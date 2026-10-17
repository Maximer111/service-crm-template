import { applyQuiet } from "../_shared/quiet.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { firstTouchText, firstTouchWaUrl, waDigits as firstTouchPhone } from "../_shared/first_touch.ts";
import { mergeRepeat } from "./repeat.ts";
import { handleReturn } from "../_shared/returning.ts";
import { submittedWebsiteFields } from "./website_fields.ts";
import { websiteAttribution, mergeWebsiteAttribution, websiteVisitChanged } from "../_shared/meta_context.ts";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const STATUS = { new: "Новый", in_progress: "В работе", follow_up: "Follow-up", pushing: "Дожим", won: "✅ Выиграно", lost: "❌ Слив", junk: "🚫 Нет связи" } as const;
type Cfg = Record<string, string>;
async function getConfig(): Promise<Cfg> {
    const { data, error } = await supabase.from("crm_app_config").select("key,value");
    if (error)
        throw error;
    return applyQuiet(Object.fromEntries((data ?? []).map((r: {
        key: string;
        value: string;
    }) => [r.key, r.value])));
}
async function tg(token: string, method: string, payload: unknown): Promise<Record<string, unknown> | null> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok)
        console.error("tg error", method, JSON.stringify(j));
    return j;
}
export function callmebotUrl(user: string, text: string): string {
    return `https://api.callmebot.com/text.php?user=${encodeURIComponent(user)}&text=${encodeURIComponent(text.slice(0, 300))}`;
}
async function callmebotAlert(cfg: Cfg, text: string): Promise<void> {
    const user = cfg.callmebot_telegram_user;
    if (!user)
        return;
    try {
        await fetch(callmebotUrl(user, text));
    }
    catch (e) {
        console.error("callmebot alert failed", e);
    }
}
function budapestProactiveHours(now = new Date()): boolean {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Budapest", hour: "2-digit", hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
    return hour >= 9 && hour < 20;
}
async function autoFirstTouch(cfg: Cfg, lead: Record<string, unknown>): Promise<{
    sent: boolean;
    status?: string;
}> {
    if (cfg.whatsapp_first_touch_enabled !== "true")
        return { sent: false, status: "disabled" };
    const leadId = String(lead.id ?? "");
    const phone = firstTouchPhone(lead.phone);
    const text = firstTouchText(lead).trim().replace(/—/g, "-").slice(0, 1600);
    if (!leadId || !phone || !text)
        return { sent: false, status: "invalid" };
    const inBusinessHours = budapestProactiveHours();
    const { data: job, error: claimError } = await supabase.from("crm_wa_outbox").insert({
        lead_id: leadId, kind: "first_touch", phone, body: text, status: "pending",
        attempts: inBusinessHours ? 1 : 0, scheduled_at: new Date().toISOString(),
    }).select("id").single();
    if (claimError) {
        if (claimError.code === "23505")
            return { sent: false, status: "duplicate" };
        throw claimError;
    }
    if (!inBusinessHours) {
        await supabase.from("crm_timeline").insert({
            lead_id: leadId, kind: "whatsapp_first_touch_queued",
            body: "Первое сообщение поставлено в очередь до дневного окна 09:00-20:00 по Будапешту",
            meta: { phone },
        });
        return { sent: false, status: "queued" };
    }
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    const sourceTimestamp = Math.floor(new Date(String(lead.created_at ?? Date.now())).getTime() / 1000);
    if (!relayUrl || !relaySecret)
        throw new Error("WhatsApp relay is not configured");
    try {
        const res = await fetch(relayUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
            body: JSON.stringify({ mode: "first_touch", leadId, phone, text, sourceTimestamp }),
        });
        const out = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (res.status === 409) {
            const reason = String(out.error ?? "existing conversation").slice(0, 500);
            const existingState = out.existingState === "in_progress" ? "in_progress" : "contacted";
            const latestSeconds = Number(out.latestTimestamp ?? 0);
            const evidenceAt = latestSeconds > 1000000000 ? new Date(latestSeconds * 1000).toISOString() : new Date().toISOString();
            await supabase.from("crm_wa_outbox").update({ status: "skipped", error: reason, updated_at: new Date().toISOString() }).eq("id", job.id);
            const statusUpdate: Record<string, unknown> = { status: existingState, status_changed_at: new Date().toISOString() };
            if (out.hasOutgoing === true)
                statusUpdate.last_contact_at = evidenceAt;
            const { data: corrected } = await supabase.from("crm_leads").update(statusUpdate)
                .eq("id", leadId).eq("status", "new").select("id").maybeSingle();
            await supabase.from("crm_timeline").insert({
                lead_id: leadId, kind: "whatsapp_first_touch_skipped",
                body: corrected
                    ? `Повтор не отправлен: переписка уже существует, статус исправлен на ${existingState === "in_progress" ? "В работе" : "Написал, ждём ответа"}`
                    : "Автоотправка остановлена: уже есть переписка или ручное сообщение",
                meta: { reason, existing_state: existingState, status_corrected: Boolean(corrected) },
            });
            return { sent: false, status: corrected ? existingState : "existing_conversation" };
        }
        if (!res.ok)
            throw new Error(`relay ${res.status}: ${String(out.error ?? "send failed")}`);
        const externalId = String(out.messageId ?? "");
        if (!externalId)
            throw new Error("relay returned no message id");
        const now = new Date().toISOString();
        await supabase.from("crm_wa_outbox").update({ status: "sent", external_message_id: externalId, sent_at: now, updated_at: now }).eq("id", job.id);
        await supabase.from("crm_wa_messages").upsert({
            provider: "evolution", account_id: cfg.whatsapp_account_id ?? "clb-personal", external_message_id: externalId,
            lead_id: leadId, direction: "outgoing", message_type: "text", body: text, sent_at: now,
            raw_meta: { automated: true, kind: "first_touch" },
        }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
        await supabase.from("crm_leads").update({ status: "contacted", last_contact_at: now, status_changed_at: now })
            .eq("id", leadId).eq("status", "new").is("last_contact_at", null);
        await supabase.from("crm_timeline").insert({
            lead_id: leadId, kind: "whatsapp_first_touch_sent", body: "📤 Первое сообщение отправлено автоматически, ждём ответа",
            meta: { external_message_id: externalId, phone },
        });
        return { sent: true, status: "contacted" };
    }
    catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
        await supabase.from("crm_wa_outbox").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "whatsapp_first_touch_failed", body: "Ошибка автоматической отправки WhatsApp", meta: { error: message } });
        console.error("first touch failed", leadId, message);
        return { sent: false, status: "failed" };
    }
}
const escapeHtml = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function normalizePhone(raw: string): string {
    const s = String(raw ?? "").trim().replace(/[^\d+]/g, "");
    if (!s)
        return "";
    return s.startsWith("+") ? "+" + s.slice(1).replace(/\D/g, "") : s;
}
function detectLang(text: string): string {
    const head = String(text ?? "").slice(0, 200);
    if (/\((?:англ|engl)[^)]*\)|,\s*EN\b/i.test(head))
        return "en";
    if (/\((?:рус|ру)[^)]*\)|,\s*RU\b/i.test(head))
        return "ru";
    return /[а-яё]/i.test(text) ? "ru" : "en";
}
function langFromContext(rawText: string, campaign?: string): string {
    const hay = `${campaign ?? ""} ${rawText ?? ""}`.toLowerCase();
    if (/\(англ\)|\(engl|\beng\b|english/.test(hay))
        return "en";
    if (/\(рус\)|\(ru\)|_ru_|\bru voice\b|русск/.test(hay))
        return "ru";
    const stripped = String(rawText ?? "")
        .replace(/новая заявка[^\n]*/gi, " ")
        .replace(/^\s*[^:\n]{0,24}:/gim, " ")
        .replace(/имя|телефон|ответы клиента|вид уборки|объект|площадь|бюджет|связь|подарок|доп|услуга|что чистим|статус/gi, " ");
    return detectLang(stripped);
}
interface Extracted {
    service?: string;
    what_to_clean?: string;
    area?: string;
    budget?: string;
    when_text?: string;
    contact_method?: string;
    gift?: string;
    extra_services?: string;
    language?: string;
    answers?: Record<string, string>;
}
const EXTRACT_SYSTEM = `You read a cleaning-company lead (from a Facebook form, Russian or English, fields may vary) and extract a flat JSON object. Keep the client's own wording, just tidy it. Translate field VALUES to short English tags where obvious but keep names/places as-is.
Return ONLY one JSON object, no markdown, with these keys (use "" when unknown):
{
 "service": one of "upholstery" (химчистка мебели/диван/ковёр), "cleaning" (уборка/клининг), "deep" (генеральная/deep), "regular" (поддерживающая/еженедельная), or "",
 "what_to_clean": short, e.g. "sofa", "carpet", "apartment 2BR",
 "area": area in m2 if present e.g. "70-80 m²",
 "budget": budget range as written e.g. "€70-100",
 "when_text": when they plan to book e.g. "within a week", "not decided",
 "contact_method": one of "telegram","whatsapp","phone","",
 "gift": chosen gift if any,
 "extra_services": extra services if any e.g. "window cleaning",
 "language": "ru" or "en",
 "answers": an object mapping each original question label to its answer (for the record)
}`;
async function extractWithClaude(apiKey: string, rawText: string): Promise<Extracted> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 700, system: EXTRACT_SYSTEM, messages: [{ role: "user", content: rawText }] }),
    });
    if (!res.ok)
        throw new Error(`Claude ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw = String(data.content?.[0]?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(raw) as Extracted;
}
function extractFallback(rawText: string): Extracted {
    const low = rawText.toLowerCase();
    const pick = (re: RegExp) => (rawText.match(re)?.[1] ?? "").trim();
    let service = "";
    if (/(химчист|диван|ковёр|ковер|upholst|sofa|carpet)/.test(low))
        service = "upholstery";
    else if (/(генеральн|deep)/.test(low))
        service = "deep";
    else if (/(еженедельн|поддержив|regular|weekly)/.test(low))
        service = "regular";
    else if (/(уборк|клининг|clean)/.test(low))
        service = "cleaning";
    let contact = "";
    if (/telegram|телеграм/.test(low))
        contact = "telegram";
    else if (/whatsapp|ватсап|ватцап/.test(low))
        contact = "whatsapp";
    return {
        service,
        what_to_clean: pick(/(?:Что чистим|What .* cleaned|Вид уборки|type of cleaning)[:\s]*([^\n]+)/i),
        area: pick(/([\d]+\s*(?:-|–|to|до)\s*[\d]+\s*m²?|[\d]+\s*м²)/i),
        budget: pick(/((?:from\s*)?€?\s*\d+\s*(?:-|–|to|до)\s*€?\s*\d+\s*€?)/i),
        when_text: pick(/(?:Когда|When)[:\s]*([^\n]+)/i),
        contact_method: contact,
        gift: pick(/(?:Подарок|gift)[:\s]*([^\n]+)/i),
        extra_services: pick(/(?:Доп услуги|additional services|Доп\.?\s*услуг)[:\s]*([^\n]+)/i),
        language: langFromContext(rawText),
        answers: {},
    };
}
function waDigits(phone: unknown): string {
    let d = String(phone ?? "").replace(/[^0-9]/g, "");
    if (!d)
        return "";
    if (d.startsWith("06"))
        d = "36" + d.slice(2);
    else if (d.length === 9)
        d = "36" + d;
    return d.length >= 10 ? d : "";
}
function statusKeyboard(leadId: string, base: string, dashKey: string) {
    const rows: Record<string, unknown>[][] = [
        [{ text: "В работе", callback_data: `s:${leadId}:in_progress` }, { text: "Follow-up", callback_data: `s:${leadId}:follow_up` }, { text: "Дожим", callback_data: `s:${leadId}:pushing` }],
        [{ text: "✅ Выиграно", callback_data: `s:${leadId}:won` }, { text: "❌ Слив", callback_data: `s:${leadId}:lost` }],
        [{ text: "🚫 Нет связи (мусор)", callback_data: `s:${leadId}:junk` }],
    ];
    if (base)
        rows.push([{ text: "🔗 Открыть карточку", url: `${base}/?key=${encodeURIComponent(dashKey)}&lead=${leadId}` }]);
    return { inline_keyboard: rows };
}
function sourceLabel(a: Record<string, unknown> | null): string {
    if (!a || typeof a !== "object")
        return "";
    const utm = String(a.utm_source ?? "").trim();
    if (utm) {
        const med = String(a.utm_medium ?? "").trim();
        return med ? `${utm} / ${med}` : utm;
    }
    const ref = String(a.referrer ?? "").trim();
    if (!ref)
        return (a.first_seen || a.landing) ? "прямой заход" : "";
    let h = "";
    try {
        h = new URL(ref).hostname.replace(/^www\./, "");
    }
    catch {
        return ref.slice(0, 60);
    }
    if (/(^|\.)google\./.test(h))
        return "Google (поиск)";
    if (/(^|\.)bing\./.test(h))
        return "Bing (поиск)";
    if (/duckduckgo\./.test(h))
        return "DuckDuckGo (поиск)";
    if (/(^|\.)yandex\./.test(h))
        return "Яндекс (поиск)";
    if (/instagram\./.test(h))
        return "Instagram";
    if (/(facebook|fb)\./.test(h))
        return "Facebook";
    if (/tiktok\./.test(h))
        return "TikTok";
    return h;
}
function cardText(lead: Record<string, unknown>): string {
    const flag = lead.language === "ru" ? "🇷🇺" : lead.language === "en" ? "🇬🇧" : "";
    const L: string[] = [];
    L.push(`🎯 <b>Новая заявка</b> ${flag}`);
    L.push("");
    L.push(`👤 <b>${escapeHtml(lead.name as string) || "-"}</b>`);
    if (lead.phone)
        L.push(`📞 ${escapeHtml(lead.phone as string)}`);
    L.push("");
    const row = (label: string, val: unknown) => { if (val)
        L.push(`${label} ${escapeHtml(String(val))}`); };
    row("🧽 Услуга:", lead.service);
    row("🛋 Что чистим:", lead.what_to_clean);
    row("📐 Площадь:", lead.area);
    row("💶 Бюджет:", lead.budget);
    row("📅 Когда:", lead.when_text);
    row("💬 Связь:", lead.contact_method);
    row("🎁 Подарок:", lead.gift);
    row("➕ Доп:", lead.extra_services);
    if (lead.campaign) {
        L.push("");
        L.push(`📊 ${escapeHtml(lead.campaign as string)}`);
    }
    const src = sourceLabel(lead.attribution as Record<string, unknown> | null);
    if (src)
        L.push(`🔎 Пришёл с: ${escapeHtml(src)}`);
    L.push("");
    L.push(`📌 Статус: <b>${STATUS[(lead.status as keyof typeof STATUS)] ?? lead.status}</b>`);
    return L.join("\n");
}
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        if (req.method !== "POST")
            return new Response("ok");
        const cfg = await getConfig();
        const secret = req.headers.get("x-intake-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
        if (!cfg.intake_secret || cfg.intake_secret === "CHANGE_ME" || secret !== cfg.intake_secret)
            return new Response("forbidden", { status: 403 });
        try {
            const ctype = req.headers.get("content-type") || "";
            const rawReq = await req.text();
            let body: Record<string, unknown> = {};
            if (ctype.includes("application/json")) {
                try {
                    body = JSON.parse(rawReq);
                }
                catch {
                    return new Response("bad json", { status: 400 });
                }
            }
            else {
                try {
                    body = JSON.parse(rawReq);
                }
                catch {
                    body = Object.fromEntries(new URLSearchParams(rawReq).entries());
                }
            }
            const name = String(body.name ?? body.full_name ?? "").trim();
            const phone = normalizePhone(String(body.phone ?? body.phone_number ?? ""));
            const campaign = String(body.campaign ?? body.campaignName ?? "").trim();
            const rawText = String(body.raw_text ?? body.text ?? "").trim();
            const receivedAt = body.received_at ?? body.dateCreated ?? null;
            const source = String(body.source ?? "facebook");
            const websiteFields = submittedWebsiteFields(source, body, rawText);
            const attribution = source === "website" ? websiteAttribution(body.attribution, body) :
                body.attribution && typeof body.attribution === "object" && !Array.isArray(body.attribution)
                    ? { ...body.attribution as Record<string, unknown> }
                    : {};
            const metaLeadId = String(body.meta_lead_id ?? body.leadgen_id ?? body.leadgenId ?? "").trim();
            if (/^\d{6,20}$/.test(metaLeadId))
                attribution.meta_lead_id = metaLeadId;
            const hash = await sha256Hex(`${phone}|${campaign}|${receivedAt ?? rawText.slice(0, 80)}`);
            const { data: dup } = await supabase.from("crm_leads").select("id,attribution").eq("content_hash", hash).limit(1);
            if (dup && dup.length) {
                if (source === "website" && websiteVisitChanged(dup[0].attribution, attribution)) {
                    const { error } = await supabase.from("crm_leads").update({
                        attribution: mergeWebsiteAttribution(dup[0].attribution, attribution),
                    }).eq("id", dup[0].id);
                    if (error)
                        return new Response(JSON.stringify({ ok: false, error: "website attribution could not be stored" }), { status: 500, headers: { "content-type": "application/json" } });
                }
                return new Response(JSON.stringify({ ok: true, duplicate: true, id: dup[0].id }), { headers: { "content-type": "application/json" } });
            }
            const p9 = phone.replace(/[^0-9]/g, "").slice(-9);
            if (p9.length >= 7) {
                const { data: prior } = await supabase.from("crm_leads").select("*")
                    .or(`phone.ilike.*${p9},attribution->>form_phone.ilike.*${p9}`).order("created_at", { ascending: false }).limit(1);
                const old = prior?.[0];
                if (old) {
                    const resurrect = ["junk", "follow_up"].includes(old.status as string);
                    const at = String(receivedAt ?? "") || new Date().toISOString();
                    const upd: Record<string, unknown> = { received_at: at, updated_at: new Date().toISOString() };
                    if (resurrect) {
                        upd.status = "new";
                        upd.status_changed_at = upd.updated_at;
                    }
                    if (source === "website")
                        upd.content_hash = hash;
                    Object.assign(upd, mergeRepeat(old, { campaign, source, at, meta_lead_id: String(attribution.meta_lead_id ?? ""), attribution }));
                    await supabase.from("crm_leads").update(upd).eq("id", old.id);
                    await supabase.from("crm_timeline").insert({ lead_id: old.id, kind: "note", body: `🔁 Повторная заявка${campaign ? ` · ${campaign}` : ""}`, meta: { raw_text: rawText, campaign, source, prev_campaign: old.campaign ?? "" } });
                    const returned = await handleReturn(supabase, cfg, old.id, { channel: `новая заявка, ${source}`, body: rawText, extra: campaign ? [`📊 ${campaign}`] : [] })
                        .catch((e) => { console.error("handleReturn", old.id, e); return null; });
                    const token = cfg.telegram_bot_token, chatId = cfg.cards_chat_id;
                    if (token && chatId && !returned) {
                        await tg(token, "sendMessage", {
                            chat_id: chatId,
                            reply_to_message_id: old.tg_message_id ?? undefined,
                            allow_sending_without_reply: true,
                            text: `🔁 Повторная заявка: ${old.name || name || "клиент"}${phone ? ` · ${phone}` : ""}${campaign ? `\n📊 ${campaign}` : ""}${resurrect ? `\n♻️ Карточка возвращена в «Новый»` : ""}`,
                            disable_web_page_preview: true,
                        });
                    }
                    return new Response(JSON.stringify({ ok: true, repeat: true, id: old.id }), { headers: { "content-type": "application/json" } });
                }
            }
            const baseLead = {
                status: "new",
                name,
                phone,
                language: (body.language as string) || langFromContext(rawText || name, campaign),
                campaign,
                source,
                raw_text: rawText,
                content_hash: hash,
                received_at: receivedAt,
                attribution,
                ...websiteFields,
            };
            const { data: inserted, error } = await supabase.from("crm_leads").insert(baseLead).select("*").single();
            if (error) {
                console.error("insert lead", error);
                await callmebotAlert(cfg, `CLB CRM: заявка ${name || phone || "?"} НЕ сохранилась в базу. ${String(error.message ?? error).slice(0, 200)}`);
                return new Response("db error", { status: 500 });
            }
            const finish = (async () => {
                try {
                    await supabase.from("crm_timeline").insert({ lead_id: inserted.id, kind: "lead_created", body: `Заявка с ${source}${campaign ? ` · ${campaign}` : ""}`, meta: { raw_text: rawText } });
                    let ex: Extracted = {};
                    const basis = rawText || [name, phone, campaign].filter(Boolean).join(" ");
                    if (basis) {
                        try {
                            ex = cfg.anthropic_api_key ? await extractWithClaude(cfg.anthropic_api_key, basis) : extractFallback(basis);
                        }
                        catch (e) {
                            console.error("extract failed", e);
                            ex = extractFallback(basis);
                        }
                    }
                    const enrich = {
                        language: (body.language as string) || ex.language || (inserted.language as string),
                        service: ex.service ?? "",
                        what_to_clean: ex.what_to_clean ?? "",
                        area: ex.area ?? "",
                        budget: ex.budget ?? "",
                        when_text: ex.when_text ?? "",
                        contact_method: ex.contact_method ?? "",
                        gift: ex.gift ?? "",
                        extra_services: ex.extra_services ?? "",
                        answers: ex.answers ?? {},
                        ...websiteFields,
                    };
                    const { data: upd } = await supabase.from("crm_leads").update(enrich).eq("id", inserted.id).select("*").single();
                    let full = upd ?? { ...inserted, ...enrich };
                    const auto = await autoFirstTouch(cfg, full as Record<string, unknown>);
                    if (auto.sent || auto.status === "contacted" || auto.status === "in_progress") {
                        full = { ...full, status: auto.status ?? "contacted", ...(auto.sent ? { last_contact_at: new Date().toISOString() } : {}) };
                    }
                    const token = cfg.telegram_bot_token;
                    const chatId = cfg.cards_chat_id;
                    if (token && chatId) {
                        const kb = statusKeyboard(inserted.id, cfg.dashboard_public_base || "", cfg.dashboard_secret || "");
                        const waUrl = firstTouchWaUrl(full);
                        if (waUrl)
                            kb.inline_keyboard.unshift([{ text: "💬 Написать в WhatsApp", url: waUrl }, { text: "✅ Отправлено", callback_data: `w:${inserted.id}` }]);
                        const sent = await tg(token, "sendMessage", {
                            chat_id: chatId,
                            text: cardText(full),
                            parse_mode: "HTML",
                            disable_web_page_preview: true,
                            reply_markup: kb,
                        });
                        const result = sent?.result as {
                            chat?: {
                                id?: number;
                            };
                            message_id?: number;
                        } | undefined;
                        if (result?.message_id) {
                            await supabase.from("crm_leads").update({ tg_chat_id: result.chat?.id, tg_message_id: result.message_id }).eq("id", inserted.id);
                        }
                    }
                }
                catch (e) {
                    console.error("post-insert pipeline failed (lead already saved)", e);
                    await callmebotAlert(cfg, `CLB CRM: заявка ${inserted.id} сохранена, но карточка в Telegram не ушла. ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
                }
            })();
            const er = (globalThis as {
                EdgeRuntime?: {
                    waitUntil?: (p: Promise<unknown>) => void;
                };
            }).EdgeRuntime;
            if (er?.waitUntil)
                er.waitUntil(finish);
            else
                await finish;
            return new Response(JSON.stringify({ ok: true, id: inserted.id }), { headers: { "content-type": "application/json" } });
        }
        catch (e) {
            console.error("intake error", e);
            await callmebotAlert(cfg, `CLB CRM: intake упал целиком. ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
            return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "content-type": "application/json" } });
        }
    });
