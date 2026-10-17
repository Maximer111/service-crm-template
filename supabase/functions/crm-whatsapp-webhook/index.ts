import { applyQuiet } from "../_shared/quiet.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { metaMessages } from "./meta.ts";
import { proactiveFollowupProblems } from "./followup_style.ts";
import { isInboundConversationLeadEligible, shouldCreateInboundLead, shouldQueueInboundConversation, } from "./inbound_lead.ts";
import { prefillFormPhone, selectLeadForMessage } from "./lead_match.ts";
import { asksForPrice, minimumCalloutReply, standardCleaningQuote } from "./pricing.ts";
import { buildQuote, quoteReply } from "./quote.ts";
import { paymentLinkReply } from "./payment_links.ts";
import { clientWords } from "./client_words.ts";
import { needsGloss } from "./gloss.ts";
import { isBareAcknowledgement, promisesToWriteBack, shouldSuppressRepeat } from "./repetition.ts";
import { runReviewSweep, runSelfLearn } from "./review.ts";
import { silentFollowupText, silentStage } from "./silent.ts";
import { jobDoneInChat } from "./job_done.ts";
import { cadenceGapMs, cadenceText, holdCadence, CADENCE_CLOSE_AFTER_HOURS, CADENCE_NEW_LEADS_FROM, CADENCE_DAYS, CADENCE_MAX_ROUNDS, CADENCE_PER_DAY } from "./cadence.ts";
import { parsePrefillForm } from "./prefill_form.ts";
import { activeDuplicate, farewellLead, farewellSlot, samePersonLeads, DUPLICATE_ACTIVE_DAYS, type PersonLead } from "./farewell_queue.ts";
import { farewellReplyKind, LATER_RE } from "./decline.ts";
import { closingText, firstTouchText, reofferText, waButtonUrl } from "../_shared/first_touch.ts";
import { handleReturn } from "../_shared/returning.ts";
import { unwrapMessage } from "./envelope.ts";
import { messageContext, originLabel, waFrom, waOriginFrom, type WaOrigin } from "./wa_origin.ts";
import { bookingChoices, bookingProblems, bookingSlot, masterForService, pricesIn, worthChecking, type BookingDraft, type ChatMessage } from "./booking.ts";
import { alreadyAsked, feedbackAskText, otherCity, reviewAskText, worthAskingReview } from "./review_ask.ts";
import { replyDelayMinutes, waitingClient, withinBotHours } from "./bot_hours.ts";
import { latinName, priceTokens, wordingObjections } from "./guards.ts";
import { priceQuote, type QuoteInput } from "./calculator.ts";
import { HOURLY_OFFER_RE, POST_RENOVATION_RE, renovationCard, type RenovationFacts } from "./price_ready.ts";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type Cfg = Record<string, string>;
type AnyMap = Record<string, any>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
async function config(): Promise<Cfg> {
    const { data, error } = await supabase.from("crm_app_config").select("key,value");
    if (error)
        throw error;
    return applyQuiet(Object.fromEntries((data ?? []).map((x: {
        key: string;
        value: string;
    }) => [x.key, x.value])));
}
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const decisionModel = (cfg: Cfg) => cfg.whatsapp_decision_model || "claude-sonnet-5";
const decisionThinking = (cfg: Cfg) => cfg.whatsapp_decision_thinking === "adaptive" ? { type: "adaptive" } : { type: "disabled" };
const decisionBudget = (cfg: Cfg) => cfg.whatsapp_decision_thinking === "adaptive" ? 8000 : 2000;
const CHEAP_MODEL = "claude-haiku-4-5-20251001";
const botOn = (cfg: Cfg, key: string) => cfg[key] === "true" && withinBotHours(cfg.whatsapp_bot_hours_manila);
const replyDelay = (cfg: Cfg, key: string, now = new Date()) => cfg[key] === "true" ? replyDelayMinutes(cfg.whatsapp_bot_hours_manila, Number(cfg.whatsapp_day_fallback_minutes ?? 0) || 0, now) : null;
const S = { type: "string" }, N = { type: "number" }, B = { type: "boolean" };
const budapestTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const stampedTranscript = (newestFirst: AnyMap[], cut: number, now = new Date()) => `NOW in Budapest: ${budapestTime.format(now)}\n` +
    [...newestFirst].reverse().map((m) => `${m.direction === "incoming" ? "CLIENT" : "OWNER"} [${m.sent_at ? budapestTime.format(new Date(String(m.sent_at))) : "?"}]: ${String(m.body || `[${m.message_type}]`).slice(0, cut)}`).join("\n");
const jsonOut = (properties: AnyMap) => ({
    format: { type: "json_schema", schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } },
});
const TEST_AUTOREPLY_PHONE = Deno.env.get("TEST_AUTOREPLY_PHONE") ?? "00000000000";
const AUTOMATION_SUPPRESSED_PHONES = new Set<string>();
const AUTOMATION_SUPPRESSED_LIDS = new Set<string>();
const automationSuppressed = (phone: unknown, remoteLid: unknown = "") => AUTOMATION_SUPPRESSED_PHONES.has(digits(phone)) || AUTOMATION_SUPPRESSED_LIDS.has(String(remoteLid ?? ""));
const normText = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const styleOnly = (v: unknown) => String(v ?? "")
    .replace(/https?:\/\/\S+/gi, "<link>")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "<email>")
    .replace(/\+?\d[\d\s()./-]{6,}\d/g, "<number>")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, "<number>")
    .replace(/^([A-ZА-ЯЁ][\p{L}'-]{1,30}),\s*(здравствуйте|добрый день)/iu, "<name>, $2")
    .replace(/^(Hi|Hello)\s+[A-Z][\p{L}'-]{1,30}/iu, "$1 <name>")
    .slice(0, 700);
async function recordStyleFeedback(leadId: string, outgoingId: string, sentText: string, sentAt: string) {
    const sent = String(sentText ?? "").trim();
    if (!sent || sent.length < 8)
        return;
    const [{ data: insight }, { data: queued }] = await Promise.all([
        supabase.from("crm_wa_insights").select("suggested_reply,last_message_at,updated_at").eq("lead_id", leadId).maybeSingle(),
        supabase.from("crm_wa_reply_queue").select("reply_body,status,updated_at,created_at")
            .eq("lead_id", leadId).neq("reply_body", "").neq("status", "sent").order("updated_at", { ascending: false }).limit(3),
    ]);
    const candidates = [
        ...(queued ?? []).map((x: AnyMap) => ({ draft: x.reply_body, at: x.updated_at ?? x.created_at })),
        { draft: insight?.suggested_reply, at: insight?.last_message_at ?? insight?.updated_at },
    ].filter((x) => String(x.draft ?? "").trim());
    const outgoingAt = new Date(sentAt).getTime();
    const source = candidates.find((x) => {
        const sourceAt = new Date(x.at ?? 0).getTime();
        return sourceAt && outgoingAt && sourceAt < outgoingAt && outgoingAt - sourceAt <= 72 * 60 * 60 * 1000;
    });
    const draft = String(source?.draft ?? "").trim();
    if (!draft || normText(draft) === normText(sent))
        return;
    const { data: exists } = await supabase.from("crm_timeline").select("id")
        .eq("lead_id", leadId).eq("kind", "sales_style_feedback")
        .contains("meta", { outgoing_id: outgoingId }).limit(1);
    if (exists?.length)
        return;
    await supabase.from("crm_timeline").insert({
        lead_id: leadId,
        kind: "sales_style_feedback",
        body: "Алекс изменил предложенный ответ",
        meta: { outgoing_id: outgoingId, draft: draft.slice(0, 1200), sent: sent.slice(0, 1200) },
    });
}
function messageText(message: AnyMap): {
    body: string;
    type: string;
} {
    if (message.conversation)
        return { body: String(message.conversation), type: "text" };
    if (message.extendedTextMessage?.text)
        return { body: String(message.extendedTextMessage.text), type: "text" };
    for (const type of ["imageMessage", "videoMessage", "documentMessage"]) {
        if (message[type])
            return { body: String(message[type].caption ?? ""), type: type.replace("Message", "") };
    }
    if (message.audioMessage)
        return { body: "", type: "audio" };
    if (message.stickerMessage)
        return { body: "", type: "sticker" };
    return { body: "", type: "unknown" };
}
function audioBase64(item: AnyMap, message: AnyMap): {
    data: string;
    mime: string;
} | null {
    const audio = message.audioMessage ?? {};
    const raw = item.base64 ?? message.base64 ?? audio.base64 ?? "";
    if (typeof raw !== "string" || !raw)
        return null;
    const match = raw.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s);
    return {
        data: (match?.[2] ?? raw).replace(/\s/g, ""),
        mime: String(match?.[1] ?? audio.mimetype ?? "audio/ogg").split(";")[0],
    };
}
async function transcribeAudio(cfg: Cfg, item: AnyMap, message: AnyMap): Promise<{
    text: string;
    status: string;
}> {
    const media = audioBase64(item, message);
    if (!media)
        return { text: "", status: "media_missing" };
    if (!cfg.deepgram_api_key)
        return { text: "", status: "not_configured" };
    if (media.data.length > 20000000)
        return { text: "", status: "too_large" };
    try {
        const bytes = Uint8Array.from(atob(media.data), (c) => c.charCodeAt(0));
        const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&mip_opt_out=true", {
            method: "POST",
            headers: {
                authorization: `Token ${cfg.deepgram_api_key}`,
                "content-type": media.mime,
            },
            body: bytes,
        });
        if (!res.ok)
            throw new Error(`transcription ${res.status}`);
        const out = await res.json() as AnyMap;
        const text = out.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
        return { text: String(text).trim().slice(0, 12000), status: "transcribed" };
    }
    catch (error) {
        console.error("voice transcription", error);
        return { text: "", status: "failed" };
    }
}
async function fetchInboundImage(job: AnyMap, lead: AnyMap, message: AnyMap): Promise<{
    data: string;
    mime: string;
}> {
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    if (!relayUrl || !relaySecret)
        throw new Error("WhatsApp relay is not configured");
    const sentAt = Math.floor(new Date(message.sent_at).getTime() / 1000);
    const remoteLid = String(message.raw_meta?.remote_lid ?? job.remote_lid ?? "");
    const res = await fetch(relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
        body: JSON.stringify({
            mode: "media",
            leadId: lead.id,
            phone: digits(job.phone || lead.phone),
            remoteLid,
            sourceTimestamp: sentAt,
            expectedInboundTimestamp: sentAt,
            expectedInboundId: String(message.external_message_id ?? ""),
        }),
    });
    const out = await res.json().catch(() => ({})) as AnyMap;
    if (!res.ok)
        throw new Error(`media relay ${res.status}: ${String(out.error ?? "image fetch failed")}`);
    const data = String(out.base64 ?? "").replace(/\s/g, "");
    const mime = String(out.mimetype ?? "image/jpeg").split(";")[0];
    if (!data || data.length > 12000000 || !/^image\/(?:jpeg|png|webp)$/i.test(mime))
        throw new Error("unsupported image");
    return { data, mime };
}
async function runMediaArchive() {
    const { data: rows } = await supabase.from("crm_wa_messages")
        .select("id,lead_id,external_message_id,sent_at,raw_meta")
        .eq("direction", "incoming").eq("message_type", "image")
        .gte("sent_at", new Date(Date.now() - 3 * 864e5).toISOString())
        .is("raw_meta->>media_path", null)
        .order("sent_at", { ascending: false }).limit(15);
    let saved = 0, failed = 0;
    for (const row of rows ?? []) {
        const { data: lead } = await supabase.from("crm_leads").select("id,phone").eq("id", row.lead_id).maybeSingle();
        if (!lead)
            continue;
        const meta = row.raw_meta ?? {};
        try {
            const image = await fetchInboundImage({ phone: lead.phone, remote_lid: meta.remote_lid }, lead, row);
            const path = `${row.lead_id}/${row.external_message_id}.${image.mime.split("/")[1].replace("jpeg", "jpg")}`;
            const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
            const { error } = await supabase.storage.from("wa-media").upload(path, bytes, { contentType: image.mime, upsert: true });
            if (error)
                throw error;
            await supabase.from("crm_wa_messages").update({ raw_meta: { ...meta, media_path: path } }).eq("id", row.id);
            saved++;
        }
        catch (error) {
            failed++;
            const tries = Number(meta.media_archive_tries ?? 0) + 1;
            await supabase.from("crm_wa_messages").update({ raw_meta: { ...meta, media_archive_tries: tries,
                    media_archive_error: String(error instanceof Error ? error.message : error).slice(0, 200),
                    ...(tries >= 3 ? { media_path: "unavailable" } : {}) } }).eq("id", row.id);
        }
    }
    return { saved, failed };
}
async function analyzeRecentInboundImages(cfg: Cfg, job: AnyMap, lead: AnyMap): Promise<string> {
    if (String(job.message_type ?? "") !== "image" || !cfg.anthropic_api_key)
        return String(job.inbound_body ?? "");
    const latestAt = new Date(Number(job.inbound_timestamp) * 1000);
    const from = new Date(latestAt.getTime() - 10 * 60 * 1000).toISOString();
    const to = new Date(latestAt.getTime() + 10 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase.from("crm_wa_messages")
        .select("external_message_id,sent_at,body,raw_meta")
        .eq("lead_id", lead.id).eq("direction", "incoming").eq("message_type", "image")
        .gte("sent_at", from).lte("sent_at", to).order("sent_at", { ascending: false }).limit(6);
    if (error)
        throw error;
    const images: {
        row: AnyMap;
        data: string;
        mime: string;
    }[] = [];
    let totalBase64 = 0;
    for (const row of [...(rows ?? [])].reverse()) {
        if (String(row.raw_meta?.media_analysis_status ?? "") === "analyzed" && String(row.body ?? "").trim())
            continue;
        try {
            const media = await fetchInboundImage(job, lead, row);
            if (totalBase64 + media.data.length > 20000000)
                break;
            totalBase64 += media.data.length;
            images.push({ row, ...media });
        }
        catch (imageError) {
            await supabase.from("crm_wa_messages").update({
                raw_meta: { ...(row.raw_meta ?? {}), media_analysis_status: "failed", media_analysis_error: String(imageError instanceof Error ? imageError.message : imageError).slice(0, 300) },
            }).eq("external_message_id", row.external_message_id).eq("lead_id", lead.id);
        }
    }
    if (!images.length) {
        const existing = (rows ?? []).map((row: AnyMap) => String(row.body ?? "").trim()).filter(Boolean);
        return existing.join(" ").slice(0, 12000) || String(job.inbound_body ?? "");
    }
    const content: AnyMap[] = [{
            type: "text",
            text: `Analyze these customer photos only for a cleaning quotation conversation. Return only JSON:
{"photos":[{"id":"","description":""}],"group_summary":""}

For each photo, describe only useful visible cleaning facts: room or object, approximate visible sections/items, materials when clear, visible dust, grease, limescale, stains, construction residue, access limitations, and whether a full or close-up photo is still needed. Never identify or describe people. Never infer facts that are not visible. Say "unclear from this photo" when uncertain. Keep each description under 350 characters and the group summary under 800 characters. Do not calculate or suggest a price.`,
        }];
    for (const image of images) {
        content.push({ type: "text", text: `PHOTO_ID: ${image.row.external_message_id}` });
        content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 900, messages: [{ role: "user", content }] }),
    });
    if (!res.ok)
        throw new Error(`image analysis ${res.status}`);
    const out = await res.json() as AnyMap;
    const analysis = extractJson((out.content ?? []).map((x: AnyMap) => x.text ?? "").join(""));
    const descriptions = new Map((Array.isArray(analysis.photos) ? analysis.photos : []).map((x: AnyMap) => [
        String(x.id ?? ""),
        String(x.description ?? "").trim().slice(0, 1000),
    ]));
    for (const image of images) {
        const description = descriptions.get(String(image.row.external_message_id)) || "Photo received; the visible cleaning condition is unclear.";
        await supabase.from("crm_wa_messages").update({
            body: `[Photo analysis] ${description}`.slice(0, 12000),
            raw_meta: { ...(image.row.raw_meta ?? {}), media_analysis_status: "analyzed", media_analysis_model: "claude-haiku-4-5" },
        }).eq("external_message_id", image.row.external_message_id).eq("lead_id", lead.id);
    }
    const summary = String(analysis.group_summary ?? "").trim().slice(0, 12000)
        || [...descriptions.values()].filter(Boolean).join(" ").slice(0, 12000);
    await supabase.from("crm_timeline").insert({
        lead_id: lead.id,
        kind: "whatsapp_media_analyzed",
        body: summary || "Фото проанализированы",
        meta: { count: images.length, status: "analyzed", inbound_message_id: job.inbound_message_id },
    });
    await supabase.from("crm_wa_reply_queue").update({ inbound_body: summary, updated_at: new Date().toISOString() }).eq("id", job.id);
    job.inbound_body = summary;
    return summary;
}
function safeProfileFirstName(value: unknown): string {
    const raw = String(value ?? "").replace(/^~+/, "").trim().replace(/\s+/g, " ");
    const first = raw.split(" ")[0] ?? "";
    if (!/^[\p{L}][\p{L}'-]{1,29}$/u.test(first))
        return "";
    if (/^(whatsapp|business|unknown|clb)$/i.test(first))
        return "";
    return first;
}
async function testReplyText(cfg: Cfg, body: string, type: string, profileName: string): Promise<string> {
    const greeting = `Hi${profileName ? ` ${profileName}` : ""}! This is Alex from CLB Cleaning Budapest.`;
    const fallback = type === "image"
        ? `${greeting} I saw your photo. Tell me a little about what you'd like cleaned and I'll take a closer look.`
        : `${greeting} I saw your message. What would you like cleaned?`;
    if (!cfg.anthropic_api_key)
        return fallback;
    const prompt = `Write one short WhatsApp reply as Alex, male manager of CLB Cleaning Budapest.
Client's verified WhatsApp profile first name: ${JSON.stringify(profileName || "unknown")}
Client's first message: ${JSON.stringify(body || `[${type}]`)}
Reply in the client's language. Start by greeting the client by name only when the verified name is not "unknown", then introduce yourself naturally as Alex from CLB Cleaning Budapest. Write in first-person singular (I/me), never as we/us. Sound like the owner personally noticed this exact message: reflect one concrete detail when available, use contractions in English, and keep the rhythm conversational. Never sound like a bot, call centre, form, ticket, notification or policy. Ask only the minimum needed to understand the cleaning request.
Never invent or mention a price, discount, availability, booking, team, arrival or payment. For upholstery or condition-dependent work, ask for suitable photos and dimensions before any estimate. Do not use an em dash. Return only the reply text.`;
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 220, messages: [{ role: "user", content: prompt }] }),
        });
        if (!res.ok)
            throw new Error(`Claude ${res.status}`);
        const out = await res.json() as AnyMap;
        const text = String((out.content ?? []).map((x: AnyMap) => x.text ?? "").join("")).trim().replace(/—/g, "-").slice(0, 1600);
        const human = await humanizeIfNeeded(cfg, text || fallback, `CLIENT: ${body || `[${type}]`}`, "first reply to a new WhatsApp conversation");
        return antiSlopReasons(human).length ? fallback : human;
    }
    catch (error) {
        console.error("test reply generation", error);
        return fallback;
    }
}
async function sendTestReply(phone: string, text: string, sourceTimestamp: number, remoteLid: string): Promise<string> {
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    if (!relayUrl || !relaySecret)
        throw new Error("WhatsApp relay is not configured");
    if (phone !== TEST_AUTOREPLY_PHONE)
        throw new Error("recipient is not allowlisted");
    const res = await fetch(relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
        body: JSON.stringify({ phone, text, sourceTimestamp, remoteLid }),
    });
    const out = await res.json().catch(() => ({})) as AnyMap;
    if (!res.ok)
        throw new Error(`relay ${res.status}: ${String(out.error ?? "send failed")}`);
    return String(out.messageId ?? out.key?.id ?? out.id ?? "");
}
async function handleTestEvent(cfg: Cfg, payload: AnyMap, item: AnyMap, phone: string, jid: string, parsed: {
    body: string;
    type: string;
}, sentAt: Date) {
    const key = item.key ?? {};
    const externalId = String(key.id ?? item.id ?? "");
    if (!externalId)
        return { accepted: false, replied: false };
    const accountId = String(payload.instance ?? payload.instanceName ?? cfg.whatsapp_account_id ?? "");
    const iso = isNaN(sentAt.getTime()) ? new Date().toISOString() : sentAt.toISOString();
    const direction = key.fromMe ? "outgoing" : "incoming";
    const { error: insertError } = await supabase.from("crm_wa_autoreply_test_events").insert({
        provider: "evolution", account_id: accountId, external_message_id: externalId,
        phone, direction, message_type: parsed.type, body: parsed.body.slice(0, 12000), sent_at: iso,
        remote_lid: jid.endsWith("@lid") ? jid : "",
        auto_reply_status: direction === "incoming" ? "claimed" : "manual_or_outgoing",
    });
    if (insertError) {
        if (insertError.code === "23505")
            return { accepted: false, replied: false, duplicate: true };
        throw insertError;
    }
    if (direction === "outgoing")
        return { accepted: true, replied: false };
    if (!parsed.body && !["image", "audio"].includes(parsed.type)) {
        await supabase.from("crm_wa_autoreply_test_events").update({ auto_reply_status: "ignored", error: "unsupported message", updated_at: new Date().toISOString() })
            .eq("provider", "evolution").eq("account_id", accountId).eq("external_message_id", externalId);
        return { accepted: true, replied: false };
    }
    const profileName = safeProfileFirstName(item.pushName ?? item.push_name ?? "");
    const reply = await testReplyText(cfg, parsed.body, parsed.type, profileName);
    const { data: newerOutgoing } = await supabase.from("crm_wa_autoreply_test_events").select("id")
        .eq("phone", phone).eq("direction", "outgoing").gt("sent_at", iso).limit(1);
    if (newerOutgoing?.length) {
        await supabase.from("crm_wa_autoreply_test_events").update({ auto_reply_status: "stopped_manual_reply", auto_reply_text: reply, updated_at: new Date().toISOString() })
            .eq("provider", "evolution").eq("account_id", accountId).eq("external_message_id", externalId);
        return { accepted: true, replied: false, stopped: "manual_reply" };
    }
    try {
        const messageId = await sendTestReply(phone, reply, Math.floor(sentAt.getTime() / 1000), jid.endsWith("@lid") ? jid : "");
        await supabase.from("crm_wa_autoreply_test_events").update({ auto_reply_status: "sent", auto_reply_text: reply, auto_reply_message_id: messageId, updated_at: new Date().toISOString() })
            .eq("provider", "evolution").eq("account_id", accountId).eq("external_message_id", externalId);
        return { accepted: true, replied: true };
    }
    catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
        const manuallyStopped = message.startsWith("relay 409:");
        await supabase.from("crm_wa_autoreply_test_events").update({ auto_reply_status: manuallyStopped ? "stopped_manual_reply" : "failed", auto_reply_text: reply, error: message, updated_at: new Date().toISOString() })
            .eq("provider", "evolution").eq("account_id", accountId).eq("external_message_id", externalId);
        if (manuallyStopped)
            return { accepted: true, replied: false, stopped: "manual_reply" };
        throw error;
    }
}
function unwrap(body: AnyMap): AnyMap[] {
    const data = body.data;
    if (Array.isArray(data))
        return data;
    if (Array.isArray(data?.messages))
        return data.messages;
    if (data?.key || data?.message)
        return [data];
    return [];
}
async function findLead(phone: string, sentAt?: Date, messageBody: unknown = "", includeApplicants = false): Promise<AnyMap | null> {
    if (phone.length < 9)
        return null;
    const tail = phone.slice(-9);
    const { data, error } = await supabase.from("crm_leads")
        .select("id,name,phone,language,status,campaign,service,source,what_to_clean,scheduled_at,when_text,assigned_master_id,created_at,received_at,updated_at")
        .limit(3000);
    if (error)
        throw error;
    const matches = (data ?? []).filter((x) => digits(x.phone).slice(-9) === tail && (includeApplicants || x.source !== "job_application"));
    return selectLeadForMessage(matches, sentAt ?? new Date(), messageBody) as AnyMap | null;
}
async function attachToFormLead(whatsappPhone: string, body: string): Promise<AnyMap | null> {
    const formPhone = prefillFormPhone(body);
    if (!formPhone || formPhone.slice(-9) === whatsappPhone.slice(-9))
        return null;
    const lead = await findLead(formPhone, new Date(), body);
    if (!lead || lead.source === "whatsapp" || new Date(String(lead.received_at ?? lead.created_at)).getTime() < Date.now() - 14 * 86400 * 1000)
        return null;
    const now = new Date().toISOString();
    const { data: cur } = await supabase.from("crm_leads").select("attribution,notes").eq("id", lead.id).maybeSingle();
    const attribution = { ...((cur?.attribution ?? {}) as AnyMap), form_phone: formPhone };
    const notes = [String(cur?.notes ?? "").trim(), `Подтверждённый номер WhatsApp: +${whatsappPhone}, в форме был +${formPhone}`].filter(Boolean).join("\n");
    await supabase.from("crm_leads").update({ phone: whatsappPhone, attribution, notes, updated_at: now }).eq("id", lead.id);
    await supabase.from("crm_wa_outbox").update({ status: "skipped", error: "client wrote first from another WhatsApp number", updated_at: now })
        .eq("lead_id", lead.id).eq("status", "pending");
    await supabase.from("crm_timeline").insert({
        lead_id: lead.id, kind: "note",
        body: `📱 Клиент написал в WhatsApp с другого номера: +${whatsappPhone}, в форме был +${formPhone}. Чат прикреплён к этой карточке, номер обновлён.`,
        meta: { form_phone: formPhone, whatsapp_phone: whatsappPhone, automatic: true },
    });
    lead.phone = whatsappPhone;
    return lead;
}
async function isActiveMasterPhone(phone: string): Promise<boolean> {
    if (!/^\d{10,15}$/.test(phone))
        return false;
    const { data, error } = await supabase.from("crm_masters").select("phone").eq("active", true);
    if (error)
        throw error;
    return (data ?? []).some((master) => digits(master.phone) === phone);
}
function isVerifiedCustomerEntryPoint(item: AnyMap, message: AnyMap): boolean {
    return String(messageContext(item, message).entryPointConversionSource ?? "").toLowerCase() === "click_to_chat_link";
}
const PLACEHOLDER_CAMPAIGNS = new Set(["", "WhatsApp inbound", "WhatsApp click-to-chat"]);
async function campaignForAd(cfg: Cfg, adId: string): Promise<string> {
    const token = String(cfg.meta_ads_access_token ?? "");
    if (!token)
        return "";
    const version = String(cfg.fb_graph_version || "v21.0");
    const url = new URL(`https://graph.facebook.com/${version}/${adId}`);
    url.searchParams.set("fields", "campaign{name}");
    url.searchParams.set("access_token", token);
    const res = await fetch(url);
    const body = await res.json().catch(() => ({})) as AnyMap;
    if (!res.ok) {
        console.error("campaignForAd", adId, String(body?.error?.message ?? res.status).slice(0, 200));
        return "";
    }
    return String(body?.campaign?.name ?? "").trim().slice(0, 200);
}
async function stampWaOrigin(cfg: Cfg, lead: AnyMap, origin: WaOrigin | null): Promise<string> {
    if (!origin || String(lead.source ?? "") !== "whatsapp")
        return "";
    const { data, error } = await supabase.from("crm_leads").select("campaign,attribution").eq("id", lead.id).maybeSingle();
    if (error)
        throw error;
    if (!data)
        return "";
    const attribution = (data.attribution ?? {}) as AnyMap;
    const before = JSON.stringify(attribution);
    const stored = (attribution.wa_ad ?? {}) as AnyMap;
    const campaign = String(data.campaign ?? "");
    const adCampaign = origin.ad_id && PLACEHOLDER_CAMPAIGNS.has(campaign)
        ? await campaignForAd(cfg, origin.ad_id) : "";
    attribution.wa_ad = { ...stored, ...origin, ...(adCampaign ? { campaign: adCampaign } : {}) };
    const from = waFrom(origin);
    if (from)
        attribution.wa_from = from;
    const renamed = adCampaign && adCampaign !== campaign;
    if (!renamed && JSON.stringify(attribution) === before)
        return "";
    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from("crm_leads")
        .update({ attribution, ...(renamed ? { campaign: adCampaign } : {}), updated_at: now }).eq("id", lead.id);
    if (updateError)
        throw updateError;
    lead.attribution = attribution;
    if (renamed) {
        lead.campaign = adCampaign;
        await supabase.from("crm_timeline").insert({
            lead_id: lead.id, kind: "note",
            body: `📢 Клиент пришёл с рекламы Meta: ${adCampaign}. Объявление ${origin.ad_id}${origin.app ? `, ${origin.app}` : ""}. Кампания в карточке была «${campaign || "пусто"}».`,
            meta: { automatic: true, wa_ad: attribution.wa_ad },
        });
    }
    return renamed ? adCampaign : String(stored.campaign ?? "");
}
async function postWhatsappLeadCard(cfg: Cfg, lead: AnyMap, firstBody: string, origin: WaOrigin | null = null) {
    const token = String(cfg.telegram_bot_token ?? "");
    const chatId = String(cfg.cards_chat_id ?? "");
    if (!token || !chatId)
        return;
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const phone = digits(lead.phone);
    const text = [
        "💬 <b>Новый клиент написал в WhatsApp</b>",
        `👤 ${esc(lead.name) || "Без имени"}`,
        phone ? `📞 +${phone}` : "📞 номер скрыт WhatsApp, связь только в чате",
        firstBody.trim() ? `✉️ ${esc(firstBody.trim().slice(0, 400))}` : "✉️ [фото или голосовое]",
        ...(origin ? [esc(originLabel(origin, PLACEHOLDER_CAMPAIGNS.has(String(lead.campaign ?? "")) ? "" : String(lead.campaign)))] : []),
        "",
        "Карточка в CRM создана. Напиши первым кнопкой ниже, иначе ответит бот.",
    ].join("\n");
    const rows: AnyMap[][] = [
        [{ text: "В работе", callback_data: `s:${lead.id}:in_progress` }, { text: "Follow-up", callback_data: `s:${lead.id}:follow_up` }],
        [{ text: "✅ Выиграно", callback_data: `s:${lead.id}:won` }, { text: "❌ Слив", callback_data: `s:${lead.id}:lost` }, { text: "🚫 Мусор", callback_data: `s:${lead.id}:junk` }],
    ];
    const firstUrl = phone ? waButtonUrl(phone, firstTouchText({ ...lead, phone })) : "";
    if (phone)
        rows.unshift(firstUrl
            ? [{ text: "✍️ Написать первое сообщение", url: firstUrl }, { text: "💬 Пустой чат", url: `https://api.whatsapp.com/send?phone=${phone}` }]
            : [{ text: "💬 Открыть чат в WhatsApp", url: `https://api.whatsapp.com/send?phone=${phone}` }]);
    if (cfg.dashboard_public_base)
        rows.push([{ text: "🔗 Открыть карточку", url: `${cfg.dashboard_public_base}/?lead=${lead.id}` }]);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: rows } }),
    });
    const out = await res.json().catch(() => ({})) as AnyMap;
    if (out?.result?.message_id) {
        await supabase.from("crm_leads").update({ tg_chat_id: out.result.chat?.id, tg_message_id: out.result.message_id }).eq("id", lead.id);
    }
    else
        console.error("whatsapp lead card", lead.id, JSON.stringify(out).slice(0, 300));
}
async function createInboundLidLead(item: AnyMap, jid: string, parsed: {
    body: string;
    type: string;
}, sentAt: Date): Promise<AnyMap> {
    const profileName = safeProfileFirstName(item.pushName ?? item.push_name ?? "");
    const body = String(parsed.body ?? "").trim();
    const receivedAt = isNaN(sentAt.getTime()) ? new Date().toISOString() : sentAt.toISOString();
    const language = /[а-яё]/iu.test(body) ? "ru"
        : /[őű]/iu.test(body) || (body.match(/[áéíóöúü]/giu) ?? []).length >= 4 ? "hu" : "en";
    const { data: lead, error } = await supabase.from("crm_leads").insert({
        name: profileName || "WhatsApp contact",
        phone: "",
        language,
        status: "in_progress",
        service: /clean|home|house|apartment|уборк|кварт|дом/iu.test(body) ? "cleaning" : "cleaning",
        what_to_clean: body.slice(0, 500),
        contact_method: "whatsapp",
        campaign: "WhatsApp click-to-chat",
        source: "whatsapp",
        raw_text: body.slice(0, 12000),
        notes: `Новый входящий WhatsApp click-to-chat. Телефон пока скрыт Evolution, подтверждённый LID: ${jid}`,
        received_at: receivedAt,
    }).select("id,name,phone,language,status,campaign,service,source,created_at,received_at").single();
    if (error)
        throw error;
    const { error: identityError } = await supabase.from("crm_wa_identities").insert({
        lead_id: lead.id, phone: "", remote_lid: jid,
        evidence: "verified WhatsApp click-to-chat inbound LID",
    });
    if (identityError)
        throw identityError;
    await supabase.from("crm_timeline").insert({
        lead_id: lead.id,
        kind: "LEAD_CREATED",
        body: "Новый клиент написал первым через WhatsApp click-to-chat",
        meta: { source: "whatsapp", remote_lid: jid, provisional_phone: true },
    });
    return lead;
}
async function createInboundPhoneLead(item: AnyMap, jid: string, phone: string, parsed: {
    body: string;
    type: string;
}, sentAt: Date): Promise<AnyMap> {
    const existing = await findLead(phone, sentAt, parsed.body, true);
    if (existing)
        return existing;
    if (FORM_PREFILL_RE.test(String(parsed.body ?? ""))) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const late = await findLead(phone, sentAt, parsed.body, true);
        if (late)
            return late;
    }
    const profileName = safeProfileFirstName(item.pushName ?? item.push_name ?? "");
    const body = String(parsed.body ?? "").trim();
    const receivedAt = isNaN(sentAt.getTime()) ? new Date().toISOString() : sentAt.toISOString();
    const language = /[а-яёіїєґ]/iu.test(body) ? "ru"
        : /[őű]/iu.test(body) || (body.match(/[áéíóöúü]/giu) ?? []).length >= 4 ? "hu" : "en";
    const pf = FORM_PREFILL_RE.test(body) ? parsePrefillForm(body) : {};
    const { data: created, error } = await supabase.from("crm_leads").insert({
        name: pf.name || profileName || "WhatsApp contact",
        phone,
        language,
        status: "in_progress",
        service: pf.service || "cleaning",
        ...(pf.area ? { area: pf.area } : {}), ...(pf.gift ? { gift: pf.gift } : {}),
        ...(pf.extra_services ? { extra_services: pf.extra_services } : {}), ...(pf.budget ? { budget: pf.budget } : {}),
        what_to_clean: body.slice(0, 500),
        contact_method: "whatsapp",
        campaign: "WhatsApp inbound",
        source: "whatsapp",
        raw_text: body.slice(0, 12000),
        notes: `Новый клиент написал первым в WhatsApp. Подтверждённый номер: +${phone}`,
        received_at: receivedAt,
    }).select("id,name,phone,language,status,campaign,service,source,what_to_clean,area,gift,extra_services,created_at,received_at").single();
    if (error)
        throw error;
    const { error: identityError } = await supabase.from("crm_wa_identities").insert({
        lead_id: created.id,
        phone,
        remote_lid: jid,
        evidence: jid.endsWith("@lid") ? "live remoteJidAlt on first inbound" : "verified phone JID on first inbound",
    });
    if (identityError?.code === "23505") {
        const { data: winner, error: winnerError } = await supabase.from("crm_wa_identities")
            .select("lead_id").eq("remote_lid", jid).maybeSingle();
        if (winnerError)
            throw winnerError;
        if (winner?.lead_id) {
            await supabase.from("crm_leads").delete().eq("id", created.id).eq("source", "whatsapp");
            const { data: lead, error: leadError } = await supabase.from("crm_leads")
                .select("id,name,phone,language,status,campaign,service,source,what_to_clean,created_at,received_at")
                .eq("id", winner.lead_id).maybeSingle();
            if (leadError)
                throw leadError;
            if (lead)
                return lead;
        }
    }
    if (identityError) {
        await supabase.from("crm_leads").delete().eq("id", created.id).eq("source", "whatsapp");
        throw identityError;
    }
    await supabase.from("crm_timeline").insert({
        lead_id: created.id,
        kind: "LEAD_CREATED",
        body: "Новый клиент написал первым в WhatsApp",
        meta: { source: "whatsapp", phone, remote_jid: jid, automatic: true },
    });
    return created;
}
async function queueConversationReply(cfg: Cfg, lead: AnyMap, phone: string, jid: string, externalId: string, sentAt: Date, parsed: {
    body: string;
    type: string;
}) {
    const delay = replyDelay(cfg, "whatsapp_conversation_autoreply_enabled");
    if (!shouldQueueInboundConversation({
        enabled: delay !== null,
        suppressed: automationSuppressed(phone || lead.phone, jid),
        body: parsed.body,
        messageType: parsed.type,
        leadSource: String(lead.source ?? ""),
    }))
        return false;
    const timestamp = Math.floor(sentAt.getTime() / 1000);
    const { error: queueError } = await supabase.from("crm_wa_reply_queue").insert({
        lead_id: lead.id, phone, remote_lid: jid.endsWith("@lid") ? jid : "",
        inbound_message_id: externalId, inbound_timestamp: timestamp,
        inbound_body: parsed.body.slice(0, 12000), message_type: parsed.type,
        scheduled_at: new Date(sentAt.getTime() + (delay ?? 0) * 60000).toISOString(),
    });
    if (queueError && queueError.code !== "23505")
        throw queueError;
    return !queueError;
}
async function ingest(cfg: Cfg, payload: AnyMap) {
    const event = String(payload.event ?? "").toLowerCase();
    if (event && !event.includes("message"))
        return { accepted: 0, ignored: "event" };
    let accepted = 0;
    let testReplies = 0;
    const lastOutgoing = new Map<string, string>();
    for (const item of unwrap(payload)) {
        const key = item.key ?? {};
        const jid = String(key.remoteJid ?? item.remoteJid ?? "");
        if (!jid || jid.endsWith("@g.us") || jid.includes("status@broadcast"))
            continue;
        const altJid = String(key.remoteJidAlt ?? item.remoteJidAlt ?? "");
        const message = unwrapMessage(item.message ?? {});
        const origin = waOriginFrom(messageContext(item, message));
        const parsed = messageText(message);
        let transcriptionStatus = "not_audio";
        if (parsed.type === "audio" && !key.fromMe) {
            const transcription = await transcribeAudio(cfg, item, message);
            parsed.body = transcription.text;
            transcriptionStatus = transcription.status;
        }
        const externalId = String(key.id ?? item.id ?? "");
        if (!externalId)
            continue;
        const rawTime = Number(item.messageTimestamp ?? item.timestamp ?? Date.now() / 1000);
        const sentAt = new Date(rawTime > 10000000000 ? rawTime : rawTime * 1000);
        let verifiedIdentity: AnyMap | null = null;
        if (jid.endsWith("@lid") && !altJid) {
            const { data, error } = await supabase.from("crm_wa_identities")
                .select("lead_id,phone,remote_lid").eq("remote_lid", jid).maybeSingle();
            if (error)
                throw error;
            verifiedIdentity = data;
        }
        let provisionalLead: AnyMap | null = null;
        if (jid.endsWith("@lid") && !altJid && !verifiedIdentity && !key.fromMe && isVerifiedCustomerEntryPoint(item, message)) {
            provisionalLead = await createInboundLidLead(item, jid, parsed, sentAt);
            await stampWaOrigin(cfg, provisionalLead, origin).catch((error) => console.error("wa origin", provisionalLead?.id, error));
            await postWhatsappLeadCard(cfg, provisionalLead, parsed.body, origin).catch((error) => console.error("lead card", error));
            verifiedIdentity = { lead_id: provisionalLead.id, phone: "", remote_lid: jid };
        }
        const phoneJid = jid.endsWith("@lid") ? (altJid || (verifiedIdentity?.phone ? `${digits(verifiedIdentity.phone)}@s.whatsapp.net` : "")) : jid;
        const phone = phoneJid.includes("@") ? digits(phoneJid.split("@")[0]) : "";
        if (!phone && !verifiedIdentity?.lead_id)
            continue;
        if (phone === TEST_AUTOREPLY_PHONE) {
            const result = await handleTestEvent(cfg, payload, item, phone, jid, parsed, sentAt);
            if (result.accepted)
                accepted++;
            if (result.replied)
                testReplies++;
            continue;
        }
        let lead: AnyMap | null = provisionalLead;
        let createdLead = false;
        if (verifiedIdentity?.lead_id) {
            if (!lead) {
                const { data, error } = await supabase.from("crm_leads")
                    .select("id,name,phone,language,status,campaign,service,source,what_to_clean,created_at,received_at")
                    .eq("id", verifiedIdentity.lead_id).neq("source", "job_application").maybeSingle();
                if (error)
                    throw error;
                lead = data;
            }
        }
        else {
            lead = await findLead(phone, sentAt, parsed.body, true);
        }
        if (!lead && !key.fromMe && phone)
            lead = await attachToFormLead(phone, parsed.body);
        const internalPhone = !lead && !key.fromMe ? await isActiveMasterPhone(phone) : false;
        if (shouldCreateInboundLead({
            fromMe: key.fromMe === true,
            phone,
            hasLead: Boolean(lead),
            suppressed: automationSuppressed(phone, jid),
            internalPhone,
        })) {
            lead = await createInboundPhoneLead(item, jid, phone, parsed, sentAt);
            createdLead = Boolean(lead);
        }
        if (!lead)
            continue;
        if (!provisionalLead)
            await stampWaOrigin(cfg, lead, origin).catch((error) => console.error("wa origin", lead?.id, error));
        if (createdLead)
            await postWhatsappLeadCard(cfg, lead, parsed.body, origin).catch((error) => console.error("lead card", error));
        if (jid.endsWith("@lid") && altJid) {
            const { error: identityError } = await supabase.from("crm_wa_identities").upsert({
                lead_id: lead.id, phone, remote_lid: jid, evidence: "live remoteJidAlt", updated_at: new Date().toISOString(),
            }, { onConflict: "lead_id" });
            if (identityError)
                console.error("identity upsert", lead.id, identityError.message);
            if (!digits(lead.phone)) {
                await supabase.from("crm_leads").update({ phone, updated_at: new Date().toISOString() }).eq("id", lead.id);
                lead.phone = phone;
            }
        }
        const { data: stored, error } = await supabase.from("crm_wa_messages").upsert({
            provider: "evolution",
            account_id: String(payload.instance ?? payload.instanceName ?? cfg.whatsapp_account_id ?? ""),
            external_message_id: externalId,
            lead_id: lead.id,
            direction: key.fromMe ? "outgoing" : "incoming",
            message_type: parsed.type,
            body: parsed.body.slice(0, 12000),
            sent_at: isNaN(sentAt.getTime()) ? new Date().toISOString() : sentAt.toISOString(),
            raw_meta: {
                push_name: item.pushName ?? "",
                has_media: parsed.type !== "text",
                ...(parsed.type === "unknown" ? { unknown_keys: Object.keys(message).slice(0, 8) } : {}),
                ...(jid.endsWith("@lid") ? { remote_lid: jid } : {}),
                ...(parsed.type === "audio" ? { transcription_status: transcriptionStatus } : {}),
            },
        }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true }).select("id");
        if (error)
            throw error;
        if (!key.fromMe && !createdLead && !provisionalLead && stored?.length
            && (parsed.body.trim() || ["image", "video", "document", "audio"].includes(parsed.type))
            && Date.now() - sentAt.getTime() < 86400000) {
            const returned = await handleReturn(supabase, cfg, String(lead.id), { channel: "WhatsApp", body: parsed.body })
                .catch((e) => { console.error("handleReturn", lead?.id, e); return null; });
            if (returned === "reopen")
                lead.status = "new";
        }
        if (!key.fromMe && lead.source === "whatsapp" && parsed.body.trim()) {
            const latestDetail = parsed.body.trim();
            const greetingOnly = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|привет|здравствуйте|добрый\s+(?:день|вечер)|доброе\s+утро|szia|helló|jó\s+(?:reggelt|napot|estét))[\s!,.?]*$/iu.test(latestDetail);
            if (!greetingOnly && !String(lead.what_to_clean ?? "").trim()) {
                await supabase.from("crm_leads").update({
                    what_to_clean: latestDetail.slice(0, 500),
                    updated_at: new Date().toISOString(),
                }).eq("id", lead.id);
                lead.what_to_clean = latestDetail.slice(0, 500);
            }
        }
        let farewelled = false;
        if (!key.fromMe && String(lead.status) === "junk") {
            const { data: fw } = await supabase.from("crm_wa_outbox").select("sent_at")
                .eq("lead_id", lead.id).in("kind", COLD_KINDS).eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle();
            farewelled = Boolean(fw) && sentAt.getTime() - new Date(String(fw?.sent_at)).getTime() > 30000;
        }
        const replyKind = farewelled ? farewellReplyKind(parsed.body) : "talk";
        if (farewelled && replyKind !== "talk") {
            const { data: noted } = await supabase.from("crm_timeline").select("id")
                .eq("lead_id", lead.id).eq("meta->>external_message_id", externalId).limit(1).maybeSingle();
            if (!noted) {
                const changedAt = new Date().toISOString();
                if (replyKind === "later") {
                    await supabase.from("crm_leads").update({ status: "follow_up", status_changed_at: changedAt, updated_at: changedAt })
                        .eq("id", lead.id).eq("status", "junk");
                }
                await supabase.from("crm_timeline").insert({
                    lead_id: lead.id, kind: "status_change",
                    body: replyKind === "decline"
                        ? "Клиент подтвердил отказ в ответ на прощание: остаётся 🚫 Нет связи"
                        : replyKind === "later"
                            ? "Клиент ответил, что напишет позже: 🚫 Нет связи → Follow-up, без пинга Алексу"
                            : "Клиент ответил без сути («спасибо», эмодзи): остаётся 🚫 Нет связи",
                    meta: { from: "junk", to: replyKind === "later" ? "follow_up" : "junk", reason: `farewell_reply_${replyKind}`, external_message_id: externalId, automated: true },
                });
            }
            accepted++;
            continue;
        }
        const formPrefillOnly = String(lead.status) === "new" && FORM_PREFILL_RE.test(String(parsed.body ?? ""));
        if (!key.fromMe && !formPrefillOnly && (["new", "contacted", "follow_up", "pushing"].includes(String(lead.status)) || farewelled)) {
            const now = new Date().toISOString();
            const previousStatus = String(lead.status);
            const { data: moved } = await supabase.from("crm_leads").update({ status: "in_progress", status_changed_at: now, updated_at: now })
                .eq("id", lead.id).eq("status", previousStatus).select("id").maybeSingle();
            if (moved) {
                await supabase.from("crm_timeline").insert({
                    lead_id: lead.id, kind: "status_change",
                    body: `Клиент написал в WhatsApp: ${({ new: "Новый", junk: "🚫 Нет связи (ответил на прощание)", follow_up: "Follow-up", pushing: "Дожим" } as Record<string, string>)[previousStatus] ?? "📨 Написал, ждём ответа"} → В работе`,
                    meta: { from: previousStatus, to: "in_progress", external_message_id: externalId },
                });
                lead.status = "in_progress";
            }
        }
        if (!key.fromMe)
            await queueConversationReply(cfg, lead, phone, jid, externalId, sentAt, parsed);
        if (key.fromMe) {
            const iso = sentAt.toISOString();
            await recordStyleFeedback(String(lead.id), externalId, parsed.body, iso);
            const prev = lastOutgoing.get(String(lead.id));
            if (!prev || iso > prev)
                lastOutgoing.set(String(lead.id), iso);
        }
        accepted++;
    }
    for (const [leadId, sentAt] of lastOutgoing) {
        const { data: cur } = await supabase.from("crm_leads").select("last_contact_at").eq("id", leadId).maybeSingle();
        if (cur?.last_contact_at && String(cur.last_contact_at) >= sentAt)
            continue;
        await supabase.from("crm_leads").update({ last_contact_at: sentAt, updated_at: new Date().toISOString() }).eq("id", leadId);
    }
    return { accepted, touched: lastOutgoing.size, test_replies: testReplies };
}
async function validMetaSignature(secret: string, rawBody: string, signature: string | null): Promise<boolean> {
    if (!secret || secret === "CHANGE_ME" || !signature?.startsWith("sha256="))
        return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
    const expectedHex = signature.slice(7).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedHex))
        return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++)
        diff |= actual[i] ^ Number.parseInt(expectedHex.slice(i * 2, i * 2 + 2), 16);
    return diff === 0;
}
async function ingestMeta(payload: AnyMap) {
    let accepted = 0;
    const lastOutgoing = new Map<string, string>();
    for (const item of metaMessages(payload)) {
        const rawTime = Number(item.timestamp ?? Date.now() / 1000);
        const sentAt = new Date(rawTime > 10000000000 ? rawTime : rawTime * 1000);
        const iso = isNaN(sentAt.getTime()) ? new Date().toISOString() : sentAt.toISOString();
        const lead = await findLead(digits(item.phone), new Date(iso), item.body);
        if (!lead)
            continue;
        const { error } = await supabase.from("crm_wa_messages").upsert({
            provider: "meta",
            account_id: item.accountId,
            external_message_id: item.externalId,
            lead_id: lead.id,
            direction: item.direction,
            message_type: item.type,
            body: item.body.slice(0, 12000),
            sent_at: iso,
            raw_meta: { push_name: item.contactName, has_media: item.type !== "text", history: item.history },
        }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
        if (error)
            throw error;
        if (item.direction === "outgoing") {
            await recordStyleFeedback(String(lead.id), item.externalId, item.body, iso);
            const prev = lastOutgoing.get(String(lead.id));
            if (!prev || iso > prev)
                lastOutgoing.set(String(lead.id), iso);
        }
        accepted++;
    }
    for (const [leadId, sentAt] of lastOutgoing) {
        const { data: cur } = await supabase.from("crm_leads").select("last_contact_at").eq("id", leadId).maybeSingle();
        if (cur?.last_contact_at && String(cur.last_contact_at) >= sentAt)
            continue;
        await supabase.from("crm_leads").update({ last_contact_at: sentAt, updated_at: new Date().toISOString() }).eq("id", leadId);
    }
    return { accepted, touched: lastOutgoing.size };
}
function extractJson(text: string): AnyMap {
    const clean = text.replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/i, "").trim();
    const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
    if (!clean)
        throw new Error("AI returned an empty answer, token budget too small");
    if (start < 0 || end < start)
        throw new Error("AI returned no JSON");
    try {
        return JSON.parse(clean.slice(start, end + 1));
    }
    catch (error) {
        console.error("extractJson failed", clean.slice(0, 3000));
        throw error;
    }
}
async function analyzeLead(cfg: Cfg, leadId: string): Promise<boolean> {
    const [{ data: lead }, { data: messages }, { data: current }, { data: feedback }] = await Promise.all([
        supabase.from("crm_leads").select("id,language,service,status,campaign,what_to_clean,area,when_text,answers,budget").eq("id", leadId).maybeSingle(),
        supabase.from("crm_wa_messages").select("direction,body,message_type,sent_at").eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(40),
        supabase.from("crm_wa_insights").select("last_message_at").eq("lead_id", leadId).maybeSingle(),
        supabase.from("crm_timeline").select("meta,created_at").eq("kind", "sales_style_feedback").order("created_at", { ascending: false }).limit(6),
    ]);
    if (!lead || !messages?.length)
        return false;
    const lastAt = String(messages[0].sent_at);
    if (current?.last_message_at && new Date(current.last_message_at) >= new Date(lastAt))
        return false;
    const transcript = [...messages].reverse().map((m) => `[${m.sent_at}] ${m.direction === "incoming" ? "CLIENT" : "CLB"}: ${m.body || `[${m.message_type}]`}`).join("\n");
    const styleExamples = (feedback ?? []).map((x: AnyMap, i: number) => {
        const meta = x.meta ?? {};
        return `Example ${i + 1}\nDRAFT: ${styleOnly(meta.draft)}\nOWNER SENT: ${styleOnly(meta.sent)}`;
    }).filter((x: string) => !x.endsWith("OWNER SENT: ")).join("\n\n");
    const prompt = `Analyze this cleaning-company WhatsApp conversation for CRM and write the next sales reply. Return only JSON:
{"summary":"Russian, max 2 sentences","objection":"short category or empty","loss_reason":"one of price,timing,no_response,competitor,trust,service_mismatch,location,duplicate,other,none","sentiment":"positive|neutral|negative","next_action":"Russian, concise","suggested_reply":"reply in the client's language; empty if no reply is appropriate","confidence":0.0}
Never invent facts, prices, discounts, availability or results. Do not include name, phone, address or other personal data in the CRM summary fields.

The suggested_reply is written as Alex, a male manager, and must sound like a natural continuation of THIS conversation, not a template or a form export.
Before writing it, silently build a list of facts the client has ALREADY provided in the lead context and the full transcript. Never ask for any of those facts again. A question asked by CLB but not yet answered is still missing.

Move the client forward by exactly ONE stage:
1. UNDERSTAND: learn why cleaning is needed now, current condition, the result that matters most, and the deadline.
2. MEASURE: only after the context is understood, ask the minimum missing price units. Cleaning: area, lived-in/move-out/post-renovation, bathrooms, pets, priority areas, photos. Windows: full photos, sash count, frame type and height/access. Upholstery: full and close-up photos, material, stains/odour, sofa seats or rug dimensions or mattress sides.
3. QUOTE: only if a price was already explicitly provided by CLB, explain what it covers and move toward scheduling. Never calculate or invent a new price here.
4. BOOK: after the client accepts the price, offer or ask for two scheduling alternatives; after a time is chosen, request the missing address/access details.

Rules for suggested_reply:
- Acknowledge the client's latest answer in one short sentence and show that it was understood.
- Treat objections as a sales conversation: identify the real concern, answer it using only confirmed facts, explain relevant value or scope, and move the client to one easy next step without pressure.
- Never quote, calculate, hint at, or volunteer a price in the first CLB reply to a new conversation. First understand the job and collect the minimum facts or photos needed for an accurate assessment.
- For upholstery, mattress, carpet, stain, or other condition-dependent work, never quote a new price until the required photos and dimensions/details have been reviewed. Ask for the missing photos or measurements instead.
- Ask only 1-3 related missing questions, not a questionnaire.
- Do not repeat greetings in an active conversation.
- Do not repeat the whole order or mechanically list form fields.
- End with one easy next action offering TWO concrete alternatives whenever possible: "сейчас или вечером", "на этой неделе или в начале следующей", "утром или после обеда". Exact facts such as area, address or sash count may be requested directly, but still finish with a two-option action.
- No em dash. No guilt, pressure, "не получил ответа", "мы честные", or premature promise to reserve a cleaner.
- If the latest client message is only thanks/acknowledgement and no reply is useful, return an empty suggested_reply.
- If the latest message in the conversation is outgoing from CLB, return an empty suggested_reply because we are waiting for the client.
- If the client objects, first identify the real concern (price vs scope, timing vs result), answer with known order facts, then give two next-step options. Do not offer a new discount or change an already quoted price.
- Match the client's language. Russian must use masculine forms for Alex: "понял", "посчитал", "проверил".
- Learn only TONE, sentence rhythm and question style from the examples below. Never copy their names, prices, dates, addresses, services or other order facts into this client reply.

Before returning JSON, silently quality-check suggested_reply and rewrite it if any answer is YES:
1. Does it ask for a fact already present in lead context or conversation?
2. Does it sound like form fields joined together or a generic call-centre template?
3. Does it contain more than three questions or move across more than one sales stage?
4. Does it end without one clear next action, or use a closed question where two useful choices are possible?
5. Does it invent a price, discount, availability, guarantee or booking?
6. Does it use an em dash, guilt, pressure, repeated greeting or the wrong gender for Alex?

Recent examples of how Alex corrected drafts (style only):
${styleExamples || "(no corrections collected yet)"}

Lead context (facts may already be answered here): service=${lead.service}, status=${lead.status}, language=${lead.language}, campaign=${lead.campaign}, requested_work=${lead.what_to_clean ?? ""}, area=${lead.area ?? ""}, requested_time=${lead.when_text ?? ""}, budget=${lead.budget ?? ""}, form_answers=${JSON.stringify(lead.answers ?? {})}
Conversation:
${transcript}`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 700, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok)
        throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const out = await res.json() as AnyMap;
    const insight = extractJson((out.content ?? []).map((x: AnyMap) => x.text ?? "").join(""));
    const row = {
        lead_id: leadId,
        summary: String(insight.summary ?? "").slice(0, 2000),
        objection: String(insight.objection ?? "").slice(0, 300),
        loss_reason: String(insight.loss_reason ?? "none").slice(0, 50),
        sentiment: String(insight.sentiment ?? "neutral").slice(0, 20),
        next_action: String(insight.next_action ?? "").slice(0, 500),
        suggested_reply: String(insight.suggested_reply ?? "").slice(0, 4000),
        confidence: Math.max(0, Math.min(1, Number(insight.confidence) || 0)),
        last_message_at: lastAt,
        analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("crm_wa_insights").upsert(row);
    if (error)
        throw error;
    await supabase.from("crm_timeline").insert({
        lead_id: leadId, kind: "whatsapp_summary", body: row.summary,
        meta: { objection: row.objection, loss_reason: row.loss_reason, next_action: row.next_action, confidence: row.confidence },
    });
    return true;
}
async function analyzePending(cfg: Cfg) {
    if (!cfg.anthropic_api_key)
        throw new Error("anthropic_api_key is not configured");
    const quietBefore = new Date(Date.now() - 10 * 60000).toISOString();
    const { data, error } = await supabase.from("crm_wa_messages").select("lead_id,sent_at")
        .lte("sent_at", quietBefore).order("sent_at", { ascending: false }).limit(500);
    if (error)
        throw error;
    const ids = [...new Set((data ?? []).map((x) => String(x.lead_id)))].slice(0, 20);
    let analyzed = 0;
    const failures: {
        lead_id: string;
        error: string;
    }[] = [];
    for (const id of ids) {
        try {
            if (await analyzeLead(cfg, id))
                analyzed++;
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error).slice(0, 500);
            failures.push({ lead_id: id, error: message });
            console.error(`analyzeLead failed for ${id}: ${message}`);
        }
    }
    return { candidates: ids.length, analyzed, failed: failures.length, failures };
}
function budapestProactiveHours(now = new Date()): boolean {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Budapest", hour: "2-digit", hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
    return hour >= 9 && hour < 20;
}
function budapestWorkingHours(cfg: Cfg, now = new Date()): boolean {
    const [from, to] = String(cfg.whatsapp_followup_window ?? "10-19").split("-").map(Number);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", hour12: false })
        .formatToParts(now).find((part) => part.type === "hour")?.value ?? -1);
    return hour >= (from || 10) && hour < (to || 19);
}
async function runSilentSweep(cfg: Cfg) {
    if (!botOn(cfg, "whatsapp_followup_enabled"))
        return { enabled: false };
    const now = new Date();
    if (!budapestWorkingHours(cfg, now))
        return { enabled: true, window: false };
    const { data: leads } = await supabase.from("crm_leads")
        .select("id,name,phone,language,service,what_to_clean,when_text,status,created_at,last_contact_at")
        .in("status", ["contacted", "in_progress"]).neq("source", "job_application")
        .order("last_contact_at", { ascending: false, nullsFirst: false }).limit(400);
    const ids = (leads ?? []).map((l: AnyMap) => String(l.id));
    if (!ids.length)
        return { enabled: true, candidates: 0, queued: 0, closed: 0 };
    const [{ data: messages }, { data: jobs }] = await Promise.all([
        supabase.from("crm_wa_messages").select("lead_id,direction,sent_at,external_message_id").in("lead_id", ids)
            .order("sent_at", { ascending: false }),
        supabase.from("crm_wa_outbox").select("lead_id,kind,status,sent_at,updated_at").in("lead_id", ids),
    ]);
    const byLead = new Map<string, AnyMap[]>();
    for (const message of messages ?? []) {
        const list = byLead.get(String(message.lead_id)) ?? [];
        list.push(message);
        byLead.set(String(message.lead_id), list);
    }
    const jobsByLead = new Map<string, AnyMap[]>();
    for (const job of jobs ?? []) {
        const list = jobsByLead.get(String(job.lead_id)) ?? [];
        list.push(job);
        jobsByLead.set(String(job.lead_id), list);
    }
    const dailyCap = Number(cfg.whatsapp_followup_daily_cap ?? 15) || 15;
    const dayStart = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const { count: sentToday } = await supabase.from("crm_wa_outbox")
        .select("id", { count: "exact", head: true }).eq("kind", "conversation_follow_up").eq("status", "sent").gte("sent_at", dayStart);
    let budget = Math.max(0, dailyCap - Number(sentToday ?? 0));
    const staleAfterDays = Number(cfg.whatsapp_followup_max_age_days ?? 30) || 30;
    let queuedNow = 0, closed = 0, candidates = 0, tooOld = 0;
    for (const lead of leads ?? []) {
        if (queuedNow >= 6 || budget <= 0)
            break;
        const list = byLead.get(String(lead.id)) ?? [];
        if (list.some((m) => m.direction === "incoming"))
            continue;
        const leadJobs = jobsByLead.get(String(lead.id)) ?? [];
        if (leadJobs.some((j) => j.kind === "conversation_follow_up" && j.status === "pending"))
            continue;
        const outgoing = list.filter((m) => m.direction === "outgoing");
        const sentJobs = leadJobs.filter((j) => j.status === "sent");
        const lastContact = lead.last_contact_at ? new Date(String(lead.last_contact_at)) : null;
        if (!outgoing.length && !lastContact)
            continue;
        candidates++;
        const touches = Math.max(outgoing.length + sentJobs.length, lastContact ? 1 : 0);
        const lastTouchMs = Math.max(outgoing.length ? new Date(outgoing[0].sent_at).getTime() : 0, ...sentJobs.map((j) => new Date(String(j.sent_at ?? j.updated_at ?? 0)).getTime() || 0), lastContact ? lastContact.getTime() : 0);
        const hours = (now.getTime() - lastTouchMs) / 3600000;
        if (hours > staleAfterDays * 24) {
            tooOld++;
            continue;
        }
        const stage = silentStage(touches, hours);
        if (!stage)
            continue;
        if (stage === "close") {
            const changedAt = now.toISOString();
            await supabase.from("crm_leads").update({ status: "junk", status_changed_at: changedAt, updated_at: changedAt }).eq("id", lead.id);
            await supabase.from("crm_timeline").insert({
                lead_id: lead.id, kind: "status_change",
                body: `🚫 Нет связи: ${touches} сообщения без единого ответа, заявка закрыта автоматически`,
                meta: { automated: true, touches },
            });
            closed++;
            continue;
        }
        const { error } = await supabase.from("crm_wa_outbox").insert({
            lead_id: lead.id, kind: "conversation_follow_up", phone: digits(lead.phone),
            body: silentFollowupText(lead, stage), status: "pending", scheduled_at: now.toISOString(),
            expected_last_outbound_timestamp: Math.floor(lastTouchMs / 1000),
            expected_last_outbound_id: outgoing.length ? String(outgoing[0].external_message_id ?? "") : "",
        });
        if (!error) {
            queuedNow++;
            budget--;
        }
    }
    return { enabled: true, window: true, candidates, queued: queuedNow, closed, too_old: tooOld, budget_left: budget };
}
async function readBookingDraft(cfg: Cfg, lead: AnyMap, messages: ChatMessage[]): Promise<BookingDraft> {
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());
    const chat = messages.map((m) => `${m.direction === "incoming" ? "CLIENT" : "OWNER"} [${fmt.format(new Date(m.sent_at))}]: ${String(m.body || "[media]").slice(0, 600)}`).join("\n");
    const prompt = `You read a WhatsApp chat between Alex of CLB Cleaning Budapest and a client, and decide whether it is a finished, undisputed order. Return only JSON:
{"ready":false,"blockers":[],"price_huf":0,"hours":0,"date":"YYYY-MM-DD","time":"HH:MM","when_text":"","address":"","service":"cleaning|upholstery|windows|mixed|other","work_ru":"","brief_ru":"","day_options":[],"time_options":[],"access_ru":""}

ready=true ONLY when every one of these holds:
- Alex stated a price and the client clearly accepted it afterwards (sure, ok, yes, deal, works for me). A question, hesitation, a counter-offer or silence is not acceptance.
- A specific calendar date is agreed. Today is ${today} in Budapest. Resolve "Wednesday" or "the 23rd" to YYYY-MM-DD. "Next week" or "sometime" is not a date.
- A start time is known. A range like "3-4 pm" gives time 15:00 and when_text "15:00-16:00".
- A full address with a house number.
- Nothing is still open: no unanswered client question, no discount request, no scope change after the price, no "I will confirm later", no second date in discussion.
Otherwise ready=false, and list every open point in blockers, in Russian, one short line each.

price_huf: the total the client pays, exactly as agreed. hours: agreed hours when priced per hour, else 0.
service: cleaning is cleaning a home or office; upholstery is sofa, mattress, carpet or chair dry cleaning; windows is window washing alone; mixed is more than one of these in one order.
work_ru: one line in Russian, what is to be done.
brief_ru: two to four short lines in Russian for the cleaner: scope, access such as bell number or door code, pets, materials, what the client asked for. No price, no phone number.
day_options: up to three dates YYYY-MM-DD the client themselves offered or agreed to, newest talk first, when no single date is settled yet ("the 23rd or the 24th" gives both). Empty when the client named no day.
time_options: up to three start times HH:MM that fit what the client said. "Morning" gives 09:00 and 10:00, "after lunch" gives 13:00 and 14:00, "3-4 pm" gives 15:00. Empty when nothing was said about the time of day.
access_ru: one line in Russian, how the cleaner gets in: bell number, floor, door, lift, who opens.
Never invent a fact that is not in the chat. Use an empty string when unknown.

Client name: ${String(lead.name ?? "")}
CHAT:
${chat}`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: decisionModel(cfg), max_tokens: 900, thinking: { type: "disabled" }, messages: [{ role: "user", content: prompt }],
            output_config: jsonOut({ ready: B, blockers: { type: "array", items: S }, price_huf: N, hours: N, date: S, time: S, when_text: S, address: S,
                service: { type: "string", enum: ["cleaning", "upholstery", "windows", "mixed", "other"] }, work_ru: S, brief_ru: S,
                day_options: { type: "array", items: S }, time_options: { type: "array", items: S }, access_ru: S }) }),
    });
    if (!res.ok)
        throw new Error(`booking read ${res.status}`);
    const out = await res.json() as AnyMap;
    return extractJson((out.content ?? []).map((x: AnyMap) => x.text ?? "").join("")) as BookingDraft;
}
async function tellOwner(cfg: Cfg, text: string) {
    const token = String(cfg.telegram_bot_token ?? "");
    const chatId = String(cfg.owner_tg_id ?? cfg.cards_chat_id ?? "");
    if (!token || !chatId)
        return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
    }).catch((error) => console.error("owner booking note", error));
}
async function readRenovationFacts(cfg: Cfg, lead: AnyMap, messages: ChatMessage[]): Promise<RenovationFacts> {
    const chat = messages.map((m) => `${m.direction === "incoming" ? "CLIENT" : "OWNER"}: ${String(m.body || "[media]").slice(0, 500)}`).join("\n");
    const prompt = `Read this WhatsApp chat between Alex of CLB Cleaning Budapest and a client. Return only JSON:
{"post_renovation":false,"ready":false,"area_m2":null,"bathrooms":null,"windows":"unknown","day":"","summary_ru":"","missing":[]}

post_renovation: the job is cleaning after renovation or builders.
ready: true only when the area in square metres is known and the client has described the state of the place (photos or words). Bathrooms and the day are useful but not required.
windows: "yes" if the client wants windows washed, "no" if they said not, otherwise "unknown".
day: the day or date the client wants, as they said it.
summary_ru: one short line in Russian with area, rooms, bathrooms, state and day.
missing: in Russian, what is still unknown for pricing.
Never invent a fact.

Client: ${String(lead.name ?? "")}
CHAT:
${chat}`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: decisionModel(cfg), max_tokens: 500, thinking: { type: "disabled" }, messages: [{ role: "user", content: prompt }],
            output_config: jsonOut({ post_renovation: B, ready: B, area_m2: { anyOf: [N, { type: "null" }] }, bathrooms: { anyOf: [N, { type: "null" }] },
                windows: S, day: S, summary_ru: S, missing: { type: "array", items: S } }) }),
    });
    if (!res.ok)
        throw new Error(`renovation read ${res.status}`);
    const out = await res.json() as AnyMap;
    return extractJson((out.content ?? []).map((x: AnyMap) => x.text ?? "").join("")) as RenovationFacts;
}
async function priceReadyForLead(cfg: Cfg, lead: AnyMap, messages: ChatMessage[], send: boolean) {
    const facts = await readRenovationFacts(cfg, lead, messages);
    const rate = Number(cfg.post_renovation_hourly_rate ?? 0);
    const card = renovationCard(lead, facts, rate > 0 ? rate : 10000);
    if (!card || !send)
        return { facts, card };
    const token = String(cfg.telegram_bot_token ?? "");
    const chatId = String(cfg.owner_tg_id ?? cfg.cards_chat_id ?? "");
    const text = rate > 0 ? card.owner : card.owner + "\n\n⚠️ Ставка после ремонта не задана в настройках, в черновике стоит 10 000. Поправь перед отправкой.";
    const url = `https://api.whatsapp.com/send?phone=${digits(lead.phone)}&text=${encodeURIComponent(card.client)}`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true,
            reply_markup: { inline_keyboard: [[{ text: "💬 Открыть WhatsApp с черновиком", url }]] } }),
    });
    await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "price_ready_card", body: "💰 Алексу ушла карточка «Готово к цене»", meta: { facts, client: card.client } });
    return { facts, card };
}
async function runPriceReadySweep(cfg: Cfg) {
    const now = new Date();
    const { data: recent } = await supabase.from("crm_wa_messages").select("lead_id")
        .eq("direction", "incoming").gte("sent_at", new Date(now.getTime() - 6 * 3600 * 1000).toISOString())
        .order("sent_at", { ascending: false }).limit(200);
    const leadIds = [...new Set((recent ?? []).map((m: AnyMap) => String(m.lead_id ?? "")).filter(Boolean))];
    let checked = 0, sent = 0;
    for (const leadId of leadIds) {
        if (checked >= 3)
            break;
        const { data: lead } = await supabase.from("crm_leads").select("id,name,phone,status,source,language,what_to_clean").eq("id", leadId).maybeSingle();
        if (!lead || !["contacted", "in_progress", "follow_up"].includes(String(lead.status)) || lead.source === "job_application")
            continue;
        const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,sent_at,raw_meta")
            .eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(60);
        const ordered = [...(rows ?? [])].reverse();
        const messages = ordered.map((m: AnyMap) => ({ direction: String(m.direction), body: String(m.body ?? ""), sent_at: String(m.sent_at) }));
        const last = messages[messages.length - 1];
        if (!last || now.getTime() - new Date(last.sent_at).getTime() < 3 * 60 * 1000)
            continue;
        const said = [String(lead.what_to_clean ?? ""), ...messages.filter((m) => m.direction === "incoming").map((m) => m.body)].join(" ");
        if (!POST_RENOVATION_RE.test(said))
            continue;
        if (ordered.some((m: AnyMap) => m.direction === "outgoing" && m.raw_meta?.automated !== true &&
            (HOURLY_OFFER_RE.test(String(m.body ?? "")) || pricesIn(String(m.body ?? "")).length)))
            continue;
        const { data: carded } = await supabase.from("crm_timeline").select("id").eq("lead_id", leadId).eq("kind", "price_ready_card").limit(1);
        if (carded?.length)
            continue;
        const { data: seen } = await supabase.from("crm_timeline").select("id").eq("lead_id", leadId)
            .eq("kind", "price_ready_check").eq("meta->>last_at", last.sent_at).limit(1);
        if (seen?.length)
            continue;
        checked++;
        const { card } = await priceReadyForLead(cfg, lead, messages, true);
        if (card)
            sent++;
        else
            await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "price_ready_check", body: "Цена после ремонта: данных пока не хватает", meta: { last_at: last.sent_at } });
    }
    return { checked, sent };
}
async function runReviewAskSweep(cfg: Cfg) {
    const url = String(cfg.google_review_url ?? "").trim();
    if (!botOn(cfg, "whatsapp_review_ask_enabled") || !url || !cfg.anthropic_api_key)
        return { enabled: false };
    const now = new Date();
    if (!budapestProactiveHours(now))
        return { enabled: true, proactive_hours: false };
    const { data: recent } = await supabase.from("crm_wa_messages").select("lead_id")
        .eq("direction", "incoming").gte("sent_at", new Date(now.getTime() - 3 * 3600 * 1000).toISOString())
        .order("sent_at", { ascending: false }).limit(200);
    const leadIds = [...new Set((recent ?? []).map((m: AnyMap) => String(m.lead_id ?? "")).filter(Boolean))];
    let checked = 0, asked = 0;
    let people: PersonLead[] | null = null;
    for (const leadId of leadIds) {
        if (checked >= 3)
            break;
        const { data: lead } = await supabase.from("crm_leads")
            .select("id,name,phone,language,status,source,review_requested_at,scheduled_at,campaign,address").eq("id", leadId).maybeSingle();
        if (!lead || lead.status !== "won" || lead.source === "job_application" || lead.review_requested_at || !digits(lead.phone))
            continue;
        if (otherCity(lead))
            continue;
        if (lead.scheduled_at && new Date(String(lead.scheduled_at)).getTime() > now.getTime())
            continue;
        if (automationSuppressed(lead.phone))
            continue;
        people ??= await loadPeople();
        if (await farewellRecentlySent(people, String(lead.id), now))
            continue;
        const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,message_type,sent_at,external_message_id,raw_meta")
            .eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(20);
        const messages = [...(rows ?? [])].reverse().map((m: AnyMap) => ({ direction: String(m.direction), body: String(m.body ?? ""), sent_at: String(m.sent_at) }));
        if (!worthAskingReview(messages, now) || alreadyAsked(messages, url))
            continue;
        checked++;
        const transcript = messages.map((m) => `${m.direction === "incoming" ? "CLIENT" : "OWNER"}: ${m.body.slice(0, 600)}`).join("\n");
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: CHEAP_MODEL, max_tokens: 300,
                messages: [{ role: "user", content: `A cleaning job for this client is finished. Read the chat and answer whether this is the right moment to ask for a Google review.

happy: the client's own last messages say the finished work was good, in their own words. Politeness alone ("ok", "thanks") is not enough.
unresolved: anything still open or sour: a complaint, a stain or a spot not removed to their satisfaction, a refund or discount request, unpaid money, a question waiting for an answer, a next visit being arranged.

CHAT:
${transcript}` }],
                output_config: jsonOut({ happy: B, unresolved: B, reason: S }),
            }),
        });
        if (!res.ok)
            continue;
        const out = await res.json() as AnyMap;
        const verdict = extractJson((out.content ?? []).map((x: AnyMap) => x.text ?? "").join(""));
        if (verdict.happy !== true || verdict.unresolved === true)
            continue;
        const last = rows?.[0] as AnyMap | undefined;
        const text = reviewAskText(lead, url);
        const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
        const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
        if (!relayUrl || !relaySecret)
            return { enabled: true, error: "relay is not configured" };
        const sent = await fetch(relayUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
            body: JSON.stringify({
                mode: "conversation", leadId: lead.id, phone: digits(lead.phone), remoteLid: String(last?.raw_meta?.remote_lid ?? ""),
                text, sourceTimestamp: Math.floor(new Date(String(last?.sent_at)).getTime() / 1000),
                expectedInboundTimestamp: Math.floor(new Date(String(last?.sent_at)).getTime() / 1000),
                expectedInboundId: String(last?.external_message_id ?? ""),
            }),
        });
        const sentOut = await sent.json().catch(() => ({})) as AnyMap;
        if (!sent.ok)
            continue;
        const stamp = new Date().toISOString();
        const externalId = String(sentOut.messageId ?? "");
        await supabase.from("crm_wa_messages").upsert({
            provider: "evolution", account_id: cfg.whatsapp_account_id ?? "clb-personal", external_message_id: externalId,
            lead_id: lead.id, direction: "outgoing", message_type: "text", body: text, sent_at: stamp,
            raw_meta: { automated: true, kind: "review_ask" },
        }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
        await supabase.from("crm_leads").update({ review_requested_at: stamp, last_contact_at: stamp, updated_at: stamp }).eq("id", lead.id);
        await supabase.from("crm_timeline").insert({
            lead_id: lead.id, kind: "review_requested",
            body: "⭐ Клиент сказал, что всё хорошо, и бот сам попросил отзыв в Google",
            meta: { automated: true, reason: String(verdict.reason ?? "").slice(0, 300), outbound_message_id: externalId },
        });
        await tellOwner(cfg, [`⭐ Попросил отзыв у довольного клиента`, `${lead.name ?? ""} ${lead.phone ?? ""}`.trim(), String(verdict.reason ?? "").slice(0, 200)].join("\n"));
        asked++;
    }
    return { enabled: true, checked, asked };
}
async function runReviewBacklogSweep(cfg: Cfg, preview = false) {
    const url = String(cfg.google_review_url ?? "").trim();
    if (!preview && (!botOn(cfg, "whatsapp_review_backlog_enabled") || !url))
        return { enabled: false };
    const now = new Date();
    if (!preview && !budapestProactiveHours(now))
        return { enabled: true, proactive_hours: false };
    const perDay = Math.max(1, Math.min(20, Number(cfg.whatsapp_review_backlog_daily ?? 10) || 10));
    const dayStart = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const { count: askedToday } = await supabase.from("crm_leads").select("id", { count: "exact", head: true })
        .gte("feedback_asked_at", dayStart);
    const left = perDay - Number(askedToday ?? 0);
    if (!preview && left <= 0)
        return { enabled: true, asked_today: Number(askedToday ?? 0), sent: 0 };
    const oldest = new Date(now.getTime() - 180 * 86400 * 1000).toISOString();
    const newest = new Date(now.getTime() - 3 * 86400 * 1000).toISOString();
    const { data: pool } = await supabase.from("crm_leads")
        .select("id,name,phone,language,scheduled_at,created_at,status,source,campaign,address")
        .eq("status", "won").neq("source", "job_application").neq("phone", "")
        .is("review_requested_at", null).is("feedback_asked_at", null)
        .order("scheduled_at", { ascending: false, nullsFirst: false }).limit(60);
    const phones = [...new Set((pool ?? []).map((l: AnyMap) => String(l.phone)))];
    const { data: siblings } = await supabase.from("crm_leads").select("id,phone").in("phone", phones);
    const { data: marks } = await supabase.from("crm_timeline").select("lead_id")
        .in("lead_id", (siblings ?? []).map((l: AnyMap) => l.id))
        .or("body.ilike.%отзыв%,body.ilike.%review%,body.ilike.%értékel%");
    const markedIds = new Set((marks ?? []).map((m: AnyMap) => String(m.lead_id)));
    const reviewedPhones = new Set((siblings ?? []).filter((l: AnyMap) => markedIds.has(String(l.id))).map((l: AnyMap) => digits(l.phone)));
    const reviewed = new Set((pool ?? []).filter((l: AnyMap) => reviewedPhones.has(digits(l.phone))).map((l: AnyMap) => String(l.id)));
    const planned: AnyMap[] = [];
    let sent = 0, skipped = 0;
    let people: PersonLead[] | null = null;
    for (const lead of pool ?? []) {
        if (reviewed.has(String(lead.id))) {
            skipped++;
            continue;
        }
        if (planned.length >= (preview ? 10 : left))
            break;
        const jobAt = String(lead.scheduled_at ?? lead.created_at ?? "");
        if (!jobAt || jobAt > newest || jobAt < oldest) {
            skipped++;
            continue;
        }
        people ??= await loadPeople();
        if (await farewellRecentlySent(people, String(lead.id), now)) {
            skipped++;
            continue;
        }
        if (automationSuppressed(lead.phone) || otherCity(lead)) {
            skipped++;
            continue;
        }
        const { data: rows } = await supabase.from("crm_wa_messages").select("direction,sent_at,external_message_id")
            .eq("lead_id", lead.id).order("sent_at", { ascending: false }).limit(5);
        const last = rows?.[0];
        if (last && String(last.sent_at) > new Date(now.getTime() - 7 * 86400 * 1000).toISOString()) {
            skipped++;
            continue;
        }
        const text = feedbackAskText(lead, jobAt.slice(0, 10));
        planned.push({ id: lead.id, name: lead.name, phone: digits(lead.phone), job: jobAt.slice(0, 10), text });
        if (preview)
            continue;
        const lastOutbound = (rows ?? []).find((m: AnyMap) => m.direction === "outgoing");
        const stamp = Math.floor((lastOutbound ? new Date(String(lastOutbound.sent_at)).getTime() : now.getTime()) / 1000);
        const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
        const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
        if (!relayUrl || !relaySecret)
            return { enabled: true, error: "relay is not configured" };
        const res = await fetch(relayUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
            body: JSON.stringify(lastOutbound
                ? { mode: "reactivation", leadId: lead.id, phone: digits(lead.phone), text, sourceTimestamp: stamp, expectedLastOutboundTimestamp: stamp, expectedLastOutboundId: String(lastOutbound.external_message_id ?? "") }
                : { mode: "first_touch", leadId: lead.id, phone: digits(lead.phone), text, sourceTimestamp: stamp }),
        });
        const out = await res.json().catch(() => ({})) as AnyMap;
        if (!res.ok) {
            skipped++;
            continue;
        }
        const iso = new Date().toISOString();
        const externalId = String(out.messageId ?? "");
        await supabase.from("crm_wa_messages").upsert({
            provider: "evolution", account_id: cfg.whatsapp_account_id ?? "clb-personal", external_message_id: externalId,
            lead_id: lead.id, direction: "outgoing", message_type: "text", body: text, sent_at: iso,
            raw_meta: { automated: true, kind: "review_feedback_ask" },
        }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
        await supabase.from("crm_leads").update({ feedback_asked_at: iso, last_contact_at: iso, updated_at: iso }).eq("id", lead.id);
        await supabase.from("crm_timeline").insert({
            lead_id: lead.id, kind: "review_feedback_asked",
            body: `⭐ Спросил прошлого клиента, как прошла уборка ${jobAt.slice(0, 10)}`,
            meta: { automated: true, outbound_message_id: externalId },
        });
        sent++;
    }
    if (preview)
        return { preview: true, asked_today: Number(askedToday ?? 0), per_day: perDay, planned, skipped_reviewed: reviewed.size };
    if (sent)
        await tellOwner(cfg, [`⭐ Спросил ${sent} прошлых клиентов, как прошла уборка`, `Ссылка на отзыв уйдёт только тем, кто ответит, что всё понравилось.`].join("\n"));
    return { enabled: true, asked_today: Number(askedToday ?? 0), sent, skipped, left };
}
async function runUnansweredPings(cfg: Cfg) {
    if (botOn(cfg, "whatsapp_conversation_autoreply_enabled"))
        return { bot_on: true };
    const now = new Date();
    const { data: recent } = await supabase.from("crm_wa_messages").select("lead_id")
        .eq("direction", "incoming").gte("sent_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
        .lte("sent_at", new Date(now.getTime() - 10 * 60 * 1000).toISOString()).limit(1000);
    const leadIds = [...new Set((recent ?? []).map((m: AnyMap) => String(m.lead_id ?? "")).filter(Boolean))];
    let pinged = 0;
    for (const leadId of leadIds) {
        if (pinged >= 10)
            break;
        const { data: lead } = await supabase.from("crm_leads").select("id,name,phone,status,source").eq("id", leadId).maybeSingle();
        if (!lead || lead.source === "job_application" || ["junk", "lost"].includes(String(lead.status)) || automationSuppressed(lead.phone))
            continue;
        const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,sent_at")
            .eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(15);
        const messages = [...(rows ?? [])].reverse().map((m: AnyMap) => ({ direction: String(m.direction), body: String(m.body ?? ""), sent_at: String(m.sent_at) }));
        const waiting = waitingClient(messages, now, (text) => isBareAcknowledgement(text) || promisesToWriteBack(text));
        if (!waiting || looksLikeSolicitation(waiting.text))
            continue;
        const { data: seen } = await supabase.from("crm_timeline").select("created_at").eq("lead_id", leadId)
            .eq("kind", "owner_ping").eq("meta->>since", waiting.since).order("created_at", { ascending: false }).limit(2);
        const morningRepeat = seen?.length === 1 && budapestProactiveHours(now) && !budapestProactiveHours(new Date(String(seen[0].created_at)));
        if (seen?.length && !morningRepeat)
            continue;
        const minutes = Math.round((now.getTime() - new Date(waiting.since).getTime()) / 60000);
        const why = morningRepeat ? `клиент ждёт ответа с ночи, ${minutes} мин` : `клиент ждёт ответа ${minutes} мин, бот днём выключен`;
        if (!await notifyOwner(cfg, lead, waiting.text, why))
            continue;
        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "owner_ping", body: `🔔 Алексу напомнили${morningRepeat ? " ещё раз утром" : ""}: клиент ждёт ответа ${minutes} мин`, meta: { since: waiting.since } });
        pinged++;
    }
    return { pinged };
}
async function tgButtons(cfg: Cfg, chatId: unknown, text: string, keyboard: AnyMap[][]) {
    const token = String(cfg.telegram_bot_token ?? "");
    if (!token || !String(chatId ?? ""))
        return false;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: String(chatId), text: text.slice(0, 3900), disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } }),
    }).catch((error) => { console.error("tg buttons", error); return null; });
    return Boolean(res?.ok);
}
async function fillCardFromDraft(leadId: string, draft: BookingDraft) {
    const { data: card } = await supabase.from("crm_leads")
        .select("id,what_to_clean,address,budget,master_brief,when_text").eq("id", leadId).maybeSingle();
    if (!card)
        return;
    const empty = (v: unknown) => !String(v ?? "").trim();
    const update: AnyMap = {};
    const work = String(draft.work_ru ?? "").trim();
    const address = String(draft.address ?? "").trim();
    const price = Math.round(Number(draft.price_huf ?? 0));
    const brief = [String(draft.brief_ru ?? "").trim(), String(draft.access_ru ?? "").trim()].filter(Boolean).join("\n");
    const when = String(draft.when_text ?? "").trim();
    if (work && empty(card.what_to_clean))
        update.what_to_clean = work.slice(0, 500);
    if (address.length > 8 && empty(card.address))
        update.address = address.slice(0, 300);
    if (price > 0 && empty(card.budget))
        update.budget = String(price);
    if (brief && empty(card.master_brief))
        update.master_brief = brief.slice(0, 1000);
    if (when && empty(card.when_text))
        update.when_text = when.slice(0, 200);
    if (!Object.keys(update).length)
        return;
    update.updated_at = new Date().toISOString();
    await supabase.from("crm_leads").update(update).eq("id", leadId);
    await supabase.from("crm_timeline").insert({
        lead_id: leadId, kind: "note",
        body: `📋 Из переписки в карточку: ${Object.keys(update).filter((k) => k !== "updated_at").join(", ")}`,
        meta: { automatic: true, filled: update },
    });
}
async function runOrderChangeSweep(cfg: Cfg) {
    if (cfg.whatsapp_auto_booking_enabled !== "true" || !cfg.anthropic_api_key)
        return { enabled: false };
    const now = new Date();
    const { data: recent } = await supabase.from("crm_wa_messages").select("lead_id")
        .eq("direction", "incoming").gte("sent_at", new Date(now.getTime() - 6 * 3600 * 1000).toISOString())
        .order("sent_at", { ascending: false }).limit(200);
    const leadIds = [...new Set((recent ?? []).map((m: AnyMap) => String(m.lead_id ?? "")).filter(Boolean))];
    let checked = 0, found = 0;
    for (const leadId of leadIds) {
        if (checked >= 4)
            break;
        const { data: lead } = await supabase.from("crm_leads")
            .select("id,name,phone,status,source,scheduled_at,address,what_to_clean,budget,assigned_master_id").eq("id", leadId).maybeSingle();
        if (!lead || lead.status !== "won" || lead.source === "job_application" || !lead.scheduled_at)
            continue;
        if (new Date(String(lead.scheduled_at)).getTime() < now.getTime())
            continue;
        const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,sent_at")
            .eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(12);
        const messages = [...(rows ?? [])].reverse().map((m: AnyMap) => ({ direction: String(m.direction), body: String(m.body ?? ""), sent_at: String(m.sent_at) }));
        const last = messages[messages.length - 1];
        if (!last || last.direction !== "incoming")
            continue;
        const { data: seen } = await supabase.from("crm_timeline").select("id").eq("lead_id", leadId)
            .eq("kind", "order_change_check").eq("meta->>last_at", last.sent_at).limit(1);
        if (seen?.length)
            continue;
        checked++;
        const tz = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Budapest", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
        const chat = messages.map((m) => `${m.direction === "incoming" ? "CLIENT" : "OWNER"} [${tz.format(new Date(m.sent_at))}]: ${m.body.slice(0, 500)}`).join("\n");
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: CHEAP_MODEL, max_tokens: 400,
                messages: [{ role: "user", content: `A cleaning job is already booked for this client. Read the last messages and say whether the CLIENT is asking to change that booked job.

Booked now: ${tz.format(new Date(String(lead.scheduled_at)))}, ${String(lead.address ?? "no address")}, ${String(lead.what_to_clean ?? "")}.
Today is ${tz.format(now)} in Budapest.

changed=true only when the client asks for a different time, a different day, a different address, or a different scope for THIS booked job, or cancels it. A question about the price, a thank you, or a new separate job is not a change.
new_date/new_time: the requested date YYYY-MM-DD and time HH:MM when the client named them, else empty.
what_ru: one short Russian line, what exactly the client asks to change.

CHAT:
${chat}` }],
                output_config: jsonOut({ changed: B, new_date: S, new_time: S, what_ru: S }),
            }),
        });
        if (!res.ok)
            continue;
        const out = await res.json() as AnyMap;
        const verdict = extractJson((out.content ?? []).map((x: AnyMap) => x.text ?? "").join(""));
        await supabase.from("crm_timeline").insert({
            lead_id: leadId, kind: "order_change_check",
            body: verdict.changed === true ? `🔁 Клиент просит изменить заказ: ${String(verdict.what_ru ?? "")}` : "Изменений по заказу нет",
            meta: { last_at: last.sent_at, verdict },
        });
        if (verdict.changed !== true)
            continue;
        found++;
        const { data: master } = lead.assigned_master_id
            ? await supabase.from("crm_masters").select("id,name,tg_chat_id").eq("id", lead.assigned_master_id).maybeSingle()
            : { data: null };
        const bookedDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" })
            .format(new Date(String(lead.scheduled_at)));
        const time = String(verdict.new_time ?? "");
        const said = String(verdict.new_date ?? "");
        const sane = /^\d{4}-\d{2}-\d{2}$/.test(said) &&
            new Date(`${said}T12:00:00Z`).getTime() > now.getTime() - 86400000 &&
            new Date(`${said}T12:00:00Z`).getTime() < now.getTime() + 120 * 86400000;
        const date = sane ? said : (time ? bookedDay : "");
        const slot = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
        const text = ["🔁 Клиент просит изменить заказ", `Клиент: ${lead.name ?? ""} ${lead.phone ?? ""}`.trim(),
            `Сейчас в CRM: ${tz.format(new Date(String(lead.scheduled_at)))}, ${String(lead.address ?? "")}`,
            `Просит: ${String(verdict.what_ru ?? "")}`, master?.name ? `Мастер: ${master.name}` : "Мастер не назначен",
            "", slot ? "Жми кнопку, если переносим, и наряд уйдёт мастеру заново." : "Новое время в переписке не названо, реши сам."].filter(Boolean).join("\n");
        const keyboard = slot ? [[{ text: `✅ Перенести на ${date} ${time}`, callback_data: `bk:${leadId}:${date}:${time}` }]] : [];
        await tgButtons(cfg, cfg.owner_tg_id ?? cfg.cards_chat_id, text, keyboard);
        if (master?.tg_chat_id)
            await tgButtons(cfg, master.tg_chat_id, text, keyboard);
    }
    return { enabled: true, checked, found };
}
async function runBookingSweep(cfg: Cfg) {
    if (cfg.whatsapp_auto_booking_enabled !== "true")
        return { enabled: false };
    const now = new Date();
    const { data: recent } = await supabase.from("crm_wa_messages").select("lead_id")
        .eq("direction", "incoming").gte("sent_at", new Date(now.getTime() - 6 * 3600 * 1000).toISOString())
        .order("sent_at", { ascending: false }).limit(200);
    const leadIds = [...new Set((recent ?? []).map((m: AnyMap) => String(m.lead_id ?? "")).filter(Boolean))];
    let checked = 0, booked = 0, held = 0;
    for (const leadId of leadIds) {
        if (checked >= 4)
            break;
        const { data: lead } = await supabase.from("crm_leads").select("id,name,phone,status,source").eq("id", leadId).maybeSingle();
        if (!lead || !["contacted", "in_progress", "follow_up"].includes(String(lead.status)) || lead.source === "job_application")
            continue;
        const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,sent_at")
            .eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(60);
        const messages = [...(rows ?? [])].reverse().map((m: AnyMap) => ({ direction: String(m.direction), body: String(m.body ?? ""), sent_at: String(m.sent_at) }));
        const last = messages[messages.length - 1];
        if (!last || now.getTime() - new Date(last.sent_at).getTime() < 3 * 60 * 1000)
            continue;
        if (!worthChecking(messages))
            continue;
        const { data: seen } = await supabase.from("crm_timeline").select("id").eq("lead_id", leadId)
            .eq("kind", "booking_check").eq("meta->>last_at", last.sent_at).limit(1);
        if (seen?.length)
            continue;
        checked++;
        const draft = await readBookingDraft(cfg, lead, messages);
        const problems = bookingProblems(draft, messages, now);
        const slot = bookingSlot(draft);
        const masterName = masterForService(draft.service);
        const { data: master } = masterName
            ? await supabase.from("crm_masters").select("id,name").eq("name", masterName).eq("active", true).maybeSingle()
            : { data: null };
        if (!problems.length && !master)
            problems.push(`мастер ${masterName} не найден в CRM`);
        if (!problems.length && master && slot) {
            const from = new Date(slot.getTime() - 5 * 3600 * 1000).toISOString();
            const to = new Date(slot.getTime() + 5 * 3600 * 1000).toISOString();
            const [own, crew] = await Promise.all([
                supabase.from("crm_leads").select("name").eq("status", "won").eq("assigned_master_id", master.id).gte("scheduled_at", from).lte("scheduled_at", to),
                supabase.from("crm_leads").select("name").eq("status", "won").contains("crew", [{ m: master.id }]).gte("scheduled_at", from).lte("scheduled_at", to),
            ]);
            const clash = [...(own.data ?? []), ...(crew.data ?? [])].map((l: AnyMap) => String(l.name));
            if (clash.length)
                problems.push(`у ${master.name} в это время уже заказ: ${clash.join(", ")}`);
        }
        const { data: previous } = await supabase.from("crm_timeline").select("meta").eq("lead_id", leadId)
            .eq("kind", "booking_check").order("created_at", { ascending: false }).limit(1);
        const sameAsBefore = JSON.stringify(previous?.[0]?.meta?.problems ?? null) === JSON.stringify(problems);
        await supabase.from("crm_timeline").insert({
            lead_id: leadId, kind: "booking_check",
            body: problems.length ? `Заказ сам не заведён: ${problems.join("; ")}` : "Заказ заводится автоматически",
            meta: { last_at: last.sent_at, problems, draft },
        });
        const price = Math.round(Number(draft.price_huf ?? 0));
        const when = slot ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Budapest", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(slot) : "";
        if (problems.length) {
            held++;
            await fillCardFromDraft(leadId, draft).catch((error) => console.error("fill card", error));
            const accepted = price > 0 && !problems.some((p) => p.startsWith("цена") || p === "клиент не ответил после цены");
            const timingOnly = problems.every((p) => /дат|числ|врем|день|дня|слот|расписан/iu.test(p));
            const choices = timingOnly && master ? bookingChoices(draft, now) : [];
            if (accepted && choices.length && !sameAsBefore) {
                const text = [`🟡 Заказ готов, не хватает только дня`, `Клиент: ${lead.name ?? ""} ${lead.phone ?? ""}`.trim(),
                    String(draft.work_ru ?? ""), String(draft.address ?? ""), String(draft.access_ru ?? ""),
                    `${price} Ft · мастер ${master!.name}`, "", "Жми день, и заказ уйдёт мастеру с нарядом."].filter(Boolean).join("\n");
                const keyboard = choices.map((c) => [{
                        text: `${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Budapest", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${c.date}T12:00:00Z`))}, ${c.time}`,
                        callback_data: `bk:${leadId}:${c.date}:${c.time}`,
                    }]);
                const sentToOwner = await tgButtons(cfg, cfg.owner_tg_id ?? cfg.cards_chat_id, text, keyboard);
                const { data: masterRow } = await supabase.from("crm_masters").select("tg_chat_id").eq("id", master!.id).maybeSingle();
                if (masterRow?.tg_chat_id)
                    await tgButtons(cfg, masterRow.tg_chat_id, text, keyboard);
                await supabase.from("crm_timeline").insert({
                    lead_id: leadId, kind: "booking_choice_sent",
                    body: `📅 Выбор дня отправлен: ${choices.map((c) => `${c.date} ${c.time}`).join(", ")}`,
                    meta: { automatic: true, choices, to_owner: sentToOwner, to_master: Boolean(masterRow?.tg_chat_id) },
                });
                continue;
            }
            if (accepted && !sameAsBefore) {
                await tellOwner(cfg, [`🟡 Заказ почти готов, но сам не заведён`, `Клиент: ${lead.name ?? ""} ${lead.phone ?? ""}`,
                    [when || "время не назначено", String(draft.address ?? "") || "адреса нет", `${price} Ft`].join(", "), `Не хватает: ${problems.join("; ")}`].join("\n"));
            }
            continue;
        }
        const changedAt = new Date().toISOString();
        const brief = String(draft.brief_ru ?? "").slice(0, 1000);
        const { data: updated } = await supabase.from("crm_leads").update({
            status: "won", status_changed_at: changedAt, updated_at: changedAt,
            scheduled_at: slot!.toISOString(), when_text: String(draft.when_text || draft.time || ""),
            address: String(draft.address), assigned_master_id: master!.id, budget: String(price),
            what_to_clean: String(draft.work_ru ?? "").slice(0, 500), master_brief: brief, master_confirmed_at: null,
            crew: [{ m: master!.id, brief: brief.slice(0, 400), sum: String(price), pay: "", sent: null, ok: null }],
        }).eq("id", leadId).in("status", ["contacted", "in_progress", "follow_up"]).select("id");
        if (!updated?.length)
            continue;
        booked++;
        await supabase.from("crm_timeline").insert({
            lead_id: leadId, kind: "status_change",
            body: `🤖 Заказ заведён автоматически: ${when}, ${draft.address}, ${master!.name}, ${price} Ft`,
            meta: { automated: true, draft },
        });
        const notify = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/crm-dashboard?action=notify_master_internal`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-reminder-secret": String(cfg.reminder_secret ?? "") },
            body: JSON.stringify({ lead: leadId }),
        }).then((r) => r.json()).catch(() => ({ ok: false })) as AnyMap;
        await tellOwner(cfg, [`✅ Заказ заведён сам`, `Клиент: ${lead.name ?? ""} ${lead.phone ?? ""}`, `${when}`, `${draft.address}`,
            `${draft.work_ru ?? ""}`, `${price} Ft`, `Мастер: ${master!.name} ${notify.ok ? "(бриф отправлен)" : "(бриф НЕ ушёл, отправь с дашборда)"}`].join("\n"));
    }
    return { enabled: true, checked, booked, held };
}
const FORM_PREFILL_RE = /I filled in your form|Kitöltöttem az űrlapot|заполнил/iu;
async function runPendingFirstTouches(cfg: Cfg) {
    if (cfg.whatsapp_first_touch_enabled !== "true")
        return { enabled: false, pending: 0, sent: 0 };
    const now = new Date();
    const { count } = await supabase.from("crm_wa_outbox").select("id", { count: "exact", head: true })
        .eq("kind", "first_touch").eq("status", "pending");
    if (!budapestProactiveHours(now))
        return { enabled: true, pending: count ?? 0, sent: 0, proactive_hours: false };
    const { data: jobs, error } = await supabase.from("crm_wa_outbox").select("*")
        .eq("kind", "first_touch").eq("status", "pending").lte("scheduled_at", now.toISOString())
        .order("created_at", { ascending: true }).limit(5);
    if (error)
        throw error;
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    let sent = 0, stopped = 0, failed = 0;
    for (const job of jobs ?? []) {
        const { data: lead } = await supabase.from("crm_leads")
            .select("id,name,phone,status,created_at,last_contact_at").eq("id", job.lead_id).maybeSingle();
        if (!lead || lead.status !== "new" || lead.last_contact_at) {
            await supabase.from("crm_wa_outbox").update({ status: "skipped", error: "lead is no longer new", updated_at: now.toISOString() }).eq("id", job.id);
            stopped++;
            continue;
        }
        if (automationSuppressed(lead.phone)) {
            await supabase.from("crm_wa_outbox").update({ status: "skipped", error: "client automation is suppressed", updated_at: now.toISOString() }).eq("id", job.id);
            stopped++;
            continue;
        }
        const sourceTimestamp = Math.floor(new Date(lead.created_at).getTime() / 1000);
        const { data: inbound } = await supabase.from("crm_wa_messages")
            .select("external_message_id,sent_at,raw_meta").eq("lead_id", lead.id).eq("direction", "incoming")
            .order("sent_at", { ascending: false }).limit(1).maybeSingle();
        const inboundTs = inbound ? Math.floor(new Date(String(inbound.sent_at)).getTime() / 1000) : 0;
        const payload = inbound
            ? { mode: "conversation", leadId: lead.id, phone: digits(lead.phone), remoteLid: String(inbound.raw_meta?.remote_lid ?? ""), text: job.body,
                sourceTimestamp: inboundTs, expectedInboundTimestamp: inboundTs, expectedInboundId: String(inbound.external_message_id ?? "") }
            : { mode: "first_touch", leadId: lead.id, phone: digits(lead.phone), text: job.body, sourceTimestamp };
        try {
            await supabase.from("crm_wa_outbox").update({ attempts: Number(job.attempts ?? 0) + 1, updated_at: now.toISOString() }).eq("id", job.id);
            const res = await fetch(relayUrl, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
                body: JSON.stringify(payload),
            });
            const out = await res.json().catch(() => ({})) as AnyMap;
            const changedAt = new Date().toISOString();
            if (res.status === 409) {
                const existingState = out.existingState === "in_progress" ? "in_progress" : "contacted";
                const latestSeconds = Number(out.latestTimestamp ?? 0);
                const update: AnyMap = { status: existingState, status_changed_at: changedAt, updated_at: changedAt };
                if (out.hasOutgoing === true && latestSeconds > 1000000000)
                    update.last_contact_at = new Date(latestSeconds * 1000).toISOString();
                await supabase.from("crm_wa_outbox").update({ status: "skipped", error: String(out.error ?? "conversation changed"), updated_at: changedAt }).eq("id", job.id);
                await supabase.from("crm_leads").update(update).eq("id", lead.id).eq("status", "new");
                await supabase.from("crm_timeline").insert({
                    lead_id: lead.id, kind: "whatsapp_first_touch_skipped",
                    body: "Повтор не отправлен: перед отправкой найдена существующая переписка",
                    meta: { existing_state: existingState, latest_timestamp: latestSeconds || null },
                });
                stopped++;
                continue;
            }
            if (!res.ok)
                throw new Error(`relay ${res.status}: ${String(out.error ?? "send failed")}`);
            const externalId = String(out.messageId ?? "");
            if (!externalId)
                throw new Error("relay returned no message id");
            await supabase.from("crm_wa_outbox").update({ status: "sent", external_message_id: externalId, sent_at: changedAt, updated_at: changedAt }).eq("id", job.id);
            await supabase.from("crm_wa_messages").upsert({
                provider: "evolution", account_id: cfg.whatsapp_account_id ?? "clb-personal", external_message_id: externalId,
                lead_id: lead.id, direction: "outgoing", message_type: "text", body: String(job.body ?? ""), sent_at: changedAt,
                raw_meta: { automated: true, kind: "first_touch", queued: true },
            }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
            await supabase.from("crm_leads").update({ status: "contacted", last_contact_at: changedAt, status_changed_at: changedAt, updated_at: changedAt })
                .eq("id", lead.id).eq("status", "new").is("last_contact_at", null);
            await supabase.from("crm_timeline").insert({
                lead_id: lead.id, kind: "whatsapp_first_touch_sent", body: "📤 Первое сообщение из дневной очереди отправлено автоматически",
                meta: { external_message_id: externalId, phone: digits(lead.phone) },
            });
            sent++;
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
            await supabase.from("crm_wa_outbox").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
            await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "whatsapp_first_touch_failed", body: "Ошибка дневной автоотправки WhatsApp", meta: { error: message } });
            failed++;
        }
    }
    return { enabled: true, pending: count ?? 0, processed: jobs?.length ?? 0, sent, stopped, failed, proactive_hours: true };
}
const SOFT_ITEM_RE = /\b(?:sofa|couch|armchair|mattress|carpet|rug|upholstery)\b|(?<![\p{L}])(?:kanapé|fotel|matrac|szőnyeg|kárpit|диван|кресл[\p{L}]*|матрас[\p{L}]*|ков[её]р|ковр[\p{L}]*|химчистк[\p{L}]*)(?![\p{L}])/iu;
async function askMasterAboutSoftItems(cfg: Cfg, lead: AnyMap, job: AnyMap): Promise<boolean> {
    const token = String(cfg.telegram_bot_token ?? "");
    if (!token)
        return false;
    const review = (lead.soft_review ?? null) as AnyMap | null;
    if (review?.asked_at || (Array.isArray(review?.items) && review.items.length))
        return false;
    const { data: master } = await supabase.from("crm_masters")
        .select("id,name,tg_chat_id").eq("active", true)
        .not("tg_chat_id", "is", null).ilike("name", "%Юр%").limit(1).maybeSingle();
    if (!master?.tg_chat_id)
        return false;
    const { data: rows } = await supabase.from("crm_wa_messages")
        .select("external_message_id,sent_at,body,raw_meta")
        .eq("lead_id", lead.id).eq("direction", "incoming").eq("message_type", "image")
        .order("sent_at", { ascending: false }).limit(6);
    let photos = 0;
    for (const row of [...(rows ?? [])].reverse()) {
        try {
            const media = await fetchInboundImage(job, lead, row);
            const bytes = Uint8Array.from(atob(media.data), (c) => c.charCodeAt(0));
            const form = new FormData();
            form.append("chat_id", String(master.tg_chat_id));
            form.append("photo", new Blob([bytes], { type: media.mime }), "item.jpg");
            const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
            if (res.ok)
                photos++;
        }
        catch (error) {
            console.error("master photo", lead.id, error);
        }
    }
    if (!photos)
        return false;
    const said = [String(lead.what_to_clean ?? ""), String(job.inbound_body ?? "")].filter(Boolean).join(" · ").slice(0, 400);
    const id = String(lead.id);
    const text = [
        "🧽 <b>Химчистка: что это за предметы?</b>",
        `Клиент: ${String(lead.name ?? "без имени").slice(0, 80)}`,
        said ? `Своими словами: ${said}` : "",
        "",
        "Жми по фото. Цену посчитаю сам, от тебя только предмет.",
    ].filter(Boolean).join("\n");
    const keyboard = [
        [{ text: "Диван прямой", callback_data: `y:${id}:sofa:str` }, { text: "Диван угловой", callback_data: `y:${id}:sofa:cor` }],
        [{ text: "Кресло", callback_data: `y:${id}:chair:1` }, { text: "Дивана нет", callback_data: `y:${id}:sofa:no` }],
        [{ text: "Матрас 1 сторона", callback_data: `y:${id}:mat:1` }, { text: "Матрас 2 стороны", callback_data: `y:${id}:mat:2` }],
        [{ text: "Кожа, не экстракция", callback_data: `y:${id}:mtrl:lea` }, { text: "Ткань", callback_data: `y:${id}:mtrl:fab` }],
        [{ text: "✅ Всё, считай", callback_data: `y:${id}:done:1` }],
    ];
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: master.tg_chat_id, text, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }),
    });
    if (!res.ok)
        return false;
    await supabase.from("crm_leads").update({
        soft_review: { asked_at: new Date().toISOString(), master: master.name, photos, items: [] },
    }).eq("id", lead.id);
    await supabase.from("crm_timeline").insert({
        lead_id: lead.id, kind: "soft_review_requested",
        body: `Фото химчистки ушли ${master.name} на оценку (${photos} шт)`,
        meta: { master_id: master.id, photos },
    });
    return true;
}
async function notifyOwner(cfg: Cfg, lead: AnyMap, latestBody: string, reason: string, draft = "") {
    const token = String(cfg.telegram_bot_token ?? "");
    const chatId = String(cfg.owner_tg_id ?? cfg.cards_chat_id ?? "");
    if (!token || !chatId)
        return false;
    const text = [
        "⚠️ Нужен ответ Алекса в WhatsApp",
        `Клиент: ${String(lead.name ?? "Без имени").slice(0, 120)}`,
        `Телефон: ${String(lead.phone ?? "").slice(0, 40)}`,
        `Причина: ${reason.slice(0, 300)}`,
        `Сообщение: ${String(latestBody || "[медиа]").slice(0, 1200)}`,
        ...(draft ? [`Готовый черновик:\n${String(draft).slice(0, 1600)}`] : []),
    ].join("\n");
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        });
        return res.ok;
    }
    catch (error) {
        console.error("owner notification", lead.id, error);
        return false;
    }
}
const SOLICITATION_RE = new RegExp([
    "review service price list",
    "negative review remove",
    "creating customer reviews",
    "\\bbuy\\b[^\\n]{0,25}\\breviews?\\b",
    "\\bwe (?:provide|offer|sell|deal)\\b[^\\n]{0,60}\\b(?:reviews?|backlinks?|seo|traffic|followers?|subscribers?|leads?)\\b",
    "\\$\\s?\\d+[^\\n]{0,40}\\b(?:reviews?|backlinks?|followers?|subscribers?)\\b",
    "\\b(?:reviews?|backlinks?|followers?|subscribers?)\\b[^\\n]{0,40}\\$\\s?\\d+",
].join("|"), "i");
function looksLikeSolicitation(body: string): boolean {
    return SOLICITATION_RE.test(String(body ?? ""));
}
function deterministicConversationAction(body: string): {
    action: "continue" | "no_reply" | "stop" | "later";
    reason: string;
} {
    const text = normText(body).replace(/[.!?,;:]+$/g, "").trim();
    if (!text)
        return { action: "continue", reason: "media_or_empty_text" };
    const noReply = /^(thanks?|thank you|thx|ok(?:ay)?|got it|perfect|great|super|спасибо(?: большое)?|благодарю|понял[аи]?|хорошо|ок|ладно|köszönöm|köszi|rendben|merci|danke|gracias|grazie)$/iu;
    if (noReply.test(text) || isBareAcknowledgement(body))
        return { action: "no_reply", reason: "acknowledgement_only" };
    const stop = /^(stop|unsubscribe|do not (?:write|message|contact)(?: me)?|don't (?:write|message|contact)(?: me)?|not interested|remove me|не пишите(?: мне)?|неинтересно|не интересно|отпишитесь|удалите мой номер|не связывайтесь(?: со мной)?|ne írjon|nem érdekel)$/iu;
    if (stop.test(text))
        return { action: "stop", reason: "client_requested_stop" };
    const later = /^(later|write (?:to )?me later|message me later|not now|maybe later|позже|напишите позже|свяжитесь позже|не сейчас|давайте позже|majd később|írjon később)$/iu;
    if (later.test(text))
        return { action: "later", reason: "client_requested_later" };
    if (!/[?\d]/.test(body) && LATER_RE.test(text))
        return { action: "later", reason: "client_requested_later" };
    return { action: "continue", reason: "" };
}
function numberTokens(value: unknown): string[] {
    return [...String(value ?? "").matchAll(/\d{1,3}(?:[   .,]\d{3})+(?!\d)|\d+(?:[.,:]\d+)?/g)].map((match) => match[0].replace(",", "."));
}
const plainNumber = (token: string) => token.replace(/[^\d]/g, "");
function hasPriceToken(value: unknown): boolean {
    return /(?:[$€£]|\b(?:ft|huf|eur|usd|gbp)\b)\s*\d|\d\s*(?:[$€£]|\b(?:ft|huf|eur|usd|gbp)\b)/iu.test(String(value ?? ""));
}
const PROMISE_RE = /\b(?:booked|reserved|confirmed|available|we can come|i can come|team will|cleaners? will arrive|arrival is confirmed|works for me|fine (?:by|with) me)\b|(?:забронировал|забронировано|подтверждаю время|время подтверждено|мы приедем|я приеду|бригада будет|команда будет|(?:приед|подъед)(?:ет|ем|ут)(?![\p{L}])|у нас свободно|есть свободное окно)|(?:lefoglaltam|megerősített időpont|csapat érkezik)/iu;
function forbiddenPromise(value: unknown): boolean {
    return PROMISE_RE.test(String(value ?? ""));
}
function antiSlopReasons(value: unknown): string[] {
    const text = String(value ?? "").trim();
    const reasons: string[] = [];
    if (CANNED_RE.test(text))
        reasons.push("canned service phrase");
    if (/—/u.test(text))
        reasons.push("em dash");
    if (/^(?:[-*•]|\d+[.)])\s/mu.test(text))
        reasons.push("list formatting");
    if (COMPANY_RE.test(text))
        reasons.push("company voice instead of Alex");
    if ((text.match(/[!?]+/g) ?? []).length > 4)
        reasons.push("too many sentence beats");
    return reasons;
}
const CANNED_RE = /\b(?:i understand your (?:request|concern)|your request has been received|i am checking the logistics|thank(?:s| you) for (?:contacting us|reaching out)|how can we (?:help|assist) you today|rest assured|at your convenience|please do not hesitate)\b|(?:я понял (?:ваш запрос|вашу просьбу)|ваша заявка получена|проверяю логистику|благодарим за обращение|чем (?:я |мы )?могу помочь|в ближайшее время|ожидайте уточнения)|(?:megértettem a kérését|köszönjük, hogy kapcsolatba lépett velünk)/iu;
const COMPANY_RE = /\b(?:we|our|us)\b|(?:^|\s)(?:мы|наш\p{L}*)(?=\s|[.,!?]|$)/iu;
const SLOP_HINT: Record<string, string> = {
    "canned service phrase": "It uses a call-centre phrase. Say it the way Alex says things in a chat.",
    "em dash": "It uses an em dash. Use a comma or a full stop.",
    "list formatting": "It is laid out as a list. Write plain sentences.",
    "company voice instead of Alex": "It speaks as a company (we, our, us, мы, наш). Alex writes as himself: I, my.",
    "too many sentence beats": "It is too long and choppy. Two or three short sentences.",
};
const writesCyrillic = (text: string) => (text.match(/\p{Script=Cyrillic}/gu) ?? []).length > (text.match(/\p{Script=Latin}/gu) ?? []).length;
const clientScriptSample = (newestFirst: AnyMap[]) => newestFirst
    .filter((m: AnyMap) => m.direction === "incoming" && /\p{L}{3}/u.test(String(m.body ?? "")) && !String(m.body).startsWith("["))
    .slice(0, 3).map((m: AnyMap) => String(m.body)).join(" ");
function replyObjections(reply: string, newestFirst: AnyMap[], allowed: Set<string>, prices: Set<string>): string[] {
    if (!reply)
        return [];
    const out: string[] = [];
    const promise = reply.match(PROMISE_RE)?.[0];
    if (promise)
        out.push(`"${promise}" promises or confirms what only Alex can confirm: a booking, availability, a day or time, the team or its arrival. Say you will check it and come back instead.`);
    for (const r of antiSlopReasons(reply)) {
        if (r === "canned service phrase")
            out.push(`"${reply.match(CANNED_RE)?.[0]}" is a call-centre phrase. Drop it and say it the way Alex talks in a chat.`);
        else if (r === "company voice instead of Alex")
            out.push(`It speaks as a company ("${[...new Set((reply.match(new RegExp(COMPANY_RE.source, "giu")) ?? []).map((w) => w.trim()))].join('", "')}"). Alex writes as himself: I, my, me.`);
        else
            out.push(SLOP_HINT[r] ?? r);
    }
    const unknown = numberTokens(reply).filter((t) => !allowed.has(plainNumber(t)));
    if (unknown.length)
        out.push(`The numbers ${unknown.join(", ")} appear nowhere in the chat, the card or the price list. Use only numbers already written there, or none.`);
    else if (hasPriceToken(reply) && !priceTokens(reply).every((t) => prices.has(plainNumber(t)))) {
        out.push("It names a price Alex has not sent in this chat. Never introduce a new price; repeat only one he already sent.");
    }
    out.push(...wordingObjections(reply));
    const clientText = clientScriptSample(newestFirst);
    if (clientText && writesCyrillic(clientText) !== writesCyrillic(reply))
        out.push("It is in a different language from the client's messages. Write in the client's language.");
    const recent = newestFirst.filter((m: AnyMap) => m.direction === "outgoing").slice(0, 3).map((m: AnyMap) => String(m.body ?? ""));
    if (shouldSuppressRepeat(reply, recent, false))
        out.push("It repeats, almost word for word, a message already sent in this chat. Answer what the client just wrote and take the next step.");
    return out;
}
async function claudeJson(cfg: Cfg, body: AnyMap, objections: (decision: AnyMap) => string[], rounds = 2, onTool?: (name: string, input: AnyMap) => unknown): Promise<{
    decision: AnyMap;
    problems: string[];
}> {
    const messages = [...body.messages];
    let decision: AnyMap = {}, problems: string[] = [];
    for (let round = 0; round <= rounds; round++) {
        let out: AnyMap = {};
        for (let step = 0; step < 4; step++) {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({ ...body, messages }),
            });
            if (!res.ok)
                throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
            out = await res.json() as AnyMap;
            const usage = (out.usage ?? {}) as AnyMap;
            console.log("claude usage", JSON.stringify({ round, step, input: usage.input_tokens, cache_write: usage.cache_creation_input_tokens, cache_read: usage.cache_read_input_tokens, output: usage.output_tokens }));
            const calls = (out.content ?? []).filter((x: AnyMap) => x.type === "tool_use");
            if (!calls.length || !onTool)
                break;
            messages.push({ role: "assistant", content: out.content });
            messages.push({ role: "user", content: calls.map((call: AnyMap) => {
                    const result = onTool(String(call.name), (call.input ?? {}) as AnyMap);
                    console.log("tool call", JSON.stringify({ name: call.name, input: call.input, result }).slice(0, 1500));
                    return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
                }) });
        }
        const text = (out.content ?? []).map((x: AnyMap) => x.text ?? "").join("");
        decision = extractJson(text);
        problems = objections(decision);
        if (!problems.length)
            break;
        console.log("guard objections", JSON.stringify({ round, problems }));
        messages.push({ role: "assistant", content: text }, { role: "user", content: `This reply was NOT sent to the client:\n- ${problems.join("\n- ")}\nRewrite it so none of this happens, keep everything else that was right, and return the same JSON.` });
    }
    return { decision, problems };
}
async function humanizeIfNeeded(cfg: Cfg, draft: string, conversation: string, purpose: string): Promise<string> {
    let current = draft.replace(/—/g, "-");
    if (!cfg.anthropic_api_key)
        return current;
    for (let attempt = 0; attempt < 2; attempt++) {
        const reasons = antiSlopReasons(current);
        if (!reasons.length)
            return current;
        const prompt = `Rewrite one WhatsApp message in Alex's personal voice. Return only the rewritten message, no JSON and no explanation.

Purpose: ${purpose}
Problems found: ${reasons.join(", ")}

Preserve the exact meaning, language, verified facts, questions and authority boundary. Do not add or remove a price, number, date, time, name, service, promise, availability, booking or next step. Write as Alex in first-person singular. Make it sound like he read this exact chat: natural spoken rhythm, contractions in English, normally 1-3 short sentences. Do not use a greeting unless the draft already has one. Do not use an em dash, list, call-centre phrase, policy phrase, stacked politeness, or "anything else" ending.
The final message must not contain the standalone words we, our or us, or their company-voice equivalents in the client's language.

Conversation for tone and meaning only:
${conversation.slice(-8000)}

Draft:
${current.slice(0, 1600)}`;
        try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({ model: decisionModel(cfg), max_tokens: 1200, thinking: { type: "disabled" }, messages: [{ role: "user", content: prompt }] }),
            });
            if (!res.ok)
                return current;
            const out = await res.json() as AnyMap;
            const rewritten = String((out.content ?? []).map((x: AnyMap) => x.text ?? "").join("")).trim().replace(/^['"]|['"]$/g, "").replace(/—/g, "-").slice(0, 1600);
            if (!rewritten)
                return current;
            current = rewritten;
        }
        catch (error) {
            console.error("humanize reply", error);
            return current;
        }
    }
    return current;
}
async function generateSafeFallback(cfg: Cfg, transcript: string, language: unknown): Promise<string> {
    if (!cfg.anthropic_api_key)
        return "";
    const lang = ({ en: "English", ru: "Russian", hu: "Hungarian" } as Record<string, string>)[String(language ?? "")] ?? "the language the client writes in";
    const prompt = `Write one safe WhatsApp reply as Alex, in ${lang}. Return only the message.

Alex is a man: if the reply is in Russian, every form referring to him is masculine. Alex will answer the substance himself. Your only job is that the client is not left in silence: show that their message was read and ask the one question that lets Alex answer faster. A client who asked for a price still gets a reply here, just without any number in it. Sound like a real owner who read the exact chat. Use first-person singular, 1-3 short natural sentences, no repeated greeting, no em dash and no list. Reflect one visible or stated detail, then ask only the smallest useful question that has not already been answered.

Do not include any number at all. Do not mention or imply a price, discount, booking, date, time, availability, team, cleaner, arrival, payment or invoice. Do not promise anything. If there is no safe useful question, return an empty response.

Conversation:
${transcript.slice(-10000)}`;
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: decisionModel(cfg), max_tokens: 800, thinking: { type: "disabled" }, messages: [{ role: "user", content: prompt }] }),
        });
        if (!res.ok)
            return "";
        const out = await res.json() as AnyMap;
        const reply = String((out.content ?? []).map((x: AnyMap) => x.text ?? "").join("")).trim().replace(/^['"]|['"]$/g, "").replace(/—/g, "-").slice(0, 1600);
        if (!reply || numberTokens(reply).length || hasPriceToken(reply) || forbiddenPromise(reply) || antiSlopReasons(reply).length)
            return "";
        return reply;
    }
    catch (error) {
        console.error("safe fallback", error);
        return "";
    }
}
type Ack = {
    reply: string;
    reason: string;
    confidence: number;
    holding?: string;
    draft?: string;
    waits?: boolean;
};
async function generateBookedAcknowledgement(cfg: Cfg, leadId: string, order: {
    amount?: unknown;
    master?: unknown;
} = {}): Promise<Ack> {
    if (!cfg.anthropic_api_key)
        return { reply: "", reason: "AI is not configured", confidence: 0 };
    const [{ data: lead }, { data: messages }, { data: feedback }] = await Promise.all([
        supabase.from("crm_leads").select("id,name,language,service,status,what_to_clean,scheduled_at,when_text,address").eq("id", leadId).maybeSingle(),
        supabase.from("crm_wa_messages").select("direction,body,message_type,sent_at").eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(40),
        supabase.from("crm_timeline").select("meta,created_at").eq("kind", "sales_style_feedback").order("created_at", { ascending: false }).limit(6),
    ]);
    const { data: history } = await supabase.from("crm_timeline")
        .select("body,meta,created_at").eq("lead_id", leadId).eq("kind", "whatsapp_summary")
        .order("created_at", { ascending: false }).limit(3);
    const earlier = (history ?? []).reverse().map((x: AnyMap) => `${String(x.created_at).slice(0, 10)}: ${String(x.body ?? "").slice(0, 400)}`).join("\n");
    return await ackFromContext(cfg, { lead, messages: messages ?? [], feedback: feedback ?? [], earlier, order });
}
async function ackFromContext(cfg: Cfg, ctx: {
    lead: AnyMap | null;
    messages: AnyMap[];
    feedback: AnyMap[];
    earlier: string;
    order: {
        amount?: unknown;
        master?: unknown;
    };
    now?: Date;
}): Promise<Ack> {
    const { lead, messages, feedback, earlier, order } = ctx;
    if (!lead || !messages?.length || messages[0].direction !== "incoming")
        return { reply: "", reason: "conversation context is missing or stale", confidence: 0 };
    const transcript = stampedTranscript(messages, 2500, ctx.now);
    const styleExamples = (feedback ?? []).map((x: AnyMap) => {
        const meta = x.meta ?? {};
        return `DRAFT: ${styleOnly(meta.draft)}\nOWNER SENT: ${styleOnly(meta.sent)}`;
    }).filter((x: string) => !x.endsWith("OWNER SENT: ")).join("\n\n");
    const latestWords = String(messages[0].body ?? "");
    const holdingLang = writesCyrillic(latestWords) ? "ru"
        : /[őű]/iu.test(latestWords) || (latestWords.match(/[áéíóöúü]/giu) ?? []).length >= 2 ? "hu"
            : /\b(?:the|you|and|could|please|thank|is|are|can|what|when)\b/iu.test(latestWords) ? "en"
                : String(lead.language ?? "en");
    const holdingLine: Record<string, string> = {
        ru: "Понял, посмотрю и вернусь к вам с ответом.",
        hu: "Rendben, utánanézek, és visszaírok.",
        en: "Got it, I'll look into it and come back to you.",
    };
    const giveUp = (reason: string, confidence: number, draft = "") => ({
        reply: "", reason, confidence, draft,
        holding: isBareAcknowledgement(latestWords) ? "" : holdingLine[holdingLang] ?? holdingLine.en,
    });
    const prompt = `You write a warm, natural WhatsApp acknowledgement for Alex at CLB Cleaning Budapest. Return only JSON:
{"reply":"","reason":"","confidence":0.0,"client_waits":true}

This is an existing booked order. Reply in the language of the client's latest message (not the language of the card), as Alex in first-person singular, with no greeting.
First decide client_waits: true when the client is waiting for something from Alex (a question, a request, a change, a new job); false when the message closes the exchange (thanks, okay, "I'll wait for your update", a review left, a cancellation).
When client_waits is true, write exactly two short, conversational sentences. Sentence 1 warmly reflects the client's latest specific concern, preference, or personal reason. Use the concrete human detail when one is present, such as children being at school, instead of saying "I understand your request". Do not repeat the whole order. Sentence 2 naturally says that Alex will see what he can work out on his side and will come back with a clear answer. Use a cleaner name only from assigned_cleaner in the order context.
When client_waits is false, write one short warm sentence if the message deserves it (a review, a cancellation), otherwise return an empty reply.

The message should sound like a real owner replying personally, not a dispatcher, ticketing system, call centre, or legal notice. Natural phrases such as "Of course, that makes complete sense", "Let me see what I can work out with Ivan", and "I'll come back to you as soon as I have a clear answer" are good style examples. Adapt them to the actual context and language; do not copy details that are not in the conversation.

Alex's voice card, learned from how he writes (style only, never a fact):
${String(cfg.style_guide ?? "(not learned yet)").slice(0, 2000)}

Learn only tone and sentence rhythm from Alex's corrections below. Never copy their client names, prices, dates, addresses, services or order facts:
${styleExamples || "(no corrections collected yet)"}

Hard rules:
- This is only acknowledgement of receipt, not a decision.
- Name a cleaner ONLY if assigned_cleaner is filled, and only that exact name. Never reuse a name from earlier in this conversation: a previous job for the same client was often done by somebody else, and naming the wrong person tells the client we do not know who is coming.
- confirmed_total belongs to THIS booked order only. You may repeat it exactly when the client asks what they owe for this order. If the client is asking about a different job, another property, a repeat visit or a new service, that is a new quote: never answer it with confirmed_total and never estimate. Return an empty reply so it reaches Alex.
- Never confirm or change a date, time, booking, cleaner, team, arrival, address, price, payment or invoice.
- Never say that a requested option is available or possible.
- Never invent a reason, fact, number, urgency, discount or promise.
- Do not use an em dash. Do not ask a question.
- Avoid mechanical phrases such as "your request has been received", "I am checking the logistics", "the exact details", or their literal translations.
- If the latest message is only thanks/acknowledgement, or cannot be safely acknowledged, return an empty reply.

What happened earlier with this client (running summary, older than the messages below):
${earlier || "(no earlier summary)"}

Order context: language=${lead.language ?? ""}; service=${lead.service ?? ""}; work=${lead.what_to_clean ?? ""}; scheduled_at=${lead.scheduled_at ?? ""}; requested_time=${lead.when_text ?? ""}; address=${lead.address ?? ""}; assigned_cleaner=${String(order.master ?? "")}${order.master && latinName(order.master) !== String(order.master) ? ` (spelled ${latinName(order.master)} in English or Hungarian)` : ""}; confirmed_total=${String(order.amount ?? "")}
Conversation:
${transcript}`;
    const facts = [lead.scheduled_at, lead.when_text, lead.address, order.amount ?? "", ...messages.map((m) => m.body)].join(" ");
    const allowedNumbers = new Set(numberTokens(facts).map(plainNumber));
    const total = new Set(numberTokens(order.amount ?? "").map(plainNumber));
    const objections = (d: AnyMap) => {
        const reply = String(d.reply ?? "").trim().replace(/—/g, "-");
        if (!reply)
            return [];
        const out = replyObjections(reply, messages, allowedNumbers, total);
        if (/\?/u.test(reply))
            out.push("It asks a question. This message only acknowledges what the client wrote.");
        if (d.client_waits === false && numberTokens(reply).length) {
            out.push("The client named a day, time or number, so they are waiting for your answer: set client_waits to true and say you will check it and come back.");
        }
        if (d.client_waits !== false && !/\b(?:check|checking|confirm|verify|work (?:it |this )?out|sort (?:it |this )?out|look into|come back|come back to you|get back|get back to you)\b|(?:провер|уточн|разбер|постараюсь решить|вернусь|дам точный ответ)|(?:ellenőrz|egyeztet|utánanéz|visszajelz)/iu.test(reply)) {
            out.push("It must say that Alex will check this and come back with a clear answer.");
        }
        return out;
    };
    const { decision, problems } = await claudeJson(cfg, {
        model: decisionModel(cfg), max_tokens: 1200, thinking: { type: "disabled" }, messages: [{ role: "user", content: prompt }],
        output_config: jsonOut({ reply: S, reason: S, confidence: N, client_waits: B }),
    }, objections);
    const confidence = Math.max(0, Math.min(1, Number(decision.confidence) || 0));
    const waits = decision.client_waits !== false;
    const reply = String(decision.reply ?? "").trim().replace(/—/g, "-").slice(0, 1200);
    const reason = String(decision.reason ?? "booked order logistics").slice(0, 500);
    if (problems.length)
        return giveUp(`проверки не пропустили ответ и после переписывания: ${problems.join(" | ")}`, confidence, reply);
    if (!reply && !waits)
        return { reply: "", reason: `nothing to answer: ${reason}`, confidence, draft: "" };
    if (!reply)
        return giveUp("no safe acknowledgement", confidence);
    return { reply, reason, confidence, draft: reply, waits };
}
async function generateConversationDecision(cfg: Cfg, leadId: string): Promise<{
    action: "reply" | "handoff" | "no_reply" | "not_a_client" | "declined";
    holding?: string;
    reply: string;
    draft: string;
    reason: string;
    confidence: number;
}> {
    if (!cfg.anthropic_api_key)
        return { action: "handoff", reply: "", draft: "", reason: "AI is not configured", confidence: 0 };
    const [{ data: lead }, { data: messages }, { data: feedback }] = await Promise.all([
        supabase.from("crm_leads").select("id,name,phone,language,service,status,campaign,what_to_clean,area,when_text,answers,budget,created_at").eq("id", leadId).maybeSingle(),
        supabase.from("crm_wa_messages").select("direction,body,message_type,sent_at").eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(60),
        supabase.from("crm_timeline").select("meta,created_at").eq("kind", "sales_style_feedback").order("created_at", { ascending: false }).limit(6),
    ]);
    const { data: history } = await supabase.from("crm_timeline")
        .select("body,meta,created_at").eq("lead_id", leadId).eq("kind", "whatsapp_summary")
        .order("created_at", { ascending: false }).limit(3);
    const earlier = (history ?? []).reverse().map((x: AnyMap) => `${String(x.created_at).slice(0, 10)}: ${String(x.body ?? "").slice(0, 400)}${x.meta?.next_action ? ` (следующий шаг: ${String(x.meta.next_action).slice(0, 200)})` : ""}`).join("\n");
    const { data: booked } = await supabase.from("crm_leads")
        .select("scheduled_at").eq("status", "won")
        .gte("scheduled_at", new Date().toISOString())
        .lte("scheduled_at", new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString());
    const takenDays = [...new Set((booked ?? []).map((x: AnyMap) => String(x.scheduled_at).slice(0, 10)))].sort();
    const scheduleSnapshot = takenDays.length >= 3 ? takenDays.join(", ") : "";
    return await decideFromContext(cfg, { lead, messages: messages ?? [], feedback: feedback ?? [], earlier, scheduleSnapshot });
}
async function decideFromContext(cfg: Cfg, ctx: {
    lead: AnyMap | null;
    messages: AnyMap[];
    feedback: AnyMap[];
    earlier: string;
    scheduleSnapshot: string;
    now?: Date;
}): Promise<{
    action: "reply" | "handoff" | "no_reply" | "not_a_client" | "declined";
    holding?: string;
    reply: string;
    draft: string;
    reason: string;
    confidence: number;
    quotes?: AnyMap[];
}> {
    const { lead, messages, feedback, earlier, scheduleSnapshot } = ctx;
    if (!lead || !messages?.length)
        return { action: "handoff", reply: "", draft: "", reason: "conversation context is missing", confidence: 0 };
    if (messages[0].direction !== "incoming")
        return { action: "no_reply", reply: "", draft: "", reason: "latest message is outgoing", confidence: 1 };
    const transcript = stampedTranscript(messages, 3000, ctx.now);
    const latestBody = String(messages[0].body ?? "");
    const spoken = clientWords(latestBody, messages[0].message_type);
    const confirmedPaymentReply = paymentLinkReply(cfg, spoken, lead.language);
    if (confirmedPaymentReply) {
        return {
            action: "reply",
            reply: confirmedPaymentReply,
            draft: confirmedPaymentReply,
            reason: "confirmed payment link requested",
            confidence: 1,
        };
    }
    const weSpokeBefore = messages.some((m: AnyMap) => m.direction === "outgoing");
    const spokenTranscript = [...messages].reverse()
        .filter((m: AnyMap) => m.direction === "incoming")
        .filter((m: AnyMap) => !/I filled in your form|Я заполнил|заполнил\(-а\) форму/iu.test(String(m.body ?? "")))
        .map((m: AnyMap) => clientWords(m.body, m.message_type))
        .filter(Boolean).join("\n");
    const estimatorOn = cfg.whatsapp_estimator_autosend === "true";
    const minimumCallout = estimatorOn && weSpokeBefore ? minimumCalloutReply(lead, spoken, transcript) : null;
    if (minimumCallout) {
        return {
            action: "reply",
            reply: minimumCallout.reply,
            draft: minimumCallout.reply,
            reason: `verified price calculation: ${minimumCallout.calculation}`,
            confidence: 1,
        };
    }
    const recentClientWords = messages.filter((m: AnyMap) => m.direction === "incoming").slice(0, 4)
        .map((m: AnyMap) => clientWords(m.body, m.message_type)).join(" ");
    const asksToBook = /(?:proceed with (?:the )?booking|(?:would like to |want to |please )?book(?: me| it| us)?\b|what dates|which dates|available dates|dates and times|when (?:can|could) you come)|(?:забронир|бронир|какие даты|свободн\w* дат|когда (?:вы )?можете)/iu
        .test(`${spoken} ${recentClientWords}`);
    const agreesToPrice = /(?:\b(?:i\s+)?(?:confirm|accept|agree(?:\s+to)?|approve)\b[^.\n]{0,60}?(?:\btotal\b|\bprice\b|\bquotation\b|\bquote\b|\bamount\b|\d[\d\s.,]{3,}))|(?:\b(?:confirmed|agreed|accepted)\b[^.\n]{0,40}\d[\d\s.,]{3,})|(?:подтвержда[юе][^.\n]{0,60}?(?:сумм|цен|итог|\d[\d\s.,]{3,}))|(?:соглас[ен|на|ны][^.\n]{0,40}\d[\d\s.,]{3,})/iu
        .test(`${spoken} ${recentClientWords}`);
    if (estimatorOn && weSpokeBefore && !asksToBook && !agreesToPrice && (asksForPrice(spoken) || asksForPrice(recentClientWords))) {
        const quote = buildQuote(lead, spokenTranscript, spoken);
        if (quote.hold) {
            return { action: "handoff", reply: "", draft: "", reason: `смета остановлена проверкой: ${quote.hold}`, confidence: 0 };
        }
        const recentOutgoing = messages.filter((m: AnyMap) => m.direction === "outgoing").slice(0, 6)
            .map((m: AnyMap) => String(m.body ?? ""));
        const priced = quoteReply(lead, quote, spoken, recentOutgoing);
        const repeatsItself = Boolean(priced && shouldSuppressRepeat(priced.reply, recentOutgoing, false));
        if (priced && quote.lines.length && !repeatsItself) {
            return {
                action: "reply",
                reply: priced.reply,
                draft: priced.reply,
                reason: `verified price calculation: ${priced.calculation}`,
                confidence: 1,
            };
        }
        if (priced && quote.indicative.length) {
            return {
                action: "reply",
                reply: priced.reply,
                draft: priced.reply,
                reason: `indicative price: ${quote.indicative[0].ru}`,
                confidence: 1,
            };
        }
    }
    const styleExamples = (feedback ?? []).map((x: AnyMap) => {
        const meta = x.meta ?? {};
        return `DRAFT: ${styleOnly(meta.draft)}\nOWNER SENT: ${styleOnly(meta.sent)}`;
    }).join("\n\n");
    const quotePrices = cfg.whatsapp_bot_quotes_prices === "true";
    const priceRule = quotePrices
        ? `- You do not do arithmetic. Every number about money comes from the price_quote tool: call it with what this chat proves (the type of cleaning, the area actually being cleaned - a 12 m2 kitchen is 12, not the flat - the window sashes by type, the upholstery items, the extras), then give the client the lines it returns. Never add, multiply or round yourself, and never name a price the tool did not return.
- If the tool returns "missing", ask for exactly that and give no total. If it returns "notes", keep what they say in your reply (the oven glass, which side of the mattress, that windows are counted by sash). If it returns a range, give the range.
- Ask only for the facts the tool says it is missing. The number of cleaners, the time of day and who opens the door change no price: they are not questions to ask before one.
- The second time a client asks the price, they get a number, not another question. If the tool is still missing a fact, send the hourly rate and the minimum visit as a guide in that same message, say the exact total follows the area and is settled on site before the work starts, and only then ask for the one fact you need. One client (23.09) asked five times in twelve minutes, got five questions back, and wrote "if you do not say the price, how are we supposed to start".
- Not in your very first message to a client: learn the job first.
- A price Alex already sent in this chat stands, even when the calculator now says more. Never raise it and never recalculate it out loud; if the difference matters, it is his to settle with the client.`
        : `- Never name, calculate or hint at a price, rate, number of hours or total that Alex has not already sent in this chat. Alex gives prices himself. When the client asks about price, take in what they need, ask the one fact still missing, and say you will confirm the price yourself, with no time attached.`;
    const priceHandoff = quotePrices
        ? "a request for the exact total of the job (the reply still gives the published rate as a guide and leaves the total to Alex)"
        : "a request for a price Alex has not sent yet (the reply says you will confirm the price yourself)";
    const priceListHeader = quotePrices
        ? "Price list. You may quote its rates and unit prices as a guide, never a total for this client's job:"
        : "Internal price list, only to understand the job. Never quote from it:";
    const reference = `You are the guarded WhatsApp sales assistant for Alex at CLB Cleaning Budapest. Return only JSON:
{"action":"reply|handoff|no_reply|not_a_client|declined","reply":"","reason":"","confidence":0.0}

Write as Alex in first-person singular, in the client's language, as a natural continuation. Alex is a man: in Russian always masculine forms (понял, сам, посчитал, уточню сам), never понялa, сама or other feminine forms. Alex speaks for himself, never as a company, and in Russian and Hungarian the verb shows it: every verb about him is first-person singular (могу, посчитаю, not можем, посчитаем; hozom, számolom, not hozzuk, számoljuk), never "мы", "наш", "mi".
Reply in the language of the client's own latest words. Text pasted from a lead form ("I filled in your form", "Xin chào! Tôi đã điền mẫu...") is a template and does not set the language; when the client has written nothing of their own, use the lead card's language. Do not repeat a greeting. The client must feel that Alex personally read the conversation, never that a bot processed it. Briefly reflect one concrete detail, concern or preference from the latest message when available. Use short conversational sentences and contractions in English. Vary the wording naturally instead of repeating a template. Never sound like a call centre, form, ticket, notification or policy. Use facts already known, and move forward by only one sales stage. Ask one question at a time. For upholstery, mattresses, carpets, stains or condition-dependent work, request suitable full and close-up photos plus dimensions/details before an estimate.

Hard rules:
${priceRule}
- Any other price may only be repeated or explained if that exact price was already explicitly sent by OWNER in this transcript.
- The price comes before the date. When the client proposes a day or a time and the price for the job as it stands now is not agreed, answer with the price (from the tool, or the one fact the tool is missing) and say the day is settled once the price is. Do not name, offer or pick a day yourself in that message. A S A (23.09) fixed a day for a deep clean of 150 m2 while the only number in the chat was a regular-cleaning visit: he would have learned the real one after planning his day.
- Never promise or confirm booking, availability, a date, time, cleaner/team, arrival, payment or invoice. Never propose a specific day or time yourself either, not even as a question ("Wednesday at 10?"): ask which day suits the client, the slots are Alex's to offer. Even a time Alex offered earlier stays his to confirm: the team's day moves, and a client told "the team comes this afternoon" waits at home for it.
- Every message carries its Budapest time and the chat opens with NOW. Read the gaps: an offer made in the morning and accepted in the evening may already be gone, and a client answering hours later is picking the conversation up, not continuing the same minute.
- Never tell the client you will calculate, work out or send the price, the numbers or the hours later. You cannot price it, so that promise has no owner. If no price is available, ask the next missing fact; once nothing is missing, say that I will confirm the price myself, with no time attached.
- Use action=handoff for: ${priceHandoff}; booking/availability/date/time/team/arrival/payment/invoice; complaint/refund/damage; an unusual or uncertain service; or an urgent schedule conflict.
- A request for a discount is NOT a handoff by itself. Work it in the order the playbook sets: a free add-on first, then the commitment question, and a percentage only inside the limit the playbook checks. Hand over only what falls outside that limit.
- Low confidence alone is not a reason to stay silent when a harmless fact-gathering question is possible. For a safe next question with confidence at least 0.70, use action=reply.
- When action=handoff, reply is sent to the client right away while Alex makes the decision. Write the message that keeps the order moving: take in what the client said, repeat only facts Alex already wrote, and ask for what the client can give, such as the flat and floor or a day that suits. Leave the decision itself out of it (a new price, a new time, a yes to availability); Alex sends that.
- Use action=no_reply only when the last client message is a bare thanks, an emoji or a one-word acknowledgement carrying no information. If the client answered a question Alex asked, that is never no_reply: confirm in one line what you heard and take the next step.
- When Alex already sent a price or an offered time and the client accepts it ("да", "подходит", "было бы супер", "ok", "sounds good"), the next stage is the order itself, never a bare "glad it suits you". In the same reply ask for the booking fact still missing that the client can give: first the full address with flat, floor and door or bell number (a street and house number from the form is not enough without the flat), then which day and time suit them. This question is action=reply, not a handoff. Only the exact arrival time the team can make is Alex's: if the client asks for it, hand off and still ask for the address in the draft.
- Use action=not_a_client as soon as the sender is not a potential customer: looking for a job, offering their own services, a supplier, a bot, or spam. Never ask a qualifying question in that case, even a safe one. The lead card may still say this is a client; the conversation wins over the card.
- Use action=reply only for a safe, confirmed-script next step such as gathering missing job facts/photos, explaining already-confirmed scope, or clarifying the client's need.
- Do not invent facts, discounts, urgency or scarcity. Do not use an em dash.
- Use action=declined, with an empty reply, when the client clearly closes the request in any language: no longer needed, please close it, not interested, already done or cleaned, plans cancelled, chose or hired someone else. The card moves to "no contact" and nobody writes to them. Never argue with the other price or do arithmetic on it. "Too expensive", "I need to think", "not now, maybe later", or declining one part of the job while asking about another is NOT declined: that is a conversation to keep.
- When the client narrows the job (only outside surfaces, no cupboards inside, only the kitchen), check whether a cheaper type of cleaning now covers it and offer that as a question.
- Do not ask for any fact already in the lead context or transcript.
- WORK THE OBJECTION, do not hand it over. "That is expensive", "I need to think", "another company said less" are the moments this job exists for. Use the objections playbook properly: name the concern in the client's own words, say what is inside the number and why it costs that, and offer a smaller shape of the same job as a question, for example fewer rooms, only the parts that matter most, or the visit without an add-on. You may repeat and explain any price already sent in this conversation, including the breakdown line by line.
- What you still may NOT do with an objection: invent a price the calculator did not produce, promise a percentage the playbook's own arithmetic does not allow, or change a date or a team. A free add-on from the playbook's list you may offer yourself.
- Never end on a full stop where a question belongs. Every reply that is not a plain acknowledgement finishes with one concrete next step: a day to look at, a detail you need, or a choice between two options.

${priceListHeader}
${String(cfg.price_list ?? "")}
Sales method you follow, stage by stage. It is a route, not a text to read out:
${String(cfg.sales_method ?? "")}

Objection playbook, use it to answer objections, not only for tone:
${String(cfg.objections ?? "")}
Alex's voice card, learned from how he writes (style only, never a fact):
${String(cfg.style_guide ?? "(not learned yet)")}

The rules Alex repeats most often; they outrank anything above:
${String(cfg.sales_rules ?? "(not filled in)")}`;
    const situation = `Свободных мест на неделе (заполняет Алекс вручную; пусто значит числа нет и
называть его нельзя): ${String(cfg.slots_left ?? "").trim() || "(не заполнено)"}
Занятые дни по календарю CRM на ближайшую неделю: ${scheduleSnapshot || "(в CRM пусто, значит расписание туда не заносят: числами не оперировать)"}

Alex style corrections (style only, never copy order facts):
${styleExamples || "(none)"}

What happened earlier with this client (running summary, older than the messages below):
${earlier || "(this is the start of the relationship)"}

Lead context: service=${lead.service ?? ""}; status=${lead.status ?? ""}; language=${lead.language ?? ""}; requested_work=${lead.what_to_clean ?? ""}; area=${lead.area ?? ""}; requested_time=${lead.when_text ?? ""}; budget=${lead.budget ?? ""}; answers=${JSON.stringify(lead.answers ?? {})}
Conversation:
${transcript}`;
    const facts = [JSON.stringify(lead.answers ?? {}), lead.area, lead.when_text, lead.budget, ...messages.map((m) => m.body)].join(" ");
    const approvedQuote = standardCleaningQuote(lead, transcript);
    const provableNumbers = [7500, 6500, 30000, 26000, approvedQuote?.price, approvedQuote?.hours]
        .filter((value): value is number => typeof value === "number" && value > 0)
        .map(String);
    const published = quotePrices ? numberTokens(String(cfg.price_list ?? "").split("\n").filter((line) => !/пример|example/iu.test(line)).join("\n")) : [];
    const allowedNumbers = new Set([...numberTokens(facts), ...provableNumbers, ...published].map(plainNumber));
    const pricesSent = new Set([...messages
            .filter((m) => m.direction === "outgoing" && hasPriceToken(m.body))
            .flatMap((m) => numberTokens(m.body)), ...provableNumbers, ...published].map(plainNumber));
    const tools = quotePrices
        ? [{
                name: "price_quote",
                description: "Price a cleaning job from CLB's approved price list. Give it the units this chat proves; it multiplies and applies the minimums. Returns lines, hours, total, missing (facts to ask for before any total) and notes (wording the reply has to carry).",
                input_schema: {
                    type: "object",
                    properties: {
                        cleaning: {
                            type: "object",
                            description: "The cleaning itself. Leave it out for an upholstery-only or windows-only job.",
                            properties: {
                                tier: { type: "string", enum: ["standard", "regular", "deep", "post_renovation"], description: "standard and regular are 6 500 Ft per hour, deep is 7 500, post_renovation is hourly only" },
                                area_m2: { type: "number", description: "The area being cleaned, in m2. Only the kitchen? Then the kitchen's area." },
                                bathrooms: { type: "number" },
                                stairs_flights: { type: "number" },
                                pets: { type: "boolean" },
                                neglect: { type: "string", enum: ["none", "some", "heavy"] },
                            },
                            required: ["tier"],
                        },
                        windows: {
                            type: "array",
                            description: "Counted by sash, never by window. Leave it out while the sashes are unknown.",
                            items: {
                                type: "object",
                                properties: {
                                    type: { type: "string", enum: ["standard", "large", "tall", "panoramic", "balcony_door", "roof"] },
                                    sashes: { type: "number" },
                                    old_wooden_double: { type: "boolean" },
                                    blinds: { type: "boolean" },
                                },
                                required: ["type", "sashes"],
                            },
                        },
                        upholstery: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    item: { type: "string", enum: ["sofa_2_3", "sofa_corner", "sofa_leather_3", "armchair", "chair", "mattress_one_side", "mattress_two_sides", "carpet_m2"] },
                                    units: { type: "number" },
                                },
                                required: ["item", "units"],
                            },
                        },
                        extras: { type: "array", items: { type: "string", enum: ["oven", "oven_glass", "fridge", "extractor", "chandelier"] } },
                        steam_rooms: { type: "number", description: "Steam on grout is priced per room" },
                    },
                },
            }]
        : undefined;
    const quotes: AnyMap[] = [];
    const ownerNamedPrice = messages.some((m: AnyMap) => m.direction === "outgoing" && hasPriceToken(m.body));
    const onTool = (name: string, input: AnyMap) => {
        if (name !== "price_quote")
            return { error: `unknown tool ${name}` };
        const quote = priceQuote(input as QuoteInput);
        if (ownerNamedPrice) {
            quote.notes.push("Alex has already sent a price for this job in this chat. That price stands. Use these lines only to explain what is inside it, and never send a total that differs from his.");
        }
        quotes.push({ input, quote });
        const numbers = [
            ...quote.lines.flatMap((l) => [l.low, l.high, l.units]),
            quote.total?.low, quote.total?.high, quote.hours, quote.rate,
        ].filter((n): n is number => typeof n === "number");
        for (const n of numbers) {
            allowedNumbers.add(String(n));
            pricesSent.add(String(n));
        }
        for (const text of [...quote.notes, quote.minimum ?? ""]) {
            for (const token of numberTokens(text)) {
                allowedNumbers.add(plainNumber(token));
                pricesSent.add(plainNumber(token));
            }
        }
        return quote;
    };
    const objections = (d: AnyMap) => {
        if (!["reply", "handoff"].includes(String(d.action)))
            return [];
        const text = String(d.reply ?? "").trim().replace(/—/g, "-");
        const out = replyObjections(text, messages, allowedNumbers, pricesSent);
        if ((text.match(/\?/g) ?? []).length > 1)
            out.push("It asks more than one question. Keep the one that moves the order forward.");
        if (!weSpokeBefore && hasPriceToken(text))
            out.push("This is your first message to this client: no price yet. Take in what they need and ask the one fact that matters.");
        const namesPrice = hasPriceToken(text) || (/(?:per hour|an hour|\/ ?h(?:our)?\b|в час|за час|óránként|\/ ?óra|óradíj)/iu.test(text) && numberTokens(text).length > 0);
        const clientNamesDay = /\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b\d{1,2}(?:st|nd|rd|th)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?:понедельник|вторник|сред[ауы]|четверг|пятниц|суббот|воскресень)|(?:hétfő|kedd|szerda|csütörtök|péntek|szombat|vasárnap)/iu.test(spoken);
        if (quotePrices && clientNamesDay && !ownerNamedPrice && !namesPrice) {
            out.push("The client is fixing a day and no price for this job has gone out yet. Give the calculator's figure, or the one fact it says is missing, and do not write that the day or the time window is noted.");
        }
        if (quotePrices && weSpokeBefore && asksForPrice(spoken) && !namesPrice) {
            out.push("The client asked about price and got no number. Give the published rate from the price list as a guide (the hourly rate for their type of cleaning, or the unit price for their item), and say you will confirm the total yourself.");
        }
        return out;
    };
    const { decision, problems } = await claudeJson(cfg, {
        model: decisionModel(cfg), max_tokens: decisionBudget(cfg), thinking: decisionThinking(cfg),
        system: [{ type: "text", text: reference, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: situation }],
        output_config: jsonOut({ action: { type: "string", enum: ["reply", "handoff", "no_reply", "not_a_client", "declined"] }, reply: S, reason: S, confidence: N }),
        ...(tools ? { tools } : {}),
    }, objections, 2, tools ? onTool : undefined);
    const requestedAction = String(decision.action ?? "handoff");
    let action: "reply" | "handoff" | "no_reply" | "not_a_client" | "declined" = requestedAction === "reply"
        ? "reply"
        : requestedAction === "no_reply"
            ? "no_reply"
            : requestedAction === "not_a_client"
                ? "not_a_client"
                : requestedAction === "declined"
                    ? "declined"
                    : "handoff";
    const confidence = Math.max(0, Math.min(1, Number(decision.confidence) || 0));
    const reply = String(decision.reply ?? "").trim().replace(/—/g, "-").slice(0, 1600);
    let reason = String(decision.reason ?? "").slice(0, 500);
    if (problems.length) {
        action = "handoff";
        reason = `проверки не пропустили ответ и после переписывания: ${problems.join(" | ")}`;
    }
    else if (action === "declined" && confidence < 0.8) {
        action = "handoff";
        reason = `possible decline, low confidence ${confidence}: ${reason}`;
    }
    else if (action === "reply" && (!reply || confidence < 0.7)) {
        action = "handoff";
        reason = !reply ? "empty generated reply" : `low confidence ${confidence}`;
    }
    const clean = problems.length ? "" : reply;
    const lastResort: Record<string, string> = {
        ru: "Спасибо за подробности, всё прочитал. Посмотрю и отвечу сам.",
        hu: "Köszönöm a részletes leírást, mindent elolvastam. Utánanézek, és visszaírok.",
        en: "Thanks for all the details, I've read everything. I'll look into it and come back to you myself.",
    };
    const holding = action === "handoff"
        ? (clean || await generateSafeFallback(cfg, transcript, lead.language) || lastResort[String(lead.language)] || lastResort.en)
        : "";
    return { action, holding, reply: action === "reply" ? clean : "", draft: reply, reason, confidence, quotes };
}
async function logRussianGloss(cfg: Cfg, leadId: string, text: string, externalId: string) {
    if (!cfg.anthropic_api_key || !needsGloss(text))
        return;
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001", max_tokens: 400,
                messages: [{ role: "user", content: `Translate this WhatsApp message into Russian, literally, keeping every number and the same tone. Return only the translation.\n\n${text.slice(0, 2000)}` }],
            }),
        });
        if (!res.ok)
            return;
        const out = await res.json() as AnyMap;
        const gloss = String((out.content ?? []).map((x: AnyMap) => x.text ?? "").join("")).trim().slice(0, 2000);
        if (!gloss)
            return;
        await supabase.from("crm_timeline").insert({
            lead_id: leadId, kind: "whatsapp_reply_translated",
            body: `🈳 Что ушло клиенту, перевод: ${gloss}`,
            meta: { external_message_id: externalId, original: text.slice(0, 2000), automated: true },
        });
    }
    catch (error) {
        console.error("gloss", error);
    }
}
function sendBlock(text: string, newestFirst: AnyMap[]): {
    status: string;
    reason: string;
} | null {
    const lastOutgoingAt = newestFirst.find((m: AnyMap) => m.direction === "outgoing")?.sent_at ?? "";
    const clientSpokeSince = newestFirst.some((m: AnyMap) => m.direction === "incoming" && String(m.sent_at) > String(lastOutgoingAt));
    const clientText = clientScriptSample(newestFirst);
    if (clientText && writesCyrillic(clientText) !== writesCyrillic(text)) {
        return { status: "needs_owner", reason: "ответ написан не на языке клиента, не отправлен" };
    }
    const recent = newestFirst.filter((m: AnyMap) => m.direction === "outgoing").slice(0, 3).map((m: AnyMap) => m.body);
    if (shouldSuppressRepeat(text, recent, clientSpokeSince)) {
        return { status: "skipped", reason: "почти то же самое уже отправлено, повтор не ушёл" };
    }
    return null;
}
async function sendConversationReply(cfg: Cfg, job: AnyMap, lead: AnyMap, text: string) {
    const { data: recentAll } = await supabase.from("crm_wa_messages")
        .select("body,direction,sent_at").eq("lead_id", lead.id)
        .order("sent_at", { ascending: false }).limit(8);
    const blocked = sendBlock(text, recentAll ?? []);
    if (blocked) {
        await supabase.from("crm_wa_reply_queue").update({
            ...blocked, reply_body: text, updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        return { sent: false, stopped: true };
    }
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    if (!relayUrl || !relaySecret)
        throw new Error("WhatsApp relay is not configured");
    const res = await fetch(relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
        body: JSON.stringify({
            mode: "conversation", leadId: lead.id, phone: digits(job.phone), remoteLid: job.remote_lid,
            text, sourceTimestamp: Number(job.inbound_timestamp), expectedInboundTimestamp: Number(job.inbound_timestamp),
            expectedInboundId: String(job.inbound_message_id),
        }),
    });
    const out = await res.json().catch(() => ({})) as AnyMap;
    const now = new Date().toISOString();
    if (res.status === 409) {
        await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reply_body: text, reason: String(out.error ?? "conversation changed"), updated_at: now }).eq("id", job.id);
        await supabase.from("crm_timeline").insert({
            lead_id: lead.id, kind: "whatsapp_autoreply_stopped",
            body: "Автоответ остановлен: найдено более новое сообщение или ручной ответ",
            meta: { inbound_message_id: job.inbound_message_id, latest_timestamp: out.latestTimestamp ?? null },
        });
        return { sent: false, stopped: true };
    }
    if (!res.ok)
        throw new Error(`relay ${res.status}: ${String(out.error ?? "send failed")}`);
    const externalId = String(out.messageId ?? "");
    if (!externalId)
        throw new Error("relay returned no message id");
    await supabase.from("crm_wa_reply_queue").update({ status: "sent", reply_body: text, outbound_message_id: externalId, sent_at: now, updated_at: now }).eq("id", job.id);
    await supabase.from("crm_wa_messages").upsert({
        provider: "evolution", account_id: cfg.whatsapp_account_id ?? "clb-personal", external_message_id: externalId,
        lead_id: lead.id, direction: "outgoing", message_type: "text", body: text, sent_at: now,
        raw_meta: { automated: true, kind: "conversation_reply", source_inbound_id: job.inbound_message_id },
    }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
    await supabase.from("crm_leads").update({ status: "in_progress", last_contact_at: now, status_changed_at: now, updated_at: now })
        .eq("id", lead.id).in("status", ["contacted", "in_progress"]);
    await supabase.from("crm_timeline").insert({
        lead_id: lead.id, kind: "whatsapp_autoreply_sent", body: "📤 Безопасный автоответ отправлен",
        meta: { inbound_message_id: job.inbound_message_id, outbound_message_id: externalId },
    });
    await logRussianGloss(cfg, String(lead.id), text, externalId);
    return { sent: true };
}
async function revisitUnanswered(cfg: Cfg, now: Date) {
    const retryAfter = Number(cfg.whatsapp_retry_after_minutes ?? 20) || 20;
    const nudgeAfter = Number(cfg.whatsapp_nudge_after_minutes ?? 60) || 60;
    const { data: candidates } = await supabase.from("crm_wa_reply_queue")
        .select("id,lead_id,inbound_timestamp,inbound_body,attempts,reason,updated_at,status")
        .in("status", ["needs_owner", "skipped"])
        .lt("updated_at", new Date(now.getTime() - retryAfter * 60 * 1000).toISOString())
        .order("updated_at", { ascending: false }).limit(60);
    const stuck = (candidates ?? []).filter((job: AnyMap) => String(job.status) === "needs_owner" ||
        String(job.reason ?? "").includes("ушёл") ||
        String(job.reason ?? "").includes("переписке")).slice(0, 10);
    let requeued = 0, nudged = 0;
    for (const job of stuck ?? []) {
        const askedAt = new Date(Number(job.inbound_timestamp) * 1000);
        const { data: answered } = await supabase.from("crm_wa_messages")
            .select("sent_at").eq("lead_id", job.lead_id).eq("direction", "outgoing")
            .gt("sent_at", askedAt.toISOString()).limit(1);
        if (answered?.length) {
            await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: "ответ уже отправлен", updated_at: now.toISOString() }).eq("id", job.id);
            continue;
        }
        const waitingMinutes = Math.round((now.getTime() - askedAt.getTime()) / 60000);
        if (Number(job.attempts ?? 0) < 4) {
            await supabase.from("crm_wa_reply_queue").update({
                status: "pending", reason: `повторная попытка после ${waitingMinutes} мин без ответа`, updated_at: now.toISOString(),
            }).eq("id", job.id);
            requeued++;
            continue;
        }
        if (waitingMinutes >= nudgeAfter && !String(job.reason ?? "").includes("напомнил")) {
            const { data: lead } = await supabase.from("crm_leads").select("id,name,phone").eq("id", job.lead_id).maybeSingle();
            if (lead)
                await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), `Клиент ждёт ответа уже ${waitingMinutes} минут, автоматика ответить не смогла`);
            await supabase.from("crm_wa_reply_queue").update({ reason: `${String(job.reason ?? "").slice(0, 200)} | напомнил через ${waitingMinutes} мин`, updated_at: now.toISOString() }).eq("id", job.id);
            nudged++;
        }
    }
    return { requeued, nudged };
}
async function runHealth(cfg: Cfg, payload: AnyMap = {}) {
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    const out: AnyMap = { relay_configured: Boolean(relayUrl && relaySecret) };
    if (!relayUrl || !relaySecret)
        return out;
    const asked = digits(payload.phone);
    const { data: recent } = await supabase.from("crm_wa_messages")
        .select("lead_id, sent_at").order("sent_at", { ascending: false }).limit(1);
    const { data: lead } = asked
        ? await supabase.from("crm_leads").select("id,phone").ilike("phone", `%${asked.slice(-9)}`).limit(1).maybeSingle()
        : await supabase.from("crm_leads").select("id,phone").eq("id", String(recent?.[0]?.lead_id ?? "")).maybeSingle();
    const phone = asked || digits(lead?.phone);
    if (!phone)
        return { ...out, error: "no phone to probe with" };
    const started = Date.now();
    try {
        const res = await fetch(relayUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
            body: JSON.stringify({ mode: "review", leadId: lead?.id, phone }),
        });
        const text = (await res.text()).slice(0, 400);
        return {
            ...out, reached_relay: true, relay_status: res.status, ms: Date.now() - started,
            relay_says: text,
            verdict: res.ok
                ? "relay and Evolution answer, WhatsApp session is alive"
                : res.status >= 500
                    ? "relay is up but Evolution refuses: session is most likely disconnected, needs a QR"
                    : "relay answered with a client error, see relay_says",
        };
    }
    catch (error) {
        return {
            ...out, reached_relay: false, ms: Date.now() - started,
            error: String(error instanceof Error ? error.message : error).slice(0, 300),
            verdict: "the relay itself is unreachable: the VPS or the container is down",
        };
    }
}
async function runDryRun(baseCfg: Cfg, payload: AnyMap) {
    const cfg: Cfg = { ...baseCfg,
        ...(payload.model ? { whatsapp_decision_model: String(payload.model) } : {}),
        ...(payload.thinking ? { whatsapp_decision_thinking: String(payload.thinking) } : {}),
        ...(payload.quote_prices ? { whatsapp_bot_quotes_prices: String(payload.quote_prices) } : {}) };
    const lead = {
        id: "dry-run", name: payload.name ?? "", phone: "", language: payload.language ?? "en",
        service: payload.service ?? "", status: payload.status ?? "contacted",
        campaign: payload.campaign ?? "", what_to_clean: payload.what_to_clean ?? "",
        area: payload.area ?? "", when_text: payload.when_text ?? "", answers: payload.answers ?? {},
        budget: payload.budget ?? "", scheduled_at: payload.scheduled_at ?? "", address: payload.address ?? "",
        created_at: new Date().toISOString(),
    };
    const messages = [...(Array.isArray(payload.messages) ? payload.messages : [])].reverse()
        .map((m: AnyMap, index: number) => ({
        direction: m.direction === "out" || m.direction === "outgoing" ? "outgoing" : "incoming",
        body: String(m.body ?? ""), message_type: m.message_type ?? "text",
        sent_at: m.sent_at ?? new Date(Date.now() - index * 60000).toISOString(),
    }));
    const now = payload.now ? new Date(String(payload.now)) : undefined;
    const latestBody = String(messages[0]?.body ?? "");
    const deterministic = deterministicConversationAction(latestBody);
    let path = "decision";
    let decision: AnyMap;
    if (looksLikeSolicitation(latestBody)) {
        path = "solicitation";
        decision = { action: "not_a_client", reason: "solicitation" };
    }
    else if (deterministic.action === "no_reply") {
        path = "bare_ack";
        decision = { action: "no_reply", reason: deterministic.reason };
    }
    else if (lead.status === "won") {
        path = "booked_ack";
        const paid = paymentLinkReply(cfg, clientWords(latestBody, messages[0]?.message_type), lead.language);
        decision = paid
            ? { action: "reply", reply: paid, reason: "payment link" }
            : await ackFromContext(cfg, { lead, messages, feedback: [], earlier: String(payload.earlier ?? ""), order: { amount: payload.amount, master: payload.master }, now });
    }
    else if (["stop", "later"].includes(deterministic.action)) {
        path = deterministic.action;
        decision = { action: "no_reply", reason: deterministic.reason };
    }
    else {
        decision = await decideFromContext(cfg, { lead, messages, feedback: [], earlier: String(payload.earlier ?? ""), scheduleSnapshot: "", now });
    }
    const text = String(decision.reply || (path === "booked_ack" || decision.action === "handoff" ? decision.holding ?? "" : ""));
    const blocked = text ? sendBlock(text, messages.slice(0, 8)) : null;
    return { lead: lead.name, path, decision, sent: blocked ? "" : text, blocked: blocked?.reason ?? "" };
}
async function requeueOrphanInbound(cfg: Cfg, now: Date) {
    const { data: recent } = await supabase.from("crm_wa_messages")
        .select("lead_id,direction,external_message_id,body,message_type,sent_at,raw_meta")
        .gte("sent_at", new Date(now.getTime() - 30 * 60 * 1000).toISOString()).order("sent_at", { ascending: true }).limit(300);
    const rows = recent ?? [];
    const inbound = rows.filter((m: AnyMap) => m.direction === "incoming" && m.lead_id &&
        now.getTime() - new Date(String(m.sent_at)).getTime() > 2 * 60 * 1000);
    if (!inbound.length)
        return 0;
    const { data: queued } = await supabase.from("crm_wa_reply_queue").select("inbound_message_id")
        .in("inbound_message_id", inbound.map((m: AnyMap) => String(m.external_message_id)));
    const have = new Set((queued ?? []).map((q: AnyMap) => String(q.inbound_message_id)));
    let requeued = 0;
    for (const m of inbound) {
        if (have.has(String(m.external_message_id)))
            continue;
        const answered = rows.some((o: AnyMap) => o.lead_id === m.lead_id && o.direction === "outgoing" &&
            new Date(String(o.sent_at)) > new Date(String(m.sent_at)));
        if (answered)
            continue;
        const { data: lead } = await supabase.from("crm_leads").select("id,phone,source,status").eq("id", m.lead_id).maybeSingle();
        if (!lead)
            continue;
        const jid = String(m.raw_meta?.remote_lid ?? "") || `${digits(lead.phone)}@s.whatsapp.net`;
        const parsed = { body: String(m.body ?? ""), type: String(m.message_type ?? "text") };
        if (await queueConversationReply(cfg, lead, digits(lead.phone), jid, String(m.external_message_id), new Date(String(m.sent_at)), parsed))
            requeued++;
    }
    return requeued;
}
async function runConversationAutoreplies(cfg: Cfg) {
    if (replyDelay(cfg, "whatsapp_conversation_autoreply_enabled") === null)
        return { enabled: false, pending: 0, sent: 0, handed_off: 0 };
    const now = new Date();
    const revisited = await revisitUnanswered(cfg, now).catch((error) => {
        console.error("revisit unanswered", error);
        return { requeued: 0, nudged: 0 };
    });
    const orphans = await requeueOrphanInbound(cfg, now).catch((error) => {
        console.error("requeue orphan inbound", error);
        return 0;
    });
    const { count } = await supabase.from("crm_wa_reply_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
    const { data: jobs, error } = await supabase.from("crm_wa_reply_queue").select("*")
        .eq("status", "pending").lte("scheduled_at", now.toISOString()).order("created_at", { ascending: false }).limit(30);
    if (error)
        throw error;
    const newestByLead = new Map<string, AnyMap>();
    for (const job of jobs ?? []) {
        if (!newestByLead.has(String(job.lead_id)))
            newestByLead.set(String(job.lead_id), job);
        else
            await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: "superseded by a newer inbound message", updated_at: now.toISOString() }).eq("id", job.id);
    }
    let sent = 0, handedOff = 0, skipped = 0, failed = 0;
    for (const job of [...newestByLead.values()].slice(0, 3)) {
        const { data: lead } = await supabase.from("crm_leads")
            .select("id,name,phone,status,language,source,created_at,last_contact_at,scheduled_at,when_text,address,assigned_master_id,service,what_to_clean,soft_review").eq("id", job.lead_id).maybeSingle();
        const ownerWindowMinutes = Number(cfg.whatsapp_owner_silence_minutes ?? 60) || 60;
        const dayFallback = Boolean(replyDelay(cfg, "whatsapp_conversation_autoreply_enabled", now));
        const ownerSince = dayFallback
            ? new Date(Number(job.inbound_timestamp) * 1000)
            : new Date(now.getTime() - ownerWindowMinutes * 60 * 1000);
        const { data: manual } = await supabase.from("crm_wa_messages")
            .select("sent_at,raw_meta").eq("lead_id", job.lead_id).eq("direction", "outgoing")
            .gte("sent_at", ownerSince.toISOString())
            .order("sent_at", { ascending: false }).limit(10);
        const ownerActive = (manual ?? []).some((m: AnyMap) => m.raw_meta?.automated !== true);
        if (ownerActive) {
            await supabase.from("crm_wa_reply_queue").update({
                status: "skipped", reason: dayFallback ? "Алекс ответил сам, страховка не нужна" : `Алекс сам в переписке, автоответ молчит ${ownerWindowMinutes} минут`, updated_at: now.toISOString(),
            }).eq("id", job.id);
            skipped++;
            continue;
        }
        const bookedAcknowledgement = Boolean(lead && replyDelay(cfg, "whatsapp_booked_ack_enabled") !== null && lead.status === "won");
        if (!lead || !isInboundConversationLeadEligible(String(lead.status), bookedAcknowledgement)) {
            await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: "lead is no longer eligible", updated_at: now.toISOString() }).eq("id", job.id);
            skipped++;
            continue;
        }
        if (looksLikeSolicitation(String(job.inbound_body ?? ""))) {
            const changedAt = new Date().toISOString();
            await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: "продажа услуг, не клиент", updated_at: changedAt }).eq("id", job.id);
            if (String(lead.status) !== "junk") {
                await supabase.from("crm_leads").update({ status: "junk", status_changed_at: changedAt, updated_at: changedAt }).eq("id", lead.id);
                await supabase.from("crm_timeline").insert({
                    lead_id: lead.id, kind: "status_change",
                    body: "Не клиент: предлагает свои услуги (отзывы, SEO, трафик)",
                    meta: { automated: true, reason: "solicitation" },
                });
            }
            skipped++;
            continue;
        }
        if (String(job.message_type ?? "") === "image") {
            try {
                await analyzeRecentInboundImages(cfg, job, lead);
                if (SOFT_ITEM_RE.test(`${lead.service ?? ""} ${lead.what_to_clean ?? ""} ${job.inbound_body ?? ""}`)) {
                    await askMasterAboutSoftItems(cfg, lead, job).catch((error) => console.error("master review", lead.id, error));
                }
            }
            catch (error) {
                const reason = `Не удалось безопасно прочитать фото: ${String(error instanceof Error ? error.message : error).slice(0, 500)}`;
                const alreadyTold = String(job.reason ?? "").startsWith("Не удалось безопасно прочитать фото");
                await supabase.from("crm_wa_reply_queue").update({ status: "needs_owner", reason, updated_at: new Date().toISOString() }).eq("id", job.id);
                if (!alreadyTold) {
                    await supabase.from("crm_timeline").insert({
                        lead_id: lead.id, kind: "whatsapp_media_analysis_failed", body: "Фото не сохранено. Анализ не выполнен",
                        meta: { reason, inbound_message_id: job.inbound_message_id },
                    });
                    await notifyOwner(cfg, lead, String(job.inbound_body ?? "[фото]"), reason);
                }
                handedOff++;
                continue;
            }
        }
        const deterministic = deterministicConversationAction(String(job.inbound_body ?? ""));
        if (deterministic.action === "no_reply") {
            await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: deterministic.reason, updated_at: now.toISOString() }).eq("id", job.id);
            skipped++;
            continue;
        }
        if (bookedAcknowledgement) {
            try {
                await supabase.from("crm_wa_reply_queue").update({ attempts: Number(job.attempts ?? 0) + 1, updated_at: now.toISOString() }).eq("id", job.id);
                const spoken = clientWords(job.inbound_body, job.message_type);
                const confirmedPaymentReply = paymentLinkReply(cfg, spoken, lead.language);
                if (confirmedPaymentReply) {
                    const result = await sendConversationReply(cfg, job, lead, confirmedPaymentReply);
                    if (result.sent) {
                        await supabase.from("crm_timeline").insert({
                            lead_id: lead.id, kind: "whatsapp_payment_link_sent",
                            body: "💳 Клиенту с подтверждённым заказом отправлена запрошенная ссылка на оплату",
                            meta: { inbound_message_id: job.inbound_message_id, automated: true },
                        });
                        sent++;
                    }
                    else
                        skipped++;
                    continue;
                }
                const { data: latestDeal } = await supabase.from("crm_deals")
                    .select("amount,created_at").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
                const { data: assigned } = lead.assigned_master_id
                    ? await supabase.from("crm_masters").select("name").eq("id", lead.assigned_master_id).maybeSingle()
                    : { data: null };
                const acknowledgement = await generateBookedAcknowledgement(cfg, lead.id, { amount: latestDeal?.amount, master: assigned?.name });
                if (!acknowledgement.reply && acknowledgement.reason.startsWith("nothing to answer")) {
                    await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: acknowledgement.reason.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", job.id);
                    skipped++;
                }
                else if (!acknowledgement.reply) {
                    if (acknowledgement.holding) {
                        const holdingSent = await sendConversationReply(cfg, job, lead, acknowledgement.holding);
                        if (holdingSent.sent) {
                            await supabase.from("crm_timeline").insert({
                                lead_id: lead.id, kind: "whatsapp_holding_reply_sent",
                                body: "📤 Клиент не оставлен без ответа: отправлен короткий вопрос, решение за Алексом",
                                meta: { inbound_message_id: job.inbound_message_id, reason: acknowledgement.reason, automated: true },
                            });
                        }
                    }
                    await supabase.from("crm_wa_reply_queue").update({ status: "needs_owner", reason: acknowledgement.reason, updated_at: new Date().toISOString() }).eq("id", job.id);
                    await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), `Заказ уже подтверждён. Решение за тобой: ${acknowledgement.reason}`, acknowledgement.draft);
                    handedOff++;
                }
                else {
                    const result = await sendConversationReply(cfg, job, lead, acknowledgement.reply);
                    if (result.sent) {
                        await supabase.from("crm_timeline").insert({
                            lead_id: lead.id, kind: "whatsapp_booked_ack_sent",
                            body: "📤 Клиенту отправлено безопасное подтверждение получения. Решение по логистике не обещано",
                            meta: { inbound_message_id: job.inbound_message_id, reason: acknowledgement.reason, confidence: acknowledgement.confidence },
                        });
                        if (acknowledgement.waits !== false)
                            await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), "Срочно проверьте логистику подтверждённого заказа. Клиенту уже отправлено только подтверждение получения, без обещания времени или команды");
                        sent++;
                        handedOff++;
                    }
                    else
                        skipped++;
                }
            }
            catch (error) {
                const reason = String(error instanceof Error ? error.message : error).slice(0, 1000);
                await supabase.from("crm_wa_reply_queue").update({ status: "needs_owner", reason, updated_at: new Date().toISOString() }).eq("id", job.id);
                await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), `Ошибка подтверждения действующего заказа: ${reason}`);
                failed++;
            }
            continue;
        }
        if (["stop", "later"].includes(deterministic.action)) {
            const changedAt = now.toISOString();
            const status = deterministic.action === "stop" ? "junk" : "follow_up";
            await supabase.from("crm_leads").update({ status, status_changed_at: changedAt, updated_at: changedAt }).eq("id", lead.id).in("status", ["contacted", "in_progress", "follow_up", "pushing"]);
            await supabase.from("crm_wa_outbox").upsert({ lead_id: lead.id, kind: "followup_stop", phone: digits(lead.phone), status: "skipped", error: deterministic.reason }, { onConflict: "lead_id,kind", ignoreDuplicates: true });
            await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: deterministic.reason, updated_at: changedAt }).eq("id", job.id);
            await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "status_change", body: deterministic.action === "stop" ? "Клиент отказался: 🚫 Нет связи, сообщения прекращены" : "Клиент попросил написать позже", meta: { automated: true, reason: deterministic.reason } });
            skipped++;
            continue;
        }
        try {
            await supabase.from("crm_wa_reply_queue").update({ attempts: Number(job.attempts ?? 0) + 1, updated_at: now.toISOString() }).eq("id", job.id);
            const decision = await generateConversationDecision(cfg, lead.id);
            if (decision.action === "not_a_client") {
                const reason = decision.reason || "sender is not a potential customer";
                const changedAt = new Date().toISOString();
                await supabase.from("crm_leads").update({ status: "junk", status_changed_at: changedAt, updated_at: changedAt })
                    .eq("id", lead.id).in("status", ["new", "contacted", "in_progress", "follow_up"]);
                await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason, updated_at: changedAt }).eq("id", job.id);
                await supabase.from("crm_timeline").insert({
                    lead_id: lead.id, kind: "status_change",
                    body: "Не клиент. Карточка убрана в мусор, автоответы прекращены",
                    meta: { automated: true, reason, inbound_message_id: job.inbound_message_id },
                });
                if (String(lead.status) !== "junk")
                    await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), `Не клиент: ${reason}`);
                skipped++;
            }
            else if (decision.action === "declined") {
                const reason = decision.reason || "client declined";
                const changedAt = new Date().toISOString();
                await supabase.from("crm_leads").update({ status: "junk", status_changed_at: changedAt, updated_at: changedAt })
                    .eq("id", lead.id).in("status", ["new", "contacted", "in_progress", "follow_up", "pushing"]);
                await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: `client_declined: ${reason}`.slice(0, 500), updated_at: changedAt }).eq("id", job.id);
                await supabase.from("crm_timeline").insert({
                    lead_id: lead.id, kind: "status_change",
                    body: "Клиент отказался: 🚫 Нет связи, автоответы прекращены",
                    meta: { automated: true, to: "junk", reason: "client_declined", detail: reason, inbound_message_id: job.inbound_message_id },
                });
                skipped++;
            }
            else if (decision.action === "no_reply") {
                await supabase.from("crm_wa_reply_queue").update({ status: "skipped", reason: decision.reason || "no reply is useful", updated_at: new Date().toISOString() }).eq("id", job.id);
                skipped++;
            }
            else if (decision.action === "handoff") {
                const reason = decision.reason || "complex question";
                if (decision.holding) {
                    const holdingSent = await sendConversationReply(cfg, job, lead, decision.holding);
                    if (holdingSent.sent) {
                        await supabase.from("crm_timeline").insert({
                            lead_id: lead.id, kind: "whatsapp_holding_reply_sent",
                            body: "📤 Клиент не оставлен без ответа: отправлен короткий вопрос, решение за Алексом",
                            meta: { inbound_message_id: job.inbound_message_id, reason, automated: true },
                        });
                    }
                }
                await supabase.from("crm_wa_reply_queue").update({ status: "needs_owner", reason, updated_at: new Date().toISOString() }).eq("id", job.id);
                await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "whatsapp_owner_handoff", body: decision.holding ? "Решение за Алексом. Клиенту отправлен короткий ответ, чтобы он не ждал в тишине" : "Вопрос передан Алексу без автоматического ответа", meta: { reason, inbound_message_id: job.inbound_message_id } });
                await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), reason, decision.draft);
                handedOff++;
            }
            else {
                if (decision.reason?.startsWith("indicative price:")) {
                    await supabase.from("crm_timeline").insert({
                        lead_id: lead.id, kind: "whatsapp_price_indicative",
                        body: `Клиенту дан ориентир цены: ${decision.reason.replace("indicative price:", "").trim()}`,
                        meta: { automated: true, inbound_message_id: job.inbound_message_id },
                    });
                    await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), "Клиенту ушёл ориентир цены. Подтверди точную сумму сам", decision.reply);
                }
                if (decision.reason?.startsWith("verified price calculation:")) {
                    await supabase.from("crm_timeline").insert({
                        lead_id: lead.id,
                        kind: "whatsapp_price_calculated",
                        body: `Автоматический расчёт цены: ${decision.reason.replace("verified price calculation:", "").trim()}`,
                        meta: { automated: true, inbound_message_id: job.inbound_message_id },
                    });
                }
                const result = await sendConversationReply(cfg, job, lead, decision.reply);
                if (result.sent)
                    sent++;
                else
                    skipped++;
            }
        }
        catch (error) {
            const reason = String(error instanceof Error ? error.message : error).slice(0, 1000);
            if (/JSON|empty answer/i.test(reason) && Number(job.attempts ?? 0) < 1) {
                await supabase.from("crm_wa_reply_queue").update({ status: "pending", reason: `retry after: ${reason}`, updated_at: new Date().toISOString() }).eq("id", job.id);
                failed++;
                continue;
            }
            await supabase.from("crm_wa_reply_queue").update({ status: "needs_owner", reason, updated_at: new Date().toISOString() }).eq("id", job.id);
            await notifyOwner(cfg, lead, String(job.inbound_body ?? ""), `Ошибка автоответа: ${reason}`);
            failed++;
        }
    }
    return { enabled: true, pending: count ?? 0, processed: Math.min(newestByLead.size, 3), sent, handed_off: handedOff, skipped, failed, customer_initiated: true, orphans_requeued: orphans, ...revisited };
}
type FollowStage = "follow_up_4h" | "follow_up_24h" | "inbound_follow_up_4h" | "inbound_follow_up_24h" | `cadence_${string}`;
function followupText(lead: AnyMap, stage: Exclude<FollowStage, `cadence_${string}`>): string {
    const ru = lead.language === "ru";
    const first = String(lead.name ?? "").trim().split(/\s+/)[0];
    if (stage === "inbound_follow_up_4h") {
        return ru
            ? `${first ? first + ", " : ""}я на связи 🙂 Остались вопросы по цене или по времени?`
            : `${first ? first + ", " : ""}I'm here 🙂 Any questions left about the price or the timing?`;
    }
    if (stage === "inbound_follow_up_24h") {
        return ru
            ? `${first ? first + ", " : ""}напомню о себе один раз 🙂 Если ещё актуально, напишите удобный день, и я подберу время.`
            : `${first ? first + ", " : ""}one last nudge from me 🙂 If it's still relevant, tell me a day that suits you and I'll find a slot.`;
    }
    if (stage === "follow_up_4h") {
        return ru
            ? `${first ? first + ", " : ""}хотел коротко уточнить 🙂 Получится прислать фото, чтобы я спокойно посмотрел детали?`
            : `${first ? first + ", " : ""}just checking in 🙂 Would you like to send the photos so I can take a proper look?`;
    }
    return ru
        ? `${first ? first + ", " : ""}оставлю это пока у вас 🙂 Если решите продолжить, просто напишите мне здесь.`
        : `${first ? first + ", " : ""}I'll leave this with you for now 🙂 If you'd like to continue, just message me here.`;
}
async function sendFollowup(cfg: Cfg, lead: AnyMap, firstTouchAt: string, previousOutboundAt: string, stage: FollowStage, customText = "") {
    const phone = digits(lead.phone);
    if (automationSuppressed(phone))
        return { sent: false, stopped: true };
    const text = (customText || followupText(lead, stage as Exclude<FollowStage, `cadence_${string}`>)).replace(/—/g, "-").slice(0, 1600);
    const { data: job, error: claimError } = await supabase.from("crm_wa_outbox").insert({
        lead_id: lead.id, kind: stage, phone, body: text, status: "pending", attempts: 1,
    }).select("id").single();
    if (claimError) {
        if (claimError.code === "23505")
            return { sent: false, duplicate: true };
        throw claimError;
    }
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    try {
        const res = await fetch(relayUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
            body: JSON.stringify({
                mode: "follow_up", leadId: lead.id, phone, text,
                sourceTimestamp: Math.floor(new Date(firstTouchAt).getTime() / 1000),
                expectedLastOutboundTimestamp: Math.floor(new Date(previousOutboundAt).getTime() / 1000),
            }),
        });
        const out = await res.json().catch(() => ({})) as AnyMap;
        if (res.status === 409) {
            const now = new Date().toISOString();
            await supabase.from("crm_wa_outbox").update({ status: "skipped", error: String(out.error ?? "conversation changed"), updated_at: now }).eq("id", job.id);
            await supabase.from("crm_wa_outbox").upsert({
                lead_id: lead.id, kind: "followup_stop", phone, body: "", status: "skipped", error: String(out.error ?? "conversation changed"), updated_at: now,
            }, { onConflict: "lead_id,kind", ignoreDuplicates: true });
            if (out.existingState === "in_progress") {
                await supabase.from("crm_leads").update({ status: "in_progress", status_changed_at: now }).eq("id", lead.id).eq("status", "contacted");
            }
            await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "whatsapp_followup_stopped", body: "Follow-up остановлен: найден ответ клиента или ручное сообщение", meta: { stage } });
            return { sent: false, stopped: true };
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
            lead_id: lead.id, direction: "outgoing", message_type: "text", body: text, sent_at: now,
            raw_meta: { automated: true, kind: stage },
        }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
        const touch = supabase.from("crm_leads").update({ last_contact_at: now, updated_at: now }).eq("id", lead.id);
        await (String(stage).startsWith("cadence_") ? touch : touch.eq("status", "contacted"));
        await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "whatsapp_followup_sent", body: stage === "follow_up_4h" ? "📤 Follow-up через 4 часа отправлен" : "📤 Финальный follow-up отправлен", meta: { stage, external_message_id: externalId } });
        return { sent: true };
    }
    catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
        await supabase.from("crm_wa_outbox").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
        console.error("followup send", lead.id, stage, message);
        return { sent: false, failed: true };
    }
}
async function sendScheduledConversationFollowup(cfg: Cfg, job: AnyMap, lead: AnyMap) {
    const phone = digits(lead.phone || job.phone);
    if (automationSuppressed(phone, job.remote_lid))
        return { sent: false, stopped: true };
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    try {
        await supabase.from("crm_wa_outbox").update({ attempts: Number(job.attempts ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", job.id);
        const scheduledText = String(job.body ?? "").replace(/—/g, "-").slice(0, 1600);
        const styleProblems = proactiveFollowupProblems(scheduledText);
        if (styleProblems.length) {
            const changedAt = new Date().toISOString();
            await supabase.from("crm_wa_outbox").update({
                status: "skipped", error: `follow-up style guard: ${styleProblems.join(", ")}`, updated_at: changedAt,
            }).eq("id", job.id);
            await supabase.from("crm_timeline").insert({
                lead_id: lead.id, kind: "whatsapp_followup_stopped",
                body: "Follow-up остановлен проверкой живого стиля",
                meta: { reasons: styleProblems, source_outbound_id: job.expected_last_outbound_id },
            });
            return { sent: false, stopped: true };
        }
        const res = await fetch(relayUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
            body: JSON.stringify({
                mode: "follow_up", leadId: lead.id, phone, remoteLid: job.remote_lid,
                text: scheduledText,
                sourceTimestamp: Math.floor(new Date(lead.created_at).getTime() / 1000),
                expectedLastOutboundTimestamp: Number(job.expected_last_outbound_timestamp ?? 0),
                expectedLastOutboundId: String(job.expected_last_outbound_id ?? ""),
            }),
        });
        const out = await res.json().catch(() => ({})) as AnyMap;
        const changedAt = new Date().toISOString();
        if (res.status === 409) {
            await supabase.from("crm_wa_outbox").update({ status: "skipped", error: String(out.error ?? "conversation changed"), updated_at: changedAt }).eq("id", job.id);
            await supabase.from("crm_timeline").insert({
                lead_id: lead.id, kind: "whatsapp_followup_stopped",
                body: "Запланированный follow-up остановлен: клиент ответил или Алекс написал вручную",
                meta: { kind: job.kind, latest_timestamp: out.latestTimestamp ?? null },
            });
            return { sent: false, stopped: true };
        }
        if (!res.ok)
            throw new Error(`relay ${res.status}: ${String(out.error ?? "send failed")}`);
        const externalId = String(out.messageId ?? "");
        if (!externalId)
            throw new Error("relay returned no message id");
        await supabase.from("crm_wa_outbox").update({ status: "sent", external_message_id: externalId, sent_at: changedAt, updated_at: changedAt }).eq("id", job.id);
        await supabase.from("crm_wa_messages").upsert({
            provider: "evolution", account_id: cfg.whatsapp_account_id ?? "clb-personal", external_message_id: externalId,
            lead_id: lead.id, direction: "outgoing", message_type: "text", body: String(job.body ?? ""), sent_at: changedAt,
            raw_meta: { automated: true, kind: "conversation_follow_up", source_outbound_id: job.expected_last_outbound_id },
        }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
        await supabase.from("crm_leads").update({ last_contact_at: changedAt, updated_at: changedAt }).eq("id", lead.id);
        await supabase.from("crm_timeline").insert({
            lead_id: lead.id, kind: "whatsapp_followup_sent", body: "📤 Персональный follow-up по незавершённому диалогу отправлен",
            meta: { external_message_id: externalId, source_outbound_id: job.expected_last_outbound_id },
        });
        return { sent: true };
    }
    catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
        await supabase.from("crm_wa_outbox").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
        return { sent: false, failed: true };
    }
}
async function runInboundFollowups(cfg: Cfg) {
    if (!botOn(cfg, "whatsapp_inbound_followup_enabled"))
        return { enabled: false, sent: 0 };
    const now = new Date();
    if (!budapestProactiveHours(now))
        return { enabled: true, sent: 0, proactive_hours: false };
    const { data: leads } = await supabase.from("crm_leads")
        .select("id,name,phone,language,status,last_contact_at,source")
        .in("status", ["contacted", "in_progress"])
        .like("source", "whatsapp%")
        .gte("created_at", new Date(now.getTime() - 30 * 86400000).toISOString())
        .limit(60);
    if (!leads?.length)
        return { enabled: true, sent: 0 };
    const { count: lastHour } = await supabase.from("crm_wa_outbox")
        .select("id", { count: "exact", head: true })
        .like("kind", "inbound_follow_up_%")
        .gte("created_at", new Date(now.getTime() - 3600000).toISOString());
    if ((lastHour ?? 0) >= 2)
        return { enabled: true, sent: 0, throttled: true };
    const ids = leads.map((l) => String(l.id));
    const [{ data: msgs }, { data: jobs }] = await Promise.all([
        supabase.from("crm_wa_messages").select("lead_id,direction,sent_at,body").in("lead_id", ids).order("sent_at", { ascending: false }),
        supabase.from("crm_wa_outbox").select("lead_id,kind,status").in("lead_id", ids),
    ]);
    let sent = 0;
    for (const lead of leads) {
        if (sent >= 2)
            break;
        const mine = (msgs ?? []).filter((m) => String(m.lead_id) === String(lead.id));
        const lastOut = mine.find((m) => m.direction === "outgoing");
        const lastIn = mine.find((m) => m.direction === "incoming");
        if (!lastOut)
            continue;
        const cyr = mine.filter((m) => m.direction === "incoming")
            .reduce((n, m) => n + (String(m.body ?? "").match(/[а-яё]/gi)?.length ?? 0), 0);
        const who = cyr >= 5 ? { ...lead, language: "ru" } : lead;
        const t0 = new Date(String(lastOut.sent_at)).getTime();
        if (lastIn && new Date(String(lastIn.sent_at)).getTime() >= t0)
            continue;
        const age = now.getTime() - t0;
        if (age > 7 * 86400000)
            continue;
        if (jobDoneInChat(mine.filter((m) => m.direction === "outgoing").map((m) => m.body)))
            continue;
        const has = (kind: string) => (jobs ?? []).some((j) => String(j.lead_id) === String(lead.id) && j.kind === kind);
        if (has("followup_stop"))
            continue;
        if (age >= 24 * 3600 * 1000 && !has("inbound_follow_up_24h")) {
            const r = await sendFollowup(cfg, who, lastOut.sent_at as string, lastOut.sent_at as string, "inbound_follow_up_24h");
            if (r.sent)
                sent++;
        }
        else if (age >= 4 * 3600 * 1000 && !has("inbound_follow_up_4h")) {
            const r = await sendFollowup(cfg, who, lastOut.sent_at as string, lastOut.sent_at as string, "inbound_follow_up_4h");
            if (r.sent)
                sent++;
        }
    }
    return { enabled: true, sent };
}
async function loadPeople(): Promise<PersonLead[]> {
    const [{ data: leads, error }, { data: ids, error: idError }] = await Promise.all([
        supabase.from("crm_leads").select("id,phone,status,source,attribution,review_requested_at,feedback_asked_at").limit(10000),
        supabase.from("crm_wa_identities").select("lead_id,phone").limit(10000),
    ]);
    if (error)
        throw error;
    if (idError)
        throw idError;
    const wa = new Map<string, string[]>();
    for (const i of ids ?? [])
        if (i.phone)
            wa.set(String(i.lead_id), [...(wa.get(String(i.lead_id)) ?? []), String(i.phone)]);
    return (leads ?? []).map((l: AnyMap) => ({ ...l, id: String(l.id), wa_phones: wa.get(String(l.id)) ?? [] }) as PersonLead);
}
async function activeDuplicateOf(people: PersonLead[], leadId: string, now: Date) {
    const me = people.find((p) => p.id === leadId);
    const others = me ? samePersonLeads(me, people) : [];
    if (!others.length)
        return null;
    const { data: talk, error } = await supabase.from("crm_wa_messages").select("lead_id")
        .in("lead_id", others.map((o) => o.id)).gte("sent_at", new Date(now.getTime() - DUPLICATE_ACTIVE_DAYS * 86400000).toISOString()).limit(500);
    if (error)
        throw error;
    return activeDuplicate(others, new Set((talk ?? []).map((m: AnyMap) => String(m.lead_id))), now);
}
const COLD_KINDS = ["closing_farewell", "reoffer"];
async function farewellRecentlySent(people: PersonLead[], leadId: string, now: Date): Promise<boolean> {
    const me = people.find((p) => p.id === leadId);
    const ids = [leadId, ...(me ? samePersonLeads(me, people).map((o) => o.id) : [])];
    const { data, error } = await supabase.from("crm_wa_outbox").select("id").in("lead_id", ids)
        .in("kind", COLD_KINDS).eq("status", "sent")
        .gte("sent_at", new Date(now.getTime() - DUPLICATE_ACTIVE_DAYS * 86400000).toISOString()).limit(1);
    if (error)
        throw error;
    return Boolean(data?.length);
}
async function runCadenceFollowups(cfg: Cfg) {
    if (cfg.whatsapp_cadence_enabled !== "true")
        return { enabled: false, sent: 0 };
    const now = new Date();
    const slot = farewellSlot(now, 0, null);
    if (!slot.ok)
        return { enabled: true, sent: 0, waiting: slot.reason };
    const since = new Date(now.getTime() - 86400000).toISOString();
    const { data: recent } = await supabase.from("crm_wa_outbox").select("sent_at").like("kind", "cadence_%")
        .eq("status", "sent").gte("sent_at", since).order("sent_at", { ascending: false });
    if ((recent?.length ?? 0) >= CADENCE_PER_DAY)
        return { enabled: true, sent: 0, waiting: "daily_cap" };
    if (recent?.[0]?.sent_at && now.getTime() - new Date(String(recent[0].sent_at)).getTime() < cadenceGapMs(String(recent[0].sent_at)))
        return { enabled: true, sent: 0, waiting: "gap" };
    const cutoff = new Date(now.getTime() - CADENCE_DAYS * 86400000).toISOString();
    const floor = new Date(now.getTime() - 30 * 86400000).toISOString();
    const { data: leads } = await supabase.from("crm_leads").select("id,name,phone,language,service,status,source,created_at")
        .in("status", ["contacted", "in_progress", "follow_up", "pushing"]).neq("source", "job_application")
        .is("scheduled_at", null).is("master_notified_at", null)
        .lt("last_contact_at", cutoff).gte("last_contact_at", floor).order("last_contact_at", { ascending: true }).limit(60);
    if (!leads?.length)
        return { enabled: true, sent: 0 };
    const ids = leads.map((l) => String(l.id));
    const [{ data: msgs }, { data: jobs }, { data: deals }] = await Promise.all([
        supabase.from("crm_wa_messages").select("lead_id,direction,sent_at,body").in("lead_id", ids).order("sent_at", { ascending: false }),
        supabase.from("crm_wa_outbox").select("lead_id,kind,status,sent_at").in("lead_id", ids),
        supabase.from("crm_deals").select("lead_id").in("lead_id", ids),
    ]);
    const dealt = new Set((deals ?? []).map((d) => String(d.lead_id)));
    for (const lead of leads) {
        if (dealt.has(String(lead.id)))
            continue;
        const phone = digits(lead.phone);
        if (!/^\d{9,15}$/.test(phone) || automationSuppressed(phone))
            continue;
        const mine = (msgs ?? []).filter((m) => String(m.lead_id) === String(lead.id));
        const lastOut = mine.find((m) => m.direction === "outgoing");
        const lastIn = mine.find((m) => m.direction === "incoming");
        if (!lastOut)
            continue;
        if (!lastIn && String(lead.created_at) < CADENCE_NEW_LEADS_FROM)
            continue;
        const t0 = new Date(String(lastOut.sent_at)).getTime();
        if (lastIn && new Date(String(lastIn.sent_at)).getTime() >= t0)
            continue;
        if (now.getTime() - t0 < CADENCE_CLOSE_AFTER_HOURS * 3600000)
            continue;
        const mineJobs = (jobs ?? []).filter((j) => String(j.lead_id) === String(lead.id));
        if (mineJobs.some((j) => j.status === "pending" && ["reoffer", "closing_farewell"].includes(String(j.kind))))
            continue;
        if (mineJobs.some((j) => j.kind === "followup_stop"))
            continue;
        if (jobDoneInChat(mine.filter((m) => m.direction === "outgoing").map((m) => m.body)))
            continue;
        if (lastIn && (farewellReplyKind(lastIn.body) === "decline" || holdCadence(lastIn.body)))
            continue;
        const rounds = mineJobs.filter((j) => String(j.kind).startsWith("cadence_") && j.status === "sent"
            && new Date(String(j.sent_at)).getTime() > (lastIn ? new Date(String(lastIn.sent_at)).getTime() : 0)).length;
        if (rounds >= CADENCE_MAX_ROUNDS) {
            if (now.getTime() - t0 >= CADENCE_CLOSE_AFTER_HOURS * 3600000) {
                const at = now.toISOString();
                const { data: closed } = await supabase.from("crm_leads").update({ status: "junk", status_changed_at: at, updated_at: at })
                    .eq("id", lead.id).in("status", ["contacted", "in_progress", "follow_up", "pushing"]).select("id");
                if (closed?.length)
                    await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "status_change", body: `🚫 Нет связи: ${CADENCE_MAX_ROUNDS + 1} касания за неделю без ответа, закрыто автоматически`, meta: { automated: true, cadence_closed: true } });
            }
            continue;
        }
        if (now.getTime() - t0 < CADENCE_DAYS * 86400000)
            continue;
        const cyr = mine.filter((m) => m.direction === "incoming").reduce((n, m) => n + (String(m.body ?? "").match(/[а-яё]/gi)?.length ?? 0), 0);
        const lat = mine.filter((m) => m.direction === "incoming").reduce((n, m) => n + (String(m.body ?? "").match(/[a-z]/gi)?.length ?? 0), 0);
        if (mine.some((m) => m.direction === "incoming" && /[\u0590-\u05FF\u0600-\u06FF]/u.test(String(m.body ?? ""))))
            continue;
        const who = { ...lead, language: cyr + lat >= 15 ? (cyr > lat ? "ru" : "en") : farewellLead(lead as AnyMap).language };
        const kind = `cadence_${String(lastOut.sent_at).slice(0, 16)}` as FollowStage;
        const r = await sendFollowup(cfg, who, String(lastOut.sent_at), String(lastOut.sent_at), kind, cadenceText(who, rounds + 1));
        if (r.sent) {
            await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: `🔁 Автонапоминание клиенту, круг ${rounds + 1} из ${CADENCE_MAX_ROUNDS} (3 дня тишины)`, meta: { automated: true, cadence: rounds + 1 } });
            return { enabled: true, sent: 1, lead: lead.id, round: rounds + 1 };
        }
    }
    return { enabled: true, sent: 0 };
}
async function runFarewellQueue(cfg: Cfg) {
    if (cfg.whatsapp_farewell_enabled !== "true")
        return { enabled: false, sent: 0 };
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600000).toISOString();
    const { data: recent } = await supabase.from("crm_wa_outbox").select("sent_at")
        .in("kind", COLD_KINDS).eq("status", "sent").gte("sent_at", since).order("sent_at", { ascending: false });
    const last = recent?.[0]?.sent_at ? new Date(String(recent[0].sent_at)) : null;
    const slot = farewellSlot(now, recent?.length ?? 0, last);
    if (!slot.ok)
        return { enabled: true, sent: 0, waiting: slot.reason, sent_24h: recent?.length ?? 0 };
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    if (!relayUrl || !relaySecret)
        return { enabled: true, sent: 0, error: "relay is not configured" };
    const { data: jobs } = await supabase.from("crm_wa_outbox").select("*")
        .in("kind", COLD_KINDS).eq("status", "pending").lte("scheduled_at", now.toISOString())
        .order("created_at", { ascending: true }).limit(8);
    let skipped = 0;
    let people: PersonLead[] | null = null;
    for (const job of jobs ?? []) {
        const skip = async (why: string) => {
            await supabase.from("crm_wa_outbox").update({ status: "skipped", error: why, updated_at: new Date().toISOString() }).eq("id", job.id);
            skipped++;
        };
        const { data: lead } = await supabase.from("crm_leads")
            .select("id,name,phone,language,service,gift,status,source").eq("id", job.lead_id).maybeSingle();
        const reoffer = job.kind === "reoffer";
        const allowed = reoffer ? ["follow_up"] : ["contacted", "in_progress"];
        if (!lead || !allowed.includes(String(lead.status))) {
            await skip("lead is no longer waiting");
            continue;
        }
        if (reoffer && String(lead.source ?? "") === "manual") {
            await skip("manual card, likely an existing client");
            continue;
        }
        const phone = digits(lead.phone);
        if (!/^\d{9,15}$/.test(phone)) {
            await skip("no valid phone");
            continue;
        }
        if (automationSuppressed(phone)) {
            await skip("client automation is suppressed");
            continue;
        }
        people ??= await loadPeople();
        const dup = await activeDuplicateOf(people, String(lead.id), now);
        if (dup) {
            await skip(`active duplicate ${dup.id}: ${dup.why}`);
            await supabase.from("crm_timeline").insert({
                lead_id: lead.id, kind: "note", body: `farewell skipped: active duplicate ${dup.id} (${dup.why})`,
                meta: { automated: true, reason: "farewell_active_duplicate", duplicate_id: dup.id, why: dup.why },
            });
            continue;
        }
        const { data: talked } = await supabase.from("crm_wa_messages").select("direction,sent_at").eq("lead_id", lead.id)
            .order("sent_at", { ascending: false }).limit(1);
        if (talked?.[0] && (talked[0].direction === "incoming" || now.getTime() - new Date(String(talked[0].sent_at)).getTime() < 6 * 86400000)) {
            await skip("the chat is alive, not a cold lead");
            continue;
        }
        const { data: chatRows } = await supabase.from("crm_wa_messages").select("body").eq("lead_id", lead.id)
            .eq("direction", "incoming").order("sent_at", { ascending: false }).limit(20);
        const fl = farewellLead(lead as AnyMap, (chatRows ?? []).map((m) => String(m.body ?? "")).join("\n"));
        const text = (reoffer ? reofferText(fl) : closingText(fl, "junk")).replace(/—/g, "-");
        await supabase.from("crm_wa_outbox").update({ attempts: Number(job.attempts ?? 0) + 1, body: text, phone, updated_at: now.toISOString() }).eq("id", job.id);
        try {
            const res = await fetch(relayUrl, {
                method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
                body: JSON.stringify({ mode: "first_touch", leadId: lead.id, phone, text, sourceTimestamp: Math.floor(now.getTime() / 1000) }),
            });
            const out = await res.json().catch(() => ({})) as AnyMap;
            const at = new Date().toISOString();
            if (res.status === 409) {
                await skip(String(out.error ?? "existing conversation"));
                if (out.existingState === "in_progress") {
                    await supabase.from("crm_leads").update({ status: "in_progress", status_changed_at: at, updated_at: at }).eq("id", lead.id).eq("status", "contacted");
                }
                continue;
            }
            if (!res.ok)
                throw new Error(`relay ${res.status}: ${String(out.error ?? "send failed")}`);
            const externalId = String(out.messageId ?? "");
            if (!externalId)
                throw new Error("relay returned no message id");
            await supabase.from("crm_wa_outbox").update({ status: "sent", external_message_id: externalId, sent_at: at, updated_at: at }).eq("id", job.id);
            await supabase.from("crm_wa_messages").upsert({
                provider: "evolution", account_id: cfg.whatsapp_account_id ?? "clb-personal", external_message_id: externalId,
                lead_id: lead.id, direction: "outgoing", message_type: "text", body: text, sent_at: at,
                raw_meta: { automated: true, kind: job.kind },
            }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
            await supabase.from("crm_leads").update({ status: "junk", status_changed_at: at, last_contact_at: at, updated_at: at })
                .eq("id", lead.id).in("status", allowed);
            const fromLabel = reoffer ? "Follow-up" : lead.status === "in_progress" ? "В работе" : "📨 Написал, ждём ответа";
            await supabase.from("crm_timeline").insert({
                lead_id: lead.id, kind: "status_change", body: `${fromLabel} → 🚫 Нет связи: ${reoffer ? "отправлено новое предложение" : "отправлено прощальное сообщение"}`,
                meta: { automated: true, reason: job.kind, external_message_id: externalId },
            });
            return { enabled: true, sent: 1, skipped, name: String(lead.name ?? "") };
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error).slice(0, 500);
            await supabase.from("crm_wa_outbox").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
            console.error("farewell send", lead.id, message);
            return { enabled: true, sent: 0, skipped, failed: 1, error: message };
        }
    }
    return { enabled: true, sent: 0, skipped, pending_left: (jobs?.length ?? 0) - skipped };
}
async function runFollowups(cfg: Cfg) {
    if (!botOn(cfg, "whatsapp_followup_enabled"))
        return { enabled: false, candidates: 0, sent: 0, closed: 0 };
    const now = new Date();
    const proactiveHours = budapestProactiveHours(now);
    let sent = 0, closed = 0, stopped = 0;
    if (proactiveHours) {
        const { data: scheduledJobs } = await supabase.from("crm_wa_outbox").select("*")
            .eq("kind", "conversation_follow_up").eq("status", "pending").lte("scheduled_at", now.toISOString())
            .order("scheduled_at", { ascending: true }).limit(2);
        for (const job of scheduledJobs ?? []) {
            const { data: lead } = await supabase.from("crm_leads")
                .select("id,name,phone,status,created_at").eq("id", job.lead_id).maybeSingle();
            if (!lead || !["contacted", "in_progress"].includes(String(lead.status))) {
                await supabase.from("crm_wa_outbox").update({ status: "skipped", error: "lead is no longer eligible", updated_at: now.toISOString() }).eq("id", job.id);
                stopped++;
                continue;
            }
            const result = await sendScheduledConversationFollowup(cfg, job, lead);
            if (result.sent)
                sent++;
            else if (result.stopped)
                stopped++;
        }
    }
    const { data: firstJobs, error } = await supabase.from("crm_wa_outbox")
        .select("lead_id,sent_at").eq("kind", "first_touch").eq("status", "sent").not("sent_at", "is", null)
        .order("sent_at", { ascending: true }).limit(200);
    if (error)
        throw error;
    const ids = [...new Set((firstJobs ?? []).map((job) => String(job.lead_id)))];
    if (!ids.length)
        return { enabled: true, candidates: 0, sent, closed, stopped, proactive_hours: proactiveHours };
    const [{ data: leads }, { data: allJobs }, { data: messages }] = await Promise.all([
        supabase.from("crm_leads").select("id,name,phone,language,status,last_contact_at").in("id", ids),
        supabase.from("crm_wa_outbox").select("lead_id,kind,status,sent_at").in("lead_id", ids),
        supabase.from("crm_wa_messages").select("lead_id,direction,sent_at,raw_meta").in("lead_id", ids).order("sent_at", { ascending: false }),
    ]);
    for (const lead of leads ?? []) {
        if (lead.status !== "contacted")
            continue;
        const jobs = (allJobs ?? []).filter((job) => job.lead_id === lead.id);
        if (jobs.some((job) => job.kind === "followup_stop"))
            continue;
        const first = jobs.find((job) => job.kind === "first_touch" && job.status === "sent");
        if (!first?.sent_at)
            continue;
        const t0 = new Date(first.sent_at).getTime();
        const leadMessages = (messages ?? []).filter((message) => message.lead_id === lead.id);
        if (leadMessages.some((message) => message.direction === "incoming" && new Date(message.sent_at).getTime() >= t0))
            continue;
        const sentJobs = jobs.filter((job) => job.status === "sent" && job.sent_at).sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
        const previous = sentJobs[0];
        if (!previous?.sent_at)
            continue;
        const manualAfter = leadMessages.some((message) => message.direction === "outgoing" && message.raw_meta?.automated !== true && new Date(message.sent_at).getTime() > new Date(previous.sent_at).getTime());
        if (manualAfter) {
            await supabase.from("crm_wa_outbox").upsert({ lead_id: lead.id, kind: "followup_stop", phone: digits(lead.phone), status: "skipped", error: "manual outgoing message" }, { onConflict: "lead_id,kind", ignoreDuplicates: true });
            stopped++;
            continue;
        }
        const age = now.getTime() - t0;
        if (age >= 48 * 60 * 60 * 1000) {
            const changedAt = now.toISOString();
            const { data: moved } = await supabase.from("crm_leads").update({ status: "junk", status_changed_at: changedAt, updated_at: changedAt })
                .eq("id", lead.id).eq("status", "contacted").select("id").maybeSingle();
            if (moved) {
                await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "status_change", body: "📨 Написал, ждём ответа → 🚫 Нет связи", meta: { reason: "no_response_48h", automated: true } });
                closed++;
            }
            continue;
        }
        if (!proactiveHours || sent >= 2)
            continue;
        const has24 = jobs.some((job) => job.kind === "follow_up_24h");
        const has4 = jobs.some((job) => job.kind === "follow_up_4h");
        if (age >= 24 * 60 * 60 * 1000 && !has24) {
            const result = await sendFollowup(cfg, lead, first.sent_at, previous.sent_at, "follow_up_24h");
            if (result.sent)
                sent++;
            else if (result.stopped)
                stopped++;
        }
        else if (age >= 4 * 60 * 60 * 1000 && !has4) {
            const result = await sendFollowup(cfg, lead, first.sent_at, previous.sent_at, "follow_up_4h");
            if (result.sent)
                sent++;
            else if (result.stopped)
                stopped++;
        }
    }
    return { enabled: true, candidates: ids.length, sent, closed, stopped, proactive_hours: proactiveHours };
}
async function relayReactivation(job: AnyMap, lead: AnyMap): Promise<{
    sent: boolean;
    stopped?: boolean;
}> {
    if (automationSuppressed(lead.phone, job.remote_lid))
        return { sent: false, stopped: true };
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    const expectedTimestamp = Number(job.expected_last_outbound_timestamp ?? 0);
    const res = await fetch(relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
        body: JSON.stringify({
            mode: "reactivation", leadId: lead.id, phone: digits(lead.phone), remoteLid: job.remote_lid,
            text: String(job.body ?? "").replace(/—/g, "-").slice(0, 1600),
            sourceTimestamp: expectedTimestamp,
            expectedLastOutboundTimestamp: expectedTimestamp,
            expectedLastOutboundId: job.expected_last_outbound_id,
        }),
    });
    const out = await res.json().catch(() => ({})) as AnyMap;
    const now = new Date().toISOString();
    if (res.status === 409) {
        await supabase.from("crm_wa_outbox").update({ status: "skipped", error: String(out.error ?? "conversation changed"), updated_at: now }).eq("id", job.id);
        if (out.existingState === "in_progress") {
            await supabase.from("crm_leads").update({ status: "in_progress", status_changed_at: now, updated_at: now })
                .eq("id", lead.id).in("status", ["contacted", "follow_up"]);
        }
        await supabase.from("crm_timeline").insert({
            lead_id: lead.id, kind: "whatsapp_reactivation_stopped",
            body: "Реактивация остановлена: после проверки найден ответ клиента или более новое ручное сообщение",
            meta: { latest_timestamp: out.latestTimestamp ?? null },
        });
        return { sent: false, stopped: true };
    }
    if (!res.ok)
        throw new Error(`relay ${res.status}: ${String(out.error ?? "send failed")}`);
    const externalId = String(out.messageId ?? "");
    const externalTimestamp = Number(out.messageTimestamp ?? 0);
    if (!externalId)
        throw new Error("relay returned no message id");
    await supabase.from("crm_wa_outbox").update({
        status: "sent", external_message_id: externalId, sent_at: now, updated_at: now,
        expected_last_outbound_id: externalId,
        expected_last_outbound_timestamp: externalTimestamp > 1000000000 ? externalTimestamp : null,
    }).eq("id", job.id);
    await supabase.from("crm_wa_messages").upsert({
        provider: "evolution", account_id: "clb-personal", external_message_id: externalId,
        lead_id: lead.id, direction: "outgoing", message_type: "text", body: String(job.body ?? ""), sent_at: now,
        raw_meta: { automated: true, kind: "reactivation_1", remote_lid: job.remote_lid },
    }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
    await supabase.from("crm_leads").update({
        status: "contacted", status_changed_at: now, last_contact_at: now, reactivated_at: now, updated_at: now,
    }).eq("id", lead.id).in("status", ["contacted", "follow_up"]);
    await supabase.from("crm_timeline").insert({
        lead_id: lead.id, kind: "whatsapp_reactivation_sent", body: "📤 Отправлена одна персональная реактивация",
        meta: { external_message_id: externalId, remote_lid: job.remote_lid },
    });
    return { sent: true };
}
async function reactivationStillUnanswered(job: AnyMap, lead: AnyMap): Promise<boolean | null> {
    const expectedTimestamp = Number(job.expected_last_outbound_timestamp ?? 0);
    if (!job.remote_lid || !job.external_message_id || expectedTimestamp < 1000000000)
        return null;
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    const res = await fetch(relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
        body: JSON.stringify({
            mode: "reactivation_check", leadId: lead.id, phone: digits(lead.phone), remoteLid: job.remote_lid,
            sourceTimestamp: expectedTimestamp, expectedLastOutboundTimestamp: expectedTimestamp,
            expectedLastOutboundId: job.external_message_id,
        }),
    });
    if (res.status === 409)
        return false;
    if (!res.ok)
        return null;
    const out = await res.json().catch(() => ({})) as AnyMap;
    return out.unchanged === true;
}
async function runReactivations(cfg: Cfg) {
    if (cfg.whatsapp_reactivation_enabled !== "true")
        return { enabled: false, pending: 0, sent: 0, closed: 0 };
    const now = new Date();
    let sent = 0, closed = 0, stopped = 0;
    const { data: sentJobs, error: sentError } = await supabase.from("crm_wa_outbox")
        .select("*").eq("kind", "reactivation_1").eq("status", "sent")
        .lte("sent_at", new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()).limit(50);
    if (sentError)
        throw sentError;
    for (const job of sentJobs ?? []) {
        const { data: lead } = await supabase.from("crm_leads").select("id,phone,status").eq("id", job.lead_id).maybeSingle();
        if (!lead || lead.status !== "contacted")
            continue;
        const unchanged = await reactivationStillUnanswered(job, lead);
        if (unchanged === false) {
            const changedAt = now.toISOString();
            await supabase.from("crm_leads").update({ status: "in_progress", status_changed_at: changedAt, updated_at: changedAt })
                .eq("id", lead.id).eq("status", "contacted");
            stopped++;
        }
        else if (unchanged === true) {
            const changedAt = now.toISOString();
            const { data: moved } = await supabase.from("crm_leads").update({ status: "junk", status_changed_at: changedAt, updated_at: changedAt })
                .eq("id", lead.id).eq("status", "contacted").select("id").maybeSingle();
            if (moved) {
                await supabase.from("crm_timeline").insert({
                    lead_id: lead.id, kind: "status_change", body: "📨 Написал, ждём ответа → 🚫 Нет связи",
                    meta: { reason: "reactivation_no_response_48h", automated: true, live_history_verified: true },
                });
                closed++;
            }
        }
    }
    if (!budapestProactiveHours(now))
        return { enabled: true, pending: 0, sent, closed, stopped, proactive_hours: false };
    const { data: jobs, error } = await supabase.from("crm_wa_outbox").select("*")
        .eq("kind", "reactivation_1").eq("status", "pending").lte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true }).limit(10);
    if (error)
        throw error;
    for (const job of jobs ?? []) {
        const { data: lead } = await supabase.from("crm_leads")
            .select("id,name,phone,language,status,last_contact_at,reactivated_at").eq("id", job.lead_id).maybeSingle();
        if (!lead || !["contacted", "follow_up"].includes(String(lead.status)) || lead.reactivated_at) {
            await supabase.from("crm_wa_outbox").update({ status: "skipped", error: "lead is no longer eligible", updated_at: now.toISOString() }).eq("id", job.id);
            stopped++;
            continue;
        }
        try {
            const result = await relayReactivation(job, lead);
            if (result.sent)
                sent++;
            else if (result.stopped)
                stopped++;
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
            await supabase.from("crm_wa_outbox").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
            console.error("reactivation send", lead.id, message);
        }
    }
    return { enabled: true, pending: jobs?.length ?? 0, sent, closed, stopped, proactive_hours: true };
}
if (import.meta.main)
    Deno.serve(async (req) => {
        try {
            const cfg = await config();
            const url = new URL(req.url);
            if (url.pathname.includes("-staging") && url.searchParams.get("cron") !== "dryrun")
                return json({ error: "staging runs dry runs only" }, 403);
            if (req.method === "GET" && url.searchParams.has("hub.mode")) {
                const valid = url.searchParams.get("hub.mode") === "subscribe" &&
                    Boolean(cfg.whatsapp_meta_verify_token) && cfg.whatsapp_meta_verify_token !== "CHANGE_ME" &&
                    url.searchParams.get("hub.verify_token") === cfg.whatsapp_meta_verify_token;
                return valid
                    ? new Response(url.searchParams.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } })
                    : new Response("forbidden", { status: 403 });
            }
            if (req.method === "POST") {
                const rawBody = await req.text();
                let payload: AnyMap;
                try {
                    payload = JSON.parse(rawBody);
                }
                catch {
                    return json({ ok: true, ignored: "invalid_json" });
                }
                if (payload.object === "whatsapp_business_account") {
                    if (!(await validMetaSignature(cfg.whatsapp_meta_app_secret ?? "", rawBody, req.headers.get("x-hub-signature-256")))) {
                        return json({ error: "forbidden" }, 403);
                    }
                    return json({ ok: true, ...(await ingestMeta(payload)) });
                }
                const supplied = req.headers.get("x-whatsapp-secret") ?? url.searchParams.get("secret") ?? "";
                if (!cfg.whatsapp_webhook_secret || cfg.whatsapp_webhook_secret === "CHANGE_ME" || supplied !== cfg.whatsapp_webhook_secret) {
                    return json({ error: "forbidden" }, 403);
                }
                if (url.searchParams.get("cron") === "analyze")
                    return json({ ok: true, ...(await analyzePending(cfg)) });
                if (url.searchParams.get("cron") === "firsttouch")
                    return json({ ok: true, ...(await runPendingFirstTouches(cfg)) });
                if (url.searchParams.get("cron") === "autoreplies")
                    return json({ ok: true, ...(await runConversationAutoreplies(cfg)) });
                if (url.searchParams.get("cron") === "followups")
                    return json({ ok: true, ...(await runFollowups(cfg)), silent: await runSilentSweep(cfg), booking: await runBookingSweep(cfg).catch((e) => ({ error: String(e) })), inbound: await runInboundFollowups(cfg).catch((e) => ({ error: String(e) })), cadence: await runCadenceFollowups(cfg).catch((e) => ({ error: String(e) })), farewell: await runFarewellQueue(cfg).catch((e) => ({ error: String(e) })), price_ready: await runPriceReadySweep(cfg).catch((e) => ({ error: String(e) })), review_ask: await runReviewAskSweep(cfg).catch((e) => ({ error: String(e) })), review_backlog: await runReviewBacklogSweep(cfg).catch((e) => ({ error: String(e) })), pings: await runUnansweredPings(cfg).catch((e) => ({ error: String(e) })), order_changes: await runOrderChangeSweep(cfg).catch((e) => ({ error: String(e) })), media: await runMediaArchive().catch((e) => ({ error: String(e) })) });
                if (url.searchParams.get("cron") === "mediaarchive")
                    return json({ ok: true, ...(await runMediaArchive()) });
                if (url.searchParams.get("cron") === "reactivations")
                    return json({ ok: true, ...(await runReactivations(cfg)) });
                if (url.searchParams.get("cron") === "review")
                    return json({ ok: true, ...(await runReviewSweep(supabase, cfg)) });
                if (url.searchParams.get("cron") === "learn")
                    return json({ ok: true, ...(await runSelfLearn(supabase, cfg)) });
                if (url.searchParams.get("cron") === "dryrun")
                    return json({ ok: true, ...(await runDryRun(cfg, payload)) });
                if (url.searchParams.get("cron") === "priceready") {
                    const { data: lead } = await supabase.from("crm_leads").select("id,name,phone,status,source,language,what_to_clean").eq("id", String(payload.lead ?? "")).maybeSingle();
                    const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,sent_at").eq("lead_id", String(payload.lead ?? "")).order("sent_at", { ascending: true }).limit(60);
                    const messages = (rows ?? []).map((m: AnyMap) => ({ direction: String(m.direction), body: String(m.body ?? ""), sent_at: String(m.sent_at) }));
                    return json({ ok: true, ...(lead ? await priceReadyForLead(cfg, lead, messages, payload.send === true) : { error: "lead not found" }) });
                }
                if (url.searchParams.get("cron") === "reviewbacklog") {
                    return json({ ok: true, ...(await runReviewBacklogSweep(cfg, payload.send !== true)) });
                }
                if (url.searchParams.get("cron") === "bookingdry") {
                    const { data: lead } = await supabase.from("crm_leads").select("id,name").eq("id", String(payload.lead ?? "")).maybeSingle();
                    const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,sent_at").eq("lead_id", String(payload.lead ?? "")).order("sent_at", { ascending: true }).limit(60);
                    const messages = (rows ?? []).map((m: AnyMap) => ({ direction: String(m.direction), body: String(m.body ?? ""), sent_at: String(m.sent_at) }));
                    const draft = lead ? await readBookingDraft(cfg, lead, messages) : {};
                    return json({ ok: true, worth: worthChecking(messages), draft, problems: bookingProblems(draft, messages), slot: bookingSlot(draft) });
                }
                if (url.searchParams.get("cron") === "health")
                    return json({ ok: true, ...(await runHealth(cfg, payload)) });
                const ingested = await ingest(cfg, payload);
                if (Number(ingested.accepted ?? 0) > 0) {
                    const immediate = runConversationAutoreplies(cfg).catch((error) => {
                        console.error("immediate conversation autoreply", error);
                        return null;
                    });
                    const runtime = (globalThis as AnyMap).EdgeRuntime;
                    if (runtime?.waitUntil)
                        runtime.waitUntil(immediate);
                }
                return json({ ok: true, ...ingested, autoreply_triggered: Number(ingested.accepted ?? 0) > 0 });
            }
            const supplied = req.headers.get("x-whatsapp-secret") ?? url.searchParams.get("secret") ?? "";
            if (!cfg.whatsapp_webhook_secret || cfg.whatsapp_webhook_secret === "CHANGE_ME" || supplied !== cfg.whatsapp_webhook_secret) {
                return json({ error: "forbidden" }, 403);
            }
            if (url.searchParams.get("cron") === "analyze")
                return json({ ok: true, ...(await analyzePending(cfg)) });
            if (url.searchParams.get("cron") === "firsttouch")
                return json({ ok: true, ...(await runPendingFirstTouches(cfg)) });
            if (url.searchParams.get("cron") === "autoreplies")
                return json({ ok: true, ...(await runConversationAutoreplies(cfg)) });
            if (url.searchParams.get("cron") === "followups")
                return json({ ok: true, ...(await runFollowups(cfg)), silent: await runSilentSweep(cfg), booking: await runBookingSweep(cfg).catch((e) => ({ error: String(e) })), inbound: await runInboundFollowups(cfg).catch((e) => ({ error: String(e) })), cadence: await runCadenceFollowups(cfg).catch((e) => ({ error: String(e) })), farewell: await runFarewellQueue(cfg).catch((e) => ({ error: String(e) })), price_ready: await runPriceReadySweep(cfg).catch((e) => ({ error: String(e) })), review_ask: await runReviewAskSweep(cfg).catch((e) => ({ error: String(e) })), review_backlog: await runReviewBacklogSweep(cfg).catch((e) => ({ error: String(e) })), pings: await runUnansweredPings(cfg).catch((e) => ({ error: String(e) })), order_changes: await runOrderChangeSweep(cfg).catch((e) => ({ error: String(e) })) });
            if (url.searchParams.get("cron") === "reactivations")
                return json({ ok: true, ...(await runReactivations(cfg)) });
            if (url.searchParams.get("cron") === "review")
                return json({ ok: true, ...(await runReviewSweep(supabase, cfg)) });
            if (url.searchParams.get("cron") === "learn")
                return json({ ok: true, ...(await runSelfLearn(supabase, cfg)) });
            return json({ ok: true });
        }
        catch (error) {
            console.error(error);
            return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
        }
    });
