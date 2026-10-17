import { createClient } from "jsr:@supabase/supabase-js@2";
import { cancelMasterJobs } from "../_shared/cancel_jobs.ts";
import { draftReply, gbpListReviews, gbpToken, reviewRow } from "../_shared/gbp.ts";
import { jobDone, reviewCity, reviewRequestText, reviewWaUrl } from "../_shared/review_request.ts";
import { firstTouchText, firstTouchWaUrl, brandName, closingText, leadDetails, ruName, waButtonUrl, waDigits, SVC_RU, SVC_EN } from "../_shared/first_touch.ts";
import { closureGapFingerprint, closureGaps, confirmedVisitAction, selectMariaRecipient, type ClosureDeal, type ClosureGap, type ClosureLead, type ClosureMaster } from "./closure_reminders.ts";
import { wordingObjections } from "../crm-whatsapp-webhook/guards.ts";
import { isBareAcknowledgement } from "../crm-whatsapp-webhook/repetition.ts";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const STATUS: Record<string, string> = { new: "Новый", contacted: "📨 Написал, ждём ответа", in_progress: "В работе", follow_up: "Follow-up", pushing: "Дожим", won: "✅ Выиграно", lost: "❌ Слив", junk: "🚫 Нет связи" };
const STATUS_KEYS = Object.keys(STATUS);
const MONTH_RU = ["январская", "февральская", "мартовская", "апрельская", "майская", "июньская", "июльская", "августовская", "сентябрьская", "октябрьская", "ноябрьская", "декабрьская"];
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function promoMonth(tz: string): {
    ru: string;
    en: string;
} {
    const m = Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, month: "2-digit" }).format(new Date())) - 1;
    return { ru: MONTH_RU[m], en: MONTH_EN[m] };
}
type Cfg = Record<string, string>;
async function getConfig(): Promise<Cfg> {
    const { data, error } = await supabase.from("crm_app_config").select("key,value");
    if (error)
        throw error;
    return Object.fromEntries((data ?? []).map((r: {
        key: string;
        value: string;
    }) => [r.key, r.value]));
}
async function setConfig(key: string, value: string) { await supabase.from("crm_app_config").upsert({ key, value }); }
async function tg(token: string, method: string, payload: unknown): Promise<Record<string, unknown> | null> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => null);
    if (!res.ok)
        console.error("tg error", method, JSON.stringify(j));
    return j;
}
const escapeHtml = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const Ft = (n: number) => fmt(n) + " Ft";
function tzOffsetMs(tz: string, date: Date): number {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUTC - date.getTime();
}
function localToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number): Date {
    const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
    return new Date(guess - tzOffsetMs(tz, new Date(guess)));
}
function localParts(tz: string, date: Date) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
function resolveDue(tz: string, due: {
    date?: string | null;
    time?: string | null;
    in_days?: number | null;
    in_hours?: number | null;
} | null | undefined): Date | null {
    if (!due)
        return null;
    const now = new Date();
    if (due.in_hours && !due.date && due.in_days == null)
        return new Date(now.getTime() + due.in_hours * 3600000);
    const np = localParts(tz, now);
    let y = np.y, mo = np.mo, d = np.d;
    if (due.date && /^\d{4}-\d{2}-\d{2}$/.test(due.date)) {
        const [yy, mm, dd] = due.date.split("-").map(Number);
        y = yy;
        mo = mm;
        d = dd;
    }
    else if (due.in_days != null) {
        const base = localToUtc(tz, np.y, np.mo, np.d, 12, 0);
        const shifted = localParts(tz, new Date(base.getTime() + due.in_days * 86400000));
        y = shifted.y;
        mo = shifted.mo;
        d = shifted.d;
    }
    else if (due.in_hours == null && !due.time)
        return null;
    let h = 10, mi = 0;
    if (due.time && /^\d{1,2}:\d{2}$/.test(due.time)) {
        const [hh, mm] = due.time.split(":").map(Number);
        h = hh;
        mi = mm;
    }
    return localToUtc(tz, y, mo, d, h, mi);
}
export function parseMoney(s: string): number[] {
    const out: number[] = [];
    for (const mm of s.matchAll(/(\d[\d \u00a0\u2009]*\d|\d)\s*(тыс[а-яё]*|тис[а-яё]*|k|к)?(?![\wа-яё])/gi)) {
        const n = Number(String(mm[1]).replace(/\D/g, ""));
        if (!n)
            continue;
        const scaled = mm[2] ? n * 1000 : n;
        if (scaled >= 500)
            out.push(scaled);
    }
    return out;
}
const NAME_ALIASES: Record<string, string> = {
    "я": "мария", "мария": "мария", "марию": "мария",
    "ваня": "иван", "ваню": "иван", "иван": "иван",
    "оля": "ольга", "олю": "ольга", "ольга": "ольга",
    "даша": "дарья", "дашу": "дарья", "дарья": "дарья",
};
const NAME_STOP = new Set(["заказ", "заказе", "заказу", "на", "в", "и", "с", "до", "после", "едут", "едет", "поедут", "поедет", "ставлю", "ставь", "будут", "будет", "отправляю", "работает", "работают", "убирает", "убирают", "бригада", "часов", "час", "утра", "дня", "сегодня", "завтра", "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь", "янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]);
const normName = (x: string) => x.toLowerCase().replace(/[іїi]/g, "и").replace(/[єe]/g, "е").replace(/ё/g, "е").trim();
export function matchMasterNames(text: string, masters: {
    id: string;
    name: string;
}[]): {
    found: {
        id: string;
        name: string;
    }[];
    unknown: string[];
} {
    const found: {
        id: string;
        name: string;
    }[] = [];
    const unknown: string[] = [];
    const seen = new Set<string>();
    for (const raw of String(text ?? "").split(/[^\p{L}-]+/u)) {
        const w = normName(raw);
        if (!w || NAME_STOP.has(w))
            continue;
        const key = NAME_ALIASES[w];
        if (!key) {
            if (w.length >= 3 && /^\p{L}+$/u.test(w) && !unknown.includes(raw))
                unknown.push(raw);
            continue;
        }
        const hit = masters.find((m) => normName(String(m.name)).startsWith(key.slice(0, 4)) || normName(String(m.name)).includes(key));
        if (hit && !seen.has(hit.id)) {
            seen.add(hit.id);
            found.push({ id: hit.id, name: String(hit.name) });
        }
        else if (!hit && !unknown.includes(raw))
            unknown.push(raw);
    }
    return { found, unknown };
}
async function applyCrew(leadId: string, masterIds: string[]): Promise<{
    crewNames: string[];
    warn: string;
}> {
    const { data: lr } = await supabase.from("crm_leads").select("crew,assigned_master_id").eq("id", leadId).limit(1);
    const crew: Array<Record<string, unknown>> = Array.isArray(lr?.[0]?.crew) ? lr![0].crew as Array<Record<string, unknown>> : [];
    const have = new Set(crew.map((c) => String(c.m)));
    for (const id of masterIds) {
        if (have.has(id))
            continue;
        crew.push({ m: id, ok: null, pay: "", sum: "", sent: null, brief: "" });
        have.add(id);
    }
    const { data: ms } = await supabase.from("crm_masters").select("id,name,pair_master_id").in("id", [...have]);
    const names = (ms ?? []).map((m) => String(m.name));
    let warn = "";
    const pairClash = (ms ?? []).some((m) => m.pair_master_id && have.has(String(m.pair_master_id)));
    if (pairClash)
        warn = "❗ На заказе оба из одной пары (Ваня и Пётр). Платим ОДИН раз, едет кто-то один. Если это ошибка - скажи, уберу.";
    await supabase.from("crm_leads").update({ crew, updated_at: new Date().toISOString() }).eq("id", leadId);
    return { crewNames: names, warn };
}
async function masterJobsBetween(masterId: string, fromIso: string, toIso: string, all = false) {
    const cols = "id,name,address,scheduled_at,master_brief,assigned_master_id,crew";
    const st = ["won", "in_progress"];
    if (all) {
        const { data } = await supabase.from("crm_leads").select(cols).in("status", st)
            .gte("scheduled_at", fromIso).lte("scheduled_at", toIso);
        return (data ?? []).sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
    }
    const { data: pairRows } = await supabase.from("crm_masters").select("id").eq("pair_master_id", masterId);
    const ids = [masterId, ...(pairRows ?? []).map((r) => String(r.id))];
    const [own, shared] = await Promise.all([
        supabase.from("crm_leads").select(cols).in("assigned_master_id", ids).in("status", st).gte("scheduled_at", fromIso).lte("scheduled_at", toIso),
        supabase.from("crm_leads").select(cols).contains("crew", [{ m: masterId }]).in("status", st).gte("scheduled_at", fromIso).lte("scheduled_at", toIso),
    ]);
    const seen = new Set<string>();
    return [...(own.data ?? []), ...(shared.data ?? [])].filter((l) => {
        if (seen.has(String(l.id)))
            return false;
        seen.add(String(l.id));
        return true;
    }).sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
}
export function stripMoneyLines(brief: string): string {
    return String(brief ?? "").split("\n").filter((line) => {
        if (parseMoney(line).length)
            return false;
        return !/оплат|сумм|деньг|плат[аиуеё]|платит|взять с|твои|доплат|цен[аыуе]|payout|price|total/i.test(line);
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function parseDayRef(t: string, tz: string, now = new Date()): {
    y: number;
    mo: number;
    d: number;
} | null {
    const np = localParts(tz, now);
    let y = np.y, mo = np.mo, d = 0;
    if (/сегодня|today/.test(t))
        d = np.d;
    else if (/завтра|tomorrow/.test(t)) {
        const nx = localParts(tz, new Date(localToUtc(tz, np.y, np.mo, np.d, 12, 0).getTime() + 86400e3));
        y = nx.y;
        mo = nx.mo;
        d = nx.d;
    }
    else {
        const dm = t.match(/(\d{1,2})\s*[.\/]\s*(\d{1,2})/);
        const mn = t.match(/(\d{1,2})\s*(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)/);
        const only = t.match(/(?:на|for)\s+(\d{1,2})(?:\s*(?:числ\w*|-?е|-?го))?\b/);
        if (dm) {
            d = +dm[1];
            mo = +dm[2];
        }
        else if (mn) {
            d = +mn[1];
            mo = ["янв", "фев", "мар", "апр", "ма", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"].findIndex((x) => mn[2].startsWith(x)) + 1;
        }
        else if (only) {
            d = +only[1];
            if (d < np.d)
                mo = np.mo + 1;
        }
        if (mo > 12) {
            mo -= 12;
            y += 1;
        }
    }
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 ? { y, mo, d } : null;
}
function fmtLocal(tz: string, iso: string | null): string {
    if (!iso)
        return "без срока";
    return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function waTextByStatus(l: Record<string, unknown>, insight?: Record<string, unknown> | null): string {
    const draft = String(insight?.suggested_reply ?? "").trim();
    if (draft)
        return draft.slice(0, 900);
    const st = String(l.status ?? "new");
    if (st === "new")
        return firstTouchText(l);
    const ru = l.language === "ru";
    const first = ruName(l.name, ru);
    const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
    const hi = ru ? `Здравствуйте${first ? ", " + first : ""}!` : `Hi${first ? " " + first : ""}!`;
    const me = ru ? `Алекс из ${brandName(l)}` : `Alex here from ${brandName(l)}`;
    const d = leadDetails(l, ru, svc);
    const subj = d.short || svc;
    const objection = String(insight?.objection ?? "").trim();
    if (st === "contacted") {
        return ru
            ? `${hi} ${me}. Хотел убедиться, что моё сообщение по поводу ${subj} не потерялось. Если помощь ещё нужна, просто напишите, и продолжим.`
            : `${hi} ${me}. Just wanted to make sure my message about ${subj} didn't get lost. If you still need a hand, reply here and we'll continue.`;
    }
    if (st === "pushing") {
        return ru
            ? `${hi} ${me}. Вспомнил про ваш запрос по поводу ${subj}. Если он ещё актуален, напишите, что сейчас удобнее обсудить первым, и я вернусь к деталям.`
            : `${hi} ${me}. I remembered your message about ${subj}. If it's still relevant, tell me what would be most useful to sort out first and I'll pick it up from there.`;
    }
    if (st === "in_progress") {
        return ru
            ? `${hi} ${me}. Возвращаюсь к нашему разговору про ${subj}.${objection ? ` Помню, что для вас было важно: ${objection}.` : ""} Напишите, какой вопрос остался, и разберём его.`
            : `${hi} ${me}. Coming back to our conversation about ${subj}.${objection ? ` I remember that ${objection} mattered to you.` : ""} Tell me what still needs clearing up and we'll go through it.`;
    }
    return ru
        ? `${hi} ${me}. Вспомнил про ваш запрос по поводу ${subj}. Если помощь ещё нужна, напишите, что изменилось с прошлого раза, и продолжим.`
        : `${hi} ${me}. I remembered your request about ${subj}. If you still need help, tell me what's changed since we last spoke and we'll continue from there.`;
}
function waUrlByStatus(l: Record<string, unknown>, insight?: Record<string, unknown> | null): string {
    const dg = waDigits(l.phone);
    if (!dg)
        return "";
    return `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(waTextByStatus(l, insight))}`;
}
function statusKeyboard(leadId: string, base: string, dashKey: string, lead?: Record<string, unknown>, insight?: Record<string, unknown> | null) {
    type TgButton = {
        text: string;
        callback_data?: string;
        url?: string;
        copy_text?: {
            text: string;
        };
    };
    const rows: TgButton[][] = [
        [{ text: "В работе", callback_data: `s:${leadId}:in_progress` }, { text: "Follow-up", callback_data: `s:${leadId}:follow_up` }, { text: "Дожим", callback_data: `s:${leadId}:pushing` }],
        [{ text: "✅ Выиграно", callback_data: `s:${leadId}:won` }, { text: "❌ Слив", callback_data: `s:${leadId}:lost` }],
        [{ text: "🚫 Нет связи (мусор)", callback_data: `s:${leadId}:junk` }],
    ];
    if (lead && ["new", "in_progress", "follow_up", "pushing"].includes(String(lead.status))) {
        const waUrl = waUrlByStatus(lead, insight);
        if (waUrl)
            rows.unshift([{ text: "💬 Написать в WhatsApp", url: waUrl }, { text: "✅ Отправлено", callback_data: `w:${leadId}` }]);
    }
    if (lead && !lead.review_requested_at && reviewCity(lead) && jobDone(lead)) {
        const wa = reviewWaUrl(lead);
        rows.unshift([
            ...(wa ? [{ text: "⭐ Попросить отзыв", url: wa }] : []),
            { text: "📋 Копировать", copy_text: { text: reviewRequestText(lead) } },
            { text: "✅ Попросил", callback_data: `rv:${leadId}:card` },
        ]);
    }
    if (base)
        rows.push([{ text: "🔗 Открыть карточку", url: `${base}/?key=${encodeURIComponent(dashKey)}&lead=${leadId}` }]);
    return { inline_keyboard: rows };
}
function cardText(lead: Record<string, unknown>): string {
    const flag = lead.language === "ru" ? "🇷🇺" : lead.language === "en" ? "🇬🇧" : "";
    const L: string[] = [`🎯 <b>Заявка</b> ${flag}`, "", `👤 <b>${escapeHtml(lead.name as string) || "-"}</b>`];
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
    row("📍 Адрес:", lead.address);
    row("💬 Связь:", lead.contact_method);
    row("🎁 Подарок:", lead.gift);
    row("➕ Доп:", lead.extra_services);
    if (lead.campaign) {
        L.push("");
        L.push(`📊 ${escapeHtml(lead.campaign as string)}`);
    }
    L.push("", `📌 Статус: <b>${STATUS[lead.status as string] ?? lead.status}</b>`);
    if (lead.review_requested_at)
        L.push(`⭐ Отзыв запрошен ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Budapest", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(String(lead.review_requested_at)))}`);
    return L.join("\n");
}
async function refreshCard(token: string, cfg: Cfg, lead: Record<string, unknown>): Promise<boolean> {
    if (!lead.tg_chat_id || !lead.tg_message_id)
        return false;
    const { data: ins } = await supabase.from("crm_wa_insights")
        .select("suggested_reply,objection,next_action").eq("lead_id", lead.id).maybeSingle();
    const r = await tg(token, "editMessageText", {
        chat_id: lead.tg_chat_id, message_id: lead.tg_message_id, text: cardText(lead), parse_mode: "HTML", disable_web_page_preview: true,
        reply_markup: statusKeyboard(lead.id as string, cfg.dashboard_public_base || "", cfg.dashboard_secret || "", lead, ins),
    });
    return !!r?.ok;
}
interface DueSpec {
    date?: string | null;
    time?: string | null;
    in_days?: number | null;
    in_hours?: number | null;
}
const SOURCES = new Set(["referral", "google", "facebook", "instagram", "website", "whatsapp", "direct"]);
interface NewLead {
    name?: string;
    phone?: string;
    language?: string;
    source?: string;
    service?: string;
    what_to_clean?: string;
    area?: string;
    budget?: string;
    contact_method?: string;
    campaign?: string;
    address?: string;
    when_text?: string;
    scheduled?: DueSpec;
    work_order?: string;
    summary?: string;
    status?: string;
    price_quoted?: number | null;
    agreed_amount?: number | null;
    next_action?: string;
    due?: DueSpec;
    deal?: {
        amount?: number;
        master_name?: string;
        extra_costs?: number | null;
        extra_costs_note?: string;
    };
}
interface Interpreted {
    action: "status" | "task" | "note" | "deal" | "analyze_chat" | "new_lead" | "new_leads" | "chat" | "report" | "client_info" | "reactivate" | "notify_master";
    status?: string;
    task?: {
        title?: string;
        reason?: string;
        due?: DueSpec;
    };
    note?: string;
    deal?: {
        amount?: number;
        master_name?: string;
        master_pct?: number | null;
        extra_costs?: number | null;
        extra_costs_note?: string;
        service_done?: string;
        master_splits?: {
            name?: string;
            amount?: number;
        }[];
    };
    analysis?: {
        summary?: string;
        status?: string;
        price_quoted?: number | null;
        agreed_amount?: number | null;
        next_action?: string;
        due?: DueSpec;
        sentiment?: string;
        address?: string;
        when_text?: string;
        scheduled?: DueSpec;
    };
    new_lead?: NewLead;
    new_leads?: NewLead[];
    reply?: string;
    report?: {
        category?: string | null;
        language?: string | null;
        from?: string | null;
        to?: string | null;
        metric?: string | null;
    };
    client_info?: {
        query_name?: string;
    };
    reactivate?: {
        count?: number | null;
        mode?: string | null;
    };
}
function interpretSystem(todayLocal: string, tz: string, leadCtx: string, hist: string, masters: string, objections = ""): Record<string, unknown>[] {
    const rules = `You are the engine of a cleaning-company CRM (CLB Cleaning Budapest). The owner (Alex) sends you a message about ONE lead. Decide what to do and return ONE JSON object, no markdown.
The facts that change with every message (today, the masters, the lead in context, the recent owner messages) are given after these rules.

Choose "action":
- "analyze_chat": the message is a pasted WhatsApp/Telegram conversation with (or about) the lead in context. Read it and fill "analysis": { "summary": 1-2 sentences in Russian, "status": one of [new,in_progress,follow_up,pushing,won,lost] reflecting where the deal stands, "price_quoted": number or null, "agreed_amount": number or null (only if a deal was clearly agreed), "next_action": short Russian phrase like "перезвонить, клиент думает", "due": when to do the next action, "sentiment": "hot"|"warm"|"cold", "address": full address if it appears in the conversation (street, city, floor, intercom) else "", "when_text": agreed visit day/time in Russian (e.g. "пятница 24 июля 10:00") else "", "scheduled": { "date":"YYYY-MM-DD", "time":"HH:MM" } ONLY when a concrete visit date is agreed }. Use this too when a follow-up paste ADDS details (address, date, price) for the lead in context.
- "task": the owner asks to schedule a call-back/reminder ("перезвонить через 3 дня", "напомни завтра в 15:00"). Fill "task": { "title": short Russian, "reason": why, "due": ... }.
- "deal": the owner reports a closed job ("закрыли на 30000 мастер Даша +5000 бензин") OR corrects/updates the existing deal of the lead in context ("мастер Ваня, прибыль 50 на 50", "сумма 25000", "добавь 5000 бензин", "поставь Ивана как мастера"). Fill "deal" with ONLY the fields the owner mentioned: { "amount": number or null (null = keep current), "master_name": EXACT name from the known masters list or "", "master_pct": number or null ("50 на 50"/"50/50"/"пополам"/"прибыль 50 на 50" → 50), "extra_costs": number or null, "extra_costs_note": string, "service_done": string, "master_splits": array or null }. MULTIPLE MASTERS: when the owner names several people WITH their own amounts on one job ("закрыли на 65000 ваня 20000 галина 15000"), fill "master_splits": [{"name":"Иван","amount":20000},{"name":"Галина","amount":15000}] and leave master_name/master_pct null. Use master_splits ONLY when each person has their own number; a single master with a percentage stays in master_name+master_pct.
- "status": the owner just wants to set a status. Fill "status".
- "note": a free note to attach to the card. Fill "note".
- "notify_master": the owner asks to send/resend the assigned job to the cleaner, or replies "сделай/эту/исправь" to a crew-readiness warning whose only actionable problem is that the assigned cleaner has not confirmed. Use this action only when the lead in context already has an assigned cleaner; never invent a cleaner, address, date or brief.
- "new_lead": leadCtx is NONE and the owner pasted a client conversation OR lead details for a client not yet in the CRM. Extract a brand-new WORK ORDER card. Fill "new_lead": { "name", "phone", "language":"ru"|"en", "source": where the client says they came from, one of ["referral","google","facebook","instagram","website","whatsapp","direct"] - "referral" when they were recommended by someone, "direct" when they are a returning client, "google" when they searched, "facebook"/"instagram" when they saw an ad or the page; leave "" when the conversation does not say, "service":"upholstery"|"cleaning"|"deep"|"regular"|"", "what_to_clean", "area", "budget", "contact_method":"whatsapp"|"telegram"|"phone"|"", "address": full street/district/city or "", "when_text": human-readable visit time in Russian (e.g. "среда 8 июля 9:00") or "", "scheduled": { "date":"YYYY-MM-DD", "time":"HH:MM" } ONLY when a visit date/time is agreed (else omit), "summary": 1-2 Russian sentences on where it stands, "status": one of [new,in_progress,follow_up,pushing,won,lost], "price_quoted": number|null, "agreed_amount": number|null, "next_action": short Russian or "", "due": {...}, "deal": { "amount": number, "master_name": string, "extra_costs": number|null, "extra_costs_note": string } only when a sale clearly happened }. BOOKING RULE: if a visit is booked (a date/time is agreed) OR money was paid/agreed, set "status":"won" and fill "address"+"when_text" (+ "scheduled" if you have the date). If a job was completed or paid, also fill "deal". If they are still only discussing price/options, use "in_progress" or "follow_up". Read the WHOLE conversation; the latest agreed date/price wins over earlier ones. WORK ORDER: when "status" is "won", ALSO fill "work_order" - a cleaner-facing brief in Russian, plain text with real line breaks, EXACTLY this shape:
📋 РАБОЧИЙ ОРДЕР / WORK ORDER
Дата / Время: ...
Лид / Клиент: <name> (<phone>)<, заметка про язык/связь>
Адрес: ...
Тип услуги: ... (тайм-лимит если есть)
Оплата: <цена клиента> HUF (наличные/Revolut если известно)
🎯 ГЛАВНАЯ ЗАДАЧА ДЛЯ МАСТЕРА: ...
🛠️ ТЕХНИЧЕСКОЕ ЗАДАНИЕ: пошагово, по приоритетам
🧳 ЧТО ВЗЯТЬ С СОБОЙ: ...
💡 ПРИМЕЧАНИЕ ДЛЯ МАСТЕРА: спец-нюансы (тишина, дети, животные, коды двери)
Use ONLY facts from the chat; omit any line you do not know. NEVER include internal margin or the master payout %.
- "new_leads": the owner pasted SEVERAL clients at once (a dump of lead cards, a list of orders, a forwarded batch). Fill "new_leads": an ARRAY where every element has EXACTLY the same shape as "new_lead" above - one element per client. Use this instead of "new_lead" whenever the text clearly holds MORE THAN ONE distinct client (different names or different phone numbers). Do not merge two clients into one element, and do not invent clients that are not in the text.
- "report": the owner asks an ANALYTICS question about lead/sales STATISTICS (not about one specific client). Examples: "сколько заявок на англоговорящую химчистку за неделю", "сколько заказов по клинингу за июнь", "конверсия по русской химчистке", "сколько мусорных за 20-29 июня", "сколько заработали в июне". Fill "report": { "category": "upholstery" (химчистка) | "cleaning" (любой клининг: генеральная/регулярная/после ремонта) | "windows" (окна) | null (все направления), "language": "ru" | "en" | null, "from": "YYYY-MM-DD" | null, "to": "YYYY-MM-DD" | null, "metric": "revenue" if they ask about money/выручка/заработали else "funnel" }. Resolve relative dates to real YYYY-MM-DD using today=${todayLocal}: "за июнь"→first..last day of June, "за неделю"/"на этой неделе"→last 7 days, "вчера"→yesterday, "сегодня"→today. If no period is mentioned, leave from/to null (all time).
- "client_info": the owner ASKS about a specific client's card or details ("что по Марине?", "какой у неё адрес?", "когда у него визит?", "есть ли сделка у X?", "покажи карточку Y"). Fill "client_info": { "query_name": the client's name in NOMINATIVE base form (Марине→Марина) or their phone as mentioned; "" if it is the lead already in context }.
- "reactivate": the owner asks for a batch of dormant/sleeping leads to re-engage ("дай пачку на реактивацию", "дай спящих", "кого разбудить", "дай 5 лидов на прозвон") OR to RE-contact those already messaged who stayed silent ("дай молчунов", "кому писали неделю назад и тишина", "повторный заход") OR to LIST leads stuck in progress that need a follow-up NOW ("кто завис", "кому надо написать фолоу ап", "покажи зависших", "кому нужен follow-up") OR to ask finished clients for a GOOGLE REVIEW ("у кого попросить отзывы", "дай на отзывы", "кому отправить запрос на фидбек") OR to LIST leads who submitted a request MORE THAN ONCE ("покажи повторные", "повторные заявки", "кто оставлял заявку дважды", "повторные лиды"). OR to LIST those written to YESTERDAY OR TODAY who have not replied ("кто молчит со вчера", "писал вчера, ответа нет", "молчуны за сегодня", "кому писал вчера и тишина"). Fill "reactivate": { "count": number or null (default 10), "mode": "followup" for silent-after-a-week, "silent_now" for silent-since-yesterday, "stale" for stuck-in-progress, "review" for review requests, "repeats" for repeat-submission leads, else "fresh" }.
- "chat": anything else; put a short helpful Russian reply in "reply". If the owner asks a general question ABOUT the lead in context and the answer is already in the card data above, answer it directly in "reply".
${objections ? `\nРАБОТА С ВОЗРАЖЕНИЯМИ. Если владелец спрашивает, что ответить клиенту на возражение ("что ответить на дорого", "клиент говорит подумаю", "просит скидку", "как дожать") - действие "chat", а в "reply" дай КОНКРЕТНЫЙ ГОТОВЫЙ ТЕКСТ для клиента на его языке, по этой схеме и своими словами:\n${objections}\n` : ""}

RULE: a STATISTICS/analytics question is ALWAYS action "report" (it concerns many leads, not one client), regardless of leadCtx. Otherwise, if leadCtx is NONE, NEVER use analyze_chat/deal/status/note; use "new_lead" when there is a client conversation or lead details (a name or phone is enough), else "task" (a reminder with no client) or "chat".
RULE: a pasted batch of MANY clients is "new_leads" (array), a single client is "new_lead". Count distinct phone numbers/names before choosing.
RULE: when leadCtx is marked "recently discussed", the message is PROBABLY a follow-up about that SAME client - even a long pasted conversation (e.g. the client just sent their address, or more of the same chat). Then use analyze_chat (or status/note/deal) for that lead. Names may differ in spelling or alphabet (Марина = Marina = Marína). Use "new_lead" ONLY if the text clearly concerns a DIFFERENT client (a different phone number, or an unrelated new inquiry).

"due" format (all optional, use what fits): { "date": "YYYY-MM-DD" or null, "time": "HH:MM" 24h or null, "in_days": integer or null, "in_hours": integer or null }. For "через 3 дня" use in_days:3. For "завтра 15:00" use in_days:1, time:"15:00". For "через 2 часа" use in_hours:2.`;
    const facts = `Today is ${todayLocal} (${tz}). Money is HUF (Hungarian forint); "30k"/"30000"/"30 тыс" = 30000.
Known masters - in "master_name" ALWAYS use the exact name from this list, mapping nicknames/latin (ваня/Vanya→Иван, даша→Дарья, настя→Анастасия): ${masters}
Lead in context: ${leadCtx}
Recent owner messages in this chat (oldest first, with the action you took) - use them to resolve follow-ups, pronouns and questions like "а адрес?", "почему нет адреса?", "добавь ему":
${hist || "(none yet)"}`;
    return [
        { type: "text", text: rules, cache_control: { type: "ephemeral" } },
        { type: "text", text: facts },
    ];
}
async function interpret(apiKey: string, system: Record<string, unknown>[], text: string): Promise<Interpreted> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
                body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1600, thinking: { type: "disabled" }, system, messages: [{ role: "user", content: text }] }),
            });
            if (!res.ok)
                throw new Error(`Claude ${res.status}: ${await res.text()}`);
            const data = await res.json();
            const u = data.usage ?? {};
            console.log("interpret usage", JSON.stringify({ input: u.input_tokens, cache_write: u.cache_creation_input_tokens, cache_read: u.cache_read_input_tokens, output: u.output_tokens }));
            const raw = String((data.content ?? []).map((x: Record<string, unknown>) => x.text ?? "").join("")).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
            const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
            if (start < 0 || end < start)
                throw new Error("no JSON in reply");
            return JSON.parse(raw.slice(start, end + 1)) as Interpreted;
        }
        catch (e) {
            lastErr = e;
            if (attempt === 0)
                await new Promise((r) => setTimeout(r, 700));
        }
    }
    throw lastErr;
}
function translit(s: string): string {
    const map: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
    return s.toLowerCase().split("").map((c) => map[c] ?? c).join("");
}
async function leadByCardMessage(messageId: number): Promise<Record<string, unknown> | null> {
    const { data } = await supabase.from("crm_leads").select("*").eq("tg_message_id", messageId).limit(1);
    return data && data.length ? data[0] : null;
}
async function saveActiveLead(chatId: number | string, leadId: string) {
    await setConfig(`active_lead_${chatId}`, `${leadId}|${Date.now()}`);
}
async function loadActiveLead(chatId: number | string): Promise<Record<string, unknown> | null> {
    const { data } = await supabase.from("crm_app_config").select("value").eq("key", `active_lead_${chatId}`).limit(1);
    const raw = data?.[0]?.value as string | undefined;
    if (!raw)
        return null;
    const [leadId, ts] = raw.split("|");
    if (!leadId || (Date.now() - Number(ts || 0)) > 30 * 60000)
        return null;
    const { data: l } = await supabase.from("crm_leads").select("*").eq("id", leadId).limit(1);
    return l && l.length ? l[0] : null;
}
async function leadByPhoneIn(text: string): Promise<Record<string, unknown> | null> {
    const m = text.match(/\+?\d[\d ()\-]{7,}\d/);
    if (!m)
        return null;
    const digits = m[0].replace(/\D/g, "").slice(-9);
    if (digits.length < 7)
        return null;
    const { data } = await supabase.from("crm_leads").select("*").ilike("phone", `%${digits}%`).order("created_at", { ascending: false }).limit(1);
    return data && data.length ? data[0] : null;
}
async function leadByNameInReminder(text: string): Promise<Record<string, unknown> | null> {
    if (!text.trim())
        return null;
    const norm = (s: unknown) => String(s ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const hay = ` ${norm(text)} `;
    const { data } = await supabase.from("crm_leads").select("*")
        .in("status", ["won", "in_progress"])
        .not("scheduled_at", "is", null)
        .order("scheduled_at", { ascending: true }).limit(50);
    const matches = (data ?? []).filter((l) => {
        const n = norm(l.name);
        return n.length >= 3 && hay.includes(` ${n} `);
    });
    return matches.sort((a, b) => String(b.name ?? "").length - String(a.name ?? "").length)[0] ?? null;
}
async function notifyAssignedMaster(cfg: Cfg, lead: Record<string, unknown>): Promise<{
    ok: boolean;
    reason?: string;
    master?: string;
}> {
    if (!lead.assigned_master_id)
        return { ok: false, reason: "мастер не назначен" };
    const { data: rows } = await supabase.from("crm_masters").select("id,name,tg_chat_id,language").eq("id", lead.assigned_master_id).limit(1);
    const master = rows?.[0];
    if (!master?.tg_chat_id)
        return { ok: false, reason: `у мастера ${master?.name ?? ""} не подключён Telegram` };
    const tz = cfg.timezone || "Europe/Budapest";
    const en = master.language === "en";
    const crew = Array.isArray(lead.crew) ? lead.crew as Array<Record<string, unknown>> : [];
    const slotIdx = crew.findIndex((s) => String(s.m ?? "") === String(master.id));
    const slot = slotIdx >= 0 ? crew[slotIdx] : null;
    const brief = String(slot?.brief ?? lead.master_brief ?? "").trim();
    const lines = en ? [
        `🧹 <b>Job reminder, ${escapeHtml(master.name)}</b>`,
        `👤 ${escapeHtml(String(lead.name ?? "-"))}`,
        `📅 ${lead.scheduled_at ? fmtLocal(tz, String(lead.scheduled_at)) : "date to be confirmed"}`,
        `📍 ${lead.address ? escapeHtml(String(lead.address)) : "address to be confirmed"}`,
        `🧽 ${escapeHtml(String(lead.what_to_clean || lead.service || "cleaning"))}`,
        brief ? `📋 <b>Details:</b> ${escapeHtml(brief)}` : "📋 Details to be confirmed",
    ] : [
        `🧹 <b>Напоминание о заказе, ${escapeHtml(master.name)}</b>`,
        `👤 ${escapeHtml(String(lead.name ?? "-"))}`,
        `📅 ${lead.scheduled_at ? fmtLocal(tz, String(lead.scheduled_at)) : "дату уточнят"}`,
        `📍 ${lead.address ? escapeHtml(String(lead.address)) : "адрес уточнят"}`,
        `🧽 ${escapeHtml(String(lead.what_to_clean || lead.service || "уборка"))}`,
        brief ? `📋 <b>Детали:</b> ${escapeHtml(brief)}` : "📋 Детали уточнят",
    ];
    const sent = await tg(cfg.telegram_bot_token, "sendMessage", {
        chat_id: master.tg_chat_id, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: "✅ Принял заказ / Accepted", callback_data: slot ? `acc:${lead.id}:${slotIdx}` : `acc:${lead.id}` }]] },
    });
    if (!sent?.ok)
        return { ok: false, reason: "Telegram не принял сообщение мастеру" };
    const now = new Date().toISOString();
    if (slot) {
        crew[slotIdx] = { ...slot, sent: now };
        await supabase.from("crm_leads").update({ crew }).eq("id", lead.id);
    }
    else
        await supabase.from("crm_leads").update({ master_notified_at: now }).eq("id", lead.id);
    await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: `📨 Заказ повторно отправлен мастеру (${master.name}) через Telegram` });
    return { ok: true, master: master.name };
}
const langFlag = (l: unknown) => (l === "ru" ? "🇷🇺" : l === "en" ? "🇬🇧" : l === "hu" ? "🇭🇺" : "");
async function applyStatus(token: string, cfg: Cfg, lead: Record<string, unknown>, status: string): Promise<Record<string, unknown>> {
    if (!STATUS_KEYS.includes(status) || status === lead.status)
        return lead;
    await supabase.from("crm_leads").update({ status }).eq("id", lead.id);
    await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "status_change", body: `${STATUS[lead.status as string] ?? lead.status} → ${STATUS[status]}` });
    const updated = { ...lead, status };
    await refreshCard(token, cfg, updated);
    if (status === "junk" || status === "lost")
        await offerFarewell(token, cfg, updated, status);
    if ((status === "junk" || status === "lost") && lead.status === "won")
        await cancelMasterJobs(supabase, token, String(lead.id), (iso) => fmtLocal(cfg.timezone || "Europe/Budapest", iso));
    return updated;
}
export const farewellText = (l: Record<string, unknown>) => closingText(l, "junk");
async function offerFarewell(token: string, cfg: Cfg, lead: Record<string, unknown>, kind: "junk" | "lost") {
    const digits = waDigits(lead.phone);
    if (!digits || !cfg.owner_tg_id)
        return;
    const text = closingText(lead, kind);
    const head = kind === "junk" ? "🚫 нет связи" : "❌ слив";
    await tg(token, "sendMessage", {
        chat_id: cfg.owner_tg_id, parse_mode: "HTML", disable_web_page_preview: true,
        text: [`<b>${escapeHtml(String(lead.name ?? "клиент"))}</b> ${langFlag(lead.language)}: ${head}.`, "", `Текст готов, язык ${lead.language === "ru" ? "русский" : "английский"}:`, `<i>${escapeHtml(text.slice(0, 320))}…</i>`].join("\n"),
        reply_markup: { inline_keyboard: [[
                    { text: kind === "junk" ? "💬 Текст «нет связи» ↗" : "💬 Текст «слив» ↗", url: waButtonUrl(lead.phone, text) },
                    { text: "✅ Отправлено", callback_data: `fw:${lead.id}:${kind}` },
                ]] },
    });
}
async function createTask(leadId: string | null, title: string, due: Date | null, reason: string, source: "manual" | "ai") {
    const { data } = await supabase.from("crm_tasks").insert({ lead_id: leadId, title, due_at: due ? due.toISOString() : null, reason, source }).select("*").single();
    if (leadId)
        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "task_created", body: title, meta: { due_at: due?.toISOString() ?? null, reason, source } });
    return data;
}
async function createDeal(lead: Record<string, unknown>, cfg: Cfg, d: NonNullable<Interpreted["deal"]>) {
    let masterId: string | null = null, pct = d.master_pct ?? null;
    if (d.master_name) {
        const { data: ms } = await supabase.from("crm_masters").select("*").ilike("name", `%${d.master_name}%`).limit(1);
        if (ms && ms.length) {
            masterId = ms[0].id;
            if (pct == null)
                pct = Number(ms[0].default_pct);
        }
    }
    if (pct == null)
        pct = Number(cfg.default_master_pct || 30);
    const amount = Number(d.amount || 0);
    const splits = (d.master_splits ?? []).filter((x) => Number(x?.amount) > 0);
    const splitTotal = splits.reduce((sum, x) => sum + Math.round(Number(x.amount)), 0);
    const splitLabel = splits.map((x) => `${x.name ?? "?"} ${Ft(Math.round(Number(x.amount)))}`).join(" · ");
    if (splits.length) {
        const { data: ms } = await supabase.from("crm_masters").select("id,name").ilike("name", `%${splits[0].name ?? ""}%`).limit(1);
        if (ms?.length)
            masterId = ms[0].id;
        pct = null as unknown as number;
    }
    const payout = splits.length ? splitTotal : Math.max(0, Math.round((amount * pct) / 100));
    const extra = Math.max(0, Number(d.extra_costs || 0));
    const dupSince = new Date(Date.now() - 86400000).toISOString();
    const { data: dup } = await supabase.from("crm_deals").select("*").eq("lead_id", lead.id).eq("amount", amount).gte("created_at", dupSince).limit(1);
    if (dup && dup.length) {
        const ex0 = Number(dup[0].extra_costs || 0), pay0 = Number(dup[0].master_payout || 0);
        return { deal: dup[0], payout: pay0, pct: Number(dup[0].master_pct ?? pct), amount, extra: ex0, net: amount - pay0 - ex0 };
    }
    const { data: deal, error } = await supabase.from("crm_deals").insert({
        lead_id: lead.id, master_id: masterId, amount, currency: cfg.base_currency || "HUF",
        master_pct: splits.length ? null : pct, master_payout: payout, extra_costs: extra, extra_costs_note: d.extra_costs_note ?? "",
        service_done: d.service_done ?? "", master_name: splitLabel,
    }).select("*").single();
    if (error || !deal) {
        console.error("createDeal insert", error);
        throw new Error(`сделка НЕ записалась (${error?.message ?? "неизвестная ошибка"})`);
    }
    await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "deal_won", body: `Сделка ${Ft(amount)} · мастерам ${Ft(payout)}${splits.length ? ` (${splitLabel})` : ` (${pct}%)`}${extra ? ` · доп ${Ft(extra)}` : ""}`, meta: { deal_id: deal.id } });
    return { deal, payout, pct, amount, extra, net: amount - payout - extra };
}
async function statsText(cfg: Cfg, showLink: boolean): Promise<string> {
    const { data: leads } = await supabase.from("crm_leads").select("status");
    const counts: Record<string, number> = {};
    for (const l of leads ?? [])
        counts[l.status] = (counts[l.status] ?? 0) + 1;
    const { data: deals } = await supabase.from("crm_deals").select("amount,master_payout,extra_costs");
    let rev = 0, pay = 0, ex = 0;
    for (const d of deals ?? []) {
        rev += Number(d.amount);
        pay += Number(d.master_payout);
        ex += Number(d.extra_costs);
    }
    const { data: openTasks } = await supabase.from("crm_tasks").select("id").eq("done", false);
    const L = ["📊 <b>CRM</b>", "", `Лиды: ${(leads ?? []).length}`];
    for (const k of STATUS_KEYS)
        if (counts[k])
            L.push(`  ${STATUS[k]}: <b>${counts[k]}</b>`);
    L.push("", `💰 Выручка: <b>${Ft(rev)}</b>`, `🧹 Мастера: ${Ft(pay)} · Доп: ${Ft(ex)}`, `✅ Чистыми: <b>${Ft(rev - pay - ex)}</b>`, "", `🔔 Открытых задач: ${(openTasks ?? []).length}`);
    if (showLink && cfg.dashboard_public_base)
        L.push("", `🔗 <a href="${cfg.dashboard_public_base}/?key=${encodeURIComponent(cfg.dashboard_secret || "")}">Открыть дашборд</a>`);
    return L.join("\n");
}
async function runReminders(cfg: Cfg): Promise<number> {
    const token = cfg.telegram_bot_token;
    const chat = cfg.cards_chat_id || cfg.owner_tg_id;
    if (!token || !chat)
        return 0;
    const { data: due } = await supabase.from("crm_tasks").select("*").eq("done", false).eq("notified", false).not("due_at", "is", null).lte("due_at", new Date().toISOString()).limit(50);
    let n = 0;
    for (const t of due ?? []) {
        let lead: Record<string, unknown> | null = null;
        if (t.lead_id) {
            const { data } = await supabase.from("crm_leads").select("name,phone,status").eq("id", t.lead_id).limit(1);
            lead = data?.[0] ?? null;
        }
        const who = lead ? `${escapeHtml(lead.name as string) || "клиент"}${lead.phone ? ` · ${escapeHtml(lead.phone as string)}` : ""}` : "";
        const text = `🔔 <b>Задача</b>\n${escapeHtml(t.title)}${t.reason ? `\n<i>${escapeHtml(t.reason)}</i>` : ""}${who ? `\n👤 ${who}` : ""}`;
        const kb = { inline_keyboard: [[{ text: "✅ Выполнено", callback_data: `t:${t.id}:done` }]] };
        await tg(token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", reply_markup: kb });
        await supabase.from("crm_tasks").update({ notified: true }).eq("id", t.id);
        n++;
    }
    return n;
}
async function runMaster24hReminders(cfg: Cfg): Promise<number> {
    const token = cfg.telegram_bot_token;
    if (!token)
        return 0;
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 3600000);
    const tz = cfg.timezone || "Europe/Budapest";
    const { data: leads, error } = await supabase.from("crm_leads")
        .select("id,name,status,scheduled_at,address,service,what_to_clean,master_brief,assigned_master_id,master_24h_for_scheduled_at,crew")
        .in("status", ["won", "in_progress"])
        .gt("scheduled_at", now.toISOString()).lte("scheduled_at", until.toISOString())
        .order("scheduled_at", { ascending: true });
    if (error) {
        console.error("24h master reminders query", error);
        return 0;
    }
    let sentCount = 0;
    for (const lead of leads ?? []) {
        const scheduled = String(lead.scheduled_at ?? "");
        if (!scheduled)
            continue;
        const crew = Array.isArray(lead.crew) ? lead.crew as Array<Record<string, unknown>> : [];
        const targets = crew.length
            ? crew.map((slot, idx) => ({ masterId: String(slot.m ?? ""), slot, idx }))
            : lead.assigned_master_id
                ? [{ masterId: String(lead.assigned_master_id), slot: null as Record<string, unknown> | null, idx: -1 }]
                : [];
        if (!targets.length)
            continue;
        const ids = [...new Set(targets.map((t) => t.masterId).filter(Boolean))];
        const { data: masters } = ids.length
            ? await supabase.from("crm_masters").select("id,name,tg_chat_id,language").in("id", ids)
            : { data: [] };
        const byId = new Map((masters ?? []).map((m) => [String(m.id), m]));
        let singleSent = false;
        for (const target of targets) {
            if (target.slot && String(target.slot.remind_for ?? "") === scheduled)
                continue;
            if (!target.slot && String(lead.master_24h_for_scheduled_at ?? "") === scheduled)
                continue;
            const master = byId.get(target.masterId);
            if (!master?.tg_chat_id)
                continue;
            const en = master.language === "en";
            const brief = String(target.slot?.brief ?? lead.master_brief ?? "").trim();
            const lines = en ? [
                `⏰ <b>Please reconfirm tomorrow's job, ${escapeHtml(master.name)}</b>`,
                `👤 ${escapeHtml(String(lead.name ?? "-"))}`,
                `📅 ${fmtLocal(tz, scheduled)}`,
                `📍 ${lead.address ? escapeHtml(String(lead.address)) : "address to be confirmed"}`,
                `🧽 ${escapeHtml(String(lead.what_to_clean || lead.service || "cleaning"))}`,
                brief ? `📋 <b>Details:</b> ${escapeHtml(brief)}` : "📋 Details to be confirmed",
                "",
                "Please tap the button again so we know you saw the final job details.",
            ] : [
                `⏰ <b>Подтверди завтрашний заказ ещё раз, ${escapeHtml(master.name)}</b>`,
                `👤 ${escapeHtml(String(lead.name ?? "-"))}`,
                `📅 ${fmtLocal(tz, scheduled)}`,
                `📍 ${lead.address ? escapeHtml(String(lead.address)) : "адрес уточнят"}`,
                `🧽 ${escapeHtml(String(lead.what_to_clean || lead.service || "уборка"))}`,
                brief ? `📋 <b>Детали:</b> ${escapeHtml(brief)}` : "📋 Детали уточнят",
                "",
                "Нажми кнопку ещё раз, чтобы мы знали: финальные детали заказа ты увидел.",
            ];
            const sent = await tg(token, "sendMessage", {
                chat_id: master.tg_chat_id, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
                reply_markup: { inline_keyboard: [[{ text: "✅ Подтверждаю / Confirm", callback_data: target.slot ? `acc:${lead.id}:${target.idx}` : `acc:${lead.id}` }]] },
            });
            if (!sent?.ok)
                continue;
            const stamp = new Date().toISOString();
            if (target.slot)
                crew[target.idx] = { ...target.slot, ok: null, remind_for: scheduled, reminded_at: stamp };
            else
                singleSent = true;
            await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: `⏰ 24ч: повторное подтверждение отправлено мастеру (${master.name})` });
            sentCount++;
        }
        if (crew.length)
            await supabase.from("crm_leads").update({ crew }).eq("id", lead.id);
        else if (singleSent)
            await supabase.from("crm_leads").update({ master_confirmed_at: null, master_24h_for_scheduled_at: scheduled }).eq("id", lead.id);
    }
    return sentCount;
}
async function sendLeadCard(token: string, chat: number | string, l: Record<string, unknown>, waLabel: string, waText: string, statusLine: string, reviewOld = false): Promise<void> {
    const dg = waDigits(l.phone);
    const ru = l.language === "ru";
    const row1: Record<string, unknown>[] = [];
    if (reviewOld && dg)
        row1.push({ text: "🔍 Проверить чат", callback_data: `wp:${l.id}` });
    if (dg && waText)
        row1.push({ text: waLabel, url: `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(waText)}` });
    row1.push({ text: "✅ Отправлено", callback_data: `w:${l.id}` });
    const head = `<b>${escapeHtml((l.name as string) || "-")}</b> ${ru ? "🇷🇺" : "🇬🇧"} · ${escapeHtml((l.phone as string) || "⚠️ БЕЗ ТЕЛЕФОНА")} · ${escapeHtml(String(l.what_to_clean || l.service || ""))}${l.budget ? ` · ${escapeHtml(l.budget as string)}` : ""}`;
    const statusRows = [
        [{ text: "✅ Выиграно", callback_data: `s:${l.id}:won` }, { text: "▶️ В работе", callback_data: `s:${l.id}:in_progress` }],
        [{ text: "❌ Слив", callback_data: `s:${l.id}:lost` }, { text: "🚫 Нет связи", callback_data: `s:${l.id}:junk` }],
    ];
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
        text: `${head}\n${statusLine}`,
        reply_markup: { inline_keyboard: row1.length ? [row1, ...statusRows] : statusRows } });
}
type ReviewRelayResult = {
    ok?: boolean;
    error?: string;
    remoteLid?: string;
    latest?: {
        id?: string;
        fromMe?: boolean;
        timestamp?: number;
    };
    messages?: Array<{
        id?: string;
        fromMe?: boolean;
        timestamp?: number;
        messageType?: string;
        text?: string;
    }>;
    existingState?: string;
    latestTimestamp?: number;
    messageId?: string;
    messageTimestamp?: number;
};
function budapestDayWindow(tz: string): {
    start: string;
    end: string;
    hour: number;
} {
    const now = new Date();
    const p = localParts(tz, now);
    const start = localToUtc(tz, p.y, p.mo, p.d, 0, 0);
    const nextP = localParts(tz, new Date(start.getTime() + 36 * 3600000));
    return { start: start.toISOString(), end: localToUtc(tz, nextP.y, nextP.mo, nextP.d, 0, 0).toISOString(), hour: p.h };
}
function reviewedReactivationText(lead: Record<string, unknown>): string {
    const ru = lead.language === "ru";
    const first = ruName(lead.name, ru);
    const svc = ru ? (SVC_RU[lead.service as string] || "уборке") : (SVC_EN[lead.service as string] || "cleaning");
    return ru
        ? `Здравствуйте${first ? ", " + first : ""}! Алекс из ${brandName(lead)}. Вспомнил про вашу заявку по поводу ${svc} и решил уточнить, нужна ли ещё помощь. Если да, напишите, что сейчас актуально, и продолжим с этого места.`
        : `Hi${first ? " " + first : ""}! Alex here from ${brandName(lead)}. I remembered your ${svc} request and wanted to see if you still need a hand with it. If you do, tell me where things stand now and we'll pick it up from there.`;
}
async function callReviewRelay(payload: Record<string, unknown>): Promise<{
    status: number;
    data: ReviewRelayResult;
}> {
    const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
    const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
    if (!relayUrl || !relaySecret)
        throw new Error("WhatsApp relay не настроен");
    const res = await fetch(relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${relaySecret}` },
        body: JSON.stringify(payload),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) as ReviewRelayResult };
}
async function prepareReviewedReactivation(cfg: Cfg, leadId: string, token: string, chatId: number | string): Promise<string> {
    if (cfg.whatsapp_reactivation_review_enabled !== "true")
        throw new Error("Проверяемая реактивация пока выключена");
    const tz = cfg.timezone || "Europe/Budapest";
    const day = budapestDayWindow(tz);
    const { count } = await supabase.from("crm_wa_outbox").select("id", { count: "exact", head: true })
        .eq("kind", "reactivation_review").gte("updated_at", day.start).lt("updated_at", day.end);
    if ((count ?? 0) >= 10)
        throw new Error("Лимит проверки старых лидов на сегодня уже достигнут: 10");
    const { data: rows } = await supabase.from("crm_leads").select("*").eq("id", leadId).limit(1);
    const lead = rows?.[0] as Record<string, unknown> | undefined;
    if (!lead)
        throw new Error("Лид не найден");
    if (["won", "lost", "junk"].includes(String(lead.status)))
        throw new Error("Карточка уже закрыта, сообщение не готовлю");
    const phone = waDigits(lead.phone);
    if (!phone)
        throw new Error("В карточке нет корректного номера WhatsApp");
    const { data: identity } = await supabase.from("crm_wa_identities").select("remote_lid").eq("lead_id", leadId).limit(1).maybeSingle();
    const checked = await callReviewRelay({ mode: "review", leadId, phone, remoteLid: identity?.remote_lid ?? "" });
    if (checked.status === 404)
        throw new Error("На сервере не найдена подтверждённая история WhatsApp для этого номера");
    if (checked.status !== 200 || !checked.data.latest)
        throw new Error(`Не удалось проверить чат: ${checked.data.error ?? checked.status}`);
    const latest = checked.data.latest;
    const latestId = String(latest.id ?? "");
    const latestTs = Number(latest.timestamp ?? 0);
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(latestId) || latestTs < 1000000000)
        throw new Error("Последнее сообщение не удалось надёжно идентифицировать");
    const now = new Date().toISOString();
    if (latest.fromMe !== true) {
        await supabase.from("crm_leads").update({ status: "in_progress", status_changed_at: now, updated_at: now })
            .eq("id", leadId).in("status", ["new", "contacted", "follow_up", "pushing"]);
        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "whatsapp_reactivation_stopped", body: "Реактивация отменена: последнее сообщение написал клиент" });
        throw new Error("Клиент уже ответил. Отправка отменена, статус исправлен на «В работе»");
    }
    if (Math.floor(Date.now() / 1000) - latestTs < 7 * 86400)
        throw new Error("После последнего исходящего прошло меньше 7 дней, повторно писать рано");
    const remoteLid = String(checked.data.remoteLid ?? identity?.remote_lid ?? "");
    if (remoteLid) {
        await supabase.from("crm_wa_identities").upsert({ lead_id: leadId, phone, remote_lid: remoteLid, evidence: "live Evolution history review", verified_at: now, updated_at: now }, { onConflict: "lead_id" });
    }
    const body = reviewedReactivationText(lead).replace(/—/g, "-");
    const evidence = { reviewed_at: now, source: "telegram_owner_review", latest_messages: (checked.data.messages ?? []).slice(-8) };
    const { data: old } = await supabase.from("crm_wa_outbox").select("id,status").eq("lead_id", leadId).eq("kind", "reactivation_review").limit(1).maybeSingle();
    if (old?.status === "sent")
        throw new Error("Этому лиду проверяемая реактивация уже отправлялась");
    let jobId = String(old?.id ?? "");
    if (jobId) {
        const { error } = await supabase.from("crm_wa_outbox").update({ phone, body, status: "pending", attempts: 0, error: "", remote_lid: remoteLid, expected_last_outbound_id: latestId, expected_last_outbound_timestamp: latestTs, scheduled_at: now, evidence, updated_at: now }).eq("id", jobId);
        if (error)
            throw error;
    }
    else {
        const { data: job, error } = await supabase.from("crm_wa_outbox").insert({ lead_id: leadId, kind: "reactivation_review", phone, body, status: "pending", remote_lid: remoteLid, expected_last_outbound_id: latestId, expected_last_outbound_timestamp: latestTs, scheduled_at: now, evidence }).select("id").single();
        if (error)
            throw error;
        jobId = String(job.id);
    }
    const context = (checked.data.messages ?? []).slice(-5).map((m) => {
        const who = m.fromMe ? "Я" : "Клиент";
        const bodyText = String(m.text ?? "").trim() || `[${String(m.messageType ?? "сообщение")}]`;
        return `${who}: ${escapeHtml(bodyText.slice(0, 320))}`;
    }).join("\n");
    await tg(token, "sendMessage", {
        chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true,
        text: `🔍 <b>Чат проверен: ${escapeHtml(String(lead.name ?? "-"))}</b>\n\n${context || "История без текста"}\n\n<b>Черновик:</b>\n${escapeHtml(body)}`,
        reply_markup: { inline_keyboard: [[{ text: "✅ Отправить", callback_data: `ws:${jobId}` }, { text: "❌ Не отправлять", callback_data: `wx:${jobId}` }]] },
    });
    return jobId;
}
async function sendReviewedReactivation(cfg: Cfg, jobId: string): Promise<{
    sent: boolean;
    reason?: string;
}> {
    if (cfg.whatsapp_reactivation_review_enabled !== "true")
        return { sent: false, reason: "Проверяемая реактивация выключена" };
    const tz = cfg.timezone || "Europe/Budapest";
    const day = budapestDayWindow(tz);
    if (day.hour < 9 || day.hour >= 20)
        return { sent: false, reason: "Отправка разрешена только с 09:00 до 20:00 по Будапешту" };
    const { count } = await supabase.from("crm_wa_outbox").select("id", { count: "exact", head: true })
        .eq("kind", "reactivation_review").eq("status", "sent").gte("sent_at", day.start).lt("sent_at", day.end);
    if ((count ?? 0) >= 10)
        return { sent: false, reason: "Дневной лимит отправок достигнут: 10" };
    const { data: jobs } = await supabase.from("crm_wa_outbox").select("*").eq("id", jobId).eq("kind", "reactivation_review").limit(1);
    const job = jobs?.[0] as Record<string, unknown> | undefined;
    if (!job || job.status !== "pending")
        return { sent: false, reason: "Этот черновик уже обработан или устарел" };
    const { data: leads } = await supabase.from("crm_leads").select("*").eq("id", job.lead_id).limit(1);
    const lead = leads?.[0] as Record<string, unknown> | undefined;
    if (!lead || ["won", "lost", "junk"].includes(String(lead.status)))
        return { sent: false, reason: "Карточка уже закрыта" };
    const expectedTs = Number(job.expected_last_outbound_timestamp ?? 0);
    const sent = await callReviewRelay({
        mode: "reactivation", leadId: lead.id, phone: waDigits(lead.phone), remoteLid: job.remote_lid,
        text: String(job.body ?? ""), sourceTimestamp: expectedTs,
        expectedLastOutboundTimestamp: expectedTs, expectedLastOutboundId: job.expected_last_outbound_id,
    });
    const now = new Date().toISOString();
    if (sent.status === 409) {
        await supabase.from("crm_wa_outbox").update({ status: "skipped", error: sent.data.error ?? "conversation changed", updated_at: now }).eq("id", jobId);
        if (sent.data.existingState === "in_progress")
            await supabase.from("crm_leads").update({ status: "in_progress", status_changed_at: now, updated_at: now }).eq("id", lead.id).in("status", ["new", "contacted", "follow_up", "pushing"]);
        await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "whatsapp_reactivation_stopped", body: "Отправка отменена: после предпросмотра чат изменился" });
        return { sent: false, reason: "Чат изменился после проверки. Сообщение не отправлено" };
    }
    if (sent.status !== 200 || !sent.data.messageId)
        return { sent: false, reason: `WhatsApp не отправил сообщение: ${sent.data.error ?? sent.status}` };
    await supabase.from("crm_wa_outbox").update({ status: "sent", external_message_id: sent.data.messageId, sent_at: now, updated_at: now }).eq("id", jobId);
    await supabase.from("crm_wa_messages").upsert({ provider: "evolution", account_id: "clb-personal", external_message_id: sent.data.messageId, lead_id: lead.id, direction: "outgoing", message_type: "text", body: job.body, sent_at: now, raw_meta: { automated: false, owner_approved: true, kind: "reactivation_review", remote_lid: job.remote_lid } }, { onConflict: "provider,account_id,external_message_id", ignoreDuplicates: true });
    await supabase.from("crm_leads").update({ status: "contacted", status_changed_at: now, last_contact_at: now, reactivated_at: now, updated_at: now }).eq("id", lead.id);
    await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "whatsapp_reactivation_sent", body: "📤 Владелец проверил чат и отправил реактивацию" });
    return { sent: true };
}
async function runNeglectNag(cfg: Cfg): Promise<number> {
    const token = cfg.telegram_bot_token;
    const chat = cfg.owner_tg_id || cfg.cards_chat_id;
    if (!token || !chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    const np = localParts(tz, new Date());
    if (np.h < 8 || np.h >= 18)
        return 0;
    const last = Number(cfg.neglect_last_bump || 0);
    if (Date.now() - last < 29 * 60000)
        return 0;
    const from = new Date(Date.now() - 3 * 864e5).toISOString();
    const to = new Date(Date.now() - 4 * 3600000).toISOString();
    const { data: negl } = await supabase.from("crm_leads").select("*").eq("status", "new").neq("source", "job_application").is("last_contact_at", null).gt("created_at", from).lt("created_at", to).order("created_at", { ascending: true });
    if (!negl?.length)
        return 0;
    await setConfig("neglect_last_bump", String(Date.now()));
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true, text: `👋 <b>Новые лиды без внимания (${negl.length})</b> - ждут дольше 12 часов${negl.length > 6 ? ", показываю первых 6" : ""}:\n💬 - WhatsApp с готовым текстом · ✅ - написал (запишу дату и замолчу) · 🚫 - нет WhatsApp` });
    for (const l of negl.slice(0, 6)) {
        const dg = waDigits(l.phone);
        const msgText = firstTouchText(l);
        const waitH = Math.round((Date.now() - new Date(l.created_at as string).getTime()) / 3600000);
        const waitLbl = waitH < 48 ? `${waitH} ч` : `${Math.floor(waitH / 24)} дн.`;
        await sendLeadCard(token, chat, l, "💬 Написать", msgText, `🆕 новый, ждёт ответа ${waitLbl}`);
    }
    return negl.length;
}
async function runFrozenSweep(cfg: Cfg, overrideChat?: number | string, batch = 12): Promise<number> {
    const token = cfg.telegram_bot_token;
    const chat = overrideChat ?? (cfg.owner_tg_id || cfg.cards_chat_id);
    if (!token || !chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    if (!overrideChat) {
        const np = localParts(tz, new Date());
        if (np.h < 8 || np.h >= 18)
            return 0;
    }
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: rows } = await supabase.from("crm_leads").select("*")
        .in("status", ["new", "contacted", "follow_up", "in_progress", "pushing"]).neq("source", "job_application")
        .or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`)
        .order("created_at", { ascending: false }).limit(600);
    const touched = (l: Record<string, unknown>) => String(l.last_contact_at ?? l.created_at);
    const frozen = (rows ?? [])
        .filter((l) => touched(l) < cutoff)
        .filter((l) => !l.silent_nudged_at || String(l.silent_nudged_at) < touched(l))
        .sort((a, b) => (touched(a) > touched(b) ? -1 : 1))
        .slice(0, Math.min(Math.max(batch, 1), 25));
    if (!frozen.length)
        return 0;
    await supabase.from("crm_leads").update({ silent_nudged_at: new Date().toISOString() }).in("id", frozen.map((l) => l.id));
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `🧊 <b>Заморозка: молчат больше месяца (${frozen.length})</b>\nЭто не дожим, а последняя попытка. Кто не ответит - закрывай: ❌ Слив / 🚫 Нет связи.` });
    for (const l of frozen) {
        await new Promise((r) => setTimeout(r, 150));
        const ru = l.language === "ru";
        const first = ruName(l.name, ru);
        const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
        const msgText = ru
            ? `Здравствуйте${first ? ", " + first : ""}! Алекс из ${brandName(l)}. Мы общались какое-то время назад насчёт ${svc}, и я так и не получил ответа - возможно, тогда было не время. Если вопрос ещё актуален, я на связи. Если нет, просто скажите, и я закрою вашу заявку 🙂`
            : `Hi${first ? " " + first : ""}! Alex from ${brandName(l)}. We spoke a while back about ${svc} and I never heard back - the timing probably was not right. If it is still relevant, I am here. If not, just say so and I will close your request 🙂`;
        const days = Math.floor((Date.now() - new Date(touched(l)).getTime()) / 864e5);
        await sendLeadCard(token, chat, l, "💬 Последняя попытка", msgText, `🧊 ${l.last_contact_at ? "писал" : "заведён"} ${fmtLocal(tz, touched(l))} · тишина ${days} дн.`, true);
    }
    return frozen.length;
}
async function chatDraft(cfg: Cfg, lead: Record<string, unknown>, mode: "nudge" | "answer"): Promise<{
    text: string;
    declined: boolean;
}> {
    const none = { text: "", declined: false };
    if (!cfg.anthropic_api_key)
        return none;
    const { data: rows } = await supabase.from("crm_wa_messages").select("direction,body,message_type,sent_at")
        .eq("lead_id", String(lead.id)).order("sent_at", { ascending: false }).limit(30);
    const msgs = [...(rows ?? [])].reverse();
    if (!msgs.length)
        return none;
    const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const chat = msgs.map((m) => `${m.direction === "incoming" ? "CLIENT" : "OWNER"} [${stamp.format(new Date(String(m.sent_at)))}]: ${String(m.body || `[${m.message_type}]`).slice(0, 1500)}`).join("\n");
    const task = mode === "nudge"
        ? "The client went quiet after Alex's last message. Write a short reminder that names exactly what is pending in this chat (photos they promised, the estimate Alex sent, the question he asked) and makes the next step easy, for example a couple of numbers instead of photos."
        : "The client wrote last and has waited more than a day for Alex. Say sorry for the slow answer in a few words, take in what they wrote, and ask the one thing needed to move on. Never answer with a new price, day or time: Alex confirms those himself.";
    const prompt = `You write one WhatsApp message for Alex, owner of CLB Cleaning Budapest. Return JSON with reply and declined.
${task}
Rules: write in the language the client writes in (Ukrainian if they write Ukrainian, Hungarian if Hungarian). Alex is a man and speaks for himself: I, never we. Two or three short sentences, at most one question, no filler such as "just checking in" or "just following up", no em dash, no pressure, no discount, no number that is not already in the chat, never a day, time or booking. Open with a short "Hi <first name>" only if Alex has not written in the last day.
If the client clearly declined or chose someone else, set declined to true and leave reply empty.

Lead card: name=${lead.name ?? ""}; service=${lead.service ?? ""}; work=${lead.what_to_clean ?? ""}
Chat:
${chat}`;
    const chatNumbers = new Set(chat.match(/\d+/g) ?? []);
    const messages: Record<string, unknown>[] = [{ role: "user", content: prompt }];
    for (let round = 0; round < 2; round++) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: cfg.whatsapp_decision_model || "claude-sonnet-5", max_tokens: 800, thinking: { type: "disabled" }, messages,
                output_config: { format: { type: "json_schema", schema: { type: "object", properties: { reply: { type: "string" }, declined: { type: "boolean" } }, required: ["reply", "declined"], additionalProperties: false } } },
            }),
        });
        if (!res.ok)
            return none;
        const out = await res.json() as Record<string, any>;
        const raw = (out.content ?? []).map((x: Record<string, any>) => x.text ?? "").join("");
        let d: Record<string, unknown>;
        try {
            d = JSON.parse(raw);
        }
        catch {
            return none;
        }
        if (d.declined === true)
            return { text: "", declined: true };
        const text = String(d.reply ?? "").trim().replace(/—/g, "-");
        if (!text)
            return none;
        const problems = wordingObjections(text);
        const stray = (text.match(/\d+/g) ?? []).filter((n) => !chatNumbers.has(n));
        if (stray.length)
            problems.push(`The numbers ${stray.join(", ")} are not in the chat. Leave them out.`);
        if (!problems.length)
            return { text, declined: false };
        messages.push({ role: "assistant", content: raw }, { role: "user", content: `Not usable yet:\n- ${problems.join("\n- ")}\nRewrite it and return the same JSON.` });
    }
    return none;
}
async function runWaitingSweep(cfg: Cfg, batch = 8): Promise<number> {
    const token = cfg.telegram_bot_token;
    const chat = cfg.owner_tg_id || cfg.cards_chat_id;
    if (!token || !chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    const { data: rows } = await supabase.from("crm_wa_messages").select("lead_id,direction,body,sent_at")
        .gte("sent_at", new Date(Date.now() - 14 * 864e5).toISOString()).order("sent_at", { ascending: false }).limit(3000);
    const latest = new Map<string, Record<string, unknown>>();
    for (const m of rows ?? [])
        if (m.lead_id && !latest.has(String(m.lead_id)))
            latest.set(String(m.lead_id), m);
    const dayAgo = Date.now() - 864e5;
    const ids = [...latest.values()]
        .filter((m) => m.direction === "incoming" && new Date(String(m.sent_at)).getTime() < dayAgo && !isBareAcknowledgement(m.body))
        .map((m) => String(m.lead_id));
    if (!ids.length)
        return 0;
    const [{ data: leads }, { data: seen }] = await Promise.all([
        supabase.from("crm_leads").select("*").in("id", ids).neq("source", "job_application").not("status", "in", "(junk,lost)"),
        supabase.from("crm_timeline").select("lead_id,meta").eq("kind", "digest_waiting").in("lead_id", ids),
    ]);
    const shown = new Set((seen ?? []).map((x: Record<string, any>) => `${x.lead_id}|${x.meta?.since}`));
    const todo = (leads ?? []).filter((l) => !shown.has(`${l.id}|${latest.get(String(l.id))?.sent_at}`)).slice(0, batch);
    if (!todo.length)
        return 0;
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `⏰ <b>Ждут твоего ответа больше суток (${todo.length})</b>\n💬 - открыть WhatsApp с готовым ответом, ты нажимаешь «Отправить» сам.` });
    for (const l of todo) {
        await new Promise((r) => setTimeout(r, 150));
        const last = latest.get(String(l.id))!;
        const draft = await chatDraft(cfg, l, "answer").catch(() => ({ text: "", declined: false }));
        const line = `⏰ ждёт с ${fmtLocal(tz, String(last.sent_at))}: «${escapeHtml(String(last.body ?? "[медиа]").slice(0, 200))}»` +
            (draft.text ? `\n✍️ ${escapeHtml(draft.text)}` : draft.declined ? "\n🙅 похоже, отказался: закрой ❌ Слив" : "");
        await sendLeadCard(token, chat, l, "💬 Ответить", draft.text, line, true);
        await supabase.from("crm_timeline").insert({ lead_id: l.id, kind: "digest_waiting", body: "⏰ В сводке: клиент ждёт ответа больше суток", meta: { since: last.sent_at, automated: true } });
    }
    return todo.length;
}
async function runSilentSweep(cfg: Cfg, overrideChat?: number | string, days = 3, batch = 25): Promise<number> {
    const token = cfg.telegram_bot_token;
    const chat = overrideChat ?? (cfg.owner_tg_id || cfg.cards_chat_id);
    if (!token || !chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    if (!overrideChat) {
        const np = localParts(tz, new Date());
        if (np.h < 8 || np.h >= 18)
            return 0;
    }
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    const { data: rows } = await supabase.from("crm_leads").select("*")
        .in("status", ["new", "contacted", "follow_up", "in_progress", "pushing"]).neq("source", "job_application")
        .or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`)
        .order("created_at", { ascending: false }).limit(600);
    const touched = (l: Record<string, unknown>) => String(l.last_contact_at ?? l.created_at);
    const { data: q } = await supabase.from("crm_wa_outbox").select("lead_id").in("kind", ["reoffer", "closing_farewell"]).eq("status", "pending");
    const queued = new Set((q ?? []).map((x: Record<string, unknown>) => String(x.lead_id)));
    const floor = new Date(Date.now() - 30 * 864e5).toISOString();
    const silent = (rows ?? [])
        .filter((l) => touched(l) < cutoff && touched(l) >= floor)
        .filter((l) => !l.silent_nudged_at || String(l.silent_nudged_at) < touched(l) || String(l.silent_nudged_at) < cutoff)
        .filter((l) => !queued.has(String(l.id)))
        .sort((a, b) => (touched(a) < touched(b) ? -1 : 1))
        .slice(0, Math.min(Math.max(batch, 1), 25));
    if (!silent.length)
        return 0;
    await supabase.from("crm_leads").update({ silent_nudged_at: new Date().toISOString() }).in("id", silent.map((l) => l.id));
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `🔕 <b>Молчат после твоего сообщения (${silent.length})</b> - 3+ дня без ответа. Повтор каждые 3 дня, пока не решишь судьбу.\n💬 - напомнить ещё раз, либо реши судьбу: ❌ Слив / 🚫 Нет связи.` });
    for (const l of silent) {
        await new Promise((r) => setTimeout(r, 150));
        const dg = waDigits(l.phone);
        const ru = l.language === "ru";
        const first = ruName(l.name, ru);
        const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
        const msgText = ru
            ? `Здравствуйте${first ? ", " + first : ""}! Алекс из ${brandName(l)} - писал вам пару дней назад насчёт ${svc}. Не хочу быть навязчивым: если сейчас не время, просто скажите, и я не буду больше беспокоить 🙂`
            : `Hi${first ? " " + first : ""}! Alex from ${brandName(l)} - I wrote to you a couple of days ago about ${svc}. I don't want to be pushy: if now isn't the right time, just say so and I won't bother you again 🙂`;
        const days = Math.floor((Date.now() - new Date(touched(l)).getTime()) / 864e5);
        const draft = await chatDraft(cfg, l, "nudge").catch(() => ({ text: "", declined: false }));
        const line = `📤 ${l.last_contact_at ? "писал" : "заведён"} ${fmtLocal(tz, touched(l))} · тишина ${days} дн.` +
            (draft.text ? `\n✍️ ${escapeHtml(draft.text)}` : draft.declined ? "\n🙅 похоже, отказался: закрой ❌ Слив" : "");
        await sendLeadCard(token, chat, l, "💬 Напомнить", draft.declined ? "" : (draft.text || msgText), line, true);
    }
    return silent.length;
}
async function runStaleSweep(cfg: Cfg, overrideChat?: number | string): Promise<number> {
    const token = cfg.telegram_bot_token;
    const chat = overrideChat ?? (cfg.owner_tg_id || cfg.cards_chat_id);
    if (!token || !chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    if (!overrideChat) {
        const np = localParts(tz, new Date());
        if (np.h < 8 || np.h >= 18)
            return 0;
        if (Date.now() - Number(cfg.stale_last_bump || 0) < 3.9 * 3600000)
            return 0;
    }
    const cutoff = new Date(Date.now() - 864e5).toISOString();
    const { data: stale } = await supabase.from("crm_leads").select("*").in("status", ["in_progress", "pushing"]).neq("source", "job_application").lt("status_changed_at", cutoff).or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`).order("status_changed_at", { ascending: true }).limit(8);
    if (!stale?.length)
        return 0;
    if (!overrideChat)
        await setConfig("stale_last_bump", String(Date.now()));
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `⏳ <b>Зависли в работе (${stale.length})</b> - больше 24 часов без движения:\n💬 - follow-up с готовым текстом, потом реши судьбу: ⏳ / ❌ / 🚫` });
    for (const l of stale) {
        const dg = waDigits(l.phone);
        const ru = l.language === "ru";
        const first = ruName(l.name, ru);
        const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
        const msgText = ru
            ? `Здравствуйте${first ? ", " + first : ""}! Алекс из ${brandName(l)} - хотел уточнить по вашей заявке на ${svc}: остались вопросы или что-то смущает? Могу предложить удобное время на этой неделе 🙂`
            : `Hi${first ? " " + first : ""}! Alex from ${brandName(l)} - just checking in about your ${svc} request: any questions I can answer? I can offer a convenient slot this week 🙂`;
        const ageH = Math.floor((Date.now() - new Date(l.status_changed_at as string).getTime()) / 3600000);
        const ageLbl = ageH < 48 ? `${ageH} ч` : `${Math.floor(ageH / 24)} дн.`;
        await sendLeadCard(token, chat, l, "💬 Follow-up", msgText, `📌 ${STATUS[l.status as string]} уже ${ageLbl}${l.last_contact_at ? ` · 📤 писал ${fmtLocal(tz, l.last_contact_at as string)}` : ""}`, true);
    }
    return stale.length;
}
async function runNoCheckNag(cfg: Cfg, overrideChat?: number | string): Promise<number> {
    const token = cfg.telegram_bot_token;
    const chat = overrideChat ?? (cfg.owner_tg_id || cfg.cards_chat_id);
    if (!token || !chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    if (!overrideChat) {
        const np = localParts(tz, new Date());
        if (np.h < 8 || np.h >= 18)
            return 0;
        if (Date.now() - Number(cfg.nocheck_last_bump || 0) < 3.9 * 3600000)
            return 0;
    }
    const { data: won } = await supabase.from("crm_leads").select("id,name,phone,language,scheduled_at").eq("status", "won").neq("source", "job_application").limit(80);
    if (!won?.length)
        return 0;
    const { data: ds } = await supabase.from("crm_deals").select("lead_id").in("lead_id", won.map((l) => l.id));
    const dealSet = new Set((ds ?? []).map((d) => d.lead_id));
    const now = Date.now();
    const noCheck = won.filter((l) => !dealSet.has(l.id) && (!l.scheduled_at || new Date(l.scheduled_at as string).getTime() < now));
    if (!noCheck.length)
        return 0;
    if (!overrideChat)
        await setConfig("nocheck_last_bump", String(Date.now()));
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `💰 <b>Выиграно без суммы (${noCheck.length})</b> - выручка занижена, впишите чек.\nНажми «💰 Вписать сумму» под нужным клиентом, а дальше просто напиши сюда: <code>закрыли на 30000 мастер Даша +5000 бензин</code>` });
    for (const l of noCheck.slice(0, 10)) {
        await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
            text: `<b>${escapeHtml((l.name as string) || "-")}</b> ${l.language === "ru" ? "🇷🇺" : "🇬🇧"} · ${escapeHtml((l.phone as string) || "без тел.")}`,
            reply_markup: { inline_keyboard: [[{ text: "💰 Вписать сумму", callback_data: `s:${l.id}:won` }]] } });
    }
    return noCheck.length;
}
async function runJobReadySweep(cfg: Cfg, overrideChat?: number | string): Promise<number> {
    const token = cfg.telegram_bot_token;
    if (!token)
        return 0;
    const chat = overrideChat ?? (cfg.owner_tg_id || cfg.cards_chat_id);
    if (!chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const until = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const { data: rows, error: qErr } = await supabase.from("crm_leads")
        .select("id,name,scheduled_at,assigned_master_id,crew,master_notified_at,master_confirmed_at,address")
        .in("status", ["won", "in_progress"])
        .gte("scheduled_at", today + "T00:00:00Z").lte("scheduled_at", until + "T23:59:59Z")
        .order("scheduled_at", { ascending: true });
    if (qErr) {
        console.error("jobReadySweep query failed", qErr);
        return 0;
    }
    const { data: ms } = await supabase.from("crm_masters").select("id,name,tg_chat_id");
    const mById = new Map((ms ?? []).map((m: {
        id: string;
        name: string;
        tg_chat_id: number | null;
    }) => [String(m.id), m]));
    const bad: string[] = [];
    for (const l of rows ?? []) {
        const problems: string[] = [];
        const crew = Array.isArray(l.crew) ? l.crew as Array<Record<string, unknown>> : [];
        if (!l.assigned_master_id && !crew.length)
            problems.push("мастер не назначен");
        else {
            if (!crew.length)
                problems.push("нет слота в бригаде, мастер не увидит заказ у себя");
            if (!l.master_notified_at)
                problems.push("бриф не отправлен");
            else if (!l.master_confirmed_at && !crew.some((c) => c.ok))
                problems.push("мастер не подтвердил");
            const m = mById.get(String(l.assigned_master_id ?? ""));
            if (m && !m.tg_chat_id)
                problems.push(`${m.name}: не нажимала Start у бота, сообщение не дойдёт`);
        }
        if (!l.address)
            problems.push("нет адреса");
        if (!problems.length)
            continue;
        const when = fmtLocal(tz, l.scheduled_at as string | null);
        const who = mById.get(String(l.assigned_master_id ?? ""))?.name ?? "-";
        bad.push(`📅 <b>${when}</b> · ${escapeHtml(String(l.name ?? ""))} · ${escapeHtml(String(who))}\n   ⚠️ ${problems.join(", ")}`);
    }
    if (!bad.length)
        return 0;
    await tg(token, "sendMessage", {
        chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
        text: `🚧 <b>Заказы на ближайшие 2 дня, к которым бригада не готова (${bad.length})</b>\n\n${bad.join("\n\n")}\n\nПочинить можно на дашборде: назначить мастера, отправить бриф, дописать адрес.`,
    });
    return bad.length;
}
async function runMasterReminders(cfg: Cfg, slot: "eve" | "morning"): Promise<number> {
    const token = cfg.telegram_bot_token;
    if (!token)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    const dayShift = slot === "eve" ? 86400000 : 0;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + dayShift));
    const { data: rows, error } = await supabase.from("crm_leads")
        .select("id,name,scheduled_at,address,assigned_master_id,master_brief,what_to_clean")
        .in("status", ["won", "in_progress"])
        .not("assigned_master_id", "is", null)
        .gte("scheduled_at", day + "T00:00:00+00:00").lte("scheduled_at", day + "T23:59:59+00:00")
        .order("scheduled_at", { ascending: true });
    if (error) {
        console.error("masterReminders query failed", error);
        return 0;
    }
    if (!rows?.length)
        return 0;
    const { data: ms } = await supabase.from("crm_masters").select("id,name,tg_chat_id,pair_master_id");
    const mById = new Map((ms ?? []).map((m: Record<string, unknown>) => [String(m.id), m]));
    let sent = 0;
    for (const l of rows) {
        const { data: done } = await supabase.from("crm_timeline").select("id")
            .eq("lead_id", l.id).eq("kind", "master_reminder").eq("meta->>slot", `${day}|${slot}`).limit(1);
        if (done?.length)
            continue;
        const m = mById.get(String(l.assigned_master_id));
        if (!m)
            continue;
        const time = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(String(l.scheduled_at)));
        const head = slot === "eve" ? "🔔 <b>Завтра выезд</b>" : "🔔 <b>Сегодня выезд</b>";
        const what = String(l.what_to_clean ?? "").slice(0, 200);
        const text = [
            `${head} в <b>${time}</b>`,
            "",
            `👤 ${escapeHtml(String(l.name ?? "клиент"))}`,
            l.address ? `📍 ${escapeHtml(String(l.address))}` : "",
            what ? `🧽 ${escapeHtml(what)}` : "",
            "",
            slot === "eve" ? "Если что-то не получается, скажи сегодня, а не утром." : "Если опаздываешь, напиши сразу, я предупрежу клиента.",
        ].filter(Boolean).join("\n");
        const chats = [m.tg_chat_id, mById.get(String(m.pair_master_id ?? ""))?.tg_chat_id]
            .filter((c): c is number => typeof c === "number");
        for (const chat of chats) {
            await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true, text });
        }
        if (!chats.length)
            continue;
        await supabase.from("crm_timeline").insert({
            lead_id: l.id, kind: "master_reminder",
            body: `Напоминание мастеру (${slot === "eve" ? "вечер накануне" : "утро выезда"}) отправлено: ${m.name}`,
            meta: { slot: `${day}|${slot}`, master: m.name },
        });
        sent++;
    }
    return sent;
}
function feedbackAskText(l: Record<string, unknown>): string {
    const first = ruName(l.name, l.language === "ru");
    return l.language === "ru"
        ? `Здравствуйте${first ? ", " + first : ""}! Это Алекс из ${brandName(l)} 🙂 Хотел узнать: как вам результат уборки, всё ли понравилось? Нам очень важна обратная связь!`
        : `Hi${first ? " " + first : ""}! This is Alex from ${brandName(l)} 🙂 Just wanted to check in: how was the cleaning, are you happy with the result? Your feedback means a lot to us!`;
}
function reviewLinkText(l: Record<string, unknown>, url: string): string {
    const first = ruName(l.name, l.language === "ru");
    return l.language === "ru"
        ? `Очень рад, что вам понравилось${first ? ", " + first : ""}! 🙏 Если не сложно, оставьте пожалуйста короткий отзыв в Google - для нашей небольшой команды это очень важно: ${url}`
        : `So glad you're happy${first ? ", " + first : ""}! 🙏 If it's not too much trouble, we'd really appreciate a short Google review - it means a lot to our small team: ${url}`;
}
async function runReviewSweep(cfg: Cfg, overrideChat?: number | string): Promise<number> {
    const token = cfg.reviews_bot_token || cfg.telegram_bot_token;
    const chat = overrideChat ?? (cfg.owner_tg_id || cfg.cards_chat_id);
    if (!token || !chat)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest";
    const { data: won } = await supabase.from("crm_leads").select("*").eq("status", "won").neq("source", "job_application").is("review_requested_at", null).is("feedback_asked_at", null).neq("phone", "");
    if (!won?.length)
        return 0;
    const { data: ds } = await supabase.from("crm_deals").select("lead_id,job_date,created_at").in("lead_id", won.map((l) => l.id));
    const lastJob = new Map<string, string>();
    for (const d of ds ?? []) {
        const j = (d.job_date as string) ?? String(d.created_at).slice(0, 10);
        const cur = lastJob.get(d.lead_id as string);
        if (!cur || j > cur)
            lastJob.set(d.lead_id as string, j);
    }
    for (const l of won) {
        if (lastJob.has(l.id as string))
            continue;
        const fallback = (l.scheduled_at ?? l.status_changed_at ?? l.updated_at) as string | null;
        if (fallback)
            lastJob.set(l.id as string, String(fallback).slice(0, 10));
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const done = (l: Record<string, unknown>) => {
        const j = lastJob.get(l.id as string);
        if (!j)
            return false;
        if (j < today)
            return true;
        const start = l.scheduled_at ? new Date(String(l.scheduled_at)).getTime() : 0;
        return j === today && start > 0 && Date.now() > start + 3 * 3600000;
    };
    const cands = won.filter(done)
        .sort((a, b) => String(lastJob.get(b.id as string)).localeCompare(String(lastJob.get(a.id as string)))).slice(0, 8);
    if (!cands.length)
        return 0;
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `💬 <b>Пора спросить фидбек (${cands.length})</b> - заказ выполнен:\n💬 - WhatsApp с вопросом «всё ли понравилось» (БЕЗ ссылки) · ✅ - спросил · 🚫 - не спрашивать\nОтветит хорошо → на карточке появится ⭐ ссылка на Google-отзыв.` });
    for (const l of cands) {
        const dg = waDigits(l.phone);
        const ru = l.language === "ru";
        const row1: Record<string, unknown>[] = [];
        if (dg)
            row1.push({ text: "💬 Спросить фидбек", url: `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(feedbackAskText(l))}` });
        const row2: Record<string, unknown>[] = [{ text: "✅ Спросил", callback_data: `rv:${l.id}:ask` }, { text: "🚫 Не спрашивать", callback_data: `rv:${l.id}:skip` }];
        const row3: Record<string, unknown>[] = [{ text: "⭐ Уже и ссылку отправил", callback_data: `rv:${l.id}:sent` }];
        await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
            text: `<b>${escapeHtml((l.name as string) || "-")}</b> ${ru ? "🇷🇺" : "🇬🇧"} · ${escapeHtml(l.phone as string)}\n🧽 ${escapeHtml(String(l.what_to_clean || l.service || ""))} · выполнено ${lastJob.get(l.id as string)}`,
            reply_markup: { inline_keyboard: row1.length ? [row1, row2, row3] : [row2, row3] } });
    }
    return cands.length;
}
async function runReviewStuckSweep(cfg: Cfg, overrideChat?: number | string): Promise<number> {
    const token = cfg.reviews_bot_token || cfg.telegram_bot_token;
    const chat = overrideChat ?? (cfg.owner_tg_id || cfg.cards_chat_id);
    if (!token || !chat)
        return 0;
    const reviewUrl = (cfg.google_review_url || "").trim();
    const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: stuck } = await supabase.from("crm_leads").select("*")
        .eq("status", "won").neq("source", "job_application")
        .is("review_requested_at", null).not("feedback_asked_at", "is", null)
        .lt("feedback_asked_at", cutoff).neq("phone", "")
        .order("feedback_asked_at", { ascending: true }).limit(4);
    if (!stuck?.length)
        return 0;
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML",
        text: `⭐ <b>Спросили фидбек, ссылку не отправили (${stuck.length})</b>\nОни уже ответили, что довольны. Осталось попросить отзыв.` });
    for (const l of stuck) {
        const dg = waDigits(l.phone);
        const kb: Record<string, unknown>[][] = [];
        if (dg && reviewUrl)
            kb.push([{ text: "⭐ Отправить ссылку", url: `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(reviewLinkText(l, reviewUrl))}` }]);
        kb.push([{ text: "✅ Ссылку отправил", callback_data: `rv:${l.id}:sent` }, { text: "🚫 Не просить", callback_data: `rv:${l.id}:skip` }]);
        await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
            text: `<b>${escapeHtml((l.name as string) || "-")}</b> · ${escapeHtml(l.phone as string)}\n🧽 ${escapeHtml(String(l.what_to_clean || l.service || ""))} · фидбек спросили ${String(l.feedback_asked_at).slice(0, 10)}`,
            reply_markup: { inline_keyboard: kb } });
    }
    return stuck.length;
}
async function runGbpPoll(cfg: Cfg, force = ""): Promise<Record<string, unknown>> {
    const all = (await gbpListReviews(await gbpToken())).map(reviewRow);
    const { data: known } = await supabase.from("crm_gbp_reviews").select("review_id,draft_reply,notified_at");
    const seen = new Map((known ?? []).map((r) => [r.review_id as string, r]));
    const { error } = await supabase.from("crm_gbp_reviews").upsert(all.map((r) => ({ ...r, fetched_at: new Date().toISOString() })), { onConflict: "review_id" });
    if (error)
        throw new Error(`upsert ${error.message}`);
    const token = cfg.reviews_bot_token || cfg.telegram_bot_token;
    const chat = cfg.owner_tg_id;
    let drafted = 0, notified = 0;
    const todo = all.filter((r) => force ? r.review_id === force : !r.reply_comment && !seen.get(r.review_id)?.notified_at).slice(0, 5);
    for (const r of todo) {
        let draft = String(seen.get(r.review_id)?.draft_reply ?? "");
        if ((!draft || force) && cfg.anthropic_api_key) {
            try {
                draft = await draftReply(cfg.anthropic_api_key, r);
                await supabase.from("crm_gbp_reviews").update({ draft_reply: draft, draft_at: new Date().toISOString() }).eq("review_id", r.review_id);
                drafted++;
            }
            catch (e) {
                console.error("gbp draft", r.review_id, e);
            }
        }
        if (force || !token || !chat)
            continue;
        const base = cfg.dashboard_public_base || "";
        const sent = await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
            text: `⭐ <b>Новый отзыв в Google</b> ${"★".repeat(r.stars ?? 0)}\n👤 ${escapeHtml(r.reviewer_name || "-")}\n${r.comment ? `«${escapeHtml(r.comment.slice(0, 1500))}»` : "<i>без текста</i>"}\n\n✍️ <b>Черновик ответа:</b>\n${escapeHtml(draft || "не получился, напиши в CRM")}\n\nНичего не опубликовано. Поправь и отправь в CRM.`,
            ...(base ? { reply_markup: { inline_keyboard: [[{ text: "✏️ Ответить в CRM", url: `${base}/?view=reviews` }]] } } : {}) });
        if (sent?.ok) {
            await supabase.from("crm_gbp_reviews").update({ notified_at: new Date().toISOString() }).eq("review_id", r.review_id);
            notified++;
        }
    }
    return { total: all.length, new: all.filter((r) => !seen.has(r.review_id)).length, unanswered: all.filter((r) => !r.reply_comment).length, drafted, notified };
}
async function sendMorningDigest(cfg: Cfg): Promise<boolean> {
    const token = cfg.telegram_bot_token;
    const chat = cfg.owner_tg_id || cfg.cards_chat_id;
    if (!token || !chat)
        return false;
    const tz = cfg.timezone || "Europe/Budapest";
    const np = localParts(tz, new Date());
    const dayStart = localToUtc(tz, np.y, np.mo, np.d, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 864e5);
    const tomEnd = new Date(dayStart.getTime() + 2 * 864e5);
    const iso = (d: Date) => d.toISOString();
    const [vt, vm, td, nl, wonLeads, dealRows, staleQ, sleepQ, stQ, waitQ, frozenQ] = await Promise.all([
        supabase.from("crm_leads").select("name,phone,address,scheduled_at").gte("scheduled_at", iso(dayStart)).lt("scheduled_at", iso(dayEnd)).order("scheduled_at"),
        supabase.from("crm_leads").select("name,scheduled_at").gte("scheduled_at", iso(dayEnd)).lt("scheduled_at", iso(tomEnd)).order("scheduled_at"),
        supabase.from("crm_tasks").select("title,due_at").eq("done", false).not("due_at", "is", null).lt("due_at", iso(dayEnd)).order("due_at").limit(30),
        supabase.from("crm_leads").select("name").neq("source", "job_application").gt("created_at", iso(new Date(Date.now() - 864e5))),
        supabase.from("crm_leads").select("id,name").eq("status", "won"),
        supabase.from("crm_deals").select("lead_id"),
        supabase.from("crm_leads").select("id", { count: "exact", head: true }).neq("source", "job_application").in("status", ["in_progress", "pushing", "follow_up"]).lt("status_changed_at", iso(new Date(Date.now() - 3 * 864e5))),
        supabase.from("crm_leads").select("id", { count: "exact", head: true }).neq("source", "job_application").in("status", ["new", "follow_up"]).is("reactivated_at", null).is("last_contact_at", null).neq("phone", ""),
        supabase.from("crm_leads").select("id", { count: "exact", head: true }).neq("source", "job_application").in("status", ["new", "follow_up"]).not("last_contact_at", "is", null).lt("last_contact_at", iso(new Date(Date.now() - 7 * 864e5))),
        supabase.from("crm_leads").select("id", { count: "exact", head: true }).neq("source", "job_application").eq("status", "contacted")
            .lt("last_contact_at", iso(new Date(Date.now() - 3 * 864e5))).gte("last_contact_at", iso(new Date(Date.now() - 30 * 864e5))),
        supabase.from("crm_leads").select("id", { count: "exact", head: true }).neq("source", "job_application").eq("status", "contacted")
            .or(`last_contact_at.is.null,last_contact_at.lt.${iso(new Date(Date.now() - 30 * 864e5))}`),
    ]);
    const dealSet = new Set((dealRows.data ?? []).map((d) => d.lead_id));
    const noCheck = (wonLeads.data ?? []).filter((l) => !dealSet.has(l.id));
    const overdue = (td.data ?? []).filter((t) => new Date(t.due_at) < new Date());
    const L: string[] = [`☀️ <b>Сводка на ${String(np.d).padStart(2, "0")}.${String(np.mo).padStart(2, "0")}</b>`, ""];
    const vis = vt.data ?? [];
    L.push(`🚗 <b>Визиты сегодня${vis.length ? ` (${vis.length})` : ""}:</b>`);
    if (vis.length) {
        for (const v of vis)
            L.push(`• ${fmtLocal(tz, v.scheduled_at)} - <b>${escapeHtml(v.name)}</b>${v.address ? ` · ${escapeHtml(v.address)}` : ""}${v.phone ? ` · ${escapeHtml(v.phone)}` : ""}`);
    }
    else
        L.push("• нет");
    if (vm.data?.length)
        L.push(`🗓 Завтра: ${vm.data.map((v) => `${escapeHtml(v.name)} (${fmtLocal(tz, v.scheduled_at)})`).join(", ")}`);
    L.push("");
    L.push(`🔔 Задач на сегодня: <b>${(td.data ?? []).length}</b>${overdue.length ? ` (просрочено ${overdue.length})` : ""}`);
    for (const t of (td.data ?? []).slice(0, 3))
        L.push(`• ${escapeHtml(t.title)} <i>(${fmtLocal(tz, t.due_at)})</i>`);
    L.push(`🆕 Новых лидов за сутки: <b>${(nl.data ?? []).length}</b>`);
    if (noCheck.length)
        L.push(`⚠️ Выиграно без чека: <b>${noCheck.length}</b> - ${noCheck.slice(0, 4).map((l) => escapeHtml(l.name)).join(", ")}`);
    L.push(`💤 Спящих: <b>${sleepQ.count ?? 0}</b>${(staleQ.count ?? 0) ? ` · зависших в работе: ${staleQ.count}` : ""} - напиши «дай пачку на реактивацию»`);
    if (stQ.count)
        L.push(`✉️ Молчат неделю после захода: <b>${stQ.count}</b> - напиши «дай молчунов»`);
    if ((waitQ.count ?? 0) || (frozenQ.count ?? 0)) {
        L.push(`📨 Ждут ответа: <b>${waitQ.count ?? 0}</b> свежих (3-30 дн.)${(frozenQ.count ?? 0) ? ` · <b>${frozenQ.count}</b> старше месяца` : ""}`);
    }
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true, text: L.join("\n") });
    return true;
}
function svcCategory(dealSvc: unknown, leadSvc: unknown): string {
    const s = `${String(dealSvc ?? "")} ${String(leadSvc ?? "")}`.toLowerCase();
    if (/химч|upholster|диван|ковёр|ковер|матрас|кресл|обивк/.test(s))
        return "Химчистка мебели и ковров";
    if (/окн|window/.test(s))
        return "Мойка окон";
    if (/регуляр|regular|еженедель/.test(s))
        return "Регулярная уборка";
    if (/генерал|deep|после ремонта|переезд/.test(s))
        return "Генеральная уборка";
    return "Уборка";
}
function quantile(sorted: number[], q: number): number {
    if (!sorted.length)
        return 0;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}
async function priceBands(): Promise<string> {
    const from = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    const { data } = await supabase.from("crm_deals")
        .select("amount,service_done,job_date,created_at,crm_leads(service,area)")
        .gte("created_at", from + "T00:00:00Z").limit(500);
    const groups = new Map<string, number[]>();
    for (const d of data ?? []) {
        const amt = Number(d.amount);
        if (!(amt > 0))
            continue;
        const relatedLead = Array.isArray(d.crm_leads) ? d.crm_leads[0] : d.crm_leads;
        const cat = svcCategory(d.service_done, (relatedLead as Record<string, unknown> | null)?.service);
        if (!groups.has(cat))
            groups.set(cat, []);
        groups.get(cat)!.push(amt);
    }
    const lines: string[] = [];
    for (const [cat, arr] of groups) {
        if (arr.length < 2)
            continue;
        arr.sort((a, b) => a - b);
        lines.push(`${cat}: ${arr.length} заказов за полгода, обычная вилка ${fmtFt(quantile(arr, 0.25))} - ${fmtFt(quantile(arr, 0.75))}, типичный чек ${fmtFt(quantile(arr, 0.5))}`);
    }
    return lines.length ? lines.join("\n") : "истории сделок пока мало, опирайся на прайс ниже";
}
const fmtFt = (n: number) => `${new Intl.NumberFormat("ru-RU").format(Math.round(n))} Ft`;
async function tgPhotoBytes(token: string, fileId: string): Promise<{
    buf: Uint8Array;
    mime: string;
} | null> {
    try {
        const info = await tg(token, "getFile", { file_id: fileId }) as Record<string, unknown> | null;
        const path = (info?.result as Record<string, unknown> | undefined)?.file_path as string | undefined;
        if (!path)
            return null;
        const r = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
        if (!r.ok)
            return null;
        const mime = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
        return { buf: new Uint8Array(await r.arrayBuffer()), mime };
    }
    catch (e) {
        console.error("tgPhotoBytes", e);
        return null;
    }
}
async function candidateJobsFor(masterId: string): Promise<{
    id: string;
    name: string;
    scheduled_at: string;
}[]> {
    const from = new Date(Date.now() - 2 * 86400e3).toISOString();
    const to = new Date(Date.now() + 86400e3).toISOString();
    const { data: pairRows } = await supabase.from("crm_masters").select("id").eq("pair_master_id", masterId);
    const ids = [masterId, ...(pairRows ?? []).map((r) => String(r.id))];
    const [own, shared] = await Promise.all([
        supabase.from("crm_leads").select("id,name,scheduled_at").in("assigned_master_id", ids).eq("status", "won").gte("scheduled_at", from).lte("scheduled_at", to),
        supabase.from("crm_leads").select("id,name,scheduled_at").contains("crew", [{ m: masterId }]).eq("status", "won").gte("scheduled_at", from).lte("scheduled_at", to),
    ]);
    const seen = new Set<string>();
    const all = [...(own.data ?? []), ...(shared.data ?? [])].filter((l) => {
        if (seen.has(l.id as string))
            return false;
        seen.add(l.id as string);
        return true;
    });
    const now = Date.now();
    const t = (l: Record<string, unknown>) => new Date(l.scheduled_at as string).getTime();
    all.sort((a, b) => {
        const sa = t(a) <= now, sb = t(b) <= now;
        if (sa !== sb)
            return sa ? -1 : 1;
        return sa ? t(b) - t(a) : t(a) - t(b);
    });
    return all.map((l) => ({ id: l.id as string, name: String(l.name ?? ""), scheduled_at: String(l.scheduled_at ?? "") }));
}
async function tgPhotoBase64(token: string, fileId: string): Promise<{
    b64: string;
    mime: string;
} | null> {
    try {
        const info = await tg(token, "getFile", { file_id: fileId }) as Record<string, unknown> | null;
        const path = (info?.result as Record<string, unknown> | undefined)?.file_path as string | undefined;
        if (!path)
            return null;
        const r = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
        if (!r.ok)
            return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000)
            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const mime = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
        return { b64: btoa(bin), mime };
    }
    catch (e) {
        console.error("tgPhotoBase64", e);
        return null;
    }
}
async function assistDraft(cfg: Cfg, text: string, images: {
    b64: string;
    mime: string;
}[]): Promise<string> {
    const key = cfg.anthropic_api_key;
    if (!key)
        return "⚠️ Не настроен ключ Claude, скажи Алексу.";
    const bands = await priceBands();
    const manual = (cfg.price_list || "").trim();
    const objections = (cfg.objections || "").trim();
    const system = `Ты помогаешь менеджеру клининговой компании CLB Cleaning Budapest отвечать клиентам в WhatsApp.
Твоя задача: написать ГОТОВЫЙ ТЕКСТ ОТВЕТА клиенту, который менеджер скопирует и отправит как есть.

ЦЕНЫ ПО РЕАЛЬНЫМ СДЕЛКАМ КОМПАНИИ (последние 6 месяцев):
${bands}
${manual ? `\nПРАЙС ОТ ВЛАДЕЛЬЦА (имеет приоритет над историей):\n${manual}` : ""}
${objections ? `\nРАБОТА С ВОЗРАЖЕНИЯМИ. Если в сообщении клиента звучит одно из них - отвечай по этой схеме, своими словами, не цитируя её дословно:\n${objections}` : ""}

ПРАВИЛА:
1. Отвечай на ТОМ ЖЕ языке, на котором написал клиент (русский, английский, венгерский, украинский).
2. Пиши так, будто Алекс лично прочитал сообщение: тепло, спокойно и по-человечески. Отрази одну конкретную деталь, пожелание или переживание клиента, если оно есть. Короткие живые фразы лучше канцелярита. Не звучать как бот, колл-центр, анкета, уведомление или регламент. В английском используй естественные сокращения. Обращение на "вы", без восторгов и лишних восклицательных знаков.
3. Цену называй ВИЛКОЙ, а не одним числом, если не хватает данных о размере или объёме. Никогда не выдумывай точную цену, если не понятно, что чистить.
4. Если данных мало - задай 1-3 коротких уточняющих вопроса: размер дивана, количество окон и створок, площадь квартиры, тип загрязнения, желаемая дата.
5. Минимальный выезд на химчистку 15 000 Ft. Если клиент просит почистить один мелкий предмет, объясни это и предложи добавить ещё вещи за те же деньги.
6. Мы привозим всё своё: оборудование, химию, тряпки. Клиенту ничего готовить не нужно, присутствовать необязательно.
7. Работаем в субботу и воскресенье без доплаты.
8. Если клиент просит счёт (számla), к цене добавляется НДС 27%. Без счёта цена как названа.
9. НИКОГДА не обещай конкретную дату и время: пиши "уточню свободное окно и вернусь с вариантами". Расписание знает только владелец.
10. Не давай скидок по своей инициативе.
11. Если на фото видно мебель или ковёр - опиши, что видишь (тип, примерный размер, характер загрязнений), и на основании этого назови вилку.
12. МАТРАС: в цене всегда явно пиши, сколько сторон входит ("одна сторона" / "one side" / "both sides"). Клиент считает матрас одним предметом и по умолчанию ждёт обе стороны. Строку вида "2 матраса 30 000" писать запрещено, только "2 матраса, по одной стороне, 15 000 каждый = 30 000". Уже две жалобы после работы из-за этого.

ФОРМАТ ОТВЕТА:
Сначала строка "ЧЕРНОВИК ОТВЕТА:" и дальше сам текст для клиента, без кавычек и пояснений.
После текста, через пустую строку, короткая строка "ЗАМЕТКА:" с тем, что должен проверить менеджер перед отправкой (например: подтвердить дату у владельца, уточнить размер).`;
    const content: Record<string, unknown>[] = [];
    for (const img of images.slice(0, 4)) {
        content.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.b64 } });
    }
    content.push({ type: "text", text: text.slice(0, 8000) || "Клиент прислал только фото, без текста." });
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, system, messages: [{ role: "user", content }] }),
        });
        const j = await res.json();
        const out = (j?.content ?? []).map((c: Record<string, unknown>) => c.text ?? "").join("").trim();
        return out || `⚠️ Claude не ответил (${res.status}). Попробуй ещё раз.`;
    }
    catch (e) {
        console.error("assistDraft", e);
        return "⚠️ Ошибка связи с Claude, попробуй ещё раз.";
    }
}
async function marketingText(cfg: Cfg, days: number, filter: string, intent = "overview"): Promise<string> {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const eurHuf = Number(cfg.fx_eur_huf) || 395;
    const usdHuf = Number(cfg.fx_usd_huf) || 360;
    const toHuf = (v: number, cur: string) => cur === "EUR" ? v * eurHuf : cur === "USD" ? v * usdHuf : v;
    const { data: sp } = await supabase.from("crm_ad_spend")
        .select("campaign,spend,currency,date_start,date_stop,impressions,clicks,leads_reported,source_file").limit(3000);
    const today = new Date().toISOString().slice(0, 10);
    const knownAds = new Set((sp ?? []).map((x) => String(x.campaign).trim().toLowerCase()));
    const { data: leads } = await supabase.from("crm_leads")
        .select("id,campaign,status,budget,created_at,last_contact_at").neq("source", "job_application")
        .gte("created_at", since + "T00:00:00Z").limit(3000);
    const { data: deals } = await supabase.from("crm_deals").select("lead_id,amount").limit(2000);
    const { data: waInsights } = await supabase.from("crm_wa_insights").select("lead_id,loss_reason").limit(3000);
    const revByLead = new Map<string, number>();
    for (const d of deals ?? [])
        revByLead.set(String(d.lead_id), (revByLead.get(String(d.lead_id)) ?? 0) + Number(d.amount));
    const isAdCampaign = (c: string) => /^\[\d{2}\.\d{2}\]/.test(c) || knownAds.has(c.toLowerCase());
    type MarketingAgg = {
        leads: number;
        newLeads: number;
        contacted: number;
        qualified: number;
        untouched: number;
        lost: number;
        won: number;
        rev: number;
        booked: number;
        reasons: Record<string, number>;
    };
    const emptyAgg = (): MarketingAgg => ({ leads: 0, newLeads: 0, contacted: 0, qualified: 0, untouched: 0, lost: 0, won: 0, rev: 0, booked: 0, reasons: {} });
    const deadStatuses = new Set(["lost", "junk"]);
    const agg = new Map<string, MarketingAgg>();
    for (const l of leads ?? []) {
        const c = String(l.campaign ?? "").trim();
        if (!c || !isAdCampaign(c))
            continue;
        if (filter && !c.toLowerCase().includes(filter))
            continue;
        const g = agg.get(c) ?? emptyAgg();
        g.leads++;
        const status = String(l.status ?? "");
        const touched = Boolean(l.last_contact_at);
        if (status === "new")
            g.newLeads++;
        if (status === "contacted")
            g.contacted++;
        if (status === "won" || (touched && !deadStatuses.has(status) && status !== "new"))
            g.qualified++;
        else if (!deadStatuses.has(status))
            g.untouched++;
        if (deadStatuses.has(status))
            g.lost++;
        if (status === "won")
            g.won++;
        const done = revByLead.get(String(l.id)) ?? 0;
        g.rev += done;
        if (!done && l.status === "won") {
            const b = String(l.budget ?? "").trim();
            if (/^[0-9\s.,]+$/.test(b))
                g.booked += Number(b.replace(/[^0-9]/g, "")) || 0;
        }
        agg.set(c, g);
    }
    const leadCampaign = new Map((leads ?? []).map((l) => [String(l.id), String(l.campaign ?? "").trim()]));
    for (const insight of waInsights ?? []) {
        const c = leadCampaign.get(String(insight.lead_id)) ?? "";
        const reason = String(insight.loss_reason ?? "");
        if (!c || !agg.has(c) || !reason || reason === "none")
            continue;
        const g = agg.get(c)!;
        g.reasons[reason] = (g.reasons[reason] ?? 0) + 1;
    }
    const metaCampaigns = new Set((sp ?? []).filter((x) => x.source_file === "meta_api").map((x) => String(x.campaign).trim().toLowerCase()));
    const spendHufBy = new Map<string, number>();
    const metaBy = new Map<string, {
        impressions: number;
        clicks: number;
        leads: number;
    }>();
    for (const x of sp ?? []) {
        const k = String(x.campaign).trim().toLowerCase();
        if (x.source_file !== "meta_api" && metaCampaigns.has(k))
            continue;
        const a = new Date(String(x.date_start ?? x.date_stop ?? "") + "T00:00:00Z");
        const b = new Date(String(x.date_stop ?? x.date_start ?? "") + "T00:00:00Z");
        if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a)
            continue;
        const total = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
        let hit = 0;
        for (let i = 0; i < total; i++) {
            const dd = new Date(a.getTime() + i * 86400000).toISOString().slice(0, 10);
            if (dd >= since && dd <= today)
                hit++;
        }
        if (!hit)
            continue;
        const share = hit / total;
        spendHufBy.set(k, (spendHufBy.get(k) ?? 0) + toHuf(Number(x.spend) * share, String(x.currency ?? "HUF")));
        if (x.source_file === "meta_api") {
            const m = metaBy.get(k) ?? { impressions: 0, clicks: 0, leads: 0 };
            m.impressions += Number(x.impressions ?? 0) * share;
            m.clicks += Number(x.clicks ?? 0) * share;
            m.leads += Number(x.leads_reported ?? 0) * share;
            metaBy.set(k, m);
        }
        if (!filter || k.includes(filter)) {
            const originalName = String(x.campaign).trim();
            if (originalName && !agg.has(originalName))
                agg.set(originalName, emptyAgg());
        }
    }
    const score = ([name, g]: [
        string,
        MarketingAgg
    ]) => intent === "quality" ? g.qualified : intent === "loss" ? g.lost : intent === "roas" ? ((g.rev + g.booked) / Math.max(1, spendHufBy.get(name.toLowerCase()) ?? 0)) : g.leads;
    const rows = [...agg.entries()].sort((a, b) => score(b) - score(a)).slice(0, 15);
    if (!rows.length)
        return `За последние ${days} дн. рекламных данных${filter ? " по этому запросу" : ""} не было.`;
    const L = [`📊 <b>Реклама за ${days} дн.</b>${filter ? ` · фильтр «${escapeHtml(filter)}»` : ""}`, ""];
    let tl = 0, tq = 0, tu = 0, tlost = 0, tw = 0, tr = 0, ts = 0, tMetaLeads = 0, ti = 0, tc = 0;
    for (const [name, g] of rows) {
        const spendHuf = spendHufBy.get(name.toLowerCase()) ?? 0;
        const meta = metaBy.get(name.toLowerCase()) ?? { impressions: 0, clicks: 0, leads: 0 };
        const total = g.rev + g.booked;
        tl += g.leads;
        tq += g.qualified;
        tu += g.untouched;
        tlost += g.lost;
        tw += g.won;
        tr += total;
        ts += spendHuf;
        tMetaLeads += meta.leads;
        ti += meta.impressions;
        tc += meta.clicks;
        const conv = g.leads ? Math.round((g.won / g.leads) * 100) : 0;
        const handled = g.qualified + g.lost;
        const qualRate = handled ? Math.round((g.qualified / handled) * 100) : 0;
        const cpl = spendHuf && g.leads ? Ft(spendHuf / g.leads) : "-";
        const cpql = spendHuf && g.qualified ? Ft(spendHuf / g.qualified) : "-";
        const roas = spendHuf ? (total / spendHuf).toFixed(1) + "x" : "-";
        L.push(`<b>${escapeHtml(name)}</b>`);
        L.push(`   CRM ${g.leads} · квалиф. ${g.qualified} из ${handled} (${qualRate}%) · слив ${g.lost} · не обработано ${g.untouched} · заказов ${g.won} (${conv}%)`);
        L.push(`   расход ${spendHuf ? Ft(spendHuf) : "не импортирован"} · CPL ${cpl} · CPQL ${cpql} · ROAS ${roas}`);
        if (meta.impressions || meta.clicks || meta.leads)
            L.push(`   Meta: лидов ${Math.round(meta.leads)} · CTR ${meta.impressions ? ((meta.clicks / meta.impressions) * 100).toFixed(1) + "%" : "-"} · кликов ${Math.round(meta.clicks)}`);
        const reasonLabels: Record<string, string> = { price: "дорого", timing: "не подошли сроки", no_response: "перестал отвечать", competitor: "выбрал конкурента", trust: "не хватило доверия", service_mismatch: "не та услуга", location: "не наша локация", duplicate: "дубль", other: "другое" };
        const topReasons = Object.entries(g.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2);
        if (topReasons.length)
            L.push(`   причины: ${topReasons.map(([r, n]) => `${reasonLabels[r] ?? r} — ${n}`).join(" · ")}`);
        L.push("");
    }
    const tconv = tl ? Math.round((tw / tl) * 100) : 0;
    const thandled = tq + tlost;
    const tqRate = thandled ? Math.round((tq / thandled) * 100) : 0;
    const troas = ts ? (tr / ts).toFixed(1) + "x" : "-";
    L.push(`<b>ИТОГО:</b> CRM ${tl} · квалиф. ${tq} из ${thandled} (${tqRate}%) · слив ${tlost} · не обработано ${tu} · заказов ${tw} (${tconv}%)`);
    L.push(`Расход ${Ft(ts)} · CPL ${tl ? Ft(ts / tl) : "-"} · CPQL ${tq ? Ft(ts / tq) : "-"} · деньги ${Ft(tr)} · ROAS ${troas}`);
    if (ti || tc || tMetaLeads)
        L.push(`Meta: лидов ${Math.round(tMetaLeads)} · CTR ${ti ? ((tc / ti) * 100).toFixed(1) + "%" : "-"} · кликов ${Math.round(tc)}`);
    L.push("");
    L.push("<i>Квалифицированный = заказ или лид, с которым был зафиксирован контакт и он не отвалился. Процент считается от обработанных (квалиф. + слив). Не обработано = до лида ещё не дотянулись, его качество неизвестно. Слив = lost или junk. Считаем только рекламные кампании; рекомендации и органика не входят.</i>");
    return L.join("\n");
}
type DcStep = "visit_confirm" | "order" | "total" | "total_ask" | "win_done" | "win_price" | "win_price_ask" | "pay_clean" | "pay_win" | "extras" | "extras_fuel" | "method" | "settle" | "photos" | "more_ask" | "more_name";
interface DcState {
    lead: string;
    deal: string;
    day: string;
    master: string;
    step: DcStep;
    ts: number;
    name: string;
    hasWin: boolean;
    partial: boolean;
    other: string;
    paid: number | null;
    win: number | null;
    payClean: {
        who: string;
        amount: number;
    }[];
    payWin: number | null;
    payWinNote: string;
    extras: {
        what: string;
        amount: number;
    }[];
    extrasMonth: {
        what: string;
        amount: number;
    }[];
    method: string;
    withMaster: boolean | null;
}
export function amountFrom(text: string): {
    value: number;
    guessed: boolean;
} | null {
    const m = parseMoney(text);
    if (m.length)
        return { value: m[0], guessed: false };
    const bare = text.match(/(^|[^\d.,])(\d{1,3})([^\d.,]|$)/);
    if (bare)
        return { value: Number(bare[2]) * 1000, guessed: true };
    return null;
}
export function saysNone(text: string): boolean {
    const t = text.toLowerCase().trim();
    if (t === "0")
        return true;
    return !/\d/.test(t) && /не было|не плат|не получ|(^|[^а-яё])нет([^а-яё]|$)|ничего|никто|никому|без оплат|^no\b/.test(t);
}
function amountsFromLine(part: string): number[] {
    const m = parseMoney(part);
    if (m.length)
        return m;
    const one = amountFrom(part);
    return one ? [one.value] : [];
}
const DC_KEY = (chat: string | number) => `dc_${chat}`;
const DC_CATCHUP_DAYS = 30;
const DC_FLOOR_DAY = "2026-09-01";
const dcFromMs = () => Math.max(Date.now() - DC_CATCHUP_DAYS * 86400000, Date.parse(DC_FLOOR_DAY + "T00:00:00Z"));
async function dcGet(chat: string | number): Promise<DcState | null> {
    const { data } = await supabase.from("crm_app_config").select("value").eq("key", DC_KEY(chat)).limit(1);
    const raw = String(data?.[0]?.value ?? "");
    if (!raw)
        return null;
    try {
        const st = JSON.parse(raw) as DcState;
        return Date.now() - st.ts < 20 * 3600 * 1000 ? st : null;
    }
    catch {
        return null;
    }
}
const dcSet = (chat: string | number, st: DcState) => setConfig(DC_KEY(chat), JSON.stringify({ ...st, ts: Date.now() }));
const dcClear = (chat: string | number) => setConfig(DC_KEY(chat), "");
function dealHasWindows(deal: Record<string, unknown>, lead: Record<string, unknown>): boolean {
    if (deal.amount_windows !== null && deal.amount_windows !== undefined)
        return Number(deal.amount_windows) > 0;
    const crew = Array.isArray(lead.crew) ? lead.crew as Array<Record<string, unknown>> : [];
    const hay = [lead.what_to_clean, lead.extra_services, lead.service, deal.service_done, deal.notes,
        ...crew.map((c) => c.brief)].join(" ");
    return /окн|окон|створ|window/i.test(hay);
}
async function dcOtherMaster(lead: Record<string, unknown>, masterId: string): Promise<string> {
    const crew = Array.isArray(lead.crew) ? lead.crew as Array<Record<string, unknown>> : [];
    const assigned = String(lead.assigned_master_id ?? "");
    const others = [...new Set([
            ...crew.map((c) => String(c.m ?? "")),
            ...(assigned ? [assigned] : []),
        ].filter((m) => m && m !== masterId))];
    if (!others.length)
        return "";
    const { data } = await supabase.from("crm_masters")
        .select("name").in("id", others).eq("closes_own_jobs", true).limit(1);
    return String(data?.[0]?.name ?? "");
}
async function dcOpenDeals(masterId: string, tz: string): Promise<Array<Record<string, unknown>>> {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const from = new Date(dcFromMs()).toISOString().slice(0, 10);
    const { data: deals } = await supabase.from("crm_deals")
        .select("*,crm_leads(id,name,address,what_to_clean,extra_services,service,crew,assigned_master_id)")
        .is("closed_at", null).gte("job_date", from).lte("job_date", today)
        .order("job_date", { ascending: true });
    return (deals ?? []).filter((d) => {
        const lead = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
        const crew = Array.isArray(lead.crew) ? lead.crew as Array<Record<string, unknown>> : [];
        return String(lead.assigned_master_id ?? "") === masterId || crew.some((slot) => String(slot.m ?? "") === masterId);
    });
}
async function dcOpenLeadBookings(masterId: string, tz: string): Promise<Array<Record<string, unknown>>> {
    const now = new Date(), from = new Date(dcFromMs()).toISOString();
    const cols = "id,name,status,source,address,what_to_clean,extra_services,service,crew,assigned_master_id,scheduled_at";
    const [own, crew] = await Promise.all([
        supabase.from("crm_leads").select(cols).eq("assigned_master_id", masterId).eq("status", "won").neq("source", "job_application").gte("scheduled_at", from).lt("scheduled_at", now.toISOString()).limit(300),
        supabase.from("crm_leads").select(cols).contains("crew", [{ m: masterId }]).eq("status", "won").neq("source", "job_application").gte("scheduled_at", from).lt("scheduled_at", now.toISOString()).limit(300),
    ]);
    if (own.error || crew.error) {
        console.error("day close lead-only query", own.error ?? crew.error);
        return [];
    }
    const seen = new Set<string>();
    const leads = [...(own.data ?? []), ...(crew.data ?? [])].filter((l) => !seen.has(String(l.id)) && !!seen.add(String(l.id)));
    if (!leads.length)
        return [];
    const { data: deals } = await supabase.from("crm_deals").select("id,lead_id,job_date,amount,closed_at").in("lead_id", leads.map((l) => l.id));
    const missing = new Set(closureGaps(leads, deals ?? [], masterId, tz, now).filter((g) => g.reason === "no_deal").map((g) => g.leadId));
    return leads.filter((l) => missing.has(String(l.id))).sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
}
const dcKb = (rows: Array<Array<{
    text: string;
    callback_data: string;
}>>) => ({ inline_keyboard: rows });
const YESNO = (yes: string, no: string) => dcKb([[{ text: "✅ Да", callback_data: yes }, { text: "❌ Нет", callback_data: no }]]);
async function dcSay(cfg: Cfg, chat: string | number, text: string, kb?: unknown) {
    await tg(cfg.telegram_bot_token, "sendMessage", {
        chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}),
    });
}
function dcBlank(lead: Record<string, unknown>, deal: Record<string, unknown>, day: string, master: string, other: string): DcState {
    return {
        lead: String(lead.id), deal: String(deal.id), day, master, step: "order", ts: Date.now(),
        name: String(lead.name ?? "заказ"), hasWin: dealHasWindows(deal, lead),
        partial: !!other, other,
        paid: null, win: null, payClean: [], payWin: null, payWinNote: "", extras: [], extrasMonth: [],
        method: "", withMaster: null,
    };
}
async function dcStart(cfg: Cfg, chat: string | number, masterId: string): Promise<boolean> {
    const tz = cfg.timezone || "Europe/Budapest";
    const [open, leadOnly] = await Promise.all([dcOpenDeals(masterId, tz), dcOpenLeadBookings(masterId, tz)]);
    const firstDeal = open[0];
    const firstLead = leadOnly[0];
    const dealDay = String(firstDeal?.job_date ?? "9999-99-99");
    const leadDay = firstLead?.scheduled_at
        ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(String(firstLead.scheduled_at)))
        : "9999-99-99";
    if (!firstDeal && !firstLead)
        return false;
    if (firstLead && leadDay < dealDay) {
        const st: DcState = {
            lead: String(firstLead.id), deal: "", day: leadDay, master: masterId, step: "visit_confirm", ts: Date.now(),
            name: String(firstLead.name ?? "заказ"), hasWin: dealHasWindows({}, firstLead), partial: false, other: "",
            paid: null, win: null, payClean: [], payWin: null, payWinNote: "", extras: [], extrasMonth: [], method: "", withMaster: null,
        };
        await dcSet(chat, st);
        await dcSay(cfg, chat, [
            `🌙 В CRM нет финансового закрытия за ${leadDay.slice(8, 10)}.${leadDay.slice(5, 7)}.`,
            "",
            `<b>${escapeHtml(String(firstLead.name ?? "заказ"))}</b>`,
            `📍 ${escapeHtml(String(firstLead.address ?? "адрес не указан"))}`,
            "",
            "Этот выезд действительно состоялся? Сделку создам только после твоего подтверждения.",
        ].join("\n"), YESNO("dc:visit:1", "dc:visit:0"));
        return true;
    }
    const d = firstDeal!;
    const lead = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
    const day = String(d.job_date);
    const other = await dcOtherMaster(lead, masterId);
    await dcSet(chat, dcBlank(lead, d, day, masterId, other));
    await dcSay(cfg, chat, [
        `🌙 Закрываем ${day.slice(8, 10)}.${day.slice(5, 7)}. Незакрытых заказов: ${open.length + leadOnly.length}.`,
        "",
        `<b>${escapeHtml(String(lead.name ?? "заказ"))}</b>`,
        `📍 ${escapeHtml(String(lead.address ?? "адрес не указан"))}`,
        ...(other ? ["", `⚠️ На этом заказе работал ещё ${escapeHtml(other)}. Говори только про свою часть, уборку и окна.`] : []),
        "",
        "Это тот заказ?",
    ].join("\n"), YESNO("dc:ord:1", "dc:ord:0"));
    return true;
}
async function dcAsk(cfg: Cfg, chat: string | number, st: DcState) {
    const { data: dRows } = await supabase.from("crm_deals").select("amount,amount_windows").eq("id", st.deal).limit(1);
    const deal = (dRows?.[0] ?? {}) as {
        amount?: number;
        amount_windows?: number;
    };
    switch (st.step) {
        case "visit_confirm":
            await dcSay(cfg, chat, `Этот выезд ${st.day.slice(8, 10)}.${st.day.slice(5, 7)} действительно состоялся? Сделку создам только после подтверждения.`, YESNO("dc:visit:1", "dc:visit:0"));
            break;
        case "total":
            if (st.partial) {
                st.step = "total_ask";
                await dcSet(chat, st);
                await dcSay(cfg, chat, `💰 Сколько клиент заплатил за твою часть, уборку и окна? Без части, которую забрал ${escapeHtml(st.other)}.`);
            }
            else {
                await dcSay(cfg, chat, `💰 В карточке чек <b>${Ft(Number(deal.amount ?? 0))}</b>.\nКлиент заплатил эту сумму?`, YESNO("dc:tot:1", "dc:tot:0"));
            }
            break;
        case "total_ask":
            await dcSay(cfg, chat, "Сколько клиент заплатил по факту? Напиши число.");
            break;
        case "win_done":
            await dcSay(cfg, chat, "🪟 В заказе есть окна. Окна делали?", YESNO("dc:win:1", "dc:win:0"));
            break;
        case "win_price": {
            const w = Number(deal.amount_windows ?? 0);
            if (w > 0)
                await dcSay(cfg, chat, `🪟 Цена за окна в карточке <b>${Ft(w)}</b>. Столько и вышло?`, YESNO("dc:wp:1", "dc:wp:0"));
            else {
                st.step = "win_price_ask";
                await dcSet(chat, st);
                await dcAsk(cfg, chat, st);
            }
            break;
        }
        case "win_price_ask":
            await dcSay(cfg, chat, "🪟 Сколько из чека пришлось на окна? Напиши число.");
            break;
        case "pay_clean":
            await dcSay(cfg, chat, "👥 Сколько отдали девочкам за уборку?\nМожно списком:\nОля 20000\nСвета 16000", dcKb([[{ text: "Уборки не было", callback_data: "dc:pc:0" }]]));
            break;
        case "pay_win":
            await dcSay(cfg, chat, "🪟 Сколько за окна? Суммой или процентом, как договаривались с мастером.\nНапример «18400» или «Даша 30%».");
            break;
        case "extras":
            await dcSay(cfg, chat, "🧾 Расходы именно по этому заказу, кроме оплаты труда? Химия, такси, парковка.\nОбщие расходы месяца сюда не надо.", dcKb([[{ text: "Расходов не было", callback_data: "dc:ex:0" }]]));
            break;
        case "extras_fuel":
            await dcSay(cfg, chat, "⛽ Заправка это на несколько выездов или только на этот заказ?\nОбычно на несколько.", dcKb([
                [{ text: "На несколько, в общие расходы", callback_data: "dc:fuel:month" }],
                [{ text: "Только на этот заказ", callback_data: "dc:fuel:job" }],
            ]));
            break;
        case "method":
            await dcSay(cfg, chat, "💳 Чем заплатил клиент?", dcKb([
                [{ text: "Наличные", callback_data: "dc:m:cash" }],
                [{ text: "Револют Алекса", callback_data: "dc:m:revolut_owner" }],
                [{ text: "Револют Марии", callback_data: "dc:m:revolut_maria" }],
                [{ text: "И то и другое", callback_data: "dc:m:mixed" }],
            ]));
            break;
        case "settle":
            await dcSay(cfg, chat, "💼 Эти деньги уже у Алекса?", YESNO("dc:st:1", "dc:st:0"));
            break;
        case "photos":
            await dcSay(cfg, chat, "📷 Есть фото по этому заказу? Кидай сюда, потом жми «Готово».", dcKb([[{ text: "Готово", callback_data: "dc:ph:0" }]]));
            break;
        case "more_ask":
            await dcSay(cfg, chat, "❓ Был ещё выезд, которого я не назвал?", YESNO("dc:more:1", "dc:more:0"));
            break;
        case "more_name":
            await dcSay(cfg, chat, "Напиши имя клиента и адрес одной строкой, я заведу заказ и спрошу по нему так же.");
            break;
    }
}
async function dcNext(cfg: Cfg, chat: string | number, st: DcState, step: DcStep) {
    st.step = step;
    await dcSet(chat, st);
    await dcAsk(cfg, chat, st);
}
const dcNeedsSettle = (m: string) => m === "cash" || m === "revolut_maria" || m === "mixed";
async function dcFinish(cfg: Cfg, chat: string | number, st: DcState, meName: string) {
    const payClean = st.payClean.reduce((a, r) => a + r.amount, 0);
    const payTotal = payClean + (st.payWin ?? 0);
    const exTotal = st.extras.reduce((a, r) => a + r.amount, 0);
    const cleanPart = st.paid !== null && st.win !== null ? st.paid - st.win : st.paid;
    const batch = crypto.randomUUID();
    const upd: Record<string, unknown> = {
        amount_windows: st.win, amount_cleaning: cleanPart,
        pay_cleaning: payClean, pay_windows: st.payWin, pay_windows_note: st.payWinNote || null,
        master_payout: payTotal, extra_costs: exTotal,
        payment_method: st.method || null, money_with_master: st.withMaster,
        closed_at: new Date().toISOString(), closed_partial: st.partial,
        notes: `— ЗАКРЫТИЕ ДНЯ ${st.day}, ${meName} по шагам в боте.${st.partial ? ` ЧАСТЬ ${meName}. Часть ${st.other} не закрыта, общий чек не трогаю.` : " СУММА ФИНАЛЬНАЯ."}`,
    };
    if (!st.partial && st.paid !== null)
        upd.amount = st.paid;
    await supabase.from("crm_deals").update(upd).eq("id", st.deal);
    const rows = [
        ...st.payClean.map((r) => ({ spent_on: st.day, amount: r.amount, lead_id: st.lead, master_id: st.master, batch_id: batch,
            note: `Уборка · выплата ${r.who || "бригаде"} · закрытие дня, ${meName} · заказ ${st.name}` })),
        ...(st.payWin ? [{ spent_on: st.day, amount: st.payWin, lead_id: st.lead, master_id: st.master, batch_id: batch,
                note: `Окна · выплата${st.payWinNote ? ` (${st.payWinNote})` : ""} · закрытие дня, ${meName} · заказ ${st.name}` }] : []),
        ...st.extras.map((r) => ({ spent_on: st.day, amount: r.amount, lead_id: st.lead, master_id: null, batch_id: batch,
            note: `${r.what} · по заказу ${st.name} · закрытие дня, ${meName}` })),
        ...st.extrasMonth.map((r) => ({ spent_on: st.day, amount: r.amount, lead_id: null, master_id: null, batch_id: batch,
            note: `${r.what} · общий расход, не на один заказ · закрытие дня, ${meName}` })),
    ];
    if (rows.length)
        await supabase.from("crm_expenses").insert(rows);
    const methodRu: Record<string, string> = { cash: "наличные", revolut_owner: "Револют Алекса", revolut_maria: "Револют Марии", mixed: "наличные и Револют" };
    const net = (st.paid ?? 0) - payTotal - exTotal;
    const lines = [
        `✅ Закрыт заказ <b>${escapeHtml(st.name)}</b> за ${st.day.slice(8, 10)}.${st.day.slice(5, 7)}`,
        `💰 Клиент заплатил ${Ft(st.paid ?? 0)}${st.partial ? ` (только часть ${escapeHtml(meName)})` : ""}${st.method ? ` · ${methodRu[st.method] ?? st.method}` : ""}`,
        ...(st.win ? [`🪟 из них окна ${Ft(st.win)}`] : []),
        ...(st.payClean.length ? ["👥 Уборка:", ...st.payClean.map((r) => `   • ${r.who || "бригада"} - ${Ft(r.amount)}`)] : []),
        ...(st.payWin ? [`🪟 Окна: ${Ft(st.payWin)}${st.payWinNote ? ` (${st.payWinNote})` : ""}`] : []),
        ...(st.extras.length ? ["🧾 Расходы заказа:", ...st.extras.map((r) => `   • ${r.what} - ${Ft(r.amount)}`)] : []),
        ...(st.extrasMonth.length ? ["⛽ В общие расходы месяца:", ...st.extrasMonth.map((r) => `   • ${r.what} - ${Ft(r.amount)}`)] : []),
        `📊 Мастерам ${Ft(payTotal)}, расходы ${Ft(exTotal)}, наша часть ${Ft(net)}`,
        ...(net < 0 ? ["", "⚠️ Наша часть вышла в МИНУС. Скорее всего в чеке или выплате опечатка. Проверь и нажми «Исправить этот заказ»."] : []),
        ...(st.withMaster === true ? [`💼 Деньги пока у ${escapeHtml(meName)}, Алексу не переданы`] : []),
        ...(st.partial ? [`⏳ Часть ${escapeHtml(st.other)} по этому заказу ещё не закрыта`] : []),
    ];
    await dcSay(cfg, chat, lines.join("\n"), dcKb([[{ text: "✏️ Исправить этот заказ", callback_data: `dc:fix:${st.deal}` }]]));
    await supabase.from("crm_timeline").insert({
        lead_id: st.lead, kind: "day_closed", body: `🌙 ${meName} закрыла заказ по шагам`,
        meta: { day: st.day, master: st.master, batch, state: st },
    });
    if (cfg.cards_chat_id)
        await dcSay(cfg, cfg.cards_chat_id, [`🌙 Закрытие от ${escapeHtml(meName)}`, ...lines.slice(1)].join("\n"));
    await dcClear(chat);
    if (!(await dcStart(cfg, chat, st.master))) {
        const st2 = { ...st, step: "more_ask" as DcStep };
        await dcSet(chat, st2);
        await dcAsk(cfg, chat, st2);
    }
}
async function dcReopen(cfg: Cfg, chat: string | number, dealId: string, meName: string, masterId: string): Promise<void> {
    const { data: dRows } = await supabase.from("crm_deals")
        .select("*,crm_leads(id,name,address,what_to_clean,extra_services,service,crew)").eq("id", dealId).limit(1);
    const d = dRows?.[0];
    if (!d) {
        await dcSay(cfg, chat, "Не нашёл этот заказ.");
        return;
    }
    const lead = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
    const { data: tl } = await supabase.from("crm_timeline")
        .select("id,meta").eq("lead_id", String(lead.id)).eq("kind", "day_closed")
        .order("created_at", { ascending: false }).limit(1);
    const batch = String((tl?.[0]?.meta as Record<string, unknown>)?.batch ?? "");
    if (batch)
        await supabase.from("crm_expenses").delete().eq("batch_id", batch);
    await supabase.from("crm_deals").update({
        closed_at: null, master_payout: 0, extra_costs: 0,
        pay_cleaning: null, pay_windows: null, pay_windows_note: null,
        payment_method: null, money_with_master: null, closed_partial: false,
    }).eq("id", dealId);
    await supabase.from("crm_timeline").insert({
        lead_id: String(lead.id), kind: "note",
        body: `↩️ ${meName} переоткрыла закрытие по этому заказу, старые суммы сняты`,
    });
    if (cfg.cards_chat_id) {
        await dcSay(cfg, cfg.cards_chat_id, `↩️ <b>${escapeHtml(String(lead.name ?? ""))}</b>: ${escapeHtml(meName)} переоткрыла закрытие. Прошлые выплаты и расходы сняты, спрашиваю заново.`);
    }
    const other = await dcOtherMaster(lead, masterId);
    await dcSet(chat, dcBlank(lead, d, String(d.job_date), masterId, other));
    await dcSay(cfg, chat, [
        `↩️ Переоткрыл <b>${escapeHtml(String(lead.name ?? "заказ"))}</b>. Прошлые суммы снял, спрашиваю заново.`,
        "",
        `📍 ${escapeHtml(String(lead.address ?? "адрес не указан"))}`,
        "",
        "Это тот заказ?",
    ].join("\n"), YESNO("dc:ord:1", "dc:ord:0"));
}
async function dcCallback(cfg: Cfg, chat: string | number, meName: string, masterId: string, data: string): Promise<boolean> {
    const [, what, val] = data.split(":");
    if (what === "fix") {
        await dcReopen(cfg, chat, val, meName, masterId);
        return true;
    }
    if (what === "start") {
        if (await dcGet(chat)) {
            await dcSay(cfg, chat, "У тебя уже открыто закрытие заказа. Сначала закончи его или напиши «отмена».");
            return true;
        }
        if (!(await dcStart(cfg, chat, masterId)))
            await dcSay(cfg, chat, "Сейчас незакрытых выездов для тебя не осталось.");
        return true;
    }
    const st = await dcGet(chat);
    if (!st)
        return false;
    switch (what) {
        case "visit": {
            if (st.step !== "visit_confirm") {
                await dcSay(cfg, chat, "Эта кнопка относится к старому вопросу. Текущее закрытие не меняю.");
                return true;
            }
            if (val !== "1") {
                await dcClear(chat);
                await dcSay(cfg, chat, "Понял, сделку не создаю. Сообщи Алексу, если дату перенесли или заказ отменился, чтобы карточку исправили.");
                return true;
            }
            const { data: lr } = await supabase.from("crm_leads")
                .select("id,name,status,source,scheduled_at,assigned_master_id,crew,service,what_to_clean").eq("id", st.lead).limit(1);
            const lead = lr?.[0] as Record<string, unknown> | undefined;
            const tz = cfg.timezone || "Europe/Budapest";
            const { data: existing } = await supabase.from("crm_deals").select("id,lead_id,job_date,amount,closed_at")
                .eq("lead_id", st.lead).eq("job_date", st.day).order("created_at", { ascending: false }).limit(1);
            const action = confirmedVisitAction(lead as unknown as ClosureLead, (existing ?? []) as ClosureDeal[], masterId, tz, new Date(), st.day);
            if (action.action === "blocked") {
                await dcClear(chat);
                await dcSay(cfg, chat, "Карточка уже изменилась, поэтому сделку не создаю. Обновлю список при следующей проверке.");
                return true;
            }
            if (action.action === "resolved") {
                await dcClear(chat);
                await dcSay(cfg, chat, "Этот выезд уже закрыт в CRM, новую сделку не создаю.");
                return true;
            }
            const verifiedLead = lead!;
            const other = await dcOtherMaster(verifiedLead, masterId);
            st.partial = !!other;
            st.other = other;
            let deal = action.deal as Record<string, unknown> | undefined;
            if (action.action === "create") {
                const lockKey = `dc_deal_${st.lead}_${st.day}`;
                const lockValue = JSON.stringify({ chat, reserved_at: new Date().toISOString() });
                const { error: lockError } = await supabase.from("crm_app_config").insert({ key: lockKey, value: lockValue });
                if (lockError) {
                    await dcSay(cfg, chat, "Этот выезд уже закрывается в другом запросе. Подожди несколько секунд и нажми ещё раз - вторую сделку я не создам.");
                    return true;
                }
                const { data: created, error } = await supabase.from("crm_deals").insert({
                    lead_id: st.lead, amount: 0, master_payout: 0, extra_costs: 0, job_date: st.day,
                    master_name: meName, service_done: String(verifiedLead.what_to_clean || verifiedLead.service || "Уборка - подтверждено Марией"),
                }).select("id,amount,closed_at").single();
                if (error || !created) {
                    console.error("day close create confirmed visit", error);
                    await supabase.from("crm_app_config").delete().eq("key", lockKey).eq("value", lockValue);
                    await dcSay(cfg, chat, "Не получилось создать финансовое закрытие. Ничего не записал, сообщи Алексу.");
                    return true;
                }
                await supabase.from("crm_app_config").update({ value: JSON.stringify({ deal_id: created.id, created_at: new Date().toISOString() }) }).eq("key", lockKey);
                deal = created;
            }
            if (!deal) {
                await dcSay(cfg, chat, "Не нашёл финансовое закрытие. Ничего не записал, сообщи Алексу.");
                return true;
            }
            st.deal = String(deal.id);
            st.step = "total_ask";
            await dcSet(chat, st);
            await dcSay(cfg, chat, other
                ? `✅ Выезд подтверждён. Создал пустое финансовое закрытие без выручки. На заказе работал ещё ${escapeHtml(other)} - сколько клиент заплатил за твою часть, уборку и окна? Без его части.`
                : "✅ Выезд подтверждён. Создал пустое финансовое закрытие без выручки. Сколько клиент заплатил по факту? Напиши число.");
            return true;
        }
        case "ord":
            if (val === "1") {
                await dcNext(cfg, chat, st, "total");
                return true;
            }
            {
                const open = await dcOpenDeals(st.master, cfg.timezone || "Europe/Budapest");
                const others = open.filter((d) => String(d.id) !== st.deal);
                if (!others.length) {
                    await dcSay(cfg, chat, "Других незакрытых заказов нет. Если выезд был, скажу Алексу завести его.");
                    await dcNext(cfg, chat, st, "more_ask");
                    return true;
                }
                await dcSay(cfg, chat, "Тогда какой из этих?", dcKb(others.slice(0, 6).map((d) => {
                    const l = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
                    return [{ text: `${String(d.job_date).slice(8, 10)}.${String(d.job_date).slice(5, 7)} ${String(l.name ?? "заказ")}`.slice(0, 60), callback_data: `dc:pick:${d.id}` }];
                })));
            }
            return true;
        case "pick": {
            const { data: dRows } = await supabase.from("crm_deals")
                .select("*,crm_leads(id,name,address,what_to_clean,extra_services,service,crew)").eq("id", val).limit(1);
            const d = dRows?.[0];
            if (!d)
                return true;
            const lead = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
            const other = await dcOtherMaster(lead, st.master);
            const fresh = dcBlank(lead, d, String(d.job_date), st.master, other);
            fresh.step = "total";
            await dcSet(chat, fresh);
            await dcAsk(cfg, chat, fresh);
            return true;
        }
        case "tot":
            if (val === "1") {
                const { data: dRows } = await supabase.from("crm_deals").select("amount").eq("id", st.deal).limit(1);
                st.paid = Number(dRows?.[0]?.amount ?? 0);
                await dcNext(cfg, chat, st, st.hasWin ? "win_done" : "pay_clean");
            }
            else
                await dcNext(cfg, chat, st, "total_ask");
            return true;
        case "win":
            if (val === "1")
                await dcNext(cfg, chat, st, "win_price");
            else {
                st.win = 0;
                st.hasWin = false;
                await dcNext(cfg, chat, st, "pay_clean");
            }
            return true;
        case "wp":
            if (val === "1") {
                const { data: dRows } = await supabase.from("crm_deals").select("amount_windows").eq("id", st.deal).limit(1);
                st.win = Number(dRows?.[0]?.amount_windows ?? 0);
                await dcNext(cfg, chat, st, "pay_clean");
            }
            else
                await dcNext(cfg, chat, st, "win_price_ask");
            return true;
        case "pc":
            await dcNext(cfg, chat, st, st.hasWin ? "pay_win" : "extras");
            return true;
        case "ex":
            await dcNext(cfg, chat, st, "method");
            return true;
        case "fuel":
            if (val === "month") {
                st.extrasMonth = st.extras.filter((r) => /бензин|топлив|заправ|солярк|дизел/i.test(r.what));
                st.extras = st.extras.filter((r) => !/бензин|топлив|заправ|солярк|дизел/i.test(r.what));
            }
            await dcNext(cfg, chat, st, "method");
            return true;
        case "m":
            st.method = val;
            if (dcNeedsSettle(val))
                await dcNext(cfg, chat, st, "settle");
            else {
                st.withMaster = false;
                await dcNext(cfg, chat, st, "photos");
            }
            return true;
        case "st":
            st.withMaster = val === "0";
            await dcNext(cfg, chat, st, "photos");
            return true;
        case "ph":
            await dcFinish(cfg, chat, st, meName);
            return true;
        case "pct":
            if (val === "1") {
                await dcNext(cfg, chat, st, "extras");
                return true;
            }
            await dcNext(cfg, chat, st, "pay_win");
            return true;
        case "more":
            if (val === "1") {
                await dcNext(cfg, chat, st, "more_name");
                return true;
            }
            await dcClear(chat);
            await dcSay(cfg, chat, "🌙 Всё закрыто. Спасибо!");
            return true;
    }
    return false;
}
async function dcText(cfg: Cfg, chat: string | number, meName: string, masterId: string, text: string): Promise<boolean> {
    const t = text.toLowerCase().trim();
    if (/исправ|поправ|переоткр|переделать|ошиблась|ошибка в сумме|\bfix\b/.test(t)) {
        const { data: recent } = await supabase.from("crm_deals")
            .select("id,job_date,crm_leads(name,assigned_master_id)").not("closed_at", "is", null)
            .gte("job_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
            .order("closed_at", { ascending: false }).limit(20);
        const mine = (recent ?? []).filter((d) => String(((d.crm_leads ?? {}) as unknown as Record<string, unknown>).assigned_master_id ?? "") === masterId).slice(0, 6);
        if (!mine.length) {
            await dcSay(cfg, chat, "Закрытых заказов за тобой не нашёл.");
            return true;
        }
        await dcSay(cfg, chat, "Какой заказ исправить?", dcKb(mine.map((d) => {
            const l = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
            return [{ text: `${String(d.job_date).slice(8, 10)}.${String(d.job_date).slice(5, 7)} ${String(l.name ?? "заказ")}`.slice(0, 60), callback_data: `dc:fix:${d.id}` }];
        })));
        return true;
    }
    if (!(await dcGet(chat)) && /закр(ыт|ыв|ое|ой|ыл)/.test(t)) {
        const tzC = cfg.timezone || "Europe/Budapest";
        const refC = parseDayRef(t, tzC);
        const openC = await dcOpenDeals(masterId, tzC);
        const wantC = refC ? `${refC.y}-${String(refC.mo).padStart(2, "0")}-${String(refC.d).padStart(2, "0")}` : "";
        const pick = wantC ? openC.filter((d) => String(d.job_date) === wantC) : openC;
        if (!pick.length) {
            await dcSay(cfg, chat, wantC
                ? `На ${wantC.slice(8, 10)}.${wantC.slice(5, 7)} незакрытых заказов за тобой нет. Напиши «закрыть» без даты, покажу все.`
                : "Незакрытых заказов за тобой нет. Всё закрыто.");
            return true;
        }
        if (pick.length === 1) {
            const d = pick[0];
            const lead = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
            const other = await dcOtherMaster(lead, masterId);
            const fresh = dcBlank(lead, d, String(d.job_date), masterId, other);
            await dcSet(chat, fresh);
            await dcSay(cfg, chat, [
                `🌙 Закрываем ${String(d.job_date).slice(8, 10)}.${String(d.job_date).slice(5, 7)}.`, "",
                `<b>${escapeHtml(String(lead.name ?? "заказ"))}</b>`,
                `📍 ${escapeHtml(String(lead.address ?? "адрес не указан"))}`,
                ...(other ? ["", `⚠️ На этом заказе работал ещё ${escapeHtml(other)}. Говори только про свою часть.`] : []),
                "", "Это тот заказ?",
            ].join("\n"), YESNO("dc:ord:1", "dc:ord:0"));
            return true;
        }
        const d0 = pick[0];
        const l0 = (d0.crm_leads ?? {}) as unknown as Record<string, unknown>;
        await dcSet(chat, dcBlank(l0, d0, String(d0.job_date), masterId, ""));
        await dcSay(cfg, chat, "Какой заказ закрываем?", dcKb(pick.slice(0, 6).map((d) => {
            const l = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
            return [{ text: `${String(d.job_date).slice(8, 10)}.${String(d.job_date).slice(5, 7)} ${String(l.name ?? "заказ")}`.slice(0, 60), callback_data: `dc:pick:${d.id}` }];
        })));
        return true;
    }
    const st = await dcGet(chat);
    if (!st)
        return false;
    if (/^(отмена|стоп|позже|потом|cancel)\b/.test(t)) {
        await dcClear(chat);
        await dcSay(cfg, chat, "Хорошо, спрошу позже.");
        return true;
    }
    const tz = cfg.timezone || "Europe/Budapest";
    const ref = parseDayRef(t, tz);
    if (ref) {
        const want = `${ref.y}-${String(ref.mo).padStart(2, "0")}-${String(ref.d).padStart(2, "0")}`;
        const open = (await dcOpenDeals(st.master, tz)).filter((d) => String(d.job_date) === want);
        if (!open.length) {
            const { data: done } = await supabase.from("crm_deals")
                .select("id,job_date,crm_leads(name,assigned_master_id)")
                .eq("job_date", want).not("closed_at", "is", null);
            const mine = (done ?? []).filter((d) => String(((d.crm_leads ?? {}) as unknown as Record<string, unknown>).assigned_master_id ?? "") === st.master);
            if (mine.length) {
                await dcSay(cfg, chat, `На ${want.slice(8, 10)}.${want.slice(5, 7)} заказы уже закрыты. Какой переоткрыть и исправить?`, dcKb(mine.slice(0, 6).map((d) => {
                    const l = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
                    return [{ text: `✏️ ${String(l.name ?? "заказ")}`.slice(0, 60), callback_data: `dc:fix:${d.id}` }];
                })));
                return true;
            }
            const { data: soon } = await supabase.from("crm_deals")
                .select("amount,crm_leads(name,address,assigned_master_id,scheduled_at)")
                .eq("job_date", want).is("closed_at", null);
            const mineSoon = (soon ?? []).filter((d) => String(((d.crm_leads ?? {}) as unknown as Record<string, unknown>).assigned_master_id ?? "") === st.master);
            if (mineSoon.length) {
                const L = [`📅 На ${want.slice(8, 10)}.${want.slice(5, 7)} заказ есть, но работа ещё не сделана, закроем после выезда.`, ""];
                for (const d of mineSoon) {
                    const l = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
                    const at = l.scheduled_at ? new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(String(l.scheduled_at))) : "";
                    L.push(`<b>${escapeHtml(String(l.name ?? "заказ"))}</b>${at ? ` · ${at}` : ""}`);
                    if (l.address)
                        L.push(`📍 ${escapeHtml(String(l.address))}`);
                }
                await dcSay(cfg, chat, L.join("\n"));
                await dcAsk(cfg, chat, st);
                return true;
            }
            await dcSay(cfg, chat, `На ${want.slice(8, 10)}.${want.slice(5, 7)} заказов за тобой в системе нет, ни закрытых, ни открытых. Проверь дату или напиши Алексу. Продолжим текущий?`);
            await dcAsk(cfg, chat, st);
            return true;
        }
        await dcSay(cfg, chat, `Заказы на ${want.slice(8, 10)}.${want.slice(5, 7)}:`, dcKb(open.slice(0, 6).map((d) => {
            const l = (d.crm_leads ?? {}) as unknown as Record<string, unknown>;
            return [{ text: String(l.name ?? "заказ").slice(0, 60), callback_data: `dc:pick:${d.id}` }];
        })));
        return true;
    }
    const sums = parseMoney(text);
    const label = (part: string) => part.replace(/\d[\d  ]*\d|\d/g, " ")
        .replace(/тыс[а-яё]*|тис[а-яё]*/gi, " ").replace(/\s+/g, " ").trim();
    switch (st.step) {
        case "total_ask": {
            const a = amountFrom(text);
            if (!a) {
                await dcSay(cfg, chat, "Не понял сумму. Напиши число: 140000, или 140 тыс, или просто 140.");
                return true;
            }
            st.paid = a.value;
            if (a.guessed)
                await dcSay(cfg, chat, `Записал чек ${Ft(a.value)}.`);
            await dcNext(cfg, chat, st, st.hasWin ? "win_done" : "pay_clean");
            return true;
        }
        case "win_price_ask": {
            const a = amountFrom(text);
            if (!a) {
                await dcSay(cfg, chat, "Не понял сумму. Напиши число: 46000, или 46 тыс, или просто 46.");
                return true;
            }
            st.win = a.value;
            if (a.guessed)
                await dcSay(cfg, chat, `Записал окна ${Ft(a.value)}.`);
            await dcNext(cfg, chat, st, "pay_clean");
            return true;
        }
        case "pay_clean": {
            if (saysNone(text)) {
                st.payClean = [];
                await dcSay(cfg, chat, "Записал: за уборку никому не платили.");
                await dcNext(cfg, chat, st, st.hasWin ? "pay_win" : "extras");
                return true;
            }
            if (!sums.length && !amountFrom(text)) {
                await dcSay(cfg, chat, "Не понял суммы. По одной в строке:\nОля 20000\nСвета 16000\nМожно и тысячами: Оля 20");
                return true;
            }
            st.payClean = [];
            for (const part of text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)) {
                for (const a of amountsFromLine(part)) {
                    let who = label(part);
                    if (/^(я|мне|себе)$/i.test(who))
                        who = meName;
                    st.payClean.push({ who: who.slice(0, 60), amount: a });
                }
            }
            await dcNext(cfg, chat, st, st.hasWin ? "pay_win" : "extras");
            return true;
        }
        case "pay_win": {
            const pct = text.match(/(\d{1,3})\s*%/);
            if (pct && st.win) {
                const p = Number(pct[1]);
                const sum = Math.round(st.win * p / 100);
                const who = text.replace(/\d{1,3}\s*%/, " ").replace(/\s+/g, " ").trim();
                st.payWin = sum;
                st.payWinNote = `${who ? who + " " : ""}${p}% от окон ${Ft(st.win)}`;
                await dcSet(chat, st);
                await dcSay(cfg, chat, `🪟 ${p}% от ${Ft(st.win)} это <b>${Ft(sum)}</b>. Верно?`, YESNO("dc:pct:1", "dc:pct:0"));
                return true;
            }
            if (saysNone(text)) {
                st.payWin = 0;
                st.payWinNote = "за окна не платили";
                await dcSay(cfg, chat, "Записал: за окна никому не платили.");
                await dcNext(cfg, chat, st, "extras");
                return true;
            }
            const a = amountFrom(text);
            if (!a) {
                await dcSay(cfg, chat, "Напиши сумму числом или процентом: «18400», «18 тыс» или «Даша 30%». Если никому не платили, напиши «не было».");
                return true;
            }
            if (a.guessed)
                await dcSay(cfg, chat, `Записал за окна ${Ft(a.value)}.`);
            st.payWin = a.value;
            st.payWinNote = label(text).slice(0, 60);
            await dcNext(cfg, chat, st, "extras");
            return true;
        }
        case "extras": {
            if (saysNone(text)) {
                await dcNext(cfg, chat, st, "method");
                return true;
            }
            if (!sums.length && !amountFrom(text)) {
                await dcSay(cfg, chat, "Напиши что и сколько, например «такси 4500». Или жми «Расходов не было».");
                return true;
            }
            st.extras = [];
            for (const part of text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)) {
                const a = amountsFromLine(part);
                if (!a.length)
                    continue;
                st.extras.push({ what: label(part).slice(0, 60) || "расход", amount: a.reduce((x, y) => x + y, 0) });
            }
            const fuel = st.extras.some((r) => /бензин|топлив|заправ|солярк|дизел/i.test(r.what));
            await dcNext(cfg, chat, st, fuel ? "extras_fuel" : "method");
            return true;
        }
        case "more_name": {
            const [nm, ...addr] = text.split(",");
            const { data: nl } = await supabase.from("crm_leads").insert({
                name: nm.trim().slice(0, 80) || "Заказ без имени", address: addr.join(",").trim().slice(0, 200),
                status: "won", source: "manual", language: "ru", service: "cleaning",
                assigned_master_id: st.master, scheduled_at: `${st.day}T08:00:00Z`,
                notes: `Заведено бригадиром ${meName} при закрытии дня ${st.day}. Выезда не было в системе, проверить.`,
            }).select("id,name,address,crew,what_to_clean,extra_services,service").single();
            if (!nl) {
                await dcSay(cfg, chat, "Не получилось завести. Напиши Алексу.");
                await dcClear(chat);
                return true;
            }
            const { data: nd } = await supabase.from("crm_deals").insert({
                lead_id: nl.id, amount: 0, master_payout: 0, extra_costs: 0, job_date: st.day,
                master_name: meName, service_done: "Заведено бригадиром при закрытии дня",
            }).select("*").single();
            if (!nd) {
                await dcSay(cfg, chat, "Не получилось завести сделку. Напиши Алексу.");
                await dcClear(chat);
                return true;
            }
            if (cfg.cards_chat_id) {
                await dcSay(cfg, cfg.cards_chat_id, `➕ <b>${escapeHtml(String(nl.name))}</b>: выезда не было в системе, ${escapeHtml(meName)} завела его при закрытии дня ${st.day}. Проверь карточку.`);
            }
            const fresh = dcBlank(nl as unknown as Record<string, unknown>, nd, st.day, st.master, "");
            fresh.step = "total_ask";
            await dcSet(chat, fresh);
            await dcSay(cfg, chat, `➕ Завёл <b>${escapeHtml(String(nl.name))}</b>. Сколько заплатил клиент?`);
            return true;
        }
    }
    await dcSay(cfg, chat, "Ответь кнопкой на вопрос ниже. Если надо прерваться, напиши «отмена».");
    await dcAsk(cfg, chat, st);
    return true;
}
async function runDayClose(cfg: Cfg, overrideChat?: number | string): Promise<number> {
    const { data: ms } = await supabase.from("crm_masters")
        .select("id,name,tg_chat_id,active,can_report_payouts").eq("can_report_payouts", true).eq("active", true);
    const maria = selectMariaRecipient((ms ?? []) as ClosureMaster[]);
    if (!maria) {
        console.error("day close blocked: expected exactly one active payout-reporting Maria with Telegram");
        return 0;
    }
    const chat = String(overrideChat ?? maria.tg_chat_id ?? "");
    if (!chat || chat !== String(maria.tg_chat_id))
        return 0;
    return await dcStart(cfg, chat, String(maria.id)) ? 1 : 0;
}
async function loadMariaClosureGaps(masterId: string, tz: string, now: Date): Promise<ClosureGap[]> {
    const cols = "id,name,status,source,scheduled_at,assigned_master_id,crew";
    const fromInstant = new Date(dcFromMs());
    const fromDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(fromInstant);
    const [own, crew, recentDeals] = await Promise.all([
        supabase.from("crm_leads").select(cols).eq("assigned_master_id", masterId).neq("source", "job_application").gte("scheduled_at", fromInstant.toISOString()).limit(500),
        supabase.from("crm_leads").select(cols).contains("crew", [{ m: masterId }]).neq("source", "job_application").gte("scheduled_at", fromInstant.toISOString()).limit(500),
        supabase.from("crm_deals")
            .select(`id,lead_id,job_date,amount,closed_at,crm_leads!inner(${cols})`)
            .gte("job_date", fromDay).limit(1000),
    ]);
    if (own.error || crew.error || recentDeals.error) {
        console.error("Maria close nag query", own.error ?? crew.error ?? recentDeals.error);
        return [];
    }
    const seen = new Set<string>();
    const dealLeads = (recentDeals.data ?? []).flatMap((d) => {
        const linked = d.crm_leads as unknown;
        return Array.isArray(linked) ? linked : linked ? [linked] : [];
    }) as ClosureLead[];
    const leads = [...(own.data ?? []), ...(crew.data ?? []), ...dealLeads].filter((l) => {
        if (seen.has(String(l.id)))
            return false;
        seen.add(String(l.id));
        return true;
    });
    if (!leads.length)
        return [];
    return closureGaps(leads, recentDeals.data ?? [], masterId, tz, now, fromDay);
}
async function runMariaClosureNag(cfg: Cfg): Promise<number> {
    const token = cfg.telegram_bot_token;
    if (!token)
        return 0;
    const tz = cfg.timezone || "Europe/Budapest", now = new Date(), np = localParts(tz, now);
    if (np.h < 17)
        return 0;
    const { data: payoutMasters, error: masterError } = await supabase.from("crm_masters")
        .select("id,name,tg_chat_id,active,can_report_payouts").eq("active", true).eq("can_report_payouts", true);
    if (masterError) {
        console.error("Maria close nag recipient query", masterError);
        return 0;
    }
    const maria = selectMariaRecipient((payoutMasters ?? []) as ClosureMaster[]);
    if (!maria) {
        console.error("Maria close nag blocked: expected exactly one active payout-reporting Maria with Telegram");
        return 0;
    }
    const chat = String(maria.tg_chat_id), localDate = `${np.y}-${String(np.mo).padStart(2, "0")}-${String(np.d).padStart(2, "0")}`;
    if (await dcGet(chat))
        return 0;
    let gaps = await loadMariaClosureGaps(String(maria.id), tz, now);
    if (!gaps.length)
        return 0;
    if (await dcGet(chat))
        return 0;
    gaps = await loadMariaClosureGaps(String(maria.id), tz, new Date());
    if (!gaps.length)
        return 0;
    const fingerprint = closureGapFingerprint(gaps);
    const reservationKey = `maria_close_nag_${localDate}`;
    const reservation = JSON.stringify({ fingerprint, reserved_at: new Date().toISOString() });
    const { error: reserveError } = await supabase.from("crm_app_config").insert({ key: reservationKey, value: reservation });
    if (reserveError) {
        if (String((reserveError as {
            code?: string;
        }).code ?? "") !== "23505")
            console.error("Maria close nag reservation", reserveError);
        return 0;
    }
    const why: Record<ClosureGap["reason"], string> = {
        no_deal: "нет закрытой сделки",
        unclosed: "сделка не закрыта",
        no_amount: "нет финальной суммы",
        unclosed_no_amount: "сделка не закрыта и нет финальной суммы",
    };
    const lines = [
        `🌙 <b>Нужно закрыть заказы (${gaps.length})</b>`,
        "Эти выезды уже прошли, но деньги ещё не закрыты в CRM:",
        "",
        ...gaps.slice(0, 20).map((g) => `• ${g.day.slice(8, 10)}.${g.day.slice(5, 7)} · <b>${escapeHtml(g.name)}</b> - ${why[g.reason]}`),
        ...(gaps.length > 20 ? [`• …ещё ${gaps.length - 20}`] : []),
        "",
        "Нажми «Закрыть сейчас». Если сделки ещё нет, я сначала спрошу, состоялся ли выезд, и только после подтверждения начну вопросы про фактический чек и выплаты.",
    ];
    const sent = await tg(token, "sendMessage", {
        chat_id: chat, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: "▶️ Закрыть сейчас", callback_data: "dc:start" }]] },
    });
    if (!sent?.ok) {
        await supabase.from("crm_app_config").delete().eq("key", reservationKey).eq("value", reservation);
        return 0;
    }
    await supabase.from("crm_app_config").update({ value: JSON.stringify({ fingerprint, sent_at: new Date().toISOString() }) }).eq("key", reservationKey);
    return gaps.length;
}
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        const url = new URL(req.url);
        const cfg = await getConfig();
        if (url.searchParams.get("cron") === "reminders") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const n = await runReminders(cfg);
            const master24h = await runMaster24hReminders(cfg);
            const nag = await runNeglectNag(cfg);
            const stale = await runStaleSweep(cfg);
            const nocheck = await runNoCheckNag(cfg);
            const mariaClose = await runMariaClosureNag(cfg);
            return new Response(JSON.stringify({ ok: true, sent: n, master24h, nag, stale, nocheck, mariaClose }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "digest") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const ok = await sendMorningDigest(cfg);
            const stale = await runStaleSweep(cfg);
            const silent = await runSilentSweep(cfg);
            const waiting = await runWaitingSweep(cfg).catch((e) => { console.error("waiting sweep", e); return 0; });
            const tzD = cfg.timezone || "Europe/Budapest";
            const isMonday = new Intl.DateTimeFormat("en-US", { timeZone: tzD, weekday: "short" }).format(new Date()) === "Mon";
            const frozen = isMonday ? await runFrozenSweep(cfg) : 0;
            const jobs = await runJobReadySweep(cfg);
            return new Response(JSON.stringify({ ok, stale, silent, waiting, frozen, jobs }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "jobs") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const jobs = await runJobReadySweep(cfg);
            return new Response(JSON.stringify({ ok: true, jobs }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "remind") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const slot = url.searchParams.get("slot") === "morning" ? "morning" : "eve";
            const sent = await runMasterReminders(cfg, slot);
            return new Response(JSON.stringify({ ok: true, slot, sent }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "stale") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const stale = await runStaleSweep(cfg);
            return new Response(JSON.stringify({ ok: true, stale }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "interpretdry") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const body = await req.json().catch(() => ({})) as Record<string, string>;
            const tz = cfg.timezone || "Europe/Budapest";
            const r = await interpret(cfg.anthropic_api_key, interpretSystem(new Date().toISOString().slice(0, 10), tz, body.lead ?? "NONE", "", "Мария, Иван", (cfg.objections || "").trim()), String(body.text ?? ""));
            return new Response(JSON.stringify({ ok: true, r }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "draftdry") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const { data: lead } = await supabase.from("crm_leads").select("*").eq("id", url.searchParams.get("lead") ?? "").maybeSingle();
            const draft = lead ? await chatDraft(cfg, lead, url.searchParams.get("mode") === "answer" ? "answer" : "nudge") : null;
            return new Response(JSON.stringify({ ok: Boolean(lead), draft }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "silent") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const forced = url.searchParams.get("chat") || undefined;
            const n = Number(url.searchParams.get("n") || 8);
            const silent = await runSilentSweep(cfg, forced, 3, Number.isFinite(n) ? n : 8);
            return new Response(JSON.stringify({ ok: true, silent }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "frozen") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const forcedF = url.searchParams.get("chat") || undefined;
            const nF = Number(url.searchParams.get("n") || 12);
            const frozen = await runFrozenSweep(cfg, forcedF, Number.isFinite(nF) ? nF : 12);
            return new Response(JSON.stringify({ ok: true, frozen }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "dayclose") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const chatD = url.searchParams.get("chat") || undefined;
            const asked = await runDayClose(cfg, chatD);
            return new Response(JSON.stringify({ ok: true, asked }), { headers: { "content-type": "application/json" } });
        }
        if (url.searchParams.get("cron") === "gbp") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            try {
                return new Response(JSON.stringify({ ok: true, ...(await runGbpPoll(cfg, url.searchParams.get("draft") || "")) }), { headers: { "content-type": "application/json" } });
            }
            catch (e) {
                console.error("gbp poll", e);
                return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
            }
        }
        if (url.searchParams.get("cron") === "reviews") {
            if (!cfg.reminder_secret || cfg.reminder_secret === "CHANGE_ME" || req.headers.get("x-reminder-secret") !== cfg.reminder_secret)
                return new Response("forbidden", { status: 403 });
            const reviews = await runReviewSweep(cfg);
            const stuck = await runReviewStuckSweep(cfg);
            return new Response(JSON.stringify({ ok: true, reviews, stuck }), { headers: { "content-type": "application/json" } });
        }
        if (req.method !== "POST")
            return new Response("ok");
        if (cfg.bot_webhook_secret && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== cfg.bot_webhook_secret)
            return new Response("forbidden", { status: 403 });
        let update: Record<string, any>;
        try {
            update = await req.json();
        }
        catch {
            return new Response("ok");
        }
        const token = url.searchParams.get("bot") === "reviews" && cfg.reviews_bot_token
            ? cfg.reviews_bot_token : cfg.telegram_bot_token;
        if (!token)
            return new Response("ok");
        let ownerId = cfg.owner_tg_id ? String(cfg.owner_tg_id) : "";
        const allowed = (fromId?: number) => !!ownerId && String(fromId) === ownerId;
        const reviewsOnly = url.searchParams.get("bot") === "reviews" && !!cfg.reviews_bot_token;
        if (reviewsOnly) {
            const cqData = String(update.callback_query?.data ?? "");
            if (update.callback_query && !cqData.startsWith("rv:")) {
                await tg(token, "answerCallbackQuery", { callback_query_id: update.callback_query.id, text: "Эта кнопка работает в основном боте", show_alert: true });
                return new Response("ok");
            }
            if (!update.callback_query) {
                const chatId = update.message?.chat?.id;
                const cmd = String(update.message?.text ?? "").trim().toLowerCase().split(/[\s@]/)[0];
                if (chatId && (cmd === "/check" || cmd === "/refresh")) {
                    const fresh = await runReviewSweep(cfg, chatId);
                    const stuck = await runReviewStuckSweep(cfg, chatId);
                    if (!fresh && !stuck) {
                        await tg(token, "sendMessage", { chat_id: chatId, text: "✅ Сверил закрытые заказы: спрашивать пока некого. Все выполненные либо уже отмечены, либо работа ещё идёт." });
                    }
                    return new Response("ok");
                }
                if (chatId) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: "Это бот отзывов. Он присылает карточки на фидбек и ссылки на Google, больше ничего.\n\n/check - сверить закрытые заказы прямо сейчас, не дожидаясь вечерней рассылки.\n\nЛиды, реактивация и отчёты в основном боте." });
                }
                return new Response("ok");
            }
        }
        try {
            if (update.callback_query) {
                const cq = update.callback_query;
                const data = String(cq.data || "");
                const msg = cq.message;
                const ack = (text?: string) => tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: text ?? "" });
                if (data.startsWith("dc:")) {
                    await ack();
                    const dcChat = String(msg?.chat?.id ?? "");
                    const { data: mr } = await supabase.from("crm_masters").select("id,name,tg_chat_id,active,can_report_payouts").eq("tg_chat_id", dcChat).limit(2);
                    const verified = selectMariaRecipient((mr ?? []) as ClosureMaster[]);
                    if (!verified) {
                        console.error("day close callback blocked: sender is not the unique active payout-reporting Maria", { chat: dcChat });
                        return new Response("ok");
                    }
                    await dcCallback(cfg, dcChat, String(verified.name ?? "Мария"), String(verified.id), data);
                    return new Response("ok");
                }
                if (data.startsWith("y:")) {
                    const [, leadId, field, value] = data.split(":");
                    const { data: lr } = await supabase.from("crm_leads").select("id,name,soft_review").eq("id", leadId).limit(1);
                    const lead = lr?.[0];
                    if (!lead) {
                        console.error("soft review: lead not found", { data, leadId, field, value });
                        await ack(`Не нашёл заявку. Пришло: ${String(leadId ?? "").slice(0, 40)}`);
                        return new Response("ok");
                    }
                    const review = (lead.soft_review ?? {}) as Record<string, unknown>;
                    const taps = { ...(review.taps as Record<string, string> ?? {}) };
                    if (field !== "done")
                        taps[field] = value;
                    const leather = taps.mtrl === "lea";
                    const items: {
                        label: string;
                        units: number;
                        each: number;
                    }[] = [];
                    if (taps.sofa === "str")
                        items.push({ label: leather ? "Диван кожаный 3 места" : "Диван 2-3 места", units: 1, each: leather ? 28000 : 25000 });
                    if (taps.sofa === "cor")
                        items.push({ label: leather ? "Диван кожаный угловой" : "Угловой диван", units: 1, each: leather ? 40000 : 35000 });
                    if (taps.chair === "1")
                        items.push({ label: leather ? "Кресло кожаное" : "Кресло", units: 1, each: leather ? 12000 : 8000 });
                    if (taps.mat === "1")
                        items.push({ label: "Матрас, одна сторона", units: 1, each: 15000 });
                    if (taps.mat === "2")
                        items.push({ label: "Матрас, две стороны", units: 1, each: 25000 });
                    const done = field === "done";
                    await supabase.from("crm_leads").update({
                        soft_review: { ...review, taps, items: done ? items : [], answered_at: done ? new Date().toISOString() : null },
                    }).eq("id", leadId);
                    if (done) {
                        const listed = items.length ? items.map((i) => i.label).join(", ") : "предметы не отмечены";
                        await supabase.from("crm_app_config").upsert({
                            key: `soft_price_wait_${cq.from?.id ?? ""}`,
                            value: `${leadId}|${Date.now()}`,
                        }, { onConflict: "key" });
                        if (msg?.message_id) {
                            await tg(token, "editMessageText", {
                                chat_id: msg.chat.id, message_id: msg.message_id,
                                text: `✅ Записал: ${listed}${leather ? "\nКожа: только вручную, без экстракции." : ""}\n\nТеперь напиши свою цену числом, одним сообщением. Например: 45000`,
                                reply_markup: { inline_keyboard: [] },
                            });
                        }
                        await ack("Жду цену числом");
                        return new Response("ok");
                    }
                    if (!done) {
                        const names: Record<string, string> = { str: "прямой диван", cor: "угловой диван", no: "дивана нет", "1": "отмечено", "2": "две стороны", lea: "кожа", fab: "ткань" };
                        await ack(`Записал: ${names[value] ?? value}`);
                        return new Response("ok");
                    }
                    await ack("Записал");
                    return new Response("ok");
                }
                if (data.startsWith("jp:")) {
                    const [, photoId, leadId] = data.split(":");
                    const { data: lr } = await supabase.from("crm_leads").select("name").eq("id", leadId).limit(1);
                    await supabase.from("crm_job_photos").update({ lead_id: leadId }).eq("id", photoId);
                    if (msg?.message_id) {
                        await tg(token, "editMessageText", {
                            chat_id: msg.chat.id, message_id: msg.message_id,
                            text: `📷 Перенёс фото на заказ ${lr?.[0]?.name ?? ""}.`,
                            reply_markup: { inline_keyboard: [] },
                        });
                    }
                    await ack("Перенёс ✅");
                    return new Response("ok");
                }
                if (data.startsWith("as:")) {
                    const leadId = data.slice(3);
                    const chat = String(msg?.chat?.id ?? "");
                    const { data: mrow } = await supabase.from("crm_masters").select("id,can_report_payouts").eq("tg_chat_id", chat).limit(1);
                    const { data: cfgRow } = await supabase.from("crm_app_config").select("value").eq("key", `assign_${chat}`).limit(1);
                    const [idsRaw, ts] = String(cfgRow?.[0]?.value ?? "").split("|");
                    const fresh = idsRaw && (Date.now() - Number(ts || 0)) < 30 * 60000;
                    if (mrow?.[0]?.can_report_payouts && fresh) {
                        const { data: lr } = await supabase.from("crm_leads").select("name").eq("id", leadId).limit(1);
                        const res = await applyCrew(leadId, idsRaw.split(",").filter(Boolean));
                        if (msg?.message_id) {
                            await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `✅ ${lr?.[0]?.name ?? ""}\nБригада: ${res.crewNames.join(", ")}${res.warn ? `\n\n${res.warn}` : ""}`, reply_markup: { inline_keyboard: [] } });
                        }
                        await ack("Поставил ✅");
                    }
                    else {
                        await ack("Не получилось, напиши заново");
                    }
                    return new Response("ok");
                }
                if (data.startsWith("pl:")) {
                    const leadId = data.slice(3);
                    const chat = String(msg?.chat?.id ?? "");
                    const { data: mrow } = await supabase.from("crm_masters").select("id,can_report_payouts").eq("tg_chat_id", chat).limit(1);
                    const mid = mrow?.[0]?.id;
                    const { data: cfgRow } = await supabase.from("crm_app_config").select("value").eq("key", `pay_batch_${chat}`).limit(1);
                    const [batchId, ts] = String(cfgRow?.[0]?.value ?? "").split("|");
                    const fresh = batchId && (Date.now() - Number(ts || 0)) < 30 * 60000;
                    if (mid && mrow?.[0]?.can_report_payouts && fresh) {
                        const { data: lr } = await supabase.from("crm_leads").select("name").eq("id", leadId).limit(1);
                        await supabase.from("crm_expenses").update({ lead_id: leadId }).eq("batch_id", batchId).eq("master_id", mid);
                        if (msg?.message_id) {
                            await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `✅ Отнёс оплату к заказу ${lr?.[0]?.name ?? ""}.`, reply_markup: { inline_keyboard: [] } });
                        }
                        await ack("Записал ✅");
                    }
                    else {
                        await ack();
                        if (msg?.message_id) {
                            await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id,
                                text: `${msg.text ?? ""}\n\n⌛️ Кнопки устарели.`, reply_markup: { inline_keyboard: [] } });
                        }
                        await tg(token, "sendMessage", { chat_id: msg.chat.id,
                            text: "⌛️ Эти кнопки уже не работают, прошло больше получаса.\nНапиши «закрыть заказ» и укажи дату, я спрошу всё по порядку." });
                    }
                    return new Response("ok");
                }
                if (data.startsWith("xp:")) {
                    const exId = data.slice(3);
                    const { data: mrow } = await supabase.from("crm_masters").select("id").eq("tg_chat_id", String(msg?.chat?.id ?? "")).limit(1);
                    const mid = mrow?.[0]?.id;
                    if (mid)
                        await supabase.from("crm_expenses").delete().eq("id", exId).eq("master_id", mid);
                    if (msg?.message_id) {
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: "❌ Удалил эту выплату. Напиши сумму заново.", reply_markup: { inline_keyboard: [] } });
                    }
                    await ack("Удалил ✅");
                    return new Response("ok");
                }
                if (data.startsWith("pf:")) {
                    const [, photoId, phase] = data.split(":");
                    if (phase === "before" || phase === "after") {
                        await supabase.from("crm_job_photos").update({ phase }).eq("id", photoId);
                        if (msg?.message_id) {
                            await tg(token, "editMessageText", {
                                chat_id: msg.chat.id, message_id: msg.message_id,
                                text: `${phase === "before" ? "📷 Отметил: это ДО работы." : "📷 Отметил: это ПОСЛЕ работы."}`,
                                reply_markup: { inline_keyboard: [] },
                            });
                        }
                        await ack("Поправил ✅");
                    }
                    return new Response("ok");
                }
                if (data.startsWith("bk:")) {
                    const [, bkLead, bkDate, bkTime] = data.split(":");
                    const startTime = `${bkTime}:${data.split(":")[4] ?? "00"}`.slice(0, 5);
                    const { data: bkRows } = await supabase.from("crm_leads").select("*").eq("id", bkLead).limit(1);
                    const bkCard = bkRows?.[0];
                    if (!bkCard) {
                        await ack("Карточка не найдена");
                        return new Response("ok");
                    }
                    if (bkCard.scheduled_at && bkCard.status === "won") {
                        await ack("Заказ уже заведён");
                        return new Response("ok");
                    }
                    const { data: checks } = await supabase.from("crm_timeline").select("meta").eq("lead_id", bkLead)
                        .eq("kind", "booking_check").order("created_at", { ascending: false }).limit(1);
                    const draft = (checks?.[0]?.meta as Record<string, unknown> | undefined)?.draft as Record<string, unknown> ?? {};
                    const service = String(draft.service ?? bkCard.service ?? "cleaning");
                    const { data: mRows } = bkCard.assigned_master_id
                        ? await supabase.from("crm_masters").select("id,name").eq("id", bkCard.assigned_master_id).limit(1)
                        : await supabase.from("crm_masters").select("id,name")
                            .eq("name", service === "upholstery" || service === "windows" ? "Иван" : "Мария").eq("active", true).limit(1);
                    const bkMaster = mRows?.[0];
                    const masterName = String(bkMaster?.name ?? "");
                    if (!bkMaster) {
                        await ack("Мастер не найден");
                        return new Response("ok");
                    }
                    const tzB = cfg.timezone || "Europe/Budapest";
                    const [yy, mm, dd] = bkDate.split("-").map(Number);
                    const [hh, mi] = startTime.split(":").map(Number);
                    const when = localToUtc(tzB, yy, mm, dd, hh, mi);
                    const brief = [String(draft.brief_ru ?? "").trim(), String(draft.access_ru ?? "").trim()].filter(Boolean).join("\n").slice(0, 1000)
                        || String(bkCard.master_brief ?? "");
                    const sum = String(Math.round(Number(draft.price_huf ?? 0)) || bkCard.budget || "");
                    const stamp = new Date().toISOString();
                    await supabase.from("crm_leads").update({
                        status: "won", status_changed_at: stamp, updated_at: stamp, scheduled_at: when.toISOString(),
                        when_text: `${bkDate} ${startTime}`, assigned_master_id: bkMaster.id, master_brief: brief, master_confirmed_at: null,
                        ...(String(draft.address ?? "").trim() ? { address: String(draft.address).slice(0, 300) } : {}),
                        ...(String(draft.work_ru ?? "").trim() ? { what_to_clean: String(draft.work_ru).slice(0, 500) } : {}),
                        ...(sum ? { budget: sum } : {}),
                        crew: [{ m: bkMaster.id, brief: brief.slice(0, 400), sum, pay: "", sent: null, ok: null }],
                    }).eq("id", bkLead);
                    const { data: freshRows } = await supabase.from("crm_leads").select("*").eq("id", bkLead).limit(1);
                    const notified = await notifyAssignedMaster(cfg, freshRows?.[0] ?? bkCard);
                    const whenText = fmtLocal(tzB, when.toISOString());
                    await supabase.from("crm_timeline").insert({ lead_id: bkLead, kind: "status_change",
                        body: `🤖 Заказ заведён по кнопке: ${whenText}, ${masterName}${notified.ok ? ", наряд отправлен" : ", наряд НЕ ушёл"}`,
                        meta: { automatic: true, by_chat: msg.chat.id, draft } });
                    await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id,
                        text: `${msg.text ?? ""}\n\n✅ Заведено на ${whenText}, мастер ${masterName}${notified.ok ? ", наряд отправлен" : `, наряд НЕ ушёл: ${notified.reason ?? ""}`}` });
                    await ack(notified.ok ? "✅ Заказ заведён, наряд ушёл" : "Заказ заведён, наряд не ушёл");
                    return new Response("ok");
                }
                if (data.startsWith("acc:")) {
                    const [, leadId, idxRaw] = data.split(":");
                    const { data: lr } = await supabase.from("crm_leads").select("id,name,assigned_master_id,crew").eq("id", leadId).limit(1);
                    const lead = lr?.[0];
                    const crew: Array<{
                        m: string;
                        sent: string | null;
                        ok: string | null;
                    }> = Array.isArray(lead?.crew) ? lead!.crew : [];
                    let slotIdx = idxRaw ? Number(idxRaw) : -1;
                    if (slotIdx >= 0 && crew.length) {
                        const ids = crew.map((s) => s.m);
                        const { data: cm } = await supabase.from("crm_masters").select("id,tg_chat_id").in("id", ids);
                        const presser = String(cq.from?.id ?? msg?.chat?.id ?? "");
                        const mine = (cm ?? []).find((x) => String(x.tg_chat_id) === presser);
                        if (!mine) {
                            await ack("Эта кнопка не для тебя");
                            return new Response("ok");
                        }
                        slotIdx = crew.findIndex((s) => s.m === mine.id);
                        if (slotIdx < 0 || slotIdx >= crew.length) {
                            await ack("Этот заказ уже переназначен");
                            return new Response("ok");
                        }
                    }
                    const slot = slotIdx >= 0 ? crew[slotIdx] : null;
                    const masterId = slot ? slot.m : lead?.assigned_master_id;
                    const { data: mr } = masterId ? await supabase.from("crm_masters").select("name,tg_chat_id").eq("id", masterId).limit(1) : { data: null };
                    const presser = String(cq.from?.id ?? msg?.chat?.id ?? "");
                    if (!slot && String(mr?.[0]?.tg_chat_id ?? "") !== presser) {
                        await ack("Эта кнопка не для тебя");
                        return new Response("ok");
                    }
                    const mname = mr?.[0]?.name ?? "Мастер";
                    if (slot) {
                        crew[slotIdx] = { ...crew[slotIdx], ok: new Date().toISOString() };
                        await supabase.from("crm_leads").update({ crew }).eq("id", leadId);
                    }
                    else {
                        await supabase.from("crm_leads").update({ master_confirmed_at: new Date().toISOString() }).eq("id", leadId);
                    }
                    await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: `✅ ${mname} подтвердил заказ` });
                    if (msg?.message_id)
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text ?? ""}\n\n✅ Ты подтвердил заказ. Спасибо!`, reply_markup: { inline_keyboard: [] } });
                    if (ownerId)
                        await tg(token, "sendMessage", { chat_id: ownerId, parse_mode: "HTML", text: `✅ <b>${escapeHtml(mname)}</b> подтвердил заказ: ${escapeHtml(lead?.name ?? "")}` });
                    await ack("Подтверждено ✅");
                    return new Response("ok");
                }
                if (data.startsWith("lang:")) {
                    const lang = data.split(":")[1] === "en" ? "en" : "ru";
                    const cid = msg.chat.id;
                    const { data: who0 } = await supabase.from("crm_masters").select("name").eq("tg_chat_id", cid).limit(1);
                    await supabase.from("crm_masters").update({ language: lang }).eq("tg_chat_id", cid);
                    const who = String(who0?.[0]?.name ?? "");
                    await tg(token, "editMessageText", { chat_id: cid, message_id: msg.message_id,
                        text: lang === "en"
                            ? `English it is${who ? ", " + who : ""}. Everything I write to you will be in English from now on.\n\nNote: the job description itself comes from Alex, so it arrives in the language he wrote it in.`
                            : `Хорошо${who ? ", " + who : ""}, пишу по-русски.\n\nОдно уточнение: сам текст заказа пишет Алекс, поэтому он приходит на том языке, на котором написан.` });
                    await ack(lang === "en" ? "English" : "Русский");
                    return new Response("ok");
                }
                if (!allowed(cq.from?.id)) {
                    await ack("⛔ Только владелец");
                    return new Response("ok");
                }
                if (data.startsWith("wp:")) {
                    const leadId = data.slice(3);
                    try {
                        await ack("Проверяю живой чат…");
                        await prepareReviewedReactivation(cfg, leadId, token, msg.chat.id);
                    }
                    catch (e) {
                        await tg(token, "sendMessage", { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: `⚠️ ${String(e instanceof Error ? e.message : e).slice(0, 500)}` });
                    }
                    return new Response("ok");
                }
                if (data.startsWith("ws:")) {
                    const jobId = data.slice(3);
                    try {
                        const result = await sendReviewedReactivation(cfg, jobId);
                        if (!result.sent) {
                            await ack(result.reason ?? "Не отправлено");
                            await tg(token, "sendMessage", { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: `⚠️ ${result.reason ?? "Сообщение не отправлено"}` });
                        }
                        else {
                            const tNow = new Intl.DateTimeFormat("ru-RU", { timeZone: cfg.timezone || "Europe/Budapest", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
                            await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text ?? ""}\n\n✅ Отправлено после проверки · ${tNow}`, reply_markup: { inline_keyboard: [] } });
                            await ack("Отправлено ✅");
                        }
                    }
                    catch (e) {
                        await ack("Ошибка отправки");
                        await tg(token, "sendMessage", { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: `⚠️ ${String(e instanceof Error ? e.message : e).slice(0, 500)}` });
                    }
                    return new Response("ok");
                }
                if (data.startsWith("wx:")) {
                    const jobId = data.slice(3);
                    const now = new Date().toISOString();
                    await supabase.from("crm_wa_outbox").update({ status: "skipped", error: "owner cancelled preview", updated_at: now }).eq("id", jobId).eq("kind", "reactivation_review").eq("status", "pending");
                    await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text ?? ""}\n\n❌ Владелец отменил отправку`, reply_markup: { inline_keyboard: [] } });
                    await ack("Не отправляем");
                    return new Response("ok");
                }
                if (data.startsWith("s:")) {
                    const [, leadId, status] = data.split(":");
                    const { data: rows } = await supabase.from("crm_leads").select("*").eq("id", leadId).limit(1);
                    const lead = rows?.[0];
                    if (!lead) {
                        await ack("Лид не найден");
                        return new Response("ok");
                    }
                    await applyStatus(token, cfg, lead, status);
                    await saveActiveLead(msg.chat.id, leadId);
                    if (msg?.message_id && msg.message_id !== lead.tg_message_id) {
                        const tNow = new Intl.DateTimeFormat("ru-RU", { timeZone: cfg.timezone || "Europe/Budapest", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text ?? ""}\n${STATUS[status] ?? status} · ${tNow}` });
                    }
                    await ack(`→ ${STATUS[status] ?? status}`);
                    if (status === "won")
                        await tg(token, "sendMessage", { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, parse_mode: "HTML", text: lead.source === "job_application"
                                ? `✅ Кандидат принят. Это не сделка, сумму вписывать не надо.\nОтветь на карточку заметкой, если надо запомнить условия, напр. <code>берём на подработку в её выходные, английский</code>.`
                                : `🎉 Запомнил клиента: <b>${escapeHtml(String(lead.name ?? ""))}</b>.\nТеперь просто напиши сюда сумму и мастера, например:\n<code>закрыли на 30000 мастер Даша +5000 бензин</code>\nОтвечать на карточку не нужно. Помню 30 минут, дальше нажми кнопку ещё раз.` });
                }
                else if (data.startsWith("bad:")) {
                    const leadId = data.split(":")[1];
                    const nowIso = new Date().toISOString();
                    const { data: brows } = await supabase.from("crm_leads").select("*").eq("id", leadId).limit(1);
                    const bl = brows?.[0];
                    if (!bl) {
                        await ack("Лид не найден");
                        return new Response("ok");
                    }
                    const ans = (bl.answers && typeof bl.answers === "object" ? bl.answers : {}) as Record<string, unknown>;
                    await supabase.from("crm_leads").update({
                        status: "junk", status_changed_at: nowIso, updated_at: nowIso,
                        answers: { ...ans, bad_phone: true },
                    }).eq("id", leadId);
                    await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: `📵 Неверный номер: ${bl.phone ?? "пусто"}. Написать невозможно, письмо не отправлялось.` });
                    await refreshCard(token, cfg, { ...bl, status: "junk" });
                    const tBad = new Intl.DateTimeFormat("ru-RU", { timeZone: cfg.timezone || "Europe/Budapest", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
                    if (msg?.message_id)
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: "HTML", text: `${msg.text ?? ""}\n\n📵 Неверный номер · ${tBad}` });
                    await ack("Отметил: неверный номер");
                }
                else if (data.startsWith("fw:")) {
                    const [, leadId, kind] = data.split(":");
                    const nowIso = new Date().toISOString();
                    const status = kind === "lost" ? "lost" : "junk";
                    const { data: lrows } = await supabase.from("crm_leads").select("*").eq("id", leadId).limit(1);
                    const lead = lrows?.[0];
                    await supabase.from("crm_leads").update({ last_contact_at: nowIso, updated_at: nowIso }).eq("id", leadId);
                    await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: kind === "lost" ? "📤 Отправлено закрытие заявки" : "📤 Отправлено прощание" });
                    if (lead && lead.status !== status) {
                        await supabase.from("crm_leads").update({ status, status_changed_at: nowIso }).eq("id", leadId);
                        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "status_change", body: `${STATUS[String(lead.status)] ?? lead.status} → ${STATUS[status]}` });
                        await refreshCard(token, cfg, { ...lead, status });
                    }
                    const tNow = new Intl.DateTimeFormat("ru-RU", { timeZone: cfg.timezone || "Europe/Budapest", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
                    if (msg?.message_id)
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: "HTML", text: `${msg.text ?? ""}\n\n✅ Отправлено · ${tNow} · ${STATUS[status]}` });
                    await ack(`Отправлено, статус: ${STATUS[status]}`);
                }
                else if (data.startsWith("svc:")) {
                    const [, dealId, svc] = data.split(":");
                    const label = svc === "upholstery" ? "🛋 химчистка" : svc === "windows" ? "🪟 окна" : "🧹 клининг";
                    const { data: dr } = await supabase.from("crm_deals").select("lead_id").eq("id", dealId).limit(1);
                    await supabase.from("crm_deals").update({ service_done: svc }).eq("id", dealId);
                    if (dr?.[0]?.lead_id)
                        await supabase.from("crm_leads").update({ service: svc, updated_at: new Date().toISOString() }).eq("id", dr[0].lead_id);
                    if (msg?.message_id)
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `🏷 Услуга: ${label} ✓` });
                    await ack(label);
                }
                else if (data.startsWith("w:")) {
                    const [, leadId] = data.split(":");
                    const { data: rows } = await supabase.from("crm_leads").select("id,name,status").eq("id", leadId).limit(1);
                    if (!rows?.length) {
                        await ack("Лид не найден");
                        return new Response("ok");
                    }
                    const nowIso = new Date().toISOString();
                    const wUpd: Record<string, unknown> = { last_contact_at: nowIso, updated_at: nowIso };
                    if (rows[0].status === "new") {
                        wUpd.status = "contacted";
                        wUpd.status_changed_at = nowIso;
                    }
                    await supabase.from("crm_leads").update(wUpd).eq("id", leadId);
                    await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: rows[0].status === "new" ? "📤 Написал в WhatsApp → ждём ответа" : "📤 Написал в WhatsApp" });
                    await saveActiveLead(msg.chat.id, leadId);
                    const tNow = new Intl.DateTimeFormat("ru-RU", { timeZone: cfg.timezone || "Europe/Budapest", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
                    const kbRows = ((msg.reply_markup?.inline_keyboard ?? []) as Record<string, unknown>[][])
                        .filter((row) => !row.some((b) => String(b.callback_data ?? "").startsWith("w:")));
                    await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text ?? ""}\n✅ Отправлено · ${tNow}`, ...(kbRows.length ? { reply_markup: { inline_keyboard: kbRows } } : {}) });
                    await ack("📤 Отмечено");
                }
                else if (data.startsWith("rv:")) {
                    const [, leadId, mode] = data.split(":");
                    const { data: rows } = await supabase.from("crm_leads").select("*").eq("id", leadId).limit(1);
                    const rvLead = rows?.[0];
                    if (!rvLead) {
                        await ack("Лид не найден");
                        return new Response("ok");
                    }
                    const tR = new Intl.DateTimeFormat("ru-RU", { timeZone: cfg.timezone || "Europe/Budapest", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
                    if (mode === "ask") {
                        await supabase.from("crm_leads").update({ feedback_asked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", leadId);
                        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: "💬 Запрошен фидбек после заказа" });
                        const reviewUrl = (cfg.google_review_url || "").trim();
                        const kb: Record<string, unknown>[][] = [];
                        const dgL = waDigits(rvLead.phone);
                        if (dgL && reviewUrl)
                            kb.push([{ text: "⭐ Ссылка на отзыв (если доволен)", url: `https://api.whatsapp.com/send?phone=${dgL}&text=${encodeURIComponent(reviewLinkText(rvLead, reviewUrl))}` }]);
                        kb.push([{ text: "✅ Ссылку отправил", callback_data: `rv:${leadId}:sent` }, { text: "👎 Не просить отзыв", callback_data: `rv:${leadId}:skip` }]);
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id,
                            text: `${msg.text ?? ""}\n💬 Фидбек запрошен · ${tR}\n${reviewUrl ? "Ответил хорошо? Жми ⭐ - WhatsApp откроется со ссылкой на Google." : "⚠️ Ссылка на Google-отзыв не задана - пришли её, и появится кнопка ⭐."}`,
                            reply_markup: { inline_keyboard: kb } });
                        await ack("💬 Отмечено");
                    }
                    else if (mode === "card") {
                        const at = new Date().toISOString();
                        await supabase.from("crm_leads").update({ review_requested_at: at, updated_at: at }).eq("id", leadId);
                        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: "⭐ Попросили отзыв в Google" });
                        await refreshCard(token, cfg, { ...rvLead, review_requested_at: at });
                        await ack("⭐ Отмечено");
                    }
                    else {
                        await supabase.from("crm_leads").update({ review_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", leadId);
                        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: mode === "skip" ? "⭐ Отзыв: решили не просить" : "⭐ Отправлена ссылка на Google-отзыв" });
                        await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text ?? ""}\n${mode === "skip" ? "🚫 Отзыв не просим" : "⭐ Ссылка отправлена"} · ${tR}` });
                        await ack(mode === "skip" ? "Ок" : "⭐ Отмечено");
                    }
                }
                else if (data.startsWith("t:")) {
                    const [, taskId] = data.split(":");
                    await supabase.from("crm_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", taskId);
                    const { data: t } = await supabase.from("crm_tasks").select("lead_id,title").eq("id", taskId).limit(1);
                    if (t?.[0]?.lead_id)
                        await supabase.from("crm_timeline").insert({ lead_id: t[0].lead_id, kind: "task_done", body: t[0].title });
                    await tg(token, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: "HTML", text: `✅ <s>${escapeHtml(t?.[0]?.title ?? "Задача")}</s> - выполнено` });
                    await ack("Готово");
                }
                return new Response("ok");
            }
            const m = update.message ?? update.edited_message;
            if (!m)
                return new Response("ok");
            const chatId = m.chat.id;
            const fromId = m.from?.id;
            let text = String(m.text ?? m.caption ?? "").trim();
            text = text.replace(/[​‎‏‪-‮⁠-⁩﻿]/g, "").replace(/[  -   　]/g, " ").replace(/[\u2010-\u2015\u2212]/g, "-");
            const isPrivate = m.chat.type === "private";
            if (isPrivate && fromId && /^[\d\s.,]+$/.test(text) && text.replace(/\D/g, "").length >= 3) {
                const { data: waitRow } = await supabase.from("crm_app_config")
                    .select("value").eq("key", `soft_price_wait_${fromId}`).limit(1);
                const [waitLead, waitAt] = String(waitRow?.[0]?.value ?? "").split("|");
                const fresh = waitLead && Date.now() - Number(waitAt || 0) < 6 * 3600000;
                if (fresh) {
                    const price = Number(text.replace(/\D/g, ""));
                    const { data: lr2 } = await supabase.from("crm_leads").select("id,name,soft_review").eq("id", waitLead).limit(1);
                    const lead2 = lr2?.[0];
                    if (lead2 && price > 0) {
                        const review2 = (lead2.soft_review ?? {}) as Record<string, unknown>;
                        const items2 = (review2.items ?? []) as {
                            label?: string;
                            units?: number;
                            each?: number;
                        }[];
                        const byTable = items2.reduce((sum, i) => sum + Number(i.units ?? 0) * Number(i.each ?? 0), 0);
                        await supabase.from("crm_leads").update({
                            soft_review: { ...review2, price, priced_at: new Date().toISOString() },
                        }).eq("id", waitLead);
                        await supabase.from("crm_app_config").delete().eq("key", `soft_price_wait_${fromId}`);
                        const listed2 = items2.length ? items2.map((i) => i.label).join(", ") : "предметы не отмечены";
                        await tg(token, "sendMessage", { chat_id: chatId, text: `Принял, ${price.toLocaleString("ru-RU")} Ft. Передал Алексу.` });
                        if (ownerId) {
                            const gap = byTable > 0 ? price - byTable : 0;
                            const warn = byTable > 0 && price < byTable
                                ? `\n⚠️ По таблице вышло бы ${byTable.toLocaleString("ru-RU")} Ft, это на ${Math.abs(gap).toLocaleString("ru-RU")} меньше`
                                : "";
                            await tg(token, "sendMessage", {
                                chat_id: ownerId, parse_mode: "HTML", disable_web_page_preview: true,
                                text: `🧽 <b>Ваня оценил химчистку</b>\nКлиент: ${escapeHtml(String(lead2.name ?? ""))}\nПредметы: ${escapeHtml(listed2)}\nЦена мастера: <b>${price.toLocaleString("ru-RU")} Ft</b>${warn}`,
                            });
                        }
                        await supabase.from("crm_timeline").insert({
                            lead_id: waitLead, kind: "soft_review_priced",
                            body: `Мастер назвал цену химчистки: ${price} Ft`,
                            meta: { price, by_table: byTable, items: items2 },
                        });
                        return new Response("ok");
                    }
                }
            }
            if (!ownerId && isPrivate && fromId) {
                await setConfig("owner_tg_id", String(fromId));
                cfg.owner_tg_id = String(fromId);
                ownerId = String(fromId);
            }
            const assistIds = String(cfg.assistant_tg_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
            if (isPrivate && fromId && String(fromId) === ownerId && /^\/assistant\b/.test(text)) {
                const arg = text.replace(/^\/assistant\s*/, "").trim();
                if (!arg) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: `Помощницы сейчас: ${assistIds.length ? assistIds.join(", ") : "нет"}.\nДобавить: /assistant 123456789\nУбрать: /assistant -123456789\nЕё ID она узнает командой /myid.` });
                }
                else if (arg.startsWith("-")) {
                    const rm = arg.slice(1).trim();
                    const next = assistIds.filter((x) => x !== rm);
                    await setConfig("assistant_tg_ids", next.join(","));
                    await tg(token, "sendMessage", { chat_id: chatId, text: `Убрал ${rm}. Осталось: ${next.join(", ") || "никого"}.` });
                }
                else {
                    const next = Array.from(new Set([...assistIds, arg]));
                    await setConfig("assistant_tg_ids", next.join(","));
                    await tg(token, "sendMessage", { chat_id: chatId, text: `Добавил ${arg}. Теперь помощницы: ${next.join(", ")}.` });
                }
                return new Response("ok");
            }
            if (isPrivate && /^\/myid\b/.test(text)) {
                await tg(token, "sendMessage", { chat_id: chatId, text: `Твой Telegram ID: ${fromId}\nПерешли его владельцу, он даст доступ.` });
                return new Response("ok");
            }
            if (isPrivate && fromId && assistIds.includes(String(fromId))) {
                if (/^\/start\b|^\/help\b/.test(text)) {
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: "👋 Это помощник по ответам клиентам CLB.\n\nПришли сюда сообщение клиента (можно вместе с фото дивана, ковра, комнаты) - я напишу готовый текст ответа с ценами, его останется скопировать и отправить.\n\nМожно прислать просто фото с подписью или несколько фото подряд.\n\n⚠️ Даты и время я не подтверждаю: расписание знает только Алекс, спрашивай у него." });
                    return new Response("ok");
                }
                const photos = m.photo as Record<string, unknown>[] | undefined;
                const imgs: {
                    b64: string;
                    mime: string;
                }[] = [];
                if (photos?.length) {
                    const biggest = photos[photos.length - 1];
                    const got = await tgPhotoBase64(token, String(biggest.file_id));
                    if (got)
                        imgs.push(got);
                }
                if (!text && !imgs.length)
                    return new Response("ok");
                await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" });
                const draft = await assistDraft(cfg, text, imgs);
                await tg(token, "sendMessage", { chat_id: chatId, text: draft, disable_web_page_preview: true });
                return new Response("ok");
            }
            if (isPrivate && m.photo && chatId && String(chatId) === String(cfg.owner_tg_id)) {
                const cap = String(m.caption ?? "");
                const lead = (await leadByPhoneIn(cap)) ?? (await loadActiveLead(chatId));
                if (!lead) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: "📷 Не понял, к какому клиенту это фото. Открой карточку в боте или пришли фото с подписью, где есть номер клиента." });
                    return new Response("ok");
                }
                const ph = m.photo as Record<string, unknown>[];
                const fileId = String(ph[ph.length - 1].file_id);
                const got = await tgPhotoBytes(token, fileId);
                let path = "";
                if (got) {
                    path = `${lead.id}/client-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
                    const { error } = await supabase.storage.from("job-photos").upload(path, got.buf, { contentType: got.mime });
                    if (error) {
                        console.error("client photo upload", error);
                        path = "";
                    }
                }
                await supabase.from("crm_job_photos").insert({ lead_id: lead.id, master_id: null, path, phase: "client", tg_file_id: fileId });
                const { count } = await supabase.from("crm_job_photos").select("id", { count: "exact", head: true }).eq("lead_id", lead.id).eq("phase", "client");
                await saveActiveLead(chatId, String(lead.id));
                await tg(token, "sendMessage", { chat_id: chatId, text: `📷 Фото клиента принято - ${lead.name}. Всего по этому заказу: ${count ?? 1}.\nОни уйдут мастеру вместе с нарядом.` });
                return new Response("ok");
            }
            const mediaMsg = (m.photo ? m.photo as Record<string, unknown>[] : null) ?? (m.video ? [m.video as Record<string, unknown>] : null);
            if (isPrivate && mediaMsg && chatId) {
                const { data: mm } = await supabase.from("crm_masters").select("id,name").eq("tg_chat_id", String(chatId)).limit(1);
                const master = mm?.[0];
                if (master) {
                    const jobs = await candidateJobsFor(String(master.id));
                    const job = jobs[0];
                    if (!job) {
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Спасибо! Но я не понял, к какому заказу это фото - на вчера, сегодня и завтра у тебя нет наряда в системе. Напиши Алексу." });
                        return new Response("ok");
                    }
                    const cap = String(m.caption ?? "");
                    const { data: phRow } = await supabase.from("crm_app_config").select("value").eq("key", `photo_phase_${chatId}`).limit(1);
                    const [markPhase, markTs] = String(phRow?.[0]?.value ?? "").split("|");
                    const marked = markPhase && (Date.now() - Number(markTs || 0)) < 30 * 60000 ? markPhase : "";
                    const phase = /(^|\s)(до|before)(\s|$)/i.test(cap) ? "before"
                        : /(^|\s)(после|after)(\s|$)/i.test(cap) ? "after"
                            : marked ? marked
                                : job.scheduled_at && Date.now() < new Date(String(job.scheduled_at)).getTime() ? "before"
                                    : "after";
                    const isVideo = !m.photo;
                    const fileId = String(mediaMsg[mediaMsg.length - 1].file_id);
                    const got = await tgPhotoBytes(token, fileId);
                    if (!got && !isVideo) {
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Не смог скачать фото, пришли ещё раз пожалуйста." });
                        return new Response("ok");
                    }
                    let path = "";
                    if (got) {
                        path = `${job.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${isVideo ? "mp4" : "jpg"}`;
                        const { error } = await supabase.storage.from("job-photos").upload(path, got.buf, { contentType: isVideo ? "video/mp4" : got.mime });
                        if (error) {
                            console.error("job photo upload", error);
                            path = "";
                            if (!isVideo) {
                                await tg(token, "sendMessage", { chat_id: chatId, text: "Фото не сохранилось, попробуй ещё раз." });
                                return new Response("ok");
                            }
                        }
                    }
                    const { data: ins } = await supabase.from("crm_job_photos").insert({ lead_id: job.id, master_id: master.id, path, phase, tg_file_id: fileId }).select("id").limit(1);
                    const photoId = ins?.[0]?.id;
                    const { count } = await supabase.from("crm_job_photos").select("id", { count: "exact", head: true }).eq("lead_id", job.id);
                    const others = jobs.slice(1, 4);
                    await tg(token, "sendMessage", {
                        chat_id: chatId,
                        text: `${isVideo ? "🎥" : "📷"} Принял (${phase === "before" ? "до" : "после"}) - заказ ${job.name}. Всего фото: ${count ?? 1}.` +
                            ((count ?? 1) <= 1 ? "\n\nЕсли снимаешь ДО уборки, отправляй фото с подписью «до». Без подписи считаю, что это «после»." : ""),
                        ...(photoId
                            ? { reply_markup: { inline_keyboard: [
                                        [{ text: phase === "before" ? "↩ нет, это ПОСЛЕ" : "↩ нет, это ДО", callback_data: `pf:${photoId}:${phase === "before" ? "after" : "before"}` }],
                                        ...(others.length ? [others.map((o) => ({ text: `↪ это ${o.name}`, callback_data: `jp:${photoId}:${o.id}` }))] : []),
                                    ] } }
                            : {}),
                    });
                    return new Response("ok");
                }
            }
            const marketerList = String(cfg.marketer_tg_ids ?? "").split(",").map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
            const myUname = String(m.from?.username ?? "").toLowerCase();
            const isMarketer = marketerList.includes(String(fromId)) || (!!myUname && marketerList.includes(myUname));
            if (isPrivate && isMarketer) {
                const t = String(text ?? "").toLowerCase();
                if (!t || /^\/(start|help)\b/.test(t) || /что ты умеешь|как польз/.test(t)) {
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: [
                            "📊 <b>CLB CRM, доступ к рекламе</b>", "",
                            "Спрашивай словами, отвечу цифрами из базы:",
                            "• <code>что по рекламе за 7 дней</code>",
                            "• <code>сколько квалифицированных лидов за месяц</code>",
                            "• <code>какая стоимость квалифицированного лида за 14 дней</code>",
                            "• <code>покажи воронку за неделю</code>",
                            "• <code>какие кампании дают лучшую квалификацию за месяц</code>",
                            "• <code>где больше всего сливов за 30 дней</code>",
                            "• <code>сколько лидов Meta дошло до CRM за неделю</code>",
                            "• <code>химчистка за месяц: CPL, CPQL и ROAS</code>",
                            "• <code>клининг за 14 дней</code>",
                            "• <code>окна за квартал</code>",
                            "",
                            "Покажу лиды Meta и CRM, квалификацию, сливы, заказы, расход, CPL, CPQL, CTR и ROAS.",
                            "Если срок не указать, беру 7 дней.",
                        ].join("\n") });
                    return new Response("ok");
                }
                let days = 7;
                const nm = t.match(/(\d+)\s*(дн|day)/);
                if (nm)
                    days = Math.min(365, Math.max(1, Number(nm[1])));
                else if (/месяц|month/.test(t))
                    days = 30;
                else if (/квартал|quarter/.test(t))
                    days = 90;
                else if (/вчера|yesterday/.test(t))
                    days = 1;
                else if (/сегодня|today/.test(t))
                    days = 1;
                let filter = "";
                if (/химчист|chim|диван|ковер|ковёр|матрас/.test(t))
                    filter = "chim";
                else if (/клининг|уборк|cleaning/.test(t))
                    filter = "cleaning";
                else if (/окн|window/.test(t))
                    filter = "window";
                else if (/вакан|vacancy/.test(t))
                    filter = "vacancy";
                let intent = "overview";
                if (/квалиф|cpql|качеств/.test(t))
                    intent = "quality";
                else if (/слив|lost|junk|плох/.test(t))
                    intent = "loss";
                else if (/roas|окуп|выруч|принес/.test(t))
                    intent = "roas";
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true, text: await marketingText(cfg, days, filter, intent) });
                return new Response("ok");
            }
            if (isPrivate && chatId && text && ownerId && String(fromId) !== ownerId) {
                const { data: mrow } = await supabase.from("crm_masters")
                    .select("id,name,language,can_report_payouts").eq("tg_chat_id", String(chatId)).limit(1);
                const me = mrow?.[0] as {
                    id: string;
                    name: string;
                    language: string | null;
                    can_report_payouts: boolean;
                } | undefined;
                if (me) {
                    const tz = cfg.timezone || "Europe/Budapest";
                    const en = String(me.language ?? "ru") === "en";
                    const t = text.toLowerCase();
                    const mark = /^(фото\s*)?(до|before)\b/.test(t) ? "before"
                        : /^(фото\s*)?(после|after)\b/.test(t) ? "after" : "";
                    if (mark && t.length < 30) {
                        await setConfig(`photo_phase_${chatId}`, `${mark}|${Date.now()}`);
                        await tg(token, "sendMessage", { chat_id: chatId, text: mark === "before"
                                ? "📷 Понял. Следующие фото записываю как ДО работы."
                                : "📷 Понял. Следующие фото записываю как ПОСЛЕ работы." });
                        return new Response("ok");
                    }
                    if (/^\/(start|help)\b|что ты умеешь|what can you do/.test(t)) {
                        await tg(token, "sendMessage", { chat_id: chatId, text: en
                                ? `Hi ${me.name}! I send you your jobs here.\n\n📅 Ask about a job:\n• "job on 5", "jobs tomorrow", "11.09"\n${me.can_report_payouts ? '\n👥 Set the crew:\n• "on 11.09 Olya, Sveta and me are going"\n\n💰 Report payouts:\nJob 31.08\nOlya 23600\nSveta 21900\n' : ""}\n🌙 In the evening we close the day: I ask about each job in turn - what the client paid, what the crew got, any costs. Answer with the buttons and numbers.\n\n📷 Send photos before and after the job right here.`
                                : `Привет, ${me.name}! Сюда я присылаю тебе заказы.\n\n📅 Спросить про заказ:\n• «какой заказ на 5 число», «заказы завтра», «11.09»\n${me.can_report_payouts ? '\n👥 Поставить бригаду:\n• «на 11.09 едут Оля, Света и я»\nЕсли заказов в этот день несколько - спрошу кнопками, на какой.\n\n💰 Отчитаться по выплатам:\nЗаказ 31.08\nОля 23600\nСвета 21900\n' : ""}\n🌙 Вечером закрываем день: спрошу по каждому заказу отдельно, что заплатил клиент, сколько получили девочки и были ли расходы. Отвечай кнопками и числами.\n\n📷 Фото до и после работы кидай прямо сюда.` });
                        return new Response("ok");
                    }
                    if (await dcText(cfg, chatId, me.name, String(me.id), text))
                        return new Response("ok");
                    const ask = String(cfg[`ask_${chatId}`] ?? "");
                    const [askLead, askTs, ...askQ] = ask.split("|");
                    if (askLead && Date.now() - Number(askTs) < 48 * 3600e3) {
                        await setConfig(`ask_${chatId}`, "");
                        const { data: al } = await supabase.from("crm_leads").select("name").eq("id", askLead).maybeSingle();
                        const who = String(al?.name ?? "клиент");
                        await supabase.from("crm_timeline").insert({ lead_id: askLead, kind: "note",
                            body: `💬 ${me.name} ответила на вопрос «${askQ.join("|")}»: ${text.slice(0, 500)}` });
                        if (cfg.owner_tg_id)
                            await tg(token, "sendMessage", { chat_id: cfg.owner_tg_id,
                                text: `💬 ${me.name} по ${who}: ${text.slice(0, 900)}\n\n(вопрос: ${askQ.join("|")})` });
                        await tg(token, "sendMessage", { chat_id: chatId, text: en ? "Got it, passed to Alex 👍" : "Записал, передал Алексу 👍" });
                        return new Response("ok");
                    }
                    const ref = parseDayRef(t, tz);
                    const valid = !!ref;
                    const y = ref?.y ?? 0, mo = ref?.mo ?? 0, d = ref?.d ?? 0;
                    let jobs: Array<Record<string, unknown>> = [];
                    if (valid) {
                        jobs = await masterJobsBetween(String(me.id), localToUtc(tz, y, mo, d, 0, 0).toISOString(), localToUtc(tz, y, mo, d, 23, 59).toISOString(), !!me.can_report_payouts);
                    }
                    const allSums = parseMoney(text);
                    const payWord = /оплат|заплат|выплат|отдал|paid|payout/.test(t);
                    const asking = /\?|какой|какие|сколько у меня|what job|which job/.test(t);
                    if (!asking && (payWord || allSums.length >= 2 || (allSums.length === 1 && valid))) {
                        if (!me.can_report_payouts) {
                            await tg(token, "sendMessage", { chat_id: chatId, text: en ? "Only the team lead can report payouts. Please tell Alex." : "Записывать выплаты может только бригадир. Напиши Алексу." });
                            return new Response("ok");
                        }
                        const NOISE = /оплат[а-яё]*|заплат[а-яё]*|выплат[а-яё]*|отдал[а-яё]*|paid|payout|заказ[а-яё]*|девочк[а-яё]*|бригад[а-яё]*|\bза\b|ft|форинт[а-яё]*|huf|янв[а-яё]*|фев[а-яё]*|март[а-яё]*|апрел[а-яё]*|ма[йя]\b|июн[а-яё]*|июл[а-яё]*|август[а-яё]*|авг\b|сентябр[а-яё]*|сен\b|октябр[а-яё]*|окт\b|ноябр[а-яё]*|ноя\b|декабр[а-яё]*|дек\b/gi;
                        const parts = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
                        const rows: {
                            amount: number;
                            who: string;
                        }[] = [];
                        for (const part of parts) {
                            for (const amount of parseMoney(part)) {
                                const who = part.replace(/\d[\d  ]*\d|\d/g, " ").replace(/тыс[а-яё]*|тис[а-яё]*/gi, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
                                rows.push({ amount, who });
                            }
                        }
                        if (!rows.length) {
                            await tg(token, "sendMessage", { chat_id: chatId, text: en
                                    ? "I did not catch the amounts. Write them in digits, one per line:\nOksana 12000\nJulia 9000\n\nOr one total: \"paid the crew 36k\"."
                                    : "Не понял суммы. Напиши цифрами, по одной в строке:\nОксана 12000\nЮля 9000\n\nИли одной суммой: «оплата девочкам 36 тыс»." });
                            return new Response("ok");
                        }
                        if (rows.length === 1)
                            rows[0].who = "";
                        const spentOn = valid
                            ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
                            : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
                        const mine = jobs.filter((j) => String(j.assigned_master_id ?? "") === String(me.id) ||
                            (Array.isArray(j.crew) ? j.crew as Array<Record<string, unknown>> : []).some((c) => String(c.m) === String(me.id)));
                        const forMoney = mine.length ? mine : jobs;
                        const leadId = forMoney.length === 1 ? String(forMoney[0].id) : null;
                        const jobName = leadId ? String(forMoney[0].name ?? "") : "";
                        const batchId = crypto.randomUUID();
                        const { data: ex } = await supabase.from("crm_expenses").insert(rows.map((r) => ({
                            spent_on: spentOn, amount: r.amount, lead_id: leadId, master_id: me.id, batch_id: batchId,
                            note: `${r.who ? `Выплата клинеру ${r.who}` : "Выплата бригаде"} · сообщила ${me.name} в боте${jobName ? ` · заказ ${jobName}` : ""}`,
                        }))).select("id,amount,note");
                        if (!leadId && forMoney.length > 1) {
                            await setConfig(`pay_batch_${chatId}`, `${batchId}|${Date.now()}`);
                            await tg(token, "sendMessage", {
                                chat_id: chatId,
                                text: [
                                    en ? `✅ Written down for ${spentOn}: ${Ft(rows.reduce((s2, r) => s2 + r.amount, 0))}` : `✅ Записал за ${spentOn}: ${Ft(rows.reduce((s2, r) => s2 + r.amount, 0))}`,
                                    "",
                                    en ? `There are ${forMoney.length} jobs that day. Which one is this payment for?` : `В этот день ${forMoney.length} заказа. К какому относится оплата?`,
                                ].join("\n"),
                                reply_markup: { inline_keyboard: forMoney.slice(0, 6).map((j) => [{ text: String(j.name ?? "").slice(0, 60), callback_data: `pl:${j.id}` }]) },
                            });
                            return new Response("ok");
                        }
                        const total = rows.reduce((s, r) => s + r.amount, 0);
                        const lines = rows.map((r) => `• ${r.who || (en ? "crew" : "бригада")} - ${Ft(r.amount)}`);
                        await tg(token, "sendMessage", {
                            chat_id: chatId,
                            text: [
                                en ? `✅ Written down for ${spentOn}:` : `✅ Записал за ${spentOn}:`,
                                ...lines,
                                en ? `Total: ${Ft(total)}` : `Итого: ${Ft(total)}`,
                                leadId ? `${en ? "Job" : "Заказ"}: ${jobName}`
                                    : (en ? "That day has no single job, saved without a link to one." : "Заказ в этот день не один или его нет - записал без привязки."),
                            ].join("\n"),
                            ...((ex ?? []).length
                                ? { reply_markup: { inline_keyboard: (ex ?? []).slice(0, 6).map((e) => [{ text: `❌ ${Ft(Number(e.amount))}`, callback_data: `xp:${e.id}` }]) } }
                                : {}),
                        });
                        return new Response("ok");
                    }
                    if (me.can_report_payouts && !asking) {
                        const { data: allM } = await supabase.from("crm_masters").select("id,name").eq("active", true);
                        const picked = matchMasterNames(text, (allM ?? []) as {
                            id: string;
                            name: string;
                        }[]);
                        const assignIntent = valid || /ед[еуя]т|поед|ставлю|ставь|будут|будет|работа[ею]т|отправ|возьму|беру/.test(t);
                        if (assignIntent && (picked.found.length || picked.unknown.length)) {
                            const cands = jobs.length ? jobs : await masterJobsBetween(String(me.id), new Date(Date.now() - 7 * 86400e3).toISOString(), new Date(Date.now() + 21 * 86400e3).toISOString(), !!me.can_report_payouts);
                            const names = picked.found.map((x) => x.name).join(", ");
                            const tail = picked.unknown.length ? `\nВ базе нет: ${picked.unknown.join(", ")} - записал в заказ как есть.` : "";
                            if (!cands.length) {
                                const who = names || picked.unknown.join(", ");
                                await tg(token, "sendMessage", { chat_id: chatId, text: `Понял, что едут ${who}, но не понял на какой заказ. Напиши дату: «на 11.09 едут ${who}».` });
                                return new Response("ok");
                            }
                            if (cands.length > 1) {
                                await setConfig(`assign_${chatId}`, `${picked.found.map((x) => x.id).join(",")}|${Date.now()}`);
                                await tg(token, "sendMessage", {
                                    chat_id: chatId,
                                    text: `Ставлю: ${names}.${tail}\n\nНа какой заказ?`,
                                    reply_markup: { inline_keyboard: cands.slice(0, 6).map((j) => [{ text: String(j.name ?? "").slice(0, 60), callback_data: `as:${j.id}` }]) },
                                });
                                return new Response("ok");
                            }
                            const res = await applyCrew(String(cands[0].id), picked.found.map((x) => x.id));
                            if (picked.unknown.length) {
                                await supabase.from("crm_timeline").insert({ lead_id: String(cands[0].id), kind: "note",
                                    body: `👥 Мария добавила на выезд: ${picked.unknown.join(", ")} (в мастерах не заведены, подработка).` });
                            }
                            await tg(token, "sendMessage", { chat_id: chatId, text: res.crewNames.length
                                    ? `✅ ${cands[0].name}\nБригада: ${res.crewNames.join(", ")}${res.warn ? `\n\n${res.warn}` : ""}${tail}`
                                    : `✅ ${cands[0].name}\nЗаписал на выезд: ${picked.unknown.join(", ")}.\nВ мастерах их нет, но это не мешает: выплаты потом пиши по именам, я запомню.` });
                            return new Response("ok");
                        }
                    }
                    if (valid) {
                        const human = `${String(d).padStart(2, "0")}.${String(mo).padStart(2, "0")}`;
                        const { data: nm } = await supabase.from("crm_masters").select("id,name");
                        const allNames = new Map((nm ?? []).map((x) => [String(x.id), String(x.name)]));
                        if (!jobs.length) {
                            await tg(token, "sendMessage", { chat_id: chatId, text: en ? `Nothing on ${human} for you yet.` : `На ${human} у тебя пока ничего нет.` });
                            return new Response("ok");
                        }
                        for (const j of jobs) {
                            const time = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(String(j.scheduled_at)));
                            const mineJob = String(j.assigned_master_id ?? "") === String(me.id) ||
                                (Array.isArray(j.crew) ? j.crew as Array<Record<string, unknown>> : []).some((c) => String(c.m) === String(me.id));
                            const whose = mineJob ? "" : (j.assigned_master_id ? `\n👤 Мастер: ${allNames.get(String(j.assigned_master_id)) ?? "другой"}` : "\n⚠️ МАСТЕР НЕ НАЗНАЧЕН");
                            const brief = String(j.master_brief || j.name || "") + whose;
                            await tg(token, "sendMessage", { chat_id: chatId, text: `📅 ${human}, ${time}\n📍 ${String(j.address || (en ? "address not set" : "адрес не указан"))}\n\n${me.can_report_payouts ? brief : stripMoneyLines(brief)}` });
                        }
                        return new Response("ok");
                    }
                    await tg(token, "sendMessage", { chat_id: chatId, text: en
                            ? "I did not get that.\n\nJobs: \"job on 5\", \"jobs tomorrow\".\nPayouts: a list like\nJob 31.08\nOlya 23600\nSveta 21900\n\nOr just send photos from the job. /help for the full list."
                            : "Не понял.\n\nЗаказы: «какой заказ на 5 число», «заказы завтра».\nВыплаты: списком, вот так\nЗаказ 31.08\nОля 23600\nСвета 21900\n\nИли просто пришли фото с работы. /help - что я умею." });
                    return new Response("ok");
                }
            }
            if (isPrivate && ownerId && String(fromId) !== ownerId) {
                const rawPhone = String(m.contact?.phone_number ?? text);
                const digitsAll = rawPhone.replace(/\D/g, "");
                const dig = digitsAll.slice(-9);
                const looksLikePhone = !!m.contact || digitsAll.length >= 9;
                if (looksLikePhone && dig.length === 9) {
                    const { data: ms } = await supabase.from("crm_masters").select("id,name,phone");
                    const match = (ms ?? []).find((x) => String(x.phone || "").replace(/\D/g, "").slice(-9) === dig);
                    if (match) {
                        await supabase.from("crm_masters").update({ tg_chat_id: chatId }).eq("id", match.id);
                        await tg(token, "sendMessage", { chat_id: chatId, text: `✅ Привязано, ${match.name}! Заказы буду присылать сюда.\n✅ Connected, ${match.name}! I will send your jobs here.`, reply_markup: { remove_keyboard: true } });
                        await tg(token, "sendMessage", { chat_id: chatId, text: "На каком языке тебе писать?\nWhich language should I write to you in?",
                            reply_markup: { inline_keyboard: [[{ text: "🇷🇺 Русский", callback_data: "lang:ru" }, { text: "🇬🇧 English", callback_data: "lang:en" }]] } });
                    }
                    else {
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Не нашёл тебя по этому номеру. Напиши Алексу или Марии, чтобы тебя добавили в систему с этим телефоном, и попробуй ещё раз.\n\nI could not find you by this number. Message Alex or Maria so they add you to the system with this phone, then try again." });
                    }
                    return new Response("ok");
                }
                await tg(token, "sendMessage", { chat_id: chatId, text: "Привет! Это бот CLB Cleaning для мастеров. Нажми кнопку ниже (или просто пришли свой номер), и я буду присылать тебе заказы.\n\nHi! This is the CLB Cleaning bot for our cleaners. Press the button below (or just send your number) and I will send you your jobs here.", reply_markup: { keyboard: [[{ text: "📱 Отправить номер / Send my number", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
                return new Response("ok");
            }
            if (!allowed(fromId))
                return new Response("ok");
            if (!text)
                return new Response("ok");
            if (text.startsWith("/")) {
                const cmd = text.slice(1).split(/[\s@]/)[0].toLowerCase();
                if (cmd === "start" || cmd === "help") {
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true, text: [
                            "🤖 <b>CLB CRM</b>", "", "Заявки с рекламы падают сюда автоматически с кнопками статуса.", "",
                            "<b>Что я умею:</b>", "• Ответь на карточку перепиской из WhatsApp - я разберу её, обновлю статус и поставлю задачу-перезвон.",
                            "• Ответь на карточку командой: <code>перезвонить через 3 дня</code>, <code>закрыли на 30000 мастер Даша +5000 бензин</code>.",
                            "• Спроси словами: <code>что по Марине?</code>, <code>какой у неё адрес?</code>, <code>сколько заявок на химчистку за неделю?</code> - отвечу из базы.",
                            "• <code>дай пачку на реактивацию</code> - пришлю спящих лидов с готовыми WhatsApp-текстами. Каждое утро в 8:00 шлю сводку дня.",
                            "", "<b>Команды:</b>", "/stats - воронка и деньги", "/leads - последние заявки", "/masters - мастера", "/refresh - обновить кнопки на карточках", "/dashboard - ссылка на дашборд", "/zakryt [дней] - пачка молчунов на закрытие", "/health - живы ли Claude, WhatsApp и заявки",
                        ].join("\n") });
                    return new Response("ok");
                }
                if (cmd === "health" || cmd === "проверка") {
                    const L: string[] = ["🩺 <b>Проверка систем</b>", ""];
                    if (!cfg.anthropic_api_key)
                        L.push("🔴 Claude: ключ не прописан");
                    else {
                        try {
                            const r = await fetch("https://api.anthropic.com/v1/messages", {
                                method: "POST",
                                headers: { "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
                                body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4, messages: [{ role: "user", content: "ping" }] }),
                            });
                            if (r.ok)
                                L.push("🟢 Claude: отвечает");
                            else {
                                const e = await r.text().catch(() => "");
                                L.push(/credit balance/i.test(e) ? "🔴 Claude: КОНЧИЛСЯ БАЛАНС" : `🔴 Claude: ошибка ${r.status}`);
                            }
                        }
                        catch {
                            L.push("🔴 Claude: не отвечает");
                        }
                    }
                    const { data: wa } = await supabase.from("crm_wa_messages")
                        .select("sent_at").order("sent_at", { ascending: false }).limit(1);
                    const waAt = wa?.[0]?.sent_at ? new Date(String(wa[0].sent_at)) : null;
                    const waMin = waAt ? Math.round((Date.now() - waAt.getTime()) / 60000) : null;
                    L.push(waMin === null ? "🔴 WhatsApp: сообщений нет вообще"
                        : waMin < 180 ? `🟢 WhatsApp: последнее сообщение ${waMin} мин назад`
                            : `🔴 WhatsApp: тишина ${Math.round(waMin / 60)} ч, канал скорее всего лёг`);
                    const { data: ld } = await supabase.from("crm_leads")
                        .select("created_at").order("created_at", { ascending: false }).limit(1);
                    const ldAt = ld?.[0]?.created_at ? new Date(String(ld[0].created_at)) : null;
                    if (ldAt) {
                        const h = Math.round((Date.now() - ldAt.getTime()) / 3600000);
                        L.push(h < 48 ? `🟢 Заявки: последняя ${h} ч назад` : `🟡 Заявки: тишина ${h} ч`);
                    }
                    const { count: openN } = await supabase.from("crm_deals")
                        .select("id", { count: "exact", head: true }).is("closed_at", null)
                        .gte("job_date", new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10));
                    L.push(openN ? `🟡 Не закрыто заказов за 10 дней: ${openN}` : "🟢 Все заказы за 10 дней закрыты");
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: L.join("\n") });
                    return new Response("ok");
                }
                if (cmd === "stats") {
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true, text: await statsText(cfg, isPrivate) });
                    return new Response("ok");
                }
                if (cmd === "zakryt" || cmd === "close") {
                    const days = Number((text.split(/\s+/)[1] || "7").replace(/\D/g, "")) || 7;
                    const cut = new Date(Date.now() - days * 86400000).toISOString();
                    const { data: stuck } = await supabase.from("crm_leads")
                        .select("id,name,phone,status,language,service,gift,campaign,last_contact_at,created_at")
                        .in("status", ["contacted", "in_progress", "follow_up", "pushing"])
                        .neq("source", "job_application")
                        .or(`last_contact_at.lt.${cut},and(last_contact_at.is.null,created_at.lt.${cut})`)
                        .order("last_contact_at", { ascending: true, nullsFirst: true }).limit(6);
                    if (!stuck?.length) {
                        await tg(token, "sendMessage", { chat_id: chatId, text: `Молчунов старше ${days} дней нет.` });
                        return new Response("ok");
                    }
                    const { data: replies } = await supabase.from("crm_wa_messages")
                        .select("lead_id,direction,body").in("lead_id", stuck.map((l) => l.id));
                    const answered = new Map<string, number>(), seen = new Map<string, number>(), cyr = new Map<string, number>();
                    for (const r of replies ?? []) {
                        const id = String(r.lead_id);
                        seen.set(id, (seen.get(id) ?? 0) + 1);
                        if (r.direction === "incoming")
                            answered.set(id, (answered.get(id) ?? 0) + 1);
                        if (/[а-яё]/i.test(String(r.body ?? "")))
                            cyr.set(id, (cyr.get(id) ?? 0) + 1);
                    }
                    await tg(token, "sendMessage", { chat_id: chatId, text: `🧹 <b>На закрытие: молчат больше ${days} дней</b>\nЖми статус, текст для клиента придёт следующим сообщением.\n\n🚫 <b>Нет связи</b> - ни разу не ответил. Текст: заявку закрываю, окно и подарок уходят, один день на ответ.\n❌ <b>Слив</b> - отвечал и отказался. Текст: спокойно закрываю, дверь открыта.`, parse_mode: "HTML" });
                    for (const l of stuck) {
                        const wa = waDigits(l.phone);
                        const ru = cyr.get(String(l.id)) ? true : /[а-яё]/i.test(String(l.name ?? "")) ? true : l.language === "ru";
                        const lang = ru ? "ru" : "en";
                        const other = ru ? "en" : "ru";
                        const forLang = (kind: "junk" | "lost", code: string) => closingText({ ...l, language: code }, kind);
                        const quiet = l.last_contact_at || l.created_at;
                        const dayCount = Math.floor((Date.now() - Date.parse(String(quiet))) / 86400000);
                        await tg(token, "sendMessage", {
                            chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true,
                            text: [`👤 <b>${escapeHtml(String(l.name ?? "клиент"))}</b> ${ru ? "🇷🇺" : "🇬🇧"} · ${escapeHtml(String(l.phone ?? ""))}`,
                                `${STATUS[String(l.status)] ?? l.status} · молчит ${dayCount} дн.`,
                                answered.get(String(l.id))
                                    ? `💬 отвечал ${answered.get(String(l.id))} раз - похоже на слив`
                                    : seen.get(String(l.id))
                                        ? `🔇 ни одного ответа - похоже на «нет связи»`
                                        : `🔍 переписки в CRM нет, открой чат и посмотри сам`,
                                (String(l.phone ?? "").replace(/\D/g, "").length < 9 || String(l.phone ?? "").replace(/\D/g, "").length > 15) ? "📵 номер выглядит неполным, проверь перед отправкой" : "",
                                l.campaign ? `📊 ${escapeHtml(String(l.campaign))}` : ""].filter(Boolean).join("\n"),
                            reply_markup: { inline_keyboard: [
                                    ...(wa ? [[
                                            { text: "🔍 Открыть чат ↗", url: `https://wa.me/${wa}` },
                                            { text: `🌐 «нет связи» на ${other === "ru" ? "русском" : "английском"} ↗`, url: waButtonUrl(l.phone, forLang("junk", other)) },
                                        ], [
                                            { text: `💬 Текст «нет связи» ${ru ? "🇷🇺" : "🇬🇧"} ↗`, url: waButtonUrl(l.phone, forLang("junk", lang)) },
                                            { text: `💬 Текст «слив» ${ru ? "🇷🇺" : "🇬🇧"} ↗`, url: waButtonUrl(l.phone, forLang("lost", lang)) },
                                        ], [
                                            { text: "✅ Отправил → 🚫 нет связи", callback_data: `fw:${l.id}:junk` },
                                            { text: "✅ Отправил → ❌ слив", callback_data: `fw:${l.id}:lost` },
                                        ]] : []),
                                    [{ text: "🚫 Без письма: нет связи", callback_data: `s:${l.id}:junk` },
                                        { text: "❌ Без письма: слив", callback_data: `s:${l.id}:lost` }],
                                    [{ text: "📵 Неверный номер", callback_data: `bad:${l.id}` }],
                                ] },
                        });
                    }
                    return new Response("ok");
                }
                if (cmd === "dashboard") {
                    const link = cfg.dashboard_public_base ? `${cfg.dashboard_public_base}/?key=${cfg.dashboard_secret}` : "";
                    await tg(token, "sendMessage", { chat_id: chatId, text: !link ? "Дашборд ещё не настроен." : isPrivate ? link : "Открой дашборд в личке с ботом, там ссылка с ключом." });
                    return new Response("ok");
                }
                if (cmd === "leads") {
                    const { data: ls } = await supabase.from("crm_leads").select("name,phone,status,what_to_clean,created_at").order("created_at", { ascending: false }).limit(12);
                    const L = ["🗂 <b>Последние заявки</b>", ""];
                    for (const l of ls ?? [])
                        L.push(`${STATUS[l.status] ?? l.status} · <b>${escapeHtml(l.name) || "-"}</b>${l.phone ? ` · ${escapeHtml(l.phone)}` : ""}${l.what_to_clean ? ` · ${escapeHtml(l.what_to_clean)}` : ""}`);
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: L.join("\n") || "Пока пусто." });
                    return new Response("ok");
                }
                if (cmd === "refresh") {
                    const { data: ls } = await supabase.from("crm_leads").select("*")
                        .in("status", ["new", "contacted", "in_progress", "follow_up", "pushing"])
                        .not("tg_message_id", "is", null)
                        .order("created_at", { ascending: false }).limit(30);
                    let ok = 0;
                    for (const l of ls ?? []) {
                        if (await refreshCard(token, cfg, l))
                            ok++;
                        await new Promise((r) => setTimeout(r, 300));
                    }
                    await tg(token, "sendMessage", { chat_id: chatId, text: `♻️ Обновил ${ok} из ${(ls ?? []).length} карточек. Кнопка «Написать» теперь берёт свежий текст.\nНе изменившиеся телеграм пропускает, это нормально.` });
                    return new Response("ok");
                }
                if (cmd === "masters") {
                    const { data: ms } = await supabase.from("crm_masters").select("name,phone,default_pct,active").order("name");
                    const L = ["🧹 <b>Мастера</b>", ""];
                    for (const x of ms ?? [])
                        L.push(`${x.active ? "🟢" : "⚪"} <b>${escapeHtml(x.name)}</b> · ${x.default_pct}%${x.phone ? ` · ${escapeHtml(x.phone)}` : ""}`);
                    L.push("", "Добавить/изменить мастеров можно на дашборде.");
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: L.join("\n") });
                    return new Response("ok");
                }
                await tg(token, "sendMessage", { chat_id: chatId, text: "Не знаю такую команду. /help" });
                return new Response("ok");
            }
            if (!cfg.anthropic_api_key) {
                await tg(token, "sendMessage", { chat_id: chatId, text: "Нужен ключ Anthropic в настройках, чтобы я понимал свободный текст." });
                return new Response("ok");
            }
            {
                const sixSecAgo = new Date(Date.now() - 6000).toISOString();
                const recent = await supabase.from("crm_inbox_chunks").select("id").eq("chat_id", chatId).gt("created_at", sixSecAgo).limit(1);
                const bufferMode = text.length >= 3500 || ((recent.data?.length ?? 0) > 0);
                if (bufferMode) {
                    const ins = await supabase.from("crm_inbox_chunks").insert({ chat_id: chatId, body: text }).select("id").single();
                    const myId = ins.data?.id;
                    await new Promise((res) => setTimeout(res, 2100));
                    const latest = await supabase.from("crm_inbox_chunks").select("id").eq("chat_id", chatId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
                    if (!myId || latest.data?.[0]?.id !== myId)
                        return new Response("ok");
                    const twoMinAgo = new Date(Date.now() - 120000).toISOString();
                    const { data: parts } = await supabase.from("crm_inbox_chunks").select("body").eq("chat_id", chatId).gt("created_at", twoMinAgo).order("created_at", { ascending: true }).order("id", { ascending: true });
                    await supabase.from("crm_inbox_chunks").delete().eq("chat_id", chatId);
                    text = (parts ?? []).map((p) => p.body).join("\n").trim();
                }
            }
            let lead: Record<string, unknown> | null = null;
            let leadVia = "";
            const repliedText = String(m.reply_to_message?.text ?? m.reply_to_message?.caption ?? "").trim();
            if (m.reply_to_message?.message_id) {
                lead = await leadByCardMessage(m.reply_to_message.message_id);
                if (lead)
                    leadVia = "reply";
            }
            if (!lead && repliedText) {
                lead = await leadByNameInReminder(repliedText);
                if (lead)
                    leadVia = "reminder";
            }
            if (!lead) {
                lead = await leadByPhoneIn(text);
                if (lead)
                    leadVia = "phone";
            }
            if (!lead) {
                lead = await loadActiveLead(chatId);
                if (lead)
                    leadVia = "memory";
            }
            if (lead)
                await saveActiveLead(chatId, lead.id as string);
            const phoneCmd = /^\s*(?:номер|телефон|phone|number)\s*:?\s*(\+?[\d][\d\s().-]{7,20})\s*$/i.exec(text);
            if (phoneCmd && lead) {
                const digits = phoneCmd[1].replace(/\D/g, "");
                if (digits.length < 8 || digits.length > 15) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: `В номере ${digits.length} цифр, нужно от 8 до 15. Проверь и пришли ещё раз.` });
                    return new Response("ok");
                }
                const next = `+${digits}`, was = String(lead.phone ?? "пусто");
                await supabase.from("crm_leads").update({ phone: next, updated_at: new Date().toISOString() }).eq("id", lead.id);
                await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: `📱 Номер изменён: ${was} → ${next}` });
                await refreshCard(token, cfg, { ...lead, phone: next });
                await tg(token, "sendMessage", {
                    chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true,
                    text: `📱 <b>${escapeHtml(String(lead.name ?? "клиент"))}</b>: номер ${escapeHtml(was)} → <b>${escapeHtml(next)}</b>`,
                    reply_markup: { inline_keyboard: [[{ text: "💬 Написать на новый ↗", url: `https://wa.me/${digits}` }]] },
                });
                return new Response("ok");
            }
            const shortDeal = /^\\s*(?:закрыли\\s*(?:на)?\\s*)?(\\d[\\d ]*\\d|\\d)\\s*(?:ft|форинт[а-яё]*)?\\s*[,;]?\\s*(?:мастер[а-яё]*|выплат[а-яё]*)\\s*:?\\s*(\\d[\\d ]*\\d|\\d)\\s*(?:ft|форинт[а-яё]*)?\\s*$/i.exec(text);
            if (shortDeal && lead) {
                const total = shortDeal[1].replace(/\s/g, ""), pay = shortDeal[2].replace(/\s/g, "");
                let who = "";
                if (lead.assigned_master_id) {
                    const { data: mm } = await supabase.from("crm_masters").select("name").eq("id", lead.assigned_master_id).limit(1);
                    who = String(mm?.[0]?.name ?? "");
                }
                text = `закрыли на ${total}, мастеру ${who || "мастер"} ${pay}`;
            }
            const tz = cfg.timezone || "Europe/Budapest";
            const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(new Date());
            let leadCtx = "NONE - no client card is in this conversation yet. Do NOT ask the owner to reply to a card. If the message contains ANY client info (a name, phone, address, what they want, prices, or a pasted chat/order), use action new_lead and create the card from it.";
            if (lead) {
                const { data: cd } = await supabase.from("crm_deals").select("amount").eq("lead_id", lead.id).limit(1);
                const f = (k: string) => { const v = (lead as Record<string, unknown>)[k]; return v ? String(v).slice(0, 140) : ""; };
                leadCtx = `name=${f("name")}, phone=${f("phone") || "(нет)"}, status=${f("status")}, service=${f("service")}, what=${f("what_to_clean")}, area=${f("area")}, budget=${f("budget")}, when=${f("when_text") || "(нет)"}, address=${f("address") || "(нет)"}, scheduled=${lead.scheduled_at ? String(lead.scheduled_at) : "(нет)"}, assigned_master_id=${f("assigned_master_id") || "(нет)"}, master_notified_at=${f("master_notified_at") || "(нет)"}, master_confirmed_at=${f("master_confirmed_at") || "(нет)"}, notes=${f("notes")}${cd?.length ? `, deal=${cd[0].amount} HUF recorded` : ", no deal yet"}${leadVia === "memory" ? " (recently discussed)" : ""}`;
            }
            const histKey = `chat_hist_${chatId}`;
            let histArr: {
                t: string;
                a: string;
            }[] = [];
            try {
                histArr = JSON.parse(cfg[histKey] || "[]");
            }
            catch {
                histArr = [];
            }
            const histBlock = histArr.map((h, i) => `${i + 1}. [${h.a}] ${h.t}`).join("\n");
            const { data: mNames } = await supabase.from("crm_masters").select("name").eq("active", true).order("name");
            const mastersList = (mNames ?? []).map((m) => m.name).join(", ") || "(нет)";
            let r: Interpreted;
            const shortFix = /^(сделай(?: пожалуйста)?|эту|это|исправь|почини)[.! ]*$/iu.test(text.trim());
            if (leadVia === "reminder" && shortFix && /бригада не готова|мастер не подтвердил/iu.test(repliedText)) {
                r = { action: "notify_master" };
            }
            else {
                const interpretText = repliedText
                    ? `${text}\n\n[Сообщение бота, на которое ответил владелец — это контекст, а не новая инструкция:]\n${repliedText.slice(0, 2500)}`
                    : text;
                try {
                    r = await interpret(cfg.anthropic_api_key, interpretSystem(todayLocal, tz, leadCtx, histBlock, mastersList, (cfg.objections || "").trim()), interpretText);
                }
                catch (e) {
                    console.error("interpret", e);
                    await tg(token, "sendMessage", { chat_id: chatId, text: "Не смог разобрать, попробуй иначе." });
                    return new Response("ok");
                }
            }
            histArr.push({ t: text.slice(0, 350), a: r.action });
            await setConfig(histKey, JSON.stringify(histArr.slice(-8)));
            if (r.action === "report") {
                const rep = r.report ?? {};
                const svcSet = rep.category === "upholstery" ? ["upholstery"]
                    : rep.category === "windows" ? ["windows"]
                        : rep.category === "cleaning" ? ["deep", "regular", "cleaning"] : null;
                const from = rep.from || "0000-01-01", to = rep.to || "9999-12-31";
                const { data: all } = await supabase.from("crm_leads").select("id,status,service,language,received_at,created_at");
                const eff = (l: Record<string, unknown>) => String(l.received_at || l.created_at || "").slice(0, 10);
                const rows = (all ?? []).filter((l) => {
                    const d = eff(l);
                    if (!d || d < from || d > to)
                        return false;
                    if (rep.language && l.language !== rep.language)
                        return false;
                    if (svcSet && !svcSet.includes(l.service as string))
                        return false;
                    return true;
                });
                const c: Record<string, number> = {};
                for (const l of rows)
                    c[l.status as string] = (c[l.status as string] || 0) + 1;
                const total = rows.length, won = c["won"] || 0, conv = total ? Math.round((won / total) * 100) : 0;
                const idSet = new Set(rows.map((l) => l.id));
                let revenue = 0, dealN = 0;
                const { data: deals } = await supabase.from("crm_deals").select("amount,lead_id");
                for (const d of deals ?? [])
                    if (idSet.has(d.lead_id)) {
                        revenue += Number(d.amount);
                        dealN++;
                    }
                const catLabel = rep.category === "upholstery" ? "Химчистка" : rep.category === "windows" ? "Окна" : rep.category === "cleaning" ? "Клининг" : "Все направления";
                const langLabel = rep.language === "ru" ? " · 🇷🇺 рус" : rep.language === "en" ? " · 🇬🇧 англ" : "";
                const fmtD = (s: string) => s.slice(8, 10) + "." + s.slice(5, 7);
                const periodLabel = (rep.from || rep.to) ? `${rep.from ? fmtD(from) : "…"}–${rep.to ? fmtD(to) : "…"}` : "за всё время";
                let out = `📊 <b>${catLabel}${langLabel}</b> · ${periodLabel}\n` +
                    `Заявок: <b>${total}</b>\n` +
                    `🆕 Новые: ${c["new"] || 0} · 🔧 В работе: ${(c["in_progress"] || 0) + (c["pushing"] || 0)} · ⏳ Раздумья: ${c["follow_up"] || 0}\n` +
                    `✅ Заказы: <b>${won}</b> (${conv}%) · ❌ Слив: ${c["lost"] || 0} · 🚫 Мусор: ${c["junk"] || 0}`;
                if (dealN > 0 || rep.metric === "revenue")
                    out += `\n💰 Выручка: <b>${revenue.toLocaleString("ru-RU")} Ft</b> (${dealN} сделок)`;
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: out });
                return new Response("ok");
            }
            if (r.action === "client_info") {
                const q = (r.client_info?.query_name || "").trim();
                let target = lead;
                if (q) {
                    const digits = q.replace(/[^0-9]/g, "");
                    if (digits.length >= 7) {
                        const { data } = await supabase.from("crm_leads").select("*").ilike("phone", `%${digits.slice(-9)}%`).order("created_at", { ascending: false }).limit(1);
                        if (data?.length)
                            target = data[0];
                    }
                    else {
                        let { data } = await supabase.from("crm_leads").select("*").ilike("name", `%${q}%`).order("created_at", { ascending: false }).limit(1);
                        if (!data?.length)
                            ({ data } = await supabase.from("crm_leads").select("*").ilike("name", `%${translit(q)}%`).order("created_at", { ascending: false }).limit(1));
                        if (data?.length)
                            target = data[0];
                    }
                }
                if (!target) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: `Не нашёл клиента${q ? ` «${q}»` : ""}. Уточни имя или дай телефон.` });
                    return new Response("ok");
                }
                await saveActiveLead(chatId, target.id as string);
                const { data: tds } = await supabase.from("crm_deals").select("amount,master_payout,extra_costs").eq("lead_id", target.id);
                const { data: tts } = await supabase.from("crm_tasks").select("title,due_at").eq("lead_id", target.id).eq("done", false).order("due_at", { ascending: true }).limit(3);
                const statusDays = target.status_changed_at ? Math.floor((Date.now() - new Date(target.status_changed_at as string).getTime()) / 864e5) : null;
                const L = [`🗂 <b>${escapeHtml(target.name as string) || "-"}</b>${target.phone ? " · " + escapeHtml(target.phone as string) : ""}`, `📌 ${STATUS[target.status as string] ?? target.status}${statusDays != null ? ` (${statusDays} дн. в статусе)` : ""}`];
                const row = (label: string, v: unknown) => { if (v)
                    L.push(`${label} ${escapeHtml(String(v))}`); };
                row("🧽", target.service);
                row("🛋", target.what_to_clean);
                row("📐", target.area);
                row("💶", target.budget);
                row("📅", target.when_text);
                row("📍", target.address);
                if (target.scheduled_at)
                    L.push(`🕒 Визит: ${fmtLocal(tz, target.scheduled_at as string)}`);
                if (target.last_contact_at)
                    L.push(`📤 Последний контакт: ${fmtLocal(tz, target.last_contact_at as string)}`);
                row("📊", target.campaign);
                if (tds?.length) {
                    let s = 0, n = 0;
                    for (const d of tds) {
                        s += Number(d.amount);
                        n += Number(d.amount) - Number(d.master_payout) - Number(d.extra_costs);
                    }
                    L.push(`💰 Сделка: ${Ft(s)} · чистыми ${Ft(n)}`);
                }
                else
                    L.push(`💰 Сделки пока нет`);
                for (const t of tts ?? [])
                    L.push(`🔔 ${escapeHtml(t.title)} - ${fmtLocal(tz, t.due_at)}`);
                if (target.notes)
                    L.push(`📝 ${escapeHtml(String(target.notes).slice(0, 300))}`);
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: L.join("\n") });
                return new Response("ok");
            }
            if (r.action === "reactivate") {
                if (r.reactivate?.mode === "stale") {
                    const n = await runStaleSweep(cfg, chatId);
                    if (!n)
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Зависших нет - никто не сидит «В работе»/«Дожим» дольше 2 дней (или всем уже написан follow-up). 👌" });
                    return new Response("ok");
                }
                if (r.reactivate?.mode === "silent_now") {
                    const n = await runSilentSweep(cfg, chatId, 1);
                    if (!n)
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Со вчера все, кому писал, либо ответили, либо им уже напомнили. 👌" });
                    return new Response("ok");
                }
                if (r.reactivate?.mode === "review") {
                    const n = await runReviewSweep(cfg, chatId);
                    if (!n && (cfg.google_review_url || "").trim())
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Все отработанные клиенты уже получили запрос на отзыв (или помечены «не просить»). ⭐" });
                    return new Response("ok");
                }
                if (r.reactivate?.mode === "repeats") {
                    const { data: marks } = await supabase.from("crm_timeline").select("lead_id").ilike("body", "%овторн%");
                    const ids = [...new Set((marks ?? []).map((m) => m.lead_id))];
                    const { data: pool } = ids.length
                        ? await supabase.from("crm_leads").select("*").in("id", ids).not("status", "in", "(won,lost,junk)").neq("phone", "").order("created_at", { ascending: false }).limit(20)
                        : { data: [] };
                    if (!pool?.length) {
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Повторных активных заявок нет - либо их нет, либо все уже закрыты/выиграны. 👌" });
                        return new Response("ok");
                    }
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true, text: `🔁 <b>Повторные заявки: ${pool.length}</b> - оставляли форму больше раза, самые тёплые.\n🔍 - сначала проверить живой чат, затем отдельно подтвердить отправку.` });
                    for (const [i, l] of pool.entries()) {
                        const dg = waDigits(l.phone);
                        const ru = l.language === "ru";
                        const first = ruName(l.name, ru);
                        const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
                        const msgText = ru
                            ? `Здравствуйте${first ? ", " + first : ""}! Это Алекс из ${brandName(l)}. Вижу, вы уже не первый раз оставляете заявку на ${svc} - спасибо за интерес! Расскажите, что нужно (фото помогут), и я посчитаю точную цену за пару минут 🙂`
                            : `Hi${first ? " " + first : ""}! This is Alex from ${brandName(l)}. I see you've reached out more than once about ${svc} - thanks for your interest! Tell me what you need (photos help) and I'll get you an exact price in a couple of minutes 🙂`;
                        const row1: Record<string, unknown>[] = [];
                        if (dg)
                            row1.push({ text: "🔍 Проверить чат", callback_data: `wp:${l.id}` });
                        const row2 = [{ text: "🚫 Нет WhatsApp", callback_data: `s:${l.id}:junk` }];
                        await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true,
                            text: `${i + 1}. <b>${escapeHtml((l.name as string) || "-")}</b> ${ru ? "🇷🇺" : "🇬🇧"} · ${escapeHtml(l.phone as string)} · ${escapeHtml(String(l.what_to_clean || l.service || ""))}${l.budget ? ` · ${escapeHtml(l.budget as string)}` : ""} · 📌 ${STATUS[l.status as string] ?? l.status}`,
                            reply_markup: { inline_keyboard: row1.length ? [row1, row2] : [row2] } });
                    }
                    return new Response("ok");
                }
                const want = Math.min(Math.max(Number(r.reactivate?.count) || 10, 1), 20);
                const followup = r.reactivate?.mode === "followup";
                let pool: Record<string, unknown>[] | null = null;
                let totalPool: number | null = null;
                if (followup) {
                    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
                    ({ data: pool } = await supabase.from("crm_leads").select("*").in("status", ["new", "follow_up"]).not("last_contact_at", "is", null).lt("last_contact_at", weekAgo).neq("phone", "").order("last_contact_at", { ascending: true }).limit(want));
                    ({ count: totalPool } = await supabase.from("crm_leads").select("id", { count: "exact", head: true }).in("status", ["new", "follow_up"]).not("last_contact_at", "is", null).lt("last_contact_at", weekAgo).neq("phone", ""));
                }
                else {
                    const cutoff = new Date(Date.now() - 5 * 864e5).toISOString();
                    const PRIO: Record<string, number> = { upholstery: 0, deep: 0, windows: 1, regular: 1, cleaning: 2 };
                    const { data: raw } = await supabase.from("crm_leads").select("*").in("status", ["new", "follow_up"]).is("reactivated_at", null).is("last_contact_at", null).neq("phone", "").lt("created_at", cutoff).order("created_at", { ascending: false }).limit(400);
                    pool = (raw ?? []).sort((a, b) => {
                        const pa = PRIO[String(a.service)] ?? 3, pb = PRIO[String(b.service)] ?? 3;
                        if (pa !== pb)
                            return pa - pb;
                        return String(b.created_at).localeCompare(String(a.created_at));
                    }).slice(0, want);
                    ({ count: totalPool } = await supabase.from("crm_leads").select("id", { count: "exact", head: true }).in("status", ["new", "follow_up"]).is("reactivated_at", null).is("last_contact_at", null).neq("phone", "").lt("created_at", cutoff));
                }
                if (!pool?.length) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: followup ? "Молчунов для повторного захода пока нет - либо не прошла неделя, либо все отмечены." : "Спящих лидов не осталось - все либо разбужены, либо в работе. 🎉" });
                    return new Response("ok");
                }
                const header = followup
                    ? `✉️ <b>Повторный заход: ${pool.length} шт.</b> (молчат неделю+, всего таких: ${totalPool ?? pool.length})`
                    : `♻️ <b>Реактивация: ${pool.length} шт.</b> (спящих останется: ${Math.max((totalPool ?? pool.length) - pool.length, 0)})`;
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true, text: `${header}\n🔍 - проверить живой чат. После проверки появится отдельная кнопка отправки. Максимум 10 в день.` });
                const pm = promoMonth(cfg.timezone || "Europe/Budapest");
                for (const [i, l] of pool.entries()) {
                    const dg = waDigits(l.phone);
                    const ru = l.language === "ru";
                    const first = ruName(l.name, ru);
                    const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
                    const msgText = followup
                        ? (ru
                            ? `Здравствуйте${first ? ", " + first : ""}! Алекс из ${brandName(l)} - писал вам на прошлой неделе насчёт ${svc}. Просто уточню: ещё актуально? Если сейчас не время - скажите, больше не потревожу 🙂`
                            : `Hi${first ? " " + first : ""}! Alex from ${brandName(l)} here - I messaged you last week about ${svc}. Just following up: still interested? If it's not a good time, let me know 🙂`)
                        : (ru
                            ? `Здравствуйте${first ? ", " + first : ""}! Это Алекс из ${brandName(l)}. Вы оставляли заявку на ${svc}. Сейчас у нас ${pm.ru} акция со скидкой - ещё актуально? Могу посчитать точную цену за 2 минуты 🙂`
                            : `Hi${first ? " " + first : ""}! This is Alex from ${brandName(l)}. You asked about ${svc} a while ago. We have a ${pm.en} promo with a discount right now - still interested? I can give you an exact price in 2 minutes 🙂`);
                    const row1: Record<string, unknown>[] = [];
                    if (dg)
                        row1.push({ text: "🔍 Проверить чат", callback_data: `wp:${l.id}` });
                    const row2: Record<string, unknown>[] = [{ text: "🚫 Нет WhatsApp", callback_data: `s:${l.id}:junk` }];
                    const row3: Record<string, unknown>[] = [
                        { text: "▶️ В работе", callback_data: `s:${l.id}:in_progress` },
                        { text: "⏳ Follow-up", callback_data: `s:${l.id}:follow_up` },
                        { text: "🔥 Дожим", callback_data: `s:${l.id}:pushing` },
                    ];
                    const row4: Record<string, unknown>[] = [
                        { text: "✅ Выиграно", callback_data: `s:${l.id}:won` },
                        { text: "❌ Слив", callback_data: `s:${l.id}:lost` },
                    ];
                    await tg(token, "sendMessage", {
                        chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true,
                        text: `${i + 1}. <b>${escapeHtml((l.name as string) || "-")}</b> ${ru ? "🇷🇺" : "🇬🇧"} · ${escapeHtml(l.phone as string)} · ${escapeHtml(String(l.what_to_clean || l.service || ""))}${l.budget ? ` · ${escapeHtml(l.budget as string)}` : ""}${followup && l.last_contact_at ? `\n📤 писал: ${fmtLocal(tz, l.last_contact_at as string)}` : ""}`,
                        reply_markup: { inline_keyboard: row1.length ? [row1, row2, row3, row4] : [row2, row3, row4] },
                    });
                }
                return new Response("ok");
            }
            if ((r.action === "new_lead" && r.new_lead) || (r.action === "new_leads" && r.new_leads?.length)) {
                const batch: NewLead[] = r.action === "new_leads" ? (r.new_leads ?? []) : [r.new_lead as NewLead];
                const bulk = batch.length > 1;
                let madeCnt = 0, skipCnt = 0;
                const madeNames: string[] = [], skipNames: string[] = [];
                for (const nl of batch) {
                    const phone = (nl.phone || "").trim().replace(/[^\d+]/g, "");
                    const sched = nl.scheduled ? resolveDue(tz, nl.scheduled) : null;
                    let statusOk = nl.status && STATUS_KEYS.includes(nl.status) ? nl.status : "in_progress";
                    if (sched)
                        statusOk = "won";
                    let existing: Record<string, unknown> | null = null;
                    const p9 = phone.replace(/[^0-9]/g, "").slice(-9);
                    if (p9.length >= 7) {
                        existing = (await supabase.from("crm_leads").select("*").ilike("phone", `%${p9}`)
                            .order("created_at", { ascending: false }).limit(1)).data?.[0] ?? null;
                    }
                    if (!bulk && !existing && (nl.name || "").trim().length >= 2)
                        existing = (await supabase.from("crm_leads").select("*").ilike("name", (nl.name || "").trim()).order("created_at", { ascending: false }).limit(1)).data?.[0] ?? null;
                    if (bulk && existing) {
                        skipCnt++;
                        skipNames.push(String(existing.name || phone || "?"));
                        continue;
                    }
                    const keep = (a: unknown, b: unknown) => (a !== undefined && a !== null && a !== "" ? a : (b ?? ""));
                    const fields: Record<string, unknown> = {
                        status: statusOk,
                        name: keep(nl.name, existing?.name),
                        phone: keep(phone, existing?.phone),
                        language: nl.language || (existing?.language as string) || (/[а-яё]/i.test(text) ? "ru" : "en"),
                        service: keep(nl.service, existing?.service),
                        what_to_clean: keep(nl.what_to_clean, existing?.what_to_clean),
                        area: keep(nl.area, existing?.area),
                        budget: keep(nl.budget, existing?.budget),
                        contact_method: keep(nl.contact_method, existing?.contact_method),
                        address: keep(nl.address, existing?.address),
                        when_text: keep(nl.when_text, existing?.when_text),
                        scheduled_at: sched ? sched.toISOString() : (existing?.scheduled_at ?? null),
                        raw_text: bulk ? [nl.name, phone, nl.what_to_clean, nl.address, nl.when_text].filter(Boolean).join(" · ").slice(0, 600) : text.slice(0, 6000),
                    };
                    let created: Record<string, unknown> | null;
                    const isUpdate = !!existing;
                    let askSource = false;
                    if (existing) {
                        await supabase.from("crm_leads").update(fields).eq("id", existing.id);
                        created = { ...existing, ...fields };
                    }
                    else {
                        const src = SOURCES.has(String(nl.source || "")) ? String(nl.source) : "manual";
                        askSource = src === "manual";
                        created = (await supabase.from("crm_leads").insert({ ...fields, campaign: nl.campaign || "", source: src }).select("*").single()).data;
                    }
                    if (!created) {
                        if (bulk) {
                            skipCnt++;
                            skipNames.push(String(nl.name || phone || "?"));
                            continue;
                        }
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Не смог создать карточку, попробуй ещё раз." });
                        return new Response("ok");
                    }
                    if (bulk) {
                        madeCnt++;
                        madeNames.push(String(created.name || created.phone || "?"));
                    }
                    else
                        await saveActiveLead(chatId, created.id as string);
                    await supabase.from("crm_timeline").insert({ lead_id: created.id, kind: isUpdate ? "note" : "lead_created", body: isUpdate ? "Обновлено из переписки" : "Заведён вручную из переписки" });
                    if (nl.summary)
                        await supabase.from("crm_timeline").insert({ lead_id: created.id, kind: "whatsapp_summary", body: nl.summary, meta: { price_quoted: nl.price_quoted ?? null, agreed_amount: nl.agreed_amount ?? null } });
                    if (isUpdate && created.tg_message_id) {
                        await refreshCard(token, cfg, created);
                    }
                    else if (cfg.cards_chat_id) {
                        const sent = await tg(token, "sendMessage", { chat_id: cfg.cards_chat_id, text: cardText(created), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: statusKeyboard(created.id as string, cfg.dashboard_public_base || "", cfg.dashboard_secret || "", created) });
                        const sres = sent?.result as {
                            chat?: {
                                id?: number;
                            };
                            message_id?: number;
                        } | undefined;
                        if (sres?.message_id) {
                            await supabase.from("crm_leads").update({ tg_chat_id: sres.chat?.id, tg_message_id: sres.message_id }).eq("id", created.id);
                            created.tg_chat_id = sres.chat?.id;
                            created.tg_message_id = sres.message_id;
                        }
                    }
                    let due: Date | null = null;
                    if (nl.next_action) {
                        due = resolveDue(tz, nl.due);
                        await createTask(created.id as string, nl.next_action, due, "из переписки", "ai");
                    }
                    if (askSource)
                        await createTask(created.id as string, "Спросить у клиента, откуда он нас нашёл: Facebook, Google или по рекомендации", null, "источник не назван в переписке", "ai");
                    let dealLine = "";
                    const dealAmt = nl.deal?.amount || nl.agreed_amount || 0;
                    const hasDeal = isUpdate ? (((await supabase.from("crm_deals").select("id").eq("lead_id", created.id).limit(1)).data?.length ?? 0) > 0) : false;
                    if (dealAmt > 0 && !hasDeal) {
                        try {
                            const rdeal = await createDeal(created, cfg, { amount: dealAmt, master_name: nl.deal?.master_name || "", master_pct: null, extra_costs: nl.deal?.extra_costs ?? null, extra_costs_note: nl.deal?.extra_costs_note || "", service_done: nl.what_to_clean || "" });
                            const updated = await applyStatus(token, cfg, created, "won");
                            created.status = "won";
                            await refreshCard(token, cfg, updated);
                            dealLine = `💰 Сделка: ${Ft(rdeal.amount)} · чистыми ${Ft(rdeal.net)}`;
                        }
                        catch (e) {
                            dealLine = `⚠️ ${(e as Error).message} - впиши сумму на карточке в дашборде`;
                        }
                    }
                    let woSent = "";
                    if (created.status === "won" && nl.work_order) {
                        const { data: crewRows } = await supabase.from("crm_masters")
                            .select("id,name,tg_chat_id,active,can_report_payouts,closes_own_jobs").eq("active", true).not("tg_chat_id", "is", null);
                        const crew = (crewRows ?? []) as Array<Record<string, unknown>>;
                        const assigned = crew.find((m) => String(m.id) === String(created.assigned_master_id ?? ""));
                        const own = created.service === "upholstery" ? crew.filter((m) => m.closes_own_jobs === true) : [];
                        const target = assigned ?? (own.length === 1 ? own[0] : selectMariaRecipient(crew as ClosureMaster[]));
                        if (target?.tg_chat_id) {
                            const sentWo = await tg(token, "sendMessage", {
                                chat_id: target.tg_chat_id, text: nl.work_order, disable_web_page_preview: true,
                                reply_markup: { inline_keyboard: [[{ text: "✅ Принял заказ / Accepted", callback_data: `acc:${created.id}` }]] },
                            });
                            if (sentWo?.ok) {
                                woSent = String(target.name ?? "");
                                await supabase.from("crm_leads").update({
                                    master_notified_at: new Date().toISOString(), master_brief: nl.work_order,
                                    ...(created.assigned_master_id ? {} : { assigned_master_id: target.id }),
                                }).eq("id", created.id);
                            }
                        }
                    }
                    if (!bulk) {
                        const L = [isUpdate ? "♻️ <b>Обновил карточку (клиент уже был в CRM)</b>" : "🆕 <b>Завёл карточку из переписки</b>", "", `👤 <b>${escapeHtml(created.name as string) || "-"}</b>${created.phone ? " · " + escapeHtml(created.phone as string) : ""}`];
                        if (nl.summary)
                            L.push(escapeHtml(nl.summary));
                        if (created.when_text)
                            L.push(`📅 ${escapeHtml(created.when_text as string)}`);
                        if (created.address)
                            L.push(`📍 ${escapeHtml(created.address as string)}`);
                        L.push(`📌 Статус: <b>${STATUS[created.status as string] ?? created.status}</b>`);
                        if (nl.next_action)
                            L.push(`🔔 ${escapeHtml(nl.next_action)} (${fmtLocal(tz, due ? due.toISOString() : null)})`);
                        if (dealLine)
                            L.push(dealLine);
                        if (woSent)
                            L.push(`📋 Рабочий ордер отправлен лично: ${escapeHtml(woSent)}`);
                        else if (created.status === "won" && nl.work_order)
                            L.push("⚠️ Рабочий ордер НЕ отправлен: не нашёл исполнителя с Телеграмом. Отправь заказ мастеру из карточки.");
                        await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: L.filter(Boolean).join("\n") });
                    }
                }
                if (bulk) {
                    const S = ["🆕 <b>Разобрал пачку</b>", "", `Заведено: <b>${madeCnt}</b> из ${batch.length}`];
                    if (madeNames.length)
                        S.push(madeNames.map((n) => `• ${escapeHtml(n)}`).join("\n"));
                    if (skipCnt)
                        S.push("", `Пропущено, уже в CRM: <b>${skipCnt}</b>`, skipNames.map((n) => `• ${escapeHtml(n)}`).join("\n"));
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: S.filter(Boolean).join("\n") });
                }
                return new Response("ok");
            }
            const needLead = ["analyze_chat", "deal", "status", "note", "notify_master"].includes(r.action) || (r.action === "task" && !!lead);
            if (needLead && !lead) {
                await tg(token, "sendMessage", { chat_id: chatId, text: "Пришли переписку или данные клиента (имя, телефон, что нужно) - я сам заведу карточку. Либо ответь (reply) на существующую карточку." });
                return new Response("ok");
            }
            if (r.action === "analyze_chat" && lead && r.analysis) {
                const a = r.analysis;
                const upd: Record<string, unknown> = {};
                if (a.status && STATUS_KEYS.includes(a.status))
                    upd.status = a.status;
                if (a.address)
                    upd.address = a.address;
                if (a.when_text)
                    upd.when_text = a.when_text;
                const asched = a.scheduled ? resolveDue(tz, a.scheduled) : null;
                if (asched)
                    upd.scheduled_at = asched.toISOString();
                if (Object.keys(upd).length)
                    await supabase.from("crm_leads").update(upd).eq("id", lead.id);
                await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "whatsapp_summary", body: a.summary ?? "", meta: { price_quoted: a.price_quoted ?? null, agreed_amount: a.agreed_amount ?? null, sentiment: a.sentiment ?? null } });
                let due: Date | null = null;
                if (a.next_action) {
                    due = resolveDue(tz, a.due);
                    await createTask(lead.id as string, a.next_action, due, "из анализа переписки", "ai");
                }
                const merged = { ...lead, ...upd };
                await refreshCard(token, cfg, merged);
                let dealNote = "";
                const agreedAmt = Number(a.agreed_amount || 0);
                if (agreedAmt > 0 && merged.status === "won") {
                    const hasDeal = ((await supabase.from("crm_deals").select("id").eq("lead_id", lead.id).limit(1)).data?.length ?? 0) > 0;
                    if (!hasDeal) {
                        try {
                            const rd = await createDeal(merged, cfg, { amount: agreedAmt, master_name: "", master_pct: null, extra_costs: null, extra_costs_note: "", service_done: String(merged.what_to_clean || merged.service || "") });
                            dealNote = `💰 Сделка записана: ${Ft(rd.amount)} · чистыми ${Ft(rd.net)} (мастер не назначен, ${rd.pct}% по умолчанию - скажи «мастер X», поправлю)`;
                        }
                        catch (e) {
                            dealNote = `⚠️ ${(e as Error).message}`;
                        }
                    }
                }
                const L = ["🧠 <b>Разобрал переписку</b>", "", `👤 ${escapeHtml(lead.name as string) || "-"}`, a.summary ? escapeHtml(a.summary) : ""];
                if (a.status && STATUS[a.status])
                    L.push(`📌 Статус: <b>${STATUS[a.status]}</b>`);
                if (a.address)
                    L.push(`📍 ${escapeHtml(a.address)}`);
                if (a.when_text)
                    L.push(`📅 ${escapeHtml(a.when_text)}`);
                if (a.price_quoted)
                    L.push(`💬 Озвучена цена: ${Ft(a.price_quoted)}`);
                if (a.agreed_amount)
                    L.push(`🤝 Договорились: <b>${Ft(a.agreed_amount)}</b>`);
                if (a.next_action)
                    L.push(`🔔 Задача: ${escapeHtml(a.next_action)} - ${fmtLocal(tz, due ? due.toISOString() : null)}`);
                if (dealNote)
                    L.push(dealNote);
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: L.filter(Boolean).join("\n") });
                return new Response("ok");
            }
            if (r.action === "task") {
                const due = resolveDue(tz, r.task?.due);
                const title = r.task?.title || "Перезвонить клиенту";
                await createTask(lead ? (lead.id as string) : null, title, due, r.task?.reason ?? "", "manual");
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `🔔 Задача: <b>${escapeHtml(title)}</b>\n🕒 ${fmtLocal(tz, due ? due.toISOString() : null)}${lead ? `\n👤 ${escapeHtml(lead.name as string)}` : ""}` });
                return new Response("ok");
            }
            if (r.action === "notify_master" && lead) {
                if (!ownerId || String(fromId) !== ownerId) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: "⛔ Отправлять задания мастерам может только владелец." });
                    return new Response("ok");
                }
                const result = await notifyAssignedMaster(cfg, lead);
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: result.ok
                        ? `📨 Заказ <b>${escapeHtml(String(lead.name ?? ""))}</b> повторно отправлен мастеру <b>${escapeHtml(result.master ?? "")}</b>. Жду подтверждения.`
                        : `⚠️ Не смог отправить заказ <b>${escapeHtml(String(lead.name ?? ""))}</b>: ${escapeHtml(result.reason ?? "неизвестная ошибка")}.` });
                return new Response("ok");
            }
            if (r.action === "deal" && lead && r.deal) {
                const d = r.deal;
                const existingDeal = (await supabase.from("crm_deals").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1)).data?.[0];
                if (existingDeal) {
                    const upd: Record<string, unknown> = {};
                    const amount = d.amount && d.amount > 0 ? Number(d.amount) : Number(existingDeal.amount);
                    if (d.amount && d.amount > 0)
                        upd.amount = amount;
                    let pct: number | null = d.master_pct ?? null;
                    if (d.master_name) {
                        let { data: ms } = await supabase.from("crm_masters").select("*").ilike("name", `%${d.master_name}%`).limit(1);
                        if (!ms?.length)
                            ({ data: ms } = await supabase.from("crm_masters").select("*").ilike("name", `%${translit(d.master_name)}%`).limit(1));
                        if (ms?.length) {
                            upd.master_id = ms[0].id;
                            if (pct == null)
                                pct = Number(ms[0].default_pct);
                        }
                    }
                    const eSplits = (d.master_splits ?? []).filter((x) => Number(x?.amount) > 0);
                    if (eSplits.length) {
                        upd.master_payout = eSplits.reduce((sum, x) => sum + Math.round(Number(x.amount)), 0);
                        upd.master_name = eSplits.map((x) => `${x.name ?? "?"} ${Ft(Math.round(Number(x.amount)))}`).join(" · ");
                        upd.master_pct = null;
                        const { data: fm } = await supabase.from("crm_masters").select("id").ilike("name", `%${eSplits[0].name ?? ""}%`).limit(1);
                        if (fm?.length)
                            upd.master_id = fm[0].id;
                    }
                    else if (pct != null) {
                        upd.master_pct = pct;
                        upd.master_payout = Math.round((amount * pct) / 100);
                    }
                    else if (upd.amount != null && existingDeal.master_pct != null) {
                        upd.master_payout = Math.round((amount * Number(existingDeal.master_pct)) / 100);
                    }
                    if (d.extra_costs != null)
                        upd.extra_costs = Number(d.extra_costs);
                    if (d.extra_costs_note)
                        upd.extra_costs_note = d.extra_costs_note;
                    if (d.service_done)
                        upd.service_done = d.service_done;
                    if (!Object.keys(upd).length) {
                        await tg(token, "sendMessage", { chat_id: chatId, text: "Не понял, что поменять в сделке. Скажи, например: «мастер Иван 50 на 50», «сумма 25000», «+5000 бензин»." });
                        return new Response("ok");
                    }
                    await supabase.from("crm_deals").update(upd).eq("id", existingDeal.id);
                    const fin = { ...existingDeal, ...upd } as Record<string, unknown>;
                    const net = Number(fin.amount) - Number(fin.master_payout) - Number(fin.extra_costs ?? 0);
                    let mName = String(fin.master_name || "");
                    if (!mName && fin.master_id) {
                        const { data: mm } = await supabase.from("crm_masters").select("name").eq("id", fin.master_id).limit(1);
                        mName = mm?.[0]?.name ?? "";
                    }
                    await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: `Сделка изменена: ${Ft(Number(fin.amount))}${mName ? ` · мастерам ${mName}${fin.master_pct ? ` (${fin.master_pct}%)` : ""}` : ""}${Number(fin.extra_costs) ? ` · доп ${Ft(Number(fin.extra_costs))}` : ""}` });
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `✏️ <b>Сделка обновлена</b>\n👤 ${escapeHtml(lead.name as string)}\n💰 Сумма: ${Ft(Number(fin.amount))}${mName ? `\n🧹 Мастера: ${escapeHtml(mName)} - всего ${Ft(Number(fin.master_payout))}${fin.master_pct ? ` (${fin.master_pct}%)` : ""}` : ""}${Number(fin.extra_costs) ? `\n⛽ Доп: ${Ft(Number(fin.extra_costs))}` : ""}\n📈 Чистыми: <b>${Ft(net)}</b>` });
                    return new Response("ok");
                }
                if (!d.amount || d.amount <= 0) {
                    if (d.master_name) {
                        let { data: ms } = await supabase.from("crm_masters").select("*").ilike("name", `%${d.master_name}%`).limit(1);
                        if (!ms?.length)
                            ({ data: ms } = await supabase.from("crm_masters").select("*").ilike("name", `%${translit(d.master_name)}%`).limit(1));
                        if (ms?.length) {
                            await supabase.from("crm_leads").update({ assigned_master_id: ms[0].id, updated_at: new Date().toISOString() }).eq("id", lead.id);
                            await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: `🧹 Мастер назначен: ${ms[0].name}` });
                            await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `🧹 Мастер <b>${escapeHtml(ms[0].name)}</b> назначен: ${escapeHtml(lead.name as string)}${lead.scheduled_at ? ` · визит ${fmtLocal(tz, lead.scheduled_at as string)}` : ""}` });
                            return new Response("ok");
                        }
                    }
                    await tg(token, "sendMessage", { chat_id: chatId, text: "Скажи сумму сделки, например: «закрыли на 30000 мастер Даша»." });
                    return new Response("ok");
                }
                let res;
                try {
                    res = await createDeal(lead, cfg, d);
                }
                catch (e) {
                    await tg(token, "sendMessage", { chat_id: chatId, text: `⚠️ ${(e as Error).message}. Проверь сумму и расходы, попробуй ещё раз.` });
                    return new Response("ok");
                }
                const updated = await applyStatus(token, cfg, lead, "won");
                await refreshCard(token, cfg, updated);
                await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `✅ <b>Сделка записана</b>\n💰 Сумма: ${Ft(res.amount)}\n🧹 Мастер: ${Ft(res.payout)} (${res.pct}%)${res.extra ? `\n⛽ Доп: ${Ft(res.extra)}` : ""}\n📈 Чистыми: <b>${Ft(res.net)}</b>` });
                if (res.deal?.id && !String(res.deal.service_done || "").trim()) {
                    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML",
                        text: `🏷 Какая услуга по этой сделке? (для точной маржи по направлениям)`,
                        reply_markup: { inline_keyboard: [[
                                    { text: "🛋 Химчистка", callback_data: `svc:${res.deal.id}:upholstery` },
                                    { text: "🧹 Клининг", callback_data: `svc:${res.deal.id}:cleaning` },
                                    { text: "🪟 Окна", callback_data: `svc:${res.deal.id}:windows` },
                                ]] } });
                }
                return new Response("ok");
            }
            if (r.action === "status" && lead && r.status) {
                await applyStatus(token, cfg, lead, r.status);
                await tg(token, "sendMessage", { chat_id: chatId, text: `📌 Статус: ${STATUS[r.status] ?? r.status}` });
                return new Response("ok");
            }
            if (r.action === "note" && lead && r.note) {
                await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: r.note });
                const prev = String(lead.notes ?? "");
                await supabase.from("crm_leads").update({ notes: prev ? `${prev}\n${r.note}` : r.note }).eq("id", lead.id);
                await tg(token, "sendMessage", { chat_id: chatId, text: "📝 Записал в карточку." });
                return new Response("ok");
            }
            await tg(token, "sendMessage", { chat_id: chatId, text: r.reply || "Принято." });
            return new Response("ok");
        }
        catch (e) {
            console.error("bot error", e);
            return new Response("ok");
        }
    });
