import { cancelMasterJobs } from "../_shared/cancel_jobs.ts";
import { gbpReply, gbpToken, replyProblem } from "../_shared/gbp.ts";
import { jobDone, reviewCity, reviewRequestText, reviewWaUrl } from "../_shared/review_request.ts";
import { makatiView, makatiUpdate } from './makati.ts';
import { adByDirDay, adCampaigns, buildAnalytics, buildDirections, buildDirMonths, countedAdRows, generalExpensesByDay, renderAnalytics, shiftDay, spanDays, spreadByDay, type Deal, type Lead, type Mode } from "./analytics.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { firstTouchText, brandName, closingText, ruName, waButtonUrl, waDigits, SVC_RU, SVC_EN } from "../_shared/first_touch.ts";
import { computePayout } from "./payout.ts";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const STATUS: Record<string, string> = { new: "Новый", contacted: "📨 Написал, ждём ответа", in_progress: "В работе", follow_up: "Follow-up", pushing: "Дожим", won: "✅ Выиграно", lost: "❌ Слив", junk: "🚫 Нет связи" };
const STATUS_KEYS = Object.keys(STATUS);
const HIRE: Record<string, string> = { new: "Новая анкета", contacted: "📨 Написали, ждём ответа", screening: "📋 Отвечает, уточняем", trial: "🧪 Пробный выезд назначен", won: "✅ Работает", no_show: "🙈 Не пришла", lost: "❌ Не подходит", junk: "🚫 Нет связи" };
const HIRE_KEYS = Object.keys(HIRE);
const HIRE_COLOR: Record<string, string> = { new: "#3b82f6", contacted: "#7c3aed", screening: "#0ea5e9", trial: "#d4740e", won: "#2d6a4f", no_show: "#b45309", lost: "#9ca3af", junk: "#78716c" };
const DOW_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const EXP: Record<string, string> = { none: "🔴 без опыта, обучать", pair: "🟡 опыт есть, в пару", solo: "🟢 можно одну" };
const expOpts = (sel: unknown) => Object.entries(EXP).map(([v, l]) => `<option value="${v}" ${String(sel || "none") === v ? "selected" : ""}>${l}</option>`).join("");
const daysLabel = (wd: unknown): string => { const a = (wd as number[] | null) ?? []; return a.length ? [...a].sort((x, y) => x - y).map((d) => DOW_RU[d - 1]).join(", ") : "—"; };
function sourceLabel(a: unknown): string {
    if (!a || typeof a !== "object" || Array.isArray(a))
        return "";
    const o = a as Record<string, unknown>;
    const utm = String(o.utm_source ?? "").trim();
    if (utm) {
        const med = String(o.utm_medium ?? "").trim();
        return med ? `${utm} / ${med}` : utm;
    }
    const ref = String(o.referrer ?? "").trim();
    if (!ref)
        return (o.first_seen || o.landing) ? "прямой заход" : "";
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
const STATUS_COLOR: Record<string, string> = { new: "#3b82f6", contacted: "#7c3aed", in_progress: "#0ea5e9", follow_up: "#f59e0b", pushing: "#d4740e", won: "#2d6a4f", lost: "#9ca3af", junk: "#78716c" };
const EN: Record<string, string> = {
    "Доска": "Board", "Календарь": "Calendar", "Кандидаты": "Applicants", "Маржа": "Margin", "Аналитика": "Analytics",
    "Отработанные": "Closed jobs", "Мастера": "Cleaners", "Экспорт": "Export",
    "Фото работ": "Job photos", "Все": "All", "ДО": "BEFORE", "ПОСЛЕ": "AFTER", "скачать": "download",
    "Пока ни одной работы не сфотографировали.": "No job has been photographed yet.",
    "Свежие сверху. Показано клиентов": "Newest first. Clients shown",
    "Ссылка «скачать» отдаёт файл на диск, годен для карточки Google.": "The download link saves the file, ready for the Google profile.",
    "нет фото ДО - работу не показать как «до и после»": "no BEFORE photo - this job cannot be shown as before/after",
    "Доступы": "Users", "Выход": "Log out", "На главную (Доска)": "Back to the board",
    "Вход": "Sign in", "Логин": "Username", "Пароль": "Password", "Войти": "Sign in",
    "Новый": "New", "В работе": "In progress", "Дожим": "Pushing",
    "✅ Выиграно": "✅ Won", "❌ Слив": "❌ Lost", "🚫 Нет связи": "🚫 No contact",
    "Всего лидов": "Leads total", "Выиграно": "Won", "Выручка": "Revenue",
    "Чистыми (без рекламы)": "Net (excl. ads)",
    "Выиграно, но чек не вписан": "Won, but no amount entered",
    "без имени": "no name",
    "открой карточку и внеси сумму в «Закрыть сделку», иначе выручка занижена.": "open the card and enter the amount under «Close deal», otherwise revenue is understated.",
    "пусто": "empty",
    "🔎 Поиск по имени или телефону...": "🔎 Search by name or phone...",
    "найдено: ": "found: ",
    "Написать в WhatsApp": "Message on WhatsApp",
    "дн.": "d", "дн. в статусе": "d in status", "писал": "wrote",
};
let LANG: "ru" | "en" = "ru";
function t(s: string): string { return LANG === "en" ? (EN[s] ?? s) : s; }
function setLangJs(to: "ru" | "en"): string {
    return `event.preventDefault();document.cookie='crm_lang=${to};path=/;max-age=31536000;samesite=lax';location.reload()`;
}
type Cfg = Record<string, string>;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const Ft = (n: number) => fmt(n) + " Ft";
const flag = (l: string) => (l === "ru" ? "🇷🇺" : l === "en" ? "🇬🇧" : "");
async function getConfig(): Promise<Cfg> {
    const { data } = await supabase.from("crm_app_config").select("key,value");
    return Object.fromEntries((data ?? []).map((r: {
        key: string;
        value: string;
    }) => [r.key, r.value]));
}
function spendToHuf(amount: number, currency: string, cfg: Cfg): number {
    const c = (currency || "HUF").toUpperCase();
    if (c === "HUF" || c === (cfg.base_currency || "HUF"))
        return amount;
    if (c === "EUR")
        return amount * Number(cfg.fx_eur_huf || 395);
    if (c === "USD")
        return amount * Number(cfg.fx_usd_huf || 360);
    return amount;
}
function tzOffsetMs(tz: string, date: Date): number {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime();
}
function localToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number): Date {
    const g = Date.UTC(y, mo - 1, d, h, mi, 0);
    return new Date(g - tzOffsetMs(tz, new Date(g)));
}
function dtLocalToUtc(tz: string, v: string): Date | null {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m)
        return null;
    return localToUtc(tz, +m[1], +m[2], +m[3], +m[4], +m[5]);
}
function fmtLocal(tz: string, iso: string | null): string {
    if (!iso)
        return "-";
    return new Intl.DateTimeFormat(LANG === "en" ? "en-GB" : "ru-RU", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function ageDays(iso: string): number { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }
async function sha256Hex(s: string): Promise<string> {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(secret: string, s: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(s));
    return Array.from(new Uint8Array(mac)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hashPassword(secret: string, username: string, password: string): Promise<string> {
    return sha256Hex(`${secret}|${username.toLowerCase()}|${password}`);
}
function b64u(s: string): string { const bytes = new TextEncoder().encode(s); let bin = ""; for (const b of bytes)
    bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64uDec(s: string): string { try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
catch {
    return "";
} }
async function makeSession(secret: string, payload: Record<string, unknown>): Promise<string> {
    const body = b64u(JSON.stringify(payload));
    return `${body}.${(await hmacHex(secret, body)).slice(0, 32)}`;
}
async function readSession(secret: string, token: string): Promise<Record<string, unknown> | null> {
    if (!token || !token.includes("."))
        return null;
    const [body, sig] = token.split(".");
    if ((await hmacHex(secret, body)).slice(0, 32) !== sig)
        return null;
    try {
        const p = JSON.parse(b64uDec(body));
        if (p.exp && Date.now() > p.exp)
            return null;
        return p;
    }
    catch {
        return null;
    }
}
function getCookie(req: Request, name: string): string {
    const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : "";
}
type Auth = {
    role: "full" | "master" | "marketer" | "supervisor";
    masterId?: string | null;
    username?: string;
    viaKey?: boolean;
};
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else
                    q = false;
            }
            else
                cur += ch;
        }
        else if (ch === '"')
            q = true;
        else if (ch === ",") {
            row.push(cur);
            cur = "";
        }
        else if (ch === "\n") {
            row.push(cur);
            rows.push(row);
            row = [];
            cur = "";
        }
        else if (ch === "\r") { }
        else
            cur += ch;
    }
    if (cur.length || row.length) {
        row.push(cur);
        rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvRow = (arr: unknown[]) => arr.map(csvCell).join(",");
interface Analysis {
    summary?: string;
    status?: string;
    booked?: boolean;
    price_quoted?: number | null;
    agreed_amount?: number | null;
    next_action?: string;
    due?: {
        date?: string | null;
        time?: string | null;
        in_days?: number | null;
        in_hours?: number | null;
    };
    sentiment?: string;
}
async function analyzeChat(apiKey: string, todayLocal: string, tz: string, lead: Record<string, unknown>, chat: string): Promise<Analysis> {
    const system = `You analyze a WhatsApp/Telegram conversation between a cleaning company (CLB Cleaning Budapest) and a client, and return ONE JSON object (no markdown). Today: ${todayLocal} (${tz}). Money is HUF.
Lead: name=${lead.name}, status=${lead.status}, service=${lead.service}.
Return: { "summary": 1-2 sentences in Russian, "status": one of [new,in_progress,follow_up,pushing,won,lost], "booked": true ONLY if the client confirmed the order (agreed to go ahead) AND a concrete visit date/time is set; else false, "price_quoted": number|null, "agreed_amount": number|null (only if clearly agreed), "next_action": short Russian phrase or "", "due": {"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"in_days":int|null,"in_hours":int|null}, "sentiment": "hot"|"warm"|"cold" }
Rule: if booked is true, status MUST be "won" and "due" MUST be the visit date/time. A future visit date is still "won" (the order is locked in).`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 700, system, messages: [{ role: "user", content: chat.slice(0, 12000) }] }),
    });
    if (!res.ok)
        throw new Error(`Claude ${res.status}`);
    const data = await res.json();
    return JSON.parse(String(data.content?.[0]?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()) as Analysis;
}
interface Payout {
    master_payout: number;
    extra_costs: number;
    hours: number | null;
    breakdown: string;
}
async function parsePayoutNote(apiKey: string, amount: number, note: string): Promise<Payout> {
    const system = `You read a short free-form Russian note about ONE finished cleaning job and return ONE JSON object, no markdown.
The job's revenue (what the CLIENT paid) is ${amount} HUF and is already known. NEVER count it as a payout, even when the note repeats it.
Extract only money the COMPANY PAID OUT.
Return: {"master_payout": number, "extra_costs": number, "hours": number|null, "breakdown": string}
- master_payout: total paid to ALL cleaners together.
- extra_costs: taxi, petrol, parking, materials. 0 if none.
- hours: total man-hours across all cleaners, null if not stated.
- breakdown: one short Russian line naming who got what, e.g. "Оля 7ч 21к · Мария 4ч 12к · такси 4к".
Rules: "7 часов по 3 тысячи" = 7*3000 = 21000. "21 тысячи" = 21000. "12к" = 12000. "3 тыс" = 3000.
If the note says nothing about payouts, return zeros and an empty breakdown.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, system, messages: [{ role: "user", content: note.slice(0, 4000) }] }),
    });
    if (!res.ok)
        throw new Error(`Claude ${res.status}`);
    const data = await res.json();
    return JSON.parse(String(data.content?.[0]?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()) as Payout;
}
function resolveDue(tz: string, due: Analysis["due"]): Date | null {
    if (!due)
        return null;
    const now = new Date();
    if (due.in_hours && !due.date && due.in_days == null)
        return new Date(now.getTime() + due.in_hours * 3600000);
    const np = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
    let y = +np.year, mo = +np.month, d = +np.day;
    if (due.date && /^\d{4}-\d{2}-\d{2}$/.test(due.date)) {
        const [a, b, c] = due.date.split("-").map(Number);
        y = a;
        mo = b;
        d = c;
    }
    else if (due.in_days != null) {
        const base = new Date(localToUtc(tz, y, mo, d, 12, 0).getTime() + due.in_days * 86400000);
        const sp = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(base).map((x) => [x.type, x.value])) as Record<string, string>;
        y = +sp.year;
        mo = +sp.month;
        d = +sp.day;
    }
    else if (!due.time)
        return null;
    let h = 10, mi = 0;
    if (due.time && /^\d{1,2}:\d{2}$/.test(due.time)) {
        const [hh, mm] = due.time.split(":").map(Number);
        h = hh;
        mi = mm;
    }
    return localToUtc(tz, y, mo, d, h, mi);
}
async function offerClosingTg(cfg: Cfg, lead: Record<string, unknown>, kind: "junk" | "lost") {
    const token = cfg.telegram_bot_token, chat = cfg.owner_tg_id;
    const digits = waDigits(lead.phone);
    if (!token || !chat || !digits)
        return;
    const text = closingText(lead, kind);
    const head = kind === "junk" ? "🚫 нет связи" : "❌ слив";
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
            chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
            text: [`<b>${esc(lead.name)}</b>: ${head}.`, "", "Последнее сообщение готово, текст уже набран:", `<i>${esc(text.slice(0, 320))}…</i>`].join("\n"),
            reply_markup: { inline_keyboard: [[{ text: kind === "junk" ? "💬 Отправить прощание" : "💬 Отправить закрытие", url: waButtonUrl(lead.phone, text) }]] },
        }),
    }).catch(() => { });
}
async function refreshCardTg(cfg: Cfg, lead: Record<string, unknown>) {
    const token = cfg.telegram_bot_token;
    if (!token || !lead.tg_chat_id || !lead.tg_message_id)
        return;
    const fl = flag(lead.language as string);
    const L: string[] = [`🎯 <b>Заявка</b> ${fl}`, "", `👤 <b>${esc(lead.name)}</b>`];
    if (lead.phone)
        L.push(`📞 ${esc(lead.phone)}`);
    L.push("");
    const row = (lbl: string, v: unknown) => { if (v)
        L.push(`${lbl} ${esc(v)}`); };
    row("🧽 Услуга:", lead.service);
    row("🛋 Что чистим:", lead.what_to_clean);
    row("📐 Площадь:", lead.area);
    row("💶 Бюджет:", lead.budget);
    row("📅 Когда:", lead.when_text);
    row("💬 Связь:", lead.contact_method);
    if (lead.campaign) {
        L.push("");
        L.push(`📊 ${esc(lead.campaign)}`);
    }
    L.push("", `📌 Статус: <b>${STATUS[lead.status as string] ?? lead.status}</b>`);
    const base = cfg.dashboard_public_base || "";
    const kb = { inline_keyboard: [
            [{ text: "В работе", callback_data: `s:${lead.id}:in_progress` }, { text: "Follow-up", callback_data: `s:${lead.id}:follow_up` }, { text: "Дожим", callback_data: `s:${lead.id}:pushing` }],
            [{ text: "✅ Выиграно", callback_data: `s:${lead.id}:won` }, { text: "❌ Слив", callback_data: `s:${lead.id}:lost` }],
            ...(base ? [[{ text: "🔗 Открыть карточку", url: `${base}/?key=${encodeURIComponent(cfg.dashboard_secret || "")}&lead=${lead.id}` }]] : []),
        ] };
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: lead.tg_chat_id, message_id: lead.tg_message_id, text: L.join("\n"), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb }) });
}
async function sendClientPhotos(cfg: Cfg, leadId: string, chatId: unknown, lang: string): Promise<void> {
    if (!cfg.telegram_bot_token || !chatId)
        return;
    const { data: ph } = await supabase.from("crm_job_photos").select("tg_file_id").eq("lead_id", leadId).eq("phase", "client").neq("tg_file_id", "").order("created_at", { ascending: true }).limit(10);
    if (!ph?.length)
        return;
    const cap = lang === "en" ? "📷 Photos from the client" : "📷 Фото от клиента";
    try {
        await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMediaGroup`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, media: ph.map((p, i) => ({ type: "photo", media: p.tg_file_id, ...(i === 0 ? { caption: cap } : {}) })) }),
        });
    }
    catch (e) {
        console.error("client photos", e);
    }
}
async function sendMasterJobDM(cfg: Cfg, lead: Record<string, unknown>, master: Record<string, unknown> | null | undefined, tz: string, slot?: {
    idx: number;
    brief: string;
    sum: string;
    pay: string;
}): Promise<boolean> {
    if (!master?.tg_chat_id || !cfg.telegram_bot_token)
        return false;
    const T = String(master.language ?? "") === "en"
        ? { head: "New job", noDate: "date to be confirmed", noAddr: "address to be confirmed", job: "cleaning",
            takePart: "💵 Collect from the client for your part", takeAll: "💵 Collect from the client",
            sum: "💵 Client pays", you: "💰 You get", youHint: "💰 Your pay", details: "Details", hrs: "h",
            hourly: (r: string) => `hourly ${r}/h`, pct: (p: unknown) => `${p}% of the order`,
            split: "The job is split between two crews, another cleaner will be there too." }
        : { head: "Новый заказ", noDate: "дату уточнят", noAddr: "адрес уточнят", job: "уборка",
            takePart: "💵 Взять с клиента за эту часть", takeAll: "💵 Взять с клиента",
            sum: "💵 Сумма с клиента", you: "💰 Тебе", youHint: "💰 Оплата тебе", details: "Детали", hrs: "ч",
            hourly: (r: string) => `почасово ${r}/ч`, pct: (p: unknown) => `${p}% от суммы`,
            split: "Заказ поделён между бригадами, на месте будет ещё одна." };
    const payHint = master.pay_type === "hourly" ? T.hourly(Ft(Number(master.hourly_rate))) : T.pct(master.default_pct);
    const { data: dl } = await supabase.from("crm_deals").select("amount,master_payout,master_pct,hours").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1);
    const deal = dl?.[0];
    const money: string[] = [];
    if (slot) {
        if (slot.sum.trim())
            money.push(`${T.takePart}: <b>${esc(slot.sum)}</b>`);
        money.push(slot.pay?.trim() ? `${T.you}: <b>${esc(slot.pay)}</b>` : `${T.youHint}: ${payHint}`);
    }
    else if (deal && Number(deal.amount) > 0) {
        money.push(`${T.takeAll}: <b>${Ft(Number(deal.amount))}</b>`);
        const payout = Number(deal.master_payout);
        const basis = deal.hours != null ? ` (${deal.hours} ${T.hrs})` : deal.master_pct != null ? ` (${deal.master_pct}%)` : "";
        if (payout > 0)
            money.push(`${T.you}: <b>${Ft(payout)}</b>${basis}`);
    }
    else {
        if (lead.budget && String(lead.budget).trim())
            money.push(`${T.sum}: <b>${esc(lead.budget)}</b>`);
        money.push(`${T.youHint}: ${payHint}`);
    }
    const lines = [
        `🧹 <b>${T.head}, ${esc(master.name)}!</b>`, "",
        `👤 ${esc(lead.name) || "-"}`,
        `📅 ${lead.scheduled_at ? fmtLocal(tz, lead.scheduled_at as string) : T.noDate}`,
        `📍 ${lead.address ? esc(lead.address) : T.noAddr}`,
        `🧽 ${esc(lead.what_to_clean) || esc(lead.service) || T.job}`,
        ...money,
        (slot ? slot.brief : lead.master_brief) ? `\n📋 <b>${T.details}:</b> ${esc(slot ? slot.brief : lead.master_brief)}` : "",
        slot ? `\n<i>${T.split}</i>` : "",
    ].filter(Boolean);
    try {
        const r = await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: master.tg_chat_id, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
                reply_markup: { inline_keyboard: [[{ text: "✅ Принял заказ / Accepted", callback_data: slot ? `acc:${lead.id}:${slot.idx}` : `acc:${lead.id}` }]] },
            }),
        });
        if (r.ok) {
            if (slot)
                await stampCrew(String(lead.id), slot.idx, { sent: new Date().toISOString() });
            else
                await supabase.from("crm_leads").update({ master_notified_at: new Date().toISOString() }).eq("id", lead.id);
            await sendClientPhotos(cfg, String(lead.id), master.tg_chat_id, String(master.language ?? ""));
            await sendPairCopy(cfg, lead, master, tz);
        }
        return r.ok;
    }
    catch (e) {
        console.error("notify master", e);
        return false;
    }
}
async function sendPairCopy(cfg: Cfg, lead: Record<string, unknown>, master: Record<string, unknown>, tz: string) {
    if (!master.pair_master_id)
        return;
    const { data: pr } = await supabase.from("crm_masters").select("id,name,tg_chat_id,language").eq("id", master.pair_master_id).limit(1);
    const pair = pr?.[0];
    if (!pair?.tg_chat_id)
        return;
    const en = String(pair.language ?? "") === "en";
    const lines = [
        en ? `🧹 <b>Job with ${esc(master.name)}, ${esc(pair.name)}</b>` : `🧹 <b>Заказ вместе с ${esc(master.name)}, ${esc(pair.name)}</b>`, "",
        `👤 ${esc(lead.name) || "-"}`,
        `📅 ${lead.scheduled_at ? fmtLocal(tz, lead.scheduled_at as string) : en ? "date to be confirmed" : "дату уточнят"}`,
        `📍 ${lead.address ? esc(lead.address) : en ? "address to be confirmed" : "адрес уточнят"}`,
        `🧽 ${esc(lead.what_to_clean) || esc(lead.service) || (en ? "cleaning" : "уборка")}`,
        lead.master_brief ? `\n📋 <b>${en ? "Details" : "Детали"}:</b> ${esc(lead.master_brief)}` : "",
    ].filter(Boolean);
    try {
        await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: pair.tg_chat_id, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true }),
        });
        await sendClientPhotos(cfg, String(lead.id), pair.tg_chat_id as number, String(pair.language ?? ""));
    }
    catch (e) {
        console.error("pair copy", e);
    }
}
type CrewSlot = {
    m: string;
    brief: string;
    sum: string;
    pay: string;
    sent: string | null;
    ok: string | null;
};
function crewOf(lead: Record<string, unknown>): CrewSlot[] {
    return Array.isArray(lead.crew) ? (lead.crew as CrewSlot[]) : [];
}
async function stampCrew(leadId: string, idx: number, patch: Partial<CrewSlot>): Promise<void> {
    const { data } = await supabase.from("crm_leads").select("crew").eq("id", leadId).limit(1);
    const crew = crewOf(data?.[0] ?? {});
    if (!crew[idx])
        return;
    crew[idx] = { ...crew[idx], ...patch };
    await supabase.from("crm_leads").update({ crew }).eq("id", leadId);
}
function notifyRow(k: string, id: string, lead: Record<string, unknown>, tz: string): string {
    const btn = (label: string, cls = "sec") => `<form method="post" action="?key=${k}&action=notify_master" style="margin-top:8px"><input type="hidden" name="lead" value="${id}"><button type="submit" class="${cls}" title="Прислать мастеру карточку заказа в Telegram">${label}</button></form>`;
    if (!lead.master_notified_at)
        return btn("📨 Отправить заказ мастеру в Telegram");
    const sent = fmtLocal(tz, lead.master_notified_at as string);
    const state = lead.master_confirmed_at
        ? `<span class="pill" style="background:#2d6a4f">✅ Мастер подтвердил · ${fmtLocal(tz, lead.master_confirmed_at as string)}</span>`
        : `<span class="pill" style="background:#d4740e">📨 Отправлено · ${sent} · ждём подтверждения</span>`;
    return `<div style="margin-top:10px">${state}</div>${btn("↻ Отправить снова")}`;
}
function crewPanel(k: string, id: string, lead: Record<string, unknown>, masterOpts: (sel?: string) => string, tz: string): string {
    const crew = crewOf(lead);
    const slotForm = (i: number, s: CrewSlot | null) => {
        const post = (action: string) => `?key=${k}&action=${action}`;
        const state = !s ? "" : !s.sent
            ? `<form method="post" action="${post("crew_notify")}" style="margin-top:8px"><input type="hidden" name="lead" value="${id}"><input type="hidden" name="idx" value="${i}"><button type="submit" class="sec">📨 Отправить заказ в Telegram</button></form>`
            : `<div style="margin-top:10px">${s.ok
                ? `<span class="pill" style="background:#2d6a4f">✅ Подтвердил · ${fmtLocal(tz, s.ok)}</span>`
                : `<span class="pill" style="background:#d4740e">📨 Отправлено · ${fmtLocal(tz, s.sent)} · ждём подтверждения</span>`}</div>
        <form method="post" action="${post("crew_notify")}" style="margin-top:8px"><input type="hidden" name="lead" value="${id}"><input type="hidden" name="idx" value="${i}"><button type="submit" class="sec">↻ Отправить снова</button></form>`;
        const del = s
            ? `<form method="post" action="${post("crew_del")}" style="margin-top:8px"><input type="hidden" name="lead" value="${id}"><input type="hidden" name="idx" value="${i}"><button type="submit" class="sec" style="background:#c53030">Убрать мастера</button></form>`
            : "";
        return `<div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:12px">
      <form method="post" action="${post("crew_save")}"><input type="hidden" name="lead" value="${id}"><input type="hidden" name="idx" value="${s ? i : ""}">
        <div class="row"><div><label>${s ? `Мастер ${i + 2}` : "Добавить ещё мастера"}</label><select name="m" ${s ? "" : "required"}><option value="">-</option>${masterOpts(s?.m)}</select></div><div><label>Сумма с клиента за его часть (Ft)</label><input name="sum" value="${esc(s?.sum ?? "")}" placeholder="напр. 40 000"></div><div><label>Выплата ему (Ft)</label><input name="pay" value="${esc(s?.pay ?? "")}" placeholder="пусто = по его %"></div></div>
        <label>📋 Что делает именно он</label>
        <textarea name="brief" style="min-height:70px" placeholder="напр. Окна 2 шт с двух сторон + 2 ковра длинный ворс. Везти всё своё, у клиента ничего нет.">${esc(s?.brief ?? "")}</textarea>
        <div style="margin-top:10px"><button>${s ? "Сохранить" : "Добавить мастера"}</button></div></form>
      ${state}${del}</div>`;
    };
    return `<div class="panel"><h2>👥 Заказ на двоих (сплит между бригадами)</h2>
    <div class="muted" style="font-size:12px">Например: химчистка и окна на одного, клининг на другого. Каждый получает свой заказ и подтверждает отдельно.</div>
    ${crew.map((s, i) => slotForm(i, s)).join("")}${slotForm(crew.length, null)}</div>`;
}
const CSS = `*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f2f6f3;color:#1f2937;font-size:14px}
a{color:inherit;text-decoration:none}.wrap{max-width:1200px;margin:0 auto;padding:16px}
header{background:linear-gradient(120deg,#3aa856 0%,#2c93b0 100%);color:#fff;padding:12px 16px;box-shadow:0 2px 10px rgba(44,147,176,.25)}header .wrap{display:flex;align-items:center;gap:16px;padding:0}
header h1{font-size:16px;margin:0;font-weight:700}nav{display:flex;gap:14px;margin-left:auto;flex-wrap:wrap}nav a{opacity:.85;font-weight:600}nav a.on{opacity:1;border-bottom:2px solid #d6ef7a;padding-bottom:2px}.brand-mark{display:inline-flex;vertical-align:middle;margin-right:7px}.brand-mark svg{display:block}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;min-width:120px}.kpi .v{font-size:20px;font-weight:700}.kpi .l{color:#6b7280;font-size:12px}.search{margin:10px 0 4px;display:flex;align-items:center;gap:10px}.search input{max-width:380px}
.board{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px}.col{background:#eceef1;border-radius:10px;min-width:230px;width:230px;flex:0 0 auto;padding:8px}
.col h3{font-size:12px;margin:2px 4px 8px;text-transform:uppercase;letter-spacing:.04em;display:flex;justify-content:space-between}
.card{background:#fff;border:1px solid #e5e7eb;border-left:3px solid #ccc;border-radius:8px;padding:8px 10px;margin-bottom:8px;display:block}
.card b{font-size:13px}.card .meta{color:#6b7280;font-size:12px;margin-top:3px}.card .due{color:#b45309;font-size:12px;margin-top:3px}
.panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:14px}
.panel h2{font-size:15px;margin:0 0 12px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:820px){.grid2{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #eef0f2;font-size:13px}th{color:#6b7280;font-weight:600;font-size:12px}
.tl{list-style:none;padding:0;margin:0}.tl li{padding:8px 0;border-bottom:1px solid #f0f1f3}.tl .k{font-size:11px;color:#6b7280;text-transform:uppercase}
input,select,textarea{width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font:inherit;background:#fff}textarea{min-height:80px}
label{display:block;font-size:12px;color:#6b7280;margin:8px 0 3px}
button{background:#3aa856;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}button:hover{filter:brightness(1.06)}button.sec{background:#e5e7eb;color:#1f2937}button.sec:hover{filter:brightness(.97)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}.row>div{flex:1;min-width:120px}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff}
.kv{display:grid;grid-template-columns:120px 1fr;gap:4px 10px}.kv .l{color:#6b7280}
.muted{color:#9ca3af}.pos{color:#2d6a4f;font-weight:700}.neg{color:#c53030;font-weight:700}
.cards{min-height:28px}.card{cursor:grab}.card:active{cursor:grabbing}.col.over{outline:2px dashed #2c93b0;outline-offset:-3px;background:#e6f4ec}
input[type=checkbox]{width:auto!important;min-width:auto!important;min-height:auto!important;padding:0!important;transform:scale(1.3);margin:0}
.days{display:flex;flex-wrap:wrap;gap:10px}.days label{flex:0 0 auto;display:flex;align-items:center;gap:5px;font-size:14px;color:#1f2937;margin:0}
@media(max-width:760px){
.wrap{padding:12px}
header{padding:10px 12px}header .wrap{flex-wrap:wrap;gap:8px}
nav{margin-left:0;width:100%;gap:14px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:3px;flex-wrap:nowrap}nav a{white-space:nowrap;font-size:14px}
.panel{padding:12px;border-radius:10px}
.panel table{display:block;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
th,td{padding:9px 8px}
.kpis{gap:8px}.kpi{flex:1 1 44%;min-width:0;padding:9px 11px}
input,select,textarea{font-size:16px!important;min-height:44px;padding:10px!important;width:100%!important;min-width:0!important}
textarea{min-height:90px}
button{min-height:44px!important;padding:11px 15px!important;font-size:15px!important}
.row{gap:10px}.row>div{flex:1 1 100%;min-width:0}
.board{scroll-snap-type:x mandatory}.col{min-width:84vw;width:84vw;scroll-snap-align:start}
.card{padding:11px 12px}.card b{font-size:14px}
.kv{grid-template-columns:1fr;gap:1px}.kv .l{font-size:11px;margin-top:7px}
.search input{max-width:none}
label{font-size:13px;margin:10px 0 4px}
}`;
function navHtml(k: string, view: string, role: "full" | "master" | "marketer" | "supervisor"): string {
    const link = (v: string, label: string) => `<a class="${view === v ? "on" : ""}" href="?key=${k}&view=${v}">${label}</a>`;
    const langToggle = `<a href="#" onclick="${setLangJs(LANG === "en" ? "ru" : "en")}" title="${LANG === "en" ? "Переключить на русский" : "Switch to English"}" style="opacity:.7;font-size:12px;border:1px solid rgba(255,255,255,.5);border-radius:6px;padding:1px 6px">${LANG === "en" ? "RU" : "EN"}</a>`;
    if (role === "master")
        return `<nav>${langToggle}<a href="?action=logout">${t("Выход")}</a></nav>`;
    const dataTab = role === "supervisor" ? "" : link("data", t("Экспорт"));
    const accesses = role === "full" ? link("users", t("Доступы")) : "";
    return `<nav>${link("board", t("Доска"))}${role === "full" ? link("makati", "Makati") + link("reviews", t("Отзывы Google")) : ""}${link("calendar", t("Календарь"))}${link("candidates", t("Кандидаты"))}${link("money", t("Маржа"))}${link("analytics", t("Аналитика"))}${link("orders", t("Отработанные"))}${link("gallery", t("Фото работ"))}${link("masters", t("Мастера"))}${dataTab}${accesses}${langToggle}<a href="?action=logout">${t("Выход")}</a></nav>`;
}
function page(navHtmlStr: string, body: string, k = ""): string {
    const logoOpen = navHtmlStr ? `<a href="?key=${k}&view=board" style="color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:8px;cursor:pointer" title="${t("На главную (Доска)")}">` : "";
    const logoClose = navHtmlStr ? "</a>" : "";
    return `<!doctype html><html lang="${LANG}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CLB CRM</title><style>${CSS}</style></head><body>
<header><div class="wrap"><h1>${logoOpen}<span class="brand-mark"><svg width="28" height="28" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg" x1="12" y1="9" x2="50" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#a6d24a"/><stop offset="1" stop-color="#2f9e44"/></linearGradient><linearGradient id="lt" x1="8" y1="46" x2="56" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#39bcd6"/><stop offset="1" stop-color="#2c6fa0"/></linearGradient></defs><path d="M32 9 56 31H49V44H15V31H8Z" fill="url(#lg)"/><rect x="26" y="26" width="12" height="12" rx="1.5" fill="#fff"/><rect x="31" y="26" width="2" height="12" fill="#2f9e44"/><rect x="26" y="31" width="12" height="2" fill="#2f9e44"/><path d="M8 46Q32 39 56 46Q40 54 24 51Q14 49 8 46Z" fill="url(#lt)"/></svg></span>CLB CRM${logoClose}</h1>${navHtmlStr}</div></header>
<div class="wrap">${body}</div></body></html>`;
}
function waUrl(lead: Record<string, unknown>, insight?: Record<string, unknown> | null): string {
    const dg = waDigits(lead.phone);
    if (!dg)
        return "";
    const ru = lead.language === "ru";
    const first = ruName(lead.name, ru);
    const svc = ru ? (SVC_RU[lead.service as string] || "уборку") : (SVC_EN[lead.service as string] || "cleaning");
    const hi = ru ? `Здравствуйте${first ? ", " + first : ""}!` : `Hi${first ? " " + first : ""}!`;
    const me = ru ? `Алекс из ${brandName(lead)}` : `this is Alex from ${brandName(lead)}`;
    const draft = String(insight?.suggested_reply ?? "").trim();
    if (draft)
        return `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(draft.slice(0, 900))}`;
    let t = "";
    if (lead.status === "new") {
        t = firstTouchText(lead);
    }
    else if (lead.status === "contacted") {
        t = ru
            ? `${hi} ${me} - писал вам по поводу заявки на ${svc}, но ответа не было. Возможно, сообщение потерялось. Ещё актуально? Если нет, просто скажите, и я больше не побеспокою 🙂`
            : `${hi} ${me} - I messaged you about your ${svc} request but did not hear back. The message may have got lost. Is it still relevant? If not, just say so and I will not bother you again 🙂`;
    }
    else if (lead.status === "in_progress") {
        t = ru
            ? `${hi} ${me}. Возвращаюсь к вам по ${svc} - остались вопросы по расчёту? Готов подобрать удобное время.`
            : `${hi} ${me}. Following up on your ${svc} - any questions about the quote? Happy to find a time that suits you.`;
    }
    else if (lead.status === "follow_up") {
        t = ru
            ? `${hi} ${me} - хотел уточнить по вашей заявке на ${svc}: остались вопросы или что-то смущает? Могу предложить удобное время на этой неделе 🙂`
            : `${hi} ${me} - just checking in about your ${svc}: any questions or doubts left? I can offer a convenient slot this week 🙂`;
    }
    else if (lead.status === "pushing") {
        t = ru
            ? `${hi} ${me}. Держу для вас место на ${svc} - скажите день, и я закреплю мастера за вами. Если что-то мешает решиться, напишите, подберём вариант.`
            : `${hi} ${me}. I'm holding a slot for your ${svc} - just tell me the day and I'll book the cleaner for you. If something is holding you back, tell me and we'll work it out.`;
    }
    else if (lead.status === "junk" || lead.status === "lost") {
        t = closingText(lead, lead.status === "junk" ? "junk" : "lost");
    }
    else {
        return `https://api.whatsapp.com/send?phone=${dg}`;
    }
    return `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(t)}`;
}
function loginPage(err: string, next = ""): string {
    return page("", `<div style="max-width:340px;margin:6vh auto"><div class="panel"><h2>${t("Вход")}</h2>
    ${err ? `<p class="neg">${esc(err)}</p>` : ""}
    <form method="post" action="?action=login">
      <input type="hidden" name="next" value="${esc(next)}">
      <label>${t("Логин")}</label><input name="username" autofocus autocomplete="username">
      <label>${t("Пароль")}</label><input name="password" type="password" autocomplete="current-password">
      <div style="margin-top:12px"><button>${t("Войти")}</button></div>
    </form>
    <p class="muted" style="margin:12px 0 0;font-size:12px"><a href="#" onclick="${setLangJs(LANG === "en" ? "ru" : "en")}" style="text-decoration:underline">${LANG === "en" ? "Русский" : "English"}</a></p></div></div>`);
}
async function viewBoard(cfg: Cfg, k: string): Promise<string> {
    const { data: leads } = await supabase.from("crm_leads").select("id,status,name,phone,language,service,what_to_clean,budget,campaign,created_at,last_contact_at,status_changed_at").neq("source", "job_application").order("created_at", { ascending: false }).limit(2000);
    const { data: tasks } = await supabase.from("crm_tasks").select("lead_id,due_at,done").eq("done", false).not("due_at", "is", null);
    const nextByLead = new Map<string, string>();
    for (const t of tasks ?? []) {
        const cur = nextByLead.get(t.lead_id);
        if (!cur || t.due_at < cur)
            nextByLead.set(t.lead_id, t.due_at);
    }
    const { data: deals } = await supabase.from("crm_deals").select("lead_id,amount,master_payout,extra_costs");
    let rev = 0, net = 0;
    for (const d of deals ?? []) {
        rev += Number(d.amount);
        net += Number(d.amount) - Number(d.master_payout) - Number(d.extra_costs);
    }
    const wonCount = (leads ?? []).filter((l) => l.status === "won").length;
    const dealLeadIds = new Set((deals ?? []).map((d) => d.lead_id));
    const wonNoDeal = (leads ?? []).filter((l) => l.status === "won" && !dealLeadIds.has(l.id));
    const warn = wonNoDeal.length ? `<div class="panel" style="border-left:4px solid #d4740e;padding:10px 14px;margin-bottom:8px">⚠️ <b>${t("Выиграно, но чек не вписан")} (${wonNoDeal.length}):</b> ${wonNoDeal.slice(0, 8).map((l) => `<a href="?key=${k}&lead=${l.id}">${esc(l.name) || t("без имени")}</a>`).join(", ")}${wonNoDeal.length > 8 ? "…" : ""} - ${t("открой карточку и внеси сумму в «Закрыть сделку», иначе выручка занижена.")}</div>` : "";
    const tz = cfg.timezone || "Europe/Budapest";
    const kpis = `<div class="kpis">
    <div class="kpi"><div class="v">${(leads ?? []).length}</div><div class="l">${t("Всего лидов")}</div></div>
    <div class="kpi"><div class="v">${wonCount}</div><div class="l">${t("Выиграно")}</div></div>
    <div class="kpi"><div class="v">${Ft(rev)}</div><div class="l">${t("Выручка")}</div></div>
    <div class="kpi"><div class="v pos">${Ft(net)}</div><div class="l">${t("Чистыми (без рекламы)")}</div></div></div>`;
    const cols = STATUS_KEYS.map((s) => {
        const items = (leads ?? []).filter((l) => l.status === s);
        const cards = items.map((l) => {
            const due = nextByLead.get(l.id);
            const ph = String(l.phone || "").replace(/[^0-9]/g, "");
            const hay = esc(((l.name || "") + " " + ph + " " + (ph.length >= 9 ? ph.slice(-9) : "") + " " + (l.campaign || "")).toLowerCase());
            return `<a class="card" draggable="true" data-lead="${l.id}" data-q="${hay}" style="border-left-color:${STATUS_COLOR[s]}" href="?key=${k}&lead=${l.id}">
        <b>${esc(l.name) || "-"}</b> ${flag(l.language)}
        <div class="meta">${esc(l.what_to_clean) || esc(l.service) || ""}${l.budget ? " · " + esc(l.budget) : ""}</div>
        ${l.phone ? `<div class="meta">📞 ${esc(l.phone)}${waDigits(l.phone) ? ` <span role="button" title="${t("Написать в WhatsApp")}" style="background:#25D366;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;cursor:pointer" onclick="event.preventDefault();event.stopPropagation();window.open('?action=wa_open&lead=${l.id}','_blank')">💬 WA</span>` : ""}</div>` : ""}
        ${l.campaign ? `<div class="meta">📊 ${esc(l.campaign)}</div>` : ""}
        <div class="meta">🕒 ${ageDays(l.created_at)} ${t("дн.")}${l.status !== "new" && l.status_changed_at ? ` · 📌 ${ageDays(l.status_changed_at)} ${t("дн. в статусе")}` : ""}${l.last_contact_at ? ` · 📤 ${t("писал")} ${fmtLocal(tz, l.last_contact_at)}` : ""}</div>
        ${due ? `<div class="due">🔔 ${fmtLocal(tz, due)}</div>` : ""}
      </a>`;
        }).join("");
        return `<div class="col" data-status="${s}"><h3><span style="color:${STATUS_COLOR[s]}">${t(STATUS[s])}</span><span class="cnt">${items.length}</span></h3><div class="cards">${cards || `<div class="muted" style="padding:6px">${t("пусто")}</div>`}</div></div>`;
    }).join("");
    const search = `<div class="search"><input id="q" type="search" placeholder="${t("🔎 Поиск по имени или телефону...")}" autocomplete="off"><span id="qn" class="muted"></span></div>`;
    const filterScript = `<script>(function(){var q=document.getElementById('q');if(!q)return;var cards=[].slice.call(document.querySelectorAll('.card'));
function apply(){var raw=q.value.trim().toLowerCase();var dig=q.value.replace(/[^0-9]/g,'');var t=raw||dig;
cards.forEach(function(c){var h=c.getAttribute('data-q')||'';var d2=dig.replace(/^0+/,'');var tail=dig.length>=9?dig.slice(-9):'';var ok=!t||(raw&&h.indexOf(raw)!==-1)||(dig.length>=3&&(h.indexOf(dig)!==-1||h.indexOf(d2)!==-1))||(tail&&h.indexOf(tail)!==-1);c.style.display=ok?'':'none';});
var shown=0;document.querySelectorAll('.col').forEach(function(col){var vis=0;col.querySelectorAll('.card').forEach(function(c){if(c.style.display!=='none')vis++;});shown+=vis;var cnt=col.querySelector('.cnt');if(cnt)cnt.textContent=vis;});
var qn=document.getElementById('qn');if(qn)qn.textContent=t?(${JSON.stringify(t("найдено: "))}+shown):'';}
q.addEventListener('input',apply);q.addEventListener('keydown',function(e){if(e.key==='Escape'){q.value='';apply();}});})();</script>`;
    return kpis + warn + search + `<div class="board">${cols}</div>` + boardScript(k) + filterScript;
}
function boardScript(k: string): string {
    return `<script>(function(){var dragId=null,src=null;
document.addEventListener('dragstart',function(e){var c=e.target.closest('.card');if(c){dragId=c.getAttribute('data-lead');src=c;if(e.dataTransfer){e.dataTransfer.effectAllowed='move';}}});
document.addEventListener('dragend',function(){document.querySelectorAll('.col.over').forEach(function(x){x.classList.remove('over');});});
document.querySelectorAll('.col').forEach(function(col){
col.addEventListener('dragover',function(e){e.preventDefault();col.classList.add('over');});
col.addEventListener('dragleave',function(){col.classList.remove('over');});
col.addEventListener('drop',function(e){e.preventDefault();col.classList.remove('over');if(!dragId||!src)return;
var status=col.getAttribute('data-status');var box=col.querySelector('.cards');var ph=box.querySelector('.muted');if(ph)ph.remove();box.appendChild(src);
try{src.style.borderLeftColor=getComputedStyle(col.querySelector('h3 span')).color;}catch(_){ }
document.querySelectorAll('.col').forEach(function(c){var cnt=c.querySelector('.cnt');if(cnt)cnt.textContent=c.querySelectorAll('.card').length;});
fetch('?key=${k}&action=status',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'lead='+encodeURIComponent(dragId)+'&status='+encodeURIComponent(status)}).catch(function(){location.reload();});
dragId=null;src=null;});});})();</script>`;
}
async function viewLead(cfg: Cfg, id: string, k: string, role: "full" | "master" | "marketer" | "supervisor" = "full"): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    const { data: rows } = await supabase.from("crm_leads").select("*").eq("id", id).limit(1);
    const lead = rows?.[0];
    if (!lead)
        return `<div class="panel">Лид не найден. <a href="?key=${k}&view=board">← на доску</a></div>`;
    const [{ data: tl }, { data: tasks }, { data: deals }, { data: masters }, { data: insight }] = await Promise.all([
        supabase.from("crm_timeline").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(80),
        supabase.from("crm_tasks").select("*").eq("lead_id", id).order("due_at", { ascending: true }),
        supabase.from("crm_deals").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
        supabase.from("crm_masters").select("*").eq("active", true).order("name"),
        supabase.from("crm_wa_insights").select("suggested_reply,objection").eq("lead_id", id).maybeSingle(),
    ]);
    const kv = (l: string, v: unknown) => v ? `<div class="l">${l}</div><div>${esc(v)}</div>` : "";
    const masterOpts = (sel?: string) => (masters ?? []).map((m) => `<option value="${m.id}" ${sel === m.id ? "selected" : ""}>${esc(m.name)} (${m.pay_type === "hourly" ? Ft(Number(m.hourly_rate)) + "/ч" : m.default_pct + "%"})</option>`).join("");
    const freeOnDay = (() => {
        if (!lead.scheduled_at)
            return `<p class="muted" style="margin:0 0 8px">Поставь дату выезда, и здесь появится список тех, кто в этот день работает.</p>`;
        const wdStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(lead.scheduled_at as string));
        const isoWd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wdStr) + 1;
        const free = (masters ?? []).filter((m) => (((m.work_days as number[] | null) ?? []).includes(isoWd)));
        const dayName = DOW_RU[isoWd - 1] || "";
        if (!free.length)
            return `<p class="muted" style="margin:0 0 8px">🟠 В ${dayName} по графику не работает никто. График правится на вкладке «Мастера».</p>`;
        const items = free.map((m) => `<li><b>${esc(m.name)}</b> ${EXP[String(m.experience || "none")] ?? ""}${m.district ? ` · 📍 ${esc(m.district)}` : ""}${m.availability_note ? `<div class="muted" style="font-size:11px">${esc(m.availability_note)}</div>` : ""}</li>`).join("");
        return `<div style="background:#f0f7f2;border:1px solid #cfe6da;border-radius:10px;padding:8px 12px;margin-bottom:10px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">🟢 Работают в ${dayName} (${free.length})</div><ul style="margin:0;padding-left:18px;font-size:13px">${items}</ul></div>`;
    })();
    const dealRows = (deals ?? []).map((d) => {
        const mn = (masters ?? []).find((m) => m.id === d.master_id)?.name || d.master_name || "";
        const net = Number(d.amount) - Number(d.master_payout) - Number(d.extra_costs);
        const basis = d.hours != null ? `${d.hours} ч` : (d.master_pct != null ? `${d.master_pct}%` : (Number(d.master_payout) > 0 ? "фикс" : "-"));
        const del = role === "full" ? `<form method="post" action="?key=${k}&action=deal_delete" onsubmit="return confirm('Удалить эту сделку? Отменить нельзя.')" style="margin:0"><input type="hidden" name="deal_id" value="${d.id}"><input type="hidden" name="lead" value="${id}"><button class="sec" title="Удалить сделку" style="padding:3px 8px;font-size:12px;color:#c53030">🗑</button></form>` : "";
        const mSel = (masters ?? []).map((m) => `<option value="${m.id}" ${m.id === d.master_id ? "selected" : ""}>${esc(m.name)}</option>`).join("");
        const lbl = "display:flex;flex-direction:column;font-size:9px;color:#8a94a6;gap:1px";
        return `<tr>
      <td><input form="ld${d.id}" name="job_date" type="date" value="${d.job_date ?? ""}" style="width:135px"></td>
      <td><form id="ld${d.id}" method="post" action="?key=${k}&action=deal_edit" style="margin:0"><input type="hidden" name="deal_id" value="${d.id}"><input type="hidden" name="lead" value="${id}"><input name="amount" type="number" step="1" value="${Number(d.amount)}" style="width:90px"></form></td>
      <td class="row" style="gap:6px;align-items:flex-end;margin:0;flex-wrap:wrap">
        <label style="${lbl}">Мастер<select form="ld${d.id}" name="master_id" style="width:120px"><option value="">- без мастера</option>${mSel}</select></label>
        <label style="${lbl}" title="Сумма всем мастерам вместе. Кто сколько получил - в заметку.">Мастеру, всем<input form="ld${d.id}" name="master_payout" type="number" step="1" value="${Number(d.master_payout)}" style="width:82px"></label>
        <span class="muted" style="font-size:11px">${basis}</span>
        <label style="${lbl};flex:1">Заметка<input form="ld${d.id}" name="notes" value="${esc(d.notes)}" placeholder="напр. Оля 7ч 21к · Мария 4ч 12к" style="min-width:150px"></label>
      </td>
      <td><input form="ld${d.id}" name="extra_costs" type="number" step="1" value="${Number(d.extra_costs)}" style="width:72px">${d.extra_costs_note ? `<div class="muted" style="font-size:11px">${esc(d.extra_costs_note)}</div>` : ""}</td>
      <td class="${net >= 0 ? "pos" : "neg"}">${Ft(net)}</td>
      <td class="row" style="gap:6px;margin:0"><button form="ld${d.id}" class="sec" title="Сохранить" style="padding:3px 8px;font-size:12px">💾</button><button form="ld${d.id}" formaction="?key=${k}&action=deal_parse" class="sec" title="Разобрать заметку: посчитать выплаты и расходы из текста" style="padding:3px 8px;font-size:12px">🧮</button>${del}</td>
    </tr>`;
    }).join("") || `<tr><td colspan="6" class="muted">сделок нет</td></tr>`;
    const taskRows = (tasks ?? []).map((t) => `<li>${t.done ? "✅" : "🔔"} ${esc(t.title)} <span class="muted">- ${fmtLocal(tz, t.due_at)}</span>${t.reason ? `<div class="k">${esc(t.reason)}</div>` : ""}${!t.done ? `<form method="post" action="?key=${k}&action=task_done" style="display:inline"><input type="hidden" name="task_id" value="${t.id}"><input type="hidden" name="lead" value="${id}"><button class="sec" style="padding:2px 8px;font-size:12px;margin-left:6px">готово</button></form>` : ""}</li>`).join("") || `<li class="muted">задач нет</li>`;
    const tlRows = (tl ?? []).map((e) => `<li><div class="k">${esc(e.kind)} · ${fmtLocal(tz, e.created_at)}</div>${esc(e.body)}</li>`).join("") || `<li class="muted">пусто</li>`;
    const isCand = String(lead.source ?? "") === "job_application";
    const btnKeys = isCand ? HIRE_KEYS : STATUS_KEYS;
    const btnName = (s: string) => (isCand ? HIRE[s] : STATUS[s]) ?? s;
    const btnColor = (s: string) => (isCand ? HIRE_COLOR[s] : STATUS_COLOR[s]);
    const statusBtns = btnKeys.map((s) => `<button class="${s === lead.status ? "" : "sec"}" name="status" value="${s}" style="background:${s === lead.status ? btnColor(s) : ""}">${btnName(s)}</button>`).join(" ");
    const schedLocal = lead.scheduled_at ? new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(lead.scheduled_at)).replace(" ", "T") : "";
    const delBtn = role === "full" ? `<form method="post" action="?key=${k}&action=lead_delete" onsubmit="return confirm('Удалить карточку навсегда? Сделки, задачи и история тоже удалятся.')" style="margin:0"><input type="hidden" name="lead" value="${id}"><button style="background:#c53030;font-size:12px;padding:5px 11px">🗑 Удалить</button></form>` : "";
    let reviewRow = "";
    if (lead.review_requested_at) {
        reviewRow = `<div style="margin:8px 0 0"><span class="pill" style="background:#2d6a4f">⭐ Отзыв запрошен · ${fmtLocal(tz, lead.review_requested_at)}</span></div>`;
    }
    else if (reviewCity(lead) && jobDone(lead, (deals ?? []).length > 0)) {
        const wa = reviewWaUrl(lead);
        const mark = (label: string, color: string, js: string) => `<button type="button" style="background:${color}" data-t="${esc(js === "wa" ? wa : reviewRequestText(lead))}" onclick="${js === "wa" ? "window.open(this.dataset.t,'_blank');this.form.submit()" : "navigator.clipboard.writeText(this.dataset.t).then(()=>this.form.submit())"}">${label}</button>`;
        reviewRow = `<form method="post" action="?key=${k}&action=review_mark" class="row" style="gap:8px;margin:8px 0 0"><input type="hidden" name="lead" value="${id}">${wa ? mark("⭐ Попросить отзыв", "#b8860b", "wa") : ""}${mark("📋 Копировать текст", "#2c93b0", "copy")}</form>`;
    }
    if (lead.source === "job_application") {
        const a = (lead.answers && typeof lead.answers === "object") ? lead.answers as Record<string, unknown> : {};
        const EXP: Record<string, string> = { none: "Нет опыта", some: "Есть небольшой опыт", pro: "Опытный клинер", yes: "Есть опыт" };
        const AVAIL: Record<string, string> = { full: "Полный день", part: "Частичная занятость", weekends: "Только выходные", flexible: "Гибкий график" };
        const known = new Set(["experience", "availability", "district", "ip_hash", "email", "country", "phone_valid"]);
        const extraAns = Object.entries(a).filter(([kk]) => !known.has(kk) && a[kk]).map(([kk, vv]) => kv(kk, vv)).join("");
        const CC_RU: Record<string, string> = { HU: "🇭🇺 Венгрия", US: "🇺🇸 США", CA: "🇨🇦 Канада", DE: "🇩🇪 Германия", PH: "🇵🇭 Филиппины" };
        const phoneBad = a.phone_valid === false;
        const appRows = kv("Телефон", phoneBad ? `${lead.phone} ⚠️ номер неполный` : lead.phone)
            + kv("Почта", lead.email || a.email)
            + kv("Страна", CC_RU[String(lead.country ?? "")] ?? lead.country)
            + kv("Опыт", EXP[String(a.experience)] ?? a.experience)
            + kv("Занятость", AVAIL[String(a.availability)] ?? a.availability)
            + kv("Район", a.district)
            + extraAns
            + kv("Кампания", lead.campaign)
            + kv("Источник", lead.source)
            + kv("Создан", fmtLocal(tz, lead.created_at));
        const rawBlock = lead.raw_text ? `<div class="muted" style="white-space:pre-wrap;margin-top:10px;font-size:13px">${esc(lead.raw_text)}</div>` : "";
        const phoneForm = `<form method="post" action="?key=${k}&action=phone" class="row" style="gap:6px;margin:10px 0 0;align-items:center">
      <input type="hidden" name="lead" value="${id}">
      <input name="phone" value="${esc(lead.phone)}" placeholder="+36301234567" style="max-width:190px" inputmode="tel">
      <button class="sec" style="padding:6px 10px">Сменить номер</button>
      ${(lead.answers as Record<string, unknown> | null)?.bad_phone ? `<span class="muted" style="font-size:12px">📵 помечен как неверный</span>` : ""}
    </form>`;
        const contactRow = lead.phone ? `<div class="row" style="gap:8px;margin:10px 0 0">${waDigits(lead.phone) ? `<a href="${waUrl(lead, insight)}" target="_blank" style="text-decoration:none"><button type="button" style="background:#25D366">💬 WhatsApp</button></a>` : ""}<a href="tel:+${waDigits(lead.phone) || esc(String(lead.phone).replace(/[^0-9]/g, ""))}" style="text-decoration:none"><button type="button" class="sec">📞 Позвонить</button></a></div>${phoneForm}` : phoneForm;
        return `<p style="display:flex;justify-content:space-between;align-items:center;gap:10px"><a href="?key=${k}&view=candidates">← Кандидаты</a>${delBtn}</p>
    <div class="grid2">
      <div>
        <div class="panel"><h2>🧹 ${esc(lead.name) || "Соискатель"} ${flag(lead.language)} <span class="pill" style="background:${STATUS_COLOR[lead.status]}">${STATUS[lead.status]}</span></h2>
          <div class="muted" style="font-size:12px;margin:-2px 0 8px">Анкета соискателя (клинер) - не клиент</div>
          <div class="kv">${appRows}</div>
          ${rawBlock}
          ${contactRow}
          <form method="post" action="?key=${k}&action=status" style="margin-top:10px"><input type="hidden" name="lead" value="${id}"><label>Статус</label><div class="row" style="gap:6px">${statusBtns}</div></form>
        </div>
      </div>
      <div>
        <div class="panel"><h2>🔔 Задачи</h2><ul class="tl">${taskRows}</ul>
          <form method="post" action="?key=${k}&action=task"><input type="hidden" name="lead" value="${id}">
            <div class="row"><div style="flex:2"><label>Новая задача</label><input name="title" placeholder="Позвонить / пригласить на пробный" required></div><div><label>Когда</label><input name="due" type="datetime-local"></div></div>
            <div style="margin-top:8px"><button class="sec">Добавить задачу</button></div></form>
        </div>
        <div class="panel"><h2>📝 Заметка</h2>
          <form method="post" action="?key=${k}&action=note"><input type="hidden" name="lead" value="${id}">
            <textarea name="note" placeholder="Свободная заметка">${esc(lead.notes)}</textarea>
            <div style="margin-top:8px"><button class="sec">Сохранить заметку</button></div></form>
        </div>
        <div class="panel"><h2>🕓 История</h2><ul class="tl">${tlRows}</ul></div>
      </div>
    </div>`;
    }
    return `<p style="display:flex;justify-content:space-between;align-items:center;gap:10px"><a href="?key=${k}&view=board">← Доска</a>${delBtn}</p>
  <div class="grid2">
    <div>
      <div class="panel"><h2>${esc(lead.name) || "Клиент"} ${flag(lead.language)} <span class="pill" style="background:${STATUS_COLOR[lead.status]}">${STATUS[lead.status]}</span></h2>
        <div class="kv">${kv("Телефон", (lead.answers as Record<string, unknown> | null)?.bad_phone ? `${lead.phone} 📵 неверный` : lead.phone)}${kv("Почта", lead.email)}${kv("Услуга", lead.service)}${kv("Что чистим", lead.what_to_clean)}${kv("Площадь", lead.area)}${kv("Бюджет", lead.budget)}${kv("Когда", lead.when_text)}${kv("Связь", lead.contact_method)}${kv("Подарок", lead.gift)}${kv("Доп. услуги", lead.extra_services)}${kv("Кампания", lead.campaign)}${kv("Пришёл с", sourceLabel(lead.attribution))}${kv("Первая страница", (lead.attribution as Record<string, unknown> | null)?.landing)}${kv("Последний контакт", lead.last_contact_at ? fmtLocal(tz, lead.last_contact_at) : "")}${kv("В статусе с", lead.status_changed_at ? fmtLocal(tz, lead.status_changed_at) : "")}${kv("Создан", fmtLocal(tz, lead.created_at))}</div>
        ${lead.phone ? `<div class="row" style="gap:8px;margin:10px 0 0">${waDigits(lead.phone) ? `<a href="?action=wa_open&lead=${id}" target="_blank" style="text-decoration:none"><button type="button" style="background:#25D366">💬 WhatsApp</button></a>` : ""}<a href="tel:+${waDigits(lead.phone) || esc(String(lead.phone).replace(/[^0-9]/g, ""))}" style="text-decoration:none"><button type="button" class="sec">📞 Позвонить</button></a></div>` : `<div class="rule warn" style="margin:10px 0 0"><p>📵 Телефон не заполнен, поэтому кнопки WhatsApp, звонка и отправки ссылки на отзыв скрыты. Впиши номер, и они появятся.</p></div>`}
        <details style="margin:8px 0 0"><summary class="muted" style="cursor:pointer;font-size:13px">✏️ Сменить номер</summary><form method="post" action="?key=${k}&action=phone" class="row" style="gap:6px;margin:6px 0 0;align-items:center">
          <input type="hidden" name="lead" value="${id}">
          <input name="phone" value="${esc(lead.phone)}" placeholder="+36301234567" style="max-width:190px" inputmode="tel">
          <button class="sec" style="padding:6px 10px">Сохранить номер</button>
        </form></details>
        ${reviewRow}
        <form method="post" action="?key=${k}&action=status"><input type="hidden" name="lead" value="${id}"><label>Статус</label><div class="row" style="gap:6px">${statusBtns}</div></form>
      </div>
      <div class="panel"><h2>📍 Назначить мастера / выезд</h2>
        ${freeOnDay}
        <form method="post" action="?key=${k}&action=assign"><input type="hidden" name="lead" value="${id}">
          <div class="row"><div><label>Мастер</label><select name="assigned_master_id"><option value="">-</option>${masterOpts(lead.assigned_master_id)}</select></div><div><label>Дата и время выезда</label><input name="scheduled_at" type="datetime-local" value="${schedLocal}"></div></div>
          <label>Адрес</label><input name="address" value="${esc(lead.address)}" placeholder="район, улица, дом">
          <label>📋 Детали для мастера (что взять, вид уборки, договорённости)</label>
          <textarea name="master_brief" style="min-height:70px" placeholder="напр. Генеральная уборка. Взять пылесос + швабру + средство для стекла. Диван + 2 ковра, пятна от кофе. Клиент просит сухость после чистки. Домофон 49, 8 этаж.">${esc(lead.master_brief)}</textarea>
          <div style="margin-top:10px"><button>Сохранить назначение</button></div></form>
        ${lead.assigned_master_id ? notifyRow(k, id, lead, tz) : ""}
      </div>
      ${crewPanel(k, id, lead, masterOpts, tz)}
      <div class="panel"><h2>🧠 Анализ переписки (WhatsApp)</h2>
        <form method="post" action="?key=${k}&action=analyze"><input type="hidden" name="lead" value="${id}">
          <textarea name="chat" placeholder="Вставь сюда переписку из WhatsApp - я разберу её, обновлю статус и поставлю задачу-перезвон"></textarea>
          <div style="margin-top:8px"><button>Разобрать и обновить</button></div></form>
      </div>
      <div class="panel"><h2>💰 Закрыть сделку</h2>
        <form method="post" action="?key=${k}&action=deal"><input type="hidden" name="lead" value="${id}">
          <div class="row"><div><label>Сумма (Ft)</label><input name="amount" type="number" step="1" required></div><div><label>Мастер</label><select name="master_id"><option value="">-</option>${masterOpts(lead.assigned_master_id)}</select></div></div>
          <div class="row"><div><label>Или имя (подработка, не в системе)</label><input name="master_name" placeholder="напр. Нина"></div><div><label>Выплата мастеру (Ft) — фиксом</label><input name="master_payout" type="number" step="1" placeholder="напр. 6900"></div></div>
          <div class="row"><div><label>% мастеру (если %)</label><input name="master_pct" type="number" step="1" placeholder="по умолч."></div><div><label>Часы (если почасово)</label><input name="hours" type="number" step="0.5" placeholder="напр. 4"></div><div><label>Ft/час на этот заказ</label><input name="hourly_rate" type="number" step="1" placeholder="по умолч. из карточки"></div></div>
          <p class="muted" style="font-size:12px;margin:2px 0 0">Оплата решается заказом, а не карточкой мастера: вписал часы - считаем почасово, вписал только % - считаем процентом. Фикс перебивает и то и другое.</p>
          <div class="row"><div><label>Доп. расходы (Ft)</label><input name="extra_costs" type="number" step="1" value="0"></div><div><label>Заметка к расходам</label><input name="extra_costs_note" placeholder="бензин, материалы"></div><div><label>Дата работы</label><input name="job_date" type="date"></div></div>
          <label>Что сделали</label><input name="service_done" placeholder="химчистка дивана + 2 кресла">
          <label>Разбивка / заметка (свободный текст)</label><textarea name="notes" style="min-height:60px" placeholder="напр. Окна 75 · Клининг 38 · Мария 14 · Катя 10 · Петя 26 · бензин 7к. Сумма = общая выручка, Выплата = всем мастерам вместе."></textarea>
          <div style="margin-top:10px"><button>Записать сделку</button></div></form>
        <table style="margin-top:12px"><tr><th>Дата</th><th>Сумма</th><th>Мастер</th><th>Доп</th><th>Чистыми</th><th></th></tr>${dealRows}</table>
        <div style="margin-top:14px"><label>📷 Фото работы от мастера</label>${(await photoGroup(id)) || `<div class="muted" style="font-size:12px">пока нет фото</div>`}</div>
      </div>
    </div>
    <div>
      <div class="panel"><h2>🔔 Задачи</h2><ul class="tl">${taskRows}</ul>
        <form method="post" action="?key=${k}&action=task"><input type="hidden" name="lead" value="${id}">
          <div class="row"><div style="flex:2"><label>Новая задача</label><input name="title" placeholder="Перезвонить" required></div><div><label>Когда</label><input name="due" type="datetime-local"></div></div>
          <div style="margin-top:8px"><button class="sec">Добавить задачу</button></div></form>
      </div>
      <div class="panel"><h2>📝 Заметка</h2>
        <form method="post" action="?key=${k}&action=note"><input type="hidden" name="lead" value="${id}">
          <textarea name="note" placeholder="Свободная заметка">${esc(lead.notes)}</textarea>
          <div style="margin-top:8px"><button class="sec">Сохранить заметку</button></div></form>
      </div>
      <div class="panel"><h2>🕓 История</h2><ul class="tl">${tlRows}</ul></div>
    </div>
  </div>`;
}
async function viewMoney(cfg: Cfg, role: "full" | "master" | "marketer" | "supervisor" = "full", k = ""): Promise<string> {
    const { data: leads } = await supabase.from("crm_leads").select("id,campaign,status");
    const { data: expenses } = await supabase.from("crm_expenses").select("id,spent_on,amount,note,lead_id").order("spent_on", { ascending: false });
    const { data: deals } = await supabase.from("crm_deals").select("lead_id,master_id,amount,master_payout,extra_costs,job_date,created_at");
    const { data: spend } = await supabase.from("crm_ad_spend").select("*");
    const { data: masters } = await supabase.from("crm_masters").select("id,name");
    const masterName = new Map((masters ?? []).map((m) => [m.id, m.name]));
    const leadCampaign = new Map((leads ?? []).map((l) => [l.id, l.campaign || "-"]));
    type Agg = {
        rev: number;
        cost: number;
        deals: number;
    };
    const camp = new Map<string, Agg>();
    const ensure = (m: Map<string, Agg>, k: string) => { let a = m.get(k); if (!a) {
        a = { rev: 0, cost: 0, deals: 0 };
        m.set(k, a);
    } return a; };
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.timezone || "Europe/Budapest" }).format(new Date());
    const doneDeals = (deals ?? []).filter((d) => !(d.job_date && String(d.job_date) > todayStr));
    for (const d of doneDeals) {
        const c = leadCampaign.get(d.lead_id) || "-";
        const a = ensure(camp, c);
        a.rev += Number(d.amount);
        a.cost += Number(d.master_payout) + Number(d.extra_costs);
        a.deals++;
    }
    const leadsByCamp = new Map<string, {
        total: number;
        won: number;
    }>();
    for (const l of leads ?? []) {
        const c = l.campaign || "-";
        const x = leadsByCamp.get(c) ?? { total: 0, won: 0 };
        x.total++;
        if (l.status === "won")
            x.won++;
        leadsByCamp.set(c, x);
    }
    const spendByCamp = new Map<string, number>();
    const countedAds = countedAdRows(spend ?? []);
    for (const s of countedAds)
        spendByCamp.set(s.campaign, (spendByCamp.get(s.campaign) ?? 0) + spendToHuf(Number(s.spend), s.currency, cfg));
    const allCamps = new Set<string>([...camp.keys(), ...leadsByCamp.keys(), ...spendByCamp.keys()]);
    let tRev = 0, tCost = 0, tAd = 0;
    const rows = [...allCamps].sort().map((c) => {
        const a = camp.get(c) ?? { rev: 0, cost: 0, deals: 0 };
        const lc = leadsByCamp.get(c) ?? { total: 0, won: 0 };
        const ad = spendByCamp.get(c) ?? 0;
        const profit = a.rev - a.cost - ad;
        tRev += a.rev;
        tCost += a.cost;
        tAd += ad;
        const cpl = lc.total ? ad / lc.total : 0;
        const cac = lc.won ? ad / lc.won : 0;
        const roas = ad ? a.rev / ad : 0;
        return `<tr><td>${c === "-" ? "Без рекламы / повторные" : esc(c)}</td><td>${lc.total}</td><td>${lc.won}</td><td>${Ft(a.rev)}</td><td>${Ft(a.cost)}</td><td>${ad ? Ft(ad) : '<span class="muted">-</span>'}</td><td class="${profit >= 0 ? "pos" : "neg"}">${Ft(profit)}</td><td>${cpl ? Ft(cpl) : "-"}</td><td>${cac ? Ft(cac) : "-"}</td><td>${roas ? roas.toFixed(1) + "x" : "-"}</td></tr>`;
    }).join("");
    const totalProfit = tRev - tCost - tAd;
    const mAgg = new Map<string, {
        payout: number;
        net: number;
        jobs: number;
    }>();
    for (const d of doneDeals) {
        const name = d.master_id ? (masterName.get(d.master_id) ?? "?") : "(без мастера)";
        const x = mAgg.get(name) ?? { payout: 0, net: 0, jobs: 0 };
        x.payout += Number(d.master_payout);
        x.net += Number(d.amount) - Number(d.master_payout) - Number(d.extra_costs);
        x.jobs++;
        mAgg.set(name, x);
    }
    const mRows = [...mAgg.entries()].sort((a, b) => b[1].payout - a[1].payout).map(([n, x]) => `<tr><td>${esc(n)}</td><td>${x.jobs}</td><td>${Ft(x.payout)}</td><td class="pos">${Ft(x.net)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">нет данных</td></tr>`;
    const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    const monAgg = new Map<string, {
        deals: number;
        rev: number;
        cost: number;
    }>();
    for (const d of doneDeals) {
        const key = String(d.job_date || d.created_at || "").slice(0, 7);
        if (!key)
            continue;
        const x = monAgg.get(key) ?? { deals: 0, rev: 0, cost: 0 };
        x.deals++;
        x.rev += Number(d.amount);
        x.cost += Number(d.master_payout) + Number(d.extra_costs);
        monAgg.set(key, x);
    }
    const adByMonth = new Map<string, number>();
    for (const sp of countedAds) {
        const huf = spendToHuf(Number(sp.spend), sp.currency, cfg);
        const a = new Date(String(sp.date_start ?? sp.date_stop ?? "") + "T00:00:00Z");
        const b = new Date(String(sp.date_stop ?? sp.date_start ?? "") + "T00:00:00Z");
        if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a)
            continue;
        const days = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
        const perDay = huf / days;
        for (let i = 0; i < days; i++) {
            const dd = new Date(a.getTime() + i * 86400000);
            const key = dd.toISOString().slice(0, 7);
            adByMonth.set(key, (adByMonth.get(key) ?? 0) + perDay);
        }
    }
    for (const key of adByMonth.keys())
        if (!monAgg.has(key))
            monAgg.set(key, { deals: 0, rev: 0, cost: 0 });
    const expByMonth = new Map<string, number>();
    for (const e of expenses ?? []) {
        if (e.lead_id)
            continue;
        const key = String(e.spent_on).slice(0, 7);
        expByMonth.set(key, (expByMonth.get(key) ?? 0) + Number(e.amount ?? 0));
    }
    for (const key of expByMonth.keys())
        if (!monAgg.has(key))
            monAgg.set(key, { deals: 0, rev: 0, cost: 0 });
    const monRows = [...monAgg.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([ym, x]) => {
        const mm = ym.split("-");
        const label = `${MONTHS[Number(mm[1]) - 1] || mm[1]} ${mm[0]}`;
        const ex = expByMonth.get(ym) ?? 0;
        const ad = adByMonth.get(ym) ?? 0;
        const net = x.rev - x.cost - ex - ad;
        return `<tr><td>${label}</td><td>${x.deals}</td><td>${Ft(x.rev)}</td><td>${Ft(x.cost)}</td><td>${ex ? Ft(ex) : '<span class="muted">-</span>'}</td><td>${ad ? Ft(ad) : '<span class="muted">-</span>'}</td><td class="${net >= 0 ? "pos" : "neg"}">${Ft(net)}</td></tr>`;
    }).join("") || `<tr><td colspan="7" class="muted">нет сделок</td></tr>`;
    const monthlyPanel = `<div class="panel"><h2>📅 По месяцам</h2><table>
    <tr><th>Месяц</th><th>Сделок</th><th>Выручка</th><th>Мастера</th><th>Общие расходы</th><th>Реклама</th><th>Чистыми</th></tr>${monRows}</table>
    <p class="muted" style="margin-top:8px">Выручка и оплаты мастеров по месяцу заказа (job_date). Общие расходы считаются месяцем целиком. Реклама разложена по дням периода открутки: если строка из FB захватывает два месяца, сумма делится пропорционально дням. Венгерские кампании и вакансии исключены. Где ручная выгрузка из кабинета пересекается с ежедневными строками из API по той же кампании, берутся строки API: иначе одна и та же открутка считалась дважды.</p></div>`;
    const expTotal = (expenses ?? []).filter((e) => !e.lead_id).reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
    const expRows = (expenses ?? []).slice(0, 40).map((e) => `<tr><td>${esc(String(e.spent_on))}</td><td>${Ft(Number(e.amount))}</td><td>${e.lead_id ? "<span class=\"muted\">в сделке · </span>" : ""}${esc(String(e.note ?? ""))}</td><td><form method="post" action="?key=${k}&action=expense_del" onsubmit="return confirm('Удалить расход?')"><input type="hidden" name="id" value="${e.id}"><button class="btn small">✕</button></form></td></tr>`).join("") || `<tr><td colspan="4" class="muted">расходов не записано</td></tr>`;
    const adRows = [...(spend ?? [])]
        .sort((a, b) => String(b.date_start ?? "").localeCompare(String(a.date_start ?? "")))
        .slice(0, 40).map((sp) => {
        const per = String(sp.date_start ?? "") === String(sp.date_stop ?? "") ? String(sp.date_start ?? "") : `${String(sp.date_start ?? "")} - ${String(sp.date_stop ?? "")}`;
        const huf = spendToHuf(Number(sp.spend), sp.currency, cfg);
        return `<tr><td>${esc(per)}</td><td>${esc(String(sp.campaign ?? ""))}</td><td>${Number(sp.spend)} ${esc(String(sp.currency ?? ""))}</td><td>${Ft(huf)}</td><td><form method="post" action="?key=${k}&action=ad_del" onsubmit="return confirm('Удалить открутку?')"><input type="hidden" name="id" value="${sp.id}"><button class="btn small">✕</button></form></td></tr>`;
    }).join("") || `<tr><td colspan="5" class="muted">открутки не записано</td></tr>`;
    const adPanel = `<div class="panel"><h2>📣 Реклама</h2>
    <form method="post" action="?key=${k}&action=ad_add" class="row" style="gap:6px;align-items:end;margin-bottom:10px">
      <label>С<input type="date" name="date_start" required></label>
      <label>По<input type="date" name="date_stop" required></label>
      <label style="flex:1;min-width:200px">Кампания<input name="campaign" required placeholder="точное название из Ads Manager"></label>
      <label>Сумма<input type="number" name="spend" step="0.01" min="0.01" required style="width:100px"></label>
      <label>Валюта<select name="currency"><option>EUR</option><option>HUF</option><option>USD</option></select></label>
      <button class="btn">Добавить</button>
    </form>
    <table><tr><th>Период</th><th>Кампания</th><th>Открутка</th><th>В форинтах</th><th></th></tr>${adRows}</table>
    <p class="muted" style="margin-top:8px">Название кампании должно совпадать с тем, что стоит в карточках лидов, иначе строка не свяжется с заказами и попадёт в P&L отдельной строкой без выручки. Период раскладывается по дням, поэтому открутку за месяц можно вписывать одной строкой. Массово грузится через «Данные», импорт CSV из Ads Manager.</p></div>`;
    const expensesPanel = `<div class="panel"><h2>🧾 Общие расходы</h2>
    <form method="post" action="?key=${k}&action=expense_add" class="row" style="gap:6px;align-items:end;margin-bottom:10px">
      <label>Дата<input type="date" name="spent_on" required></label>
      <label>Сумма, Ft<input type="number" name="amount" step="1" min="1" required style="width:120px"></label>
      <label style="flex:1;min-width:180px">Что это<input name="note" placeholder="бензин, проездной, химия, такси"></label>
      <button class="btn">Добавить</button>
    </form>
    <table><tr><th>Дата</th><th>Сумма</th><th>Что</th><th></th></tr>${expRows}</table>
    <p class="muted" style="margin-top:8px">Расходы, которые не относятся к конкретному заказу. Всего записано ${Ft(expTotal)}. Вычитаются из прибыли месяца целиком, не размазываются по заказам.</p></div>`;
    if (role === "supervisor") {
        const netNoAd = tRev - tCost;
        return `<div class="kpis">
      <div class="kpi"><div class="v">${Ft(tRev)}</div><div class="l">Выручка</div></div>
      <div class="kpi"><div class="v">${Ft(tCost)}</div><div class="l">Мастера + расходы</div></div>
      <div class="kpi"><div class="v ${netNoAd >= 0 ? "pos" : "neg"}">${Ft(netNoAd)}</div><div class="l">Чистыми</div></div></div>
    ${monthlyPanel}
    ${expensesPanel}
    <div class="panel"><h2>🧹 По мастерам</h2><table><tr><th>Мастер</th><th>Работ</th><th>Выплачено</th><th>Принёс чистыми</th></tr>${mRows}</table>
    <p class="muted" style="margin-top:8px">Выручка и оплаты мастеров. Рекламные расходы и окупаемость для этой роли скрыты.</p></div>`;
    }
    return `<div class="kpis">
    <div class="kpi"><div class="v">${Ft(tRev)}</div><div class="l">Выручка</div></div>
    <div class="kpi"><div class="v">${Ft(tCost)}</div><div class="l">Мастера + расходы</div></div>
    <div class="kpi"><div class="v">${Ft(tAd)}</div><div class="l">Реклама</div></div>
    <div class="kpi"><div class="v ${totalProfit >= 0 ? "pos" : "neg"}">${Ft(totalProfit)}</div><div class="l">Чистая прибыль</div></div></div>
  ${monthlyPanel}
  ${expensesPanel}
  ${adPanel}
  <div class="panel"><h2>📊 P&L по кампаниям</h2><div style="overflow-x:auto"><table>
    <tr><th>Кампания</th><th>Лиды</th><th>Выигр.</th><th>Выручка</th><th>Мастер+доп</th><th>Реклама</th><th>Прибыль</th><th>CPL</th><th>CAC</th><th>ROAS</th></tr>
    ${rows || `<tr><td colspan="10" class="muted">нет данных</td></tr>`}</table></div>
    <p class="muted" style="margin-top:8px">CPL - цена лида (реклама/лиды). CAC - цена клиента (реклама/выигранные). ROAS - выручка/реклама. Реклама в HUF (EUR/USD по курсу из настроек). Венгерские кампании и вакансии исключены из расчёта (другая воронка / найм).</p></div>
  <div class="panel"><h2>🧹 По мастерам</h2><table><tr><th>Мастер</th><th>Работ</th><th>Выплачено</th><th>Принёс чистыми</th></tr>${mRows}</table></div>`;
}
async function paged(page: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
}>): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let off = 0;; off += 1000) {
        const { data, error } = await page(off, off + 999);
        if (error) {
            console.error("paged", error);
            throw new Error(`paged query failed at offset ${off}`);
        }
        out.push(...((data ?? []) as Record<string, unknown>[]));
        if (!data || data.length < 1000)
            break;
    }
    return out;
}
async function viewAnalytics(cfg: Cfg, k: string, from: string, to: string, city: string, mode: string): Promise<string> {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.timezone || "Europe/Budapest" }).format(new Date());
    const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isDay(to))
        to = today;
    if (!isDay(from))
        from = shiftDay(today, -13);
    if (from > to)
        [from, to] = [to, from];
    const m: Mode = mode === "job" ? "job" : "lead";
    const prevTo = shiftDay(from, -1), prevFrom = shiftDay(from, -spanDays(from, to));
    const monthsBack = new Date(today.slice(0, 8) + "01T00:00:00Z");
    monthsBack.setUTCMonth(monthsBack.getUTCMonth() - 2);
    const since = [prevFrom, shiftDay(to, -56), monthsBack.toISOString().slice(0, 10)].sort()[0];
    const [deals, spend, expenses] = await Promise.all([
        paged((a, b) => supabase.from("crm_deals").select("id,lead_id,amount,master_payout,extra_costs,hours,job_date,closed_at").order("id").range(a, b)),
        paged((a, b) => supabase.from("crm_ad_spend").select("*").order("id").range(a, b)),
        paged((a, b) => supabase.from("crm_expenses").select("id,spent_on,amount,lead_id").order("id").range(a, b)),
    ]);
    const jobLeads = [...new Set(deals.filter((d) => d.lead_id && d.job_date && String(d.job_date) >= prevFrom && String(d.job_date) <= to).map((d) => String(d.lead_id)))];
    const leadFilter = [`received_at.gte.${since}`, `created_at.gte.${since}`, `scheduled_at.gte.${since}`, ...(jobLeads.length ? [`id.in.(${jobLeads.join(",")})`] : [])].join(",");
    const leads = await paged((a, b) => supabase.from("crm_leads").select("id,status,source,service,language,country,campaign,attribution,answers,budget,scheduled_at,received_at,created_at").neq("source", "job_application").or(leadFilter).order("id").range(a, b));
    const waIds = leads.filter((l) => String(l.source ?? "").toLowerCase().startsWith("whatsapp")).map((l) => String(l.id));
    const firstMsg = new Map<string, string>();
    const chunks = Array.from({ length: Math.ceil(waIds.length / 100) }, (_, i) => waIds.slice(i * 100, i * 100 + 100));
    for (const { data } of await Promise.all(chunks.map((ids) => supabase.from("crm_wa_first_in").select("lead_id,body").in("lead_id", ids)))) {
        for (const r of data ?? [])
            firstMsg.set(String(r.lead_id), String(r.body ?? ""));
    }
    for (const l of leads) {
        const msg = firstMsg.get(String(l.id));
        if (msg)
            l.first_msg = msg;
    }
    const adRows = countedAdRows(spend);
    const adByDay = spreadByDay(adRows, (n, c) => spendToHuf(n, c, cfg));
    const expenseByDay = generalExpensesByDay(expenses);
    const adDir = adByDirDay(adRows, (n, c) => spendToHuf(n, c, cfg));
    const L = leads as unknown as Lead[], D = deals as unknown as Deal[];
    const a = buildAnalytics(L, D, adByDay, from, to, city, m, today, expenseByDay, cfg.timezone || "Europe/Budapest");
    const pa = buildAnalytics(L, D, adByDay, prevFrom, prevTo, city, m, today, expenseByDay, cfg.timezone || "Europe/Budapest");
    const pfb = pa.chans.find((c) => c.id === "fb")!;
    const prev = { total: pa.total, orders: pa.orders, sum: pa.sum, ad: pa.ad, won: pa.won, junk: pa.junk, fbLeads: pfb.leads, fbOrders: pfb.orders, masterPayout: pa.masterPayout, dealExpenses: pa.dealExpenses, generalExpenses: pa.generalExpenses, net: pa.net, from: prevFrom, to: prevTo };
    const rows = a.rows;
    const SVC: Record<string, string> = { upholstery: "Химчистка", windows: "Окна", deep: "Клининг (генер.)", regular: "Клининг (регул.)", cleaning: "Клининг" };
    const segCols = (c: Record<string, number>, total: number) => {
        const conv = total ? Math.round(((c["won"] || 0) / total) * 100) : 0;
        return `<td><b>${total}</b></td><td>${c["new"] || 0}</td><td>${c["contacted"] || 0}</td><td>${(c["in_progress"] || 0) + (c["pushing"] || 0)}</td><td>${c["follow_up"] || 0}</td><td class="pos">${c["won"] || 0}</td><td>${c["lost"] || 0}</td><td>${c["junk"] || 0}</td><td>${conv}%</td>`;
    };
    const segAgg = new Map<string, {
        svc: string;
        lang: string;
        c: Record<string, number>;
        total: number;
    }>();
    for (const l of rows) {
        const key = (l.service || "?") + "|" + (l.language || "?");
        let a = segAgg.get(key);
        if (!a) {
            a = { svc: l.service || "?", lang: l.language || "?", c: {}, total: 0 };
            segAgg.set(key, a);
        }
        a.total++;
        a.c[l.status] = (a.c[l.status] || 0) + 1;
    }
    const segRows = [...segAgg.values()].sort((a, b) => b.total - a.total).map((a) => `<tr><td>${SVC[a.svc] || esc(a.svc)}</td><td>${(a.lang || "").toUpperCase()}</td>${segCols(a.c, a.total)}</tr>`).join("") || `<tr><td colspan="10" class="muted">нет заявок за период</td></tr>`;
    const campAgg = new Map<string, {
        c: Record<string, number>;
        total: number;
    }>();
    for (const l of rows) {
        const key = l.campaign || "(без кампании)";
        let a = campAgg.get(key);
        if (!a) {
            a = { c: {}, total: 0 };
            campAgg.set(key, a);
        }
        a.total++;
        a.c[l.status] = (a.c[l.status] || 0) + 1;
    }
    const campRows = [...campAgg.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, a]) => `<tr><td>${esc(name)}</td>${segCols(a.c, a.total)}</tr>`).join("") || `<tr><td colspan="9" class="muted">нет заявок за период</td></tr>`;
    const headCols = `<th>Заявок</th><th>Новые</th><th>📨Ждём</th><th>В работе</th><th>Раздумья</th><th>✅Заказы</th><th>❌Слив</th><th>🚫Мусор</th><th>%зак</th>`;
    const known = adCampaigns(adRows);
    const dirs = buildDirections(L, D, adDir, from, to, city, m, known);
    const pdirs = buildDirections(L, D, adDir, prevFrom, prevTo, city, m, known);
    const dirMonths = buildDirMonths(L, D, adDir, today, city, m, 3, known);
    return renderAnalytics(a, prev, k, from, to, city, today, dirs, pdirs, dirMonths) + `<details class="dx-legacy"><summary>Подробные таблицы: направления, языки, кампании</summary><div class="panel"><h2>🧩 По направлениям и языкам</h2>
    <div style="overflow-x:auto"><table><tr><th>Направление</th><th>Язык</th>${headCols}</tr>${segRows}</table></div>
    <p class="muted" style="margin-top:8px">По дате заявки. «В работе» = в работе + дожим. «Раздумья» = follow-up. «Мусор» = нет связи / ошибка номера. %зак = заказы / заявки.</p></div>
  <div class="panel"><h2>🎯 По кампаниям</h2><div style="overflow-x:auto"><table><tr><th>Кампания</th>${headCols}</tr>${campRows}</table></div>
    <p class="muted" style="margin-top:8px">Та же воронка по конкретной кампании - видно, какой креатив даёт квалов и заказы, а какой только мусор (повод для контекстного перезапуска).</p></div></details>`;
}
async function viewReviews(cfg: Cfg, k: string, note = ""): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    const { data } = await supabase.from("crm_gbp_reviews").select("*").order("created_at", { ascending: false }).limit(200);
    const rows = data ?? [];
    const open = rows.filter((r) => !r.reply_comment);
    const card = (r: Record<string, unknown>) => {
        const head = `<b>${esc(r.reviewer_name || "-")}</b> <span style="color:#b8860b">${"★".repeat(Number(r.stars) || 0)}</span> <span style="color:#6b7280;font-size:12px">${fmtLocal(tz, r.created_at as string)}</span>`;
        const body = r.comment ? `<div style="white-space:pre-wrap;margin:6px 0">${esc(r.comment)}</div>` : `<div style="color:#6b7280;margin:6px 0"><i>без текста</i></div>`;
        const reply = r.reply_comment
            ? `<div style="background:#eef7f0;border-radius:8px;padding:6px 8px;white-space:pre-wrap"><span class="pill" style="background:#2d6a4f">Ответ${r.published_at ? " из CRM" : ""}</span> ${esc(r.reply_comment)}</div>`
            : `<form method="post" action="?key=${k}&action=gbp_reply" onsubmit="return confirm('Опубликовать ответ в Google?')"><input type="hidden" name="review" value="${esc(r.review_id)}"><textarea name="comment" placeholder="Ответ: 2-3 предложения, без ссылок, телефонов и акций">${esc(r.draft_reply ?? "")}</textarea><div class="row" style="gap:8px;margin-top:6px"><button style="background:#b8860b">⭐ Опубликовать ответ</button><span style="color:#6b7280;font-size:12px">${r.draft_reply ? "черновик от Claude, поправь перед отправкой" : ""}</span></div></form>`;
        return `<div class="card" style="border-left-color:${r.reply_comment ? "#2d6a4f" : "#d4740e"};cursor:default">${head}${body}${reply}</div>`;
    };
    return `<h2>⭐ Отзывы Google</h2>${note ? `<div class="card" style="border-left-color:${note.startsWith("✅") ? "#2d6a4f" : "#c53030"}">${esc(note)}</div>` : ""}
<p style="color:#6b7280">Всего ${rows.length} · без ответа ${open.length}. Новые подтягиваются раз в 3 часа. Ответ уходит в Google только по кнопке.</p>
${open.map(card).join("")}${rows.filter((r) => r.reply_comment).map(card).join("")}`;
}
async function publishGbpReply(form: URLSearchParams): Promise<string> {
    const id = form.get("review") || "", comment = (form.get("comment") || "").replace(/\u2014/g, "-").trim();
    const bad = replyProblem(comment);
    if (!id || bad)
        return `Не опубликовано: ${bad || "нет отзыва"}`;
    const { data: cur } = await supabase.from("crm_gbp_reviews").select("reply_comment").eq("review_id", id).maybeSingle();
    if (!cur)
        return "Не опубликовано: отзыв не найден";
    if (cur.reply_comment)
        return "Не опубликовано: на этот отзыв уже есть ответ";
    try {
        await gbpReply(await gbpToken(), id, comment);
    }
    catch (e) {
        console.error("gbp reply", e);
        return `Не опубликовано: ${(e as Error).message}`;
    }
    const at = new Date().toISOString();
    await supabase.from("crm_gbp_reviews").update({ reply_comment: comment, reply_updated_at: at, published_at: at }).eq("review_id", id);
    return "✅ Ответ опубликован в Google";
}
async function viewCandidates(cfg: Cfg, k: string): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    const CST = HIRE;
    const EXP: Record<string, string> = { none: "Нет опыта", "1-2": "1-2 года", "3+": "3+ лет" };
    const AVL: Record<string, string> = { full: "Полный день", part: "Частичная", weekends: "Выходные" };
    const { data: leads } = await supabase.from("crm_leads").select("id,status,name,phone,answers,created_at")
        .eq("source", "job_application").order("created_at", { ascending: false }).limit(1000);
    const rows = leads ?? [];
    const ids = new Set(rows.map((l) => l.id));
    const { data: tl } = await supabase.from("crm_timeline").select("lead_id").eq("kind", "note");
    const noteCount = new Map<string, number>();
    for (const n of tl ?? [])
        if (ids.has(n.lead_id))
            noteCount.set(n.lead_id, (noteCount.get(n.lead_id) || 0) + 1);
    const active = rows.filter((l) => ["contacted", "screening", "trial", "in_progress", "pushing", "follow_up"].includes(l.status)).length;
    const onTrial = rows.filter((l) => l.status === "trial").length;
    const hired = rows.filter((l) => l.status === "won").length;
    const kpis = `<div class="kpis">
    <div class="kpi"><div class="v">${rows.length}</div><div class="l">Всего анкет</div></div>
    <div class="kpi"><div class="v">${rows.filter((l) => l.status === "new").length}</div><div class="l">Новые</div></div>
    <div class="kpi"><div class="v">${active}</div><div class="l">В работе</div></div>
    <div class="kpi"><div class="v">${onTrial}</div><div class="l">На пробном</div></div>
    <div class="kpi"><div class="v pos">${hired}</div><div class="l">Работают</div></div></div>`;
    const trs = rows.map((l) => {
        const a = (l.answers ?? {}) as Record<string, string>;
        const ph = String(l.phone || "").replace(/[^0-9]/g, "");
        const hay = esc(((l.name || "") + " " + ph + " " + (ph.length >= 9 ? ph.slice(-9) : "") + " " + (a.district || "")).toLowerCase());
        const wa = waDigits(l.phone) ? ` <span role="button" title="Написать в WhatsApp" style="background:#25D366;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;cursor:pointer" onclick="window.open('https://api.whatsapp.com/send?phone=${waDigits(l.phone)}','_blank')">💬 WA</span>` : "";
        const n = noteCount.get(l.id) || 0;
        return `<tr class="cand" data-q="${hay}">
      <td><a href="?key=${k}&lead=${l.id}"><b>${esc(l.name) || "-"}</b></a></td>
      <td>${esc(l.phone) || "-"}${wa}</td>
      <td>${esc(a.district) || "-"}</td>
      <td>${EXP[a.experience] || esc(a.experience) || "-"}</td>
      <td>${AVL[a.availability] || esc(a.availability) || "-"}</td>
      <td><form id="cf${l.id}" method="post" action="?key=${k}&action=cand_update" style="margin:0"><input type="hidden" name="lead" value="${l.id}"></form><select form="cf${l.id}" name="status" style="width:168px;padding:4px;color:${HIRE_COLOR[l.status] || "#666"}">${HIRE_KEYS.concat(HIRE_KEYS.includes(l.status) ? [] : [l.status]).map((s) => `<option value="${s}" ${l.status === s ? "selected" : ""}>${CST[s] ?? (STATUS[s] ? STATUS[s] + " (старый статус)" : s)}</option>`).join("")}</select></td>
      <td><div class="row" style="gap:4px;align-items:center;margin:0"><input form="cf${l.id}" name="note" placeholder="${n ? `📝 ${n} · добавить` : "заметка / коммент"}" style="min-width:120px;padding:4px"><button form="cf${l.id}" class="sec" style="padding:4px 9px;font-size:12px" title="Сохранить статус и заметку">💾</button></div>${n ? `<a class="muted" href="?key=${k}&lead=${l.id}" style="font-size:11px">открыть (${n})</a>` : ""}</td>
      <td class="muted">${fmtLocal(tz, l.created_at)} · ${ageDays(l.created_at)} дн.</td>
    </tr>`;
    }).join("") || `<tr><td colspan="8" class="muted">Пока нет анкет. Кандидаты появятся здесь после заявок со страницы вакансий (rabota.html).</td></tr>`;
    const search = `<div class="search"><input id="cq" type="search" placeholder="🔎 Поиск по имени, телефону или району..." autocomplete="off"><span id="cqn" class="muted"></span></div>`;
    const filterScript = `<script>(function(){var q=document.getElementById('cq');if(!q)return;var rs=[].slice.call(document.querySelectorAll('tr.cand'));
function apply(){var raw=q.value.trim().toLowerCase();var dig=q.value.replace(/[^0-9]/g,'');var t=raw||dig;var shown=0;
rs.forEach(function(r){var h=r.getAttribute('data-q')||'';var d2=dig.replace(/^0+/,'');var tail=dig.length>=9?dig.slice(-9):'';var ok=!t||(raw&&h.indexOf(raw)!==-1)||(dig.length>=3&&(h.indexOf(dig)!==-1||h.indexOf(d2)!==-1))||(tail&&h.indexOf(tail)!==-1);r.style.display=ok?'':'none';if(ok)shown++;});
var n=document.getElementById('cqn');if(n)n.textContent=t?('найдено: '+shown):'';}
q.addEventListener('input',apply);q.addEventListener('keydown',function(e){if(e.key==='Escape'){q.value='';apply();}});})();</script>`;
    return kpis + `<div class="panel"><h2>🧹 Кандидаты в клинеры</h2>${search}
    <div style="overflow-x:auto"><table><tr><th>Имя</th><th>Телефон</th><th>Район</th><th>Опыт</th><th>Занятость</th><th>Статус</th><th>Заметки</th><th>Заявка</th></tr>${trs}</table></div>
    <p class="muted" style="margin-top:8px">Клик по имени открывает карточку: там заметки, задачи и смена статуса. Путь кандидата: новая анкета → написали и ждём ответа → отвечает, уточняем документы, район и дни → назначен пробный выезд с наставником → работает. Отдельно «Не пришла» для тех, кто согласился на пробный и не приехал: это не отказ, а срыв, и считать их надо отдельно, иначе не видно, сколько людей теряется именно на пробном.</p></div>` + filterScript;
}
async function viewMasters(cfg: Cfg, k: string): Promise<string> {
    const { data: ms } = await supabase.from("crm_masters").select("*").order("name");
    const payOpts = (sel: string) => `<option value="percent" ${sel !== "hourly" ? "selected" : ""}>% от заказа</option><option value="hourly" ${sel === "hourly" ? "selected" : ""}>ставка в час</option>`;
    const rows = (ms ?? []).map((m) => `<tr>
    <td>${m.active ? "🟢" : "⚪"}</td>
    <td><form method="post" action="?key=${k}&action=master_save" class="row" style="gap:4px;align-items:end">
      <input type="hidden" name="id" value="${m.id}">
      <div style="flex:0 0 130px"><input name="name" value="${esc(m.name)}"></div>
      <div style="flex:0 0 120px"><input name="phone" value="${esc(m.phone)}" placeholder="телефон"></div>
      <div style="flex:0 0 120px"><select name="pay_type">${payOpts(m.pay_type)}</select></div>
      <div style="flex:0 0 70px"><input name="default_pct" type="number" value="${m.default_pct}" title="%"></div>
      <div style="flex:0 0 90px"><input name="hourly_rate" type="number" value="${Number(m.hourly_rate)}" title="Ft/час"></div>
      <div style="flex:0 0 80px"><select name="active"><option value="true" ${m.active ? "selected" : ""}>вкл</option><option value="false" ${!m.active ? "selected" : ""}>выкл</option></select></div>
      <div style="flex:0 0 80px"><input name="district" value="${esc(m.district)}" placeholder="район" title="район, где живёт"></div>
      <div style="flex:0 0 160px"><select name="experience" title="можно ли отправлять одну">${expOpts(m.experience)}</select></div>
      <div style="flex:1 1 220px"><input name="availability_note" value="${esc(m.availability_note)}" placeholder="доступность: окна, отпуска, ограничения"></div>
      <div style="flex:1 1 100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:#6b7280">📅 ${DOW_RU.map((dn, di) => `<label style="display:inline-flex;align-items:center;gap:3px"><input type="checkbox" name="work_days" value="${di + 1}" ${(((m.work_days as number[] | null) ?? []).includes(di + 1)) ? "checked" : ""}>${dn}</label>`).join("")}</div>
      <input type="hidden" name="wd_present" value="1"><div><button class="sec">Сохранить</button></div></form>
      <div class="muted" style="font-size:11px;margin-top:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">📅 Работает: ${daysLabel(m.work_days)}${m.district ? ` · 📍 ${esc(m.district)}` : ""} · ${EXP[String(m.experience || "none")] ?? ""}
        <form method="post" action="?key=${k}&action=master_delete" onsubmit="return confirm('Удалить мастера? Если у него есть закрытые сделки, он будет отключён, а история сохранится.')" style="margin:0"><input type="hidden" name="id" value="${m.id}"><button class="sec" style="padding:2px 8px;font-size:12px;color:#c53030">🗑 Удалить</button></form></div></td></tr>`).join("");
    return `<div class="panel"><h2 style="display:flex;justify-content:space-between;align-items:center;gap:10px">🧹 Мастера
      <a href="?key=${k}&action=export&type=masters" style="text-decoration:none"><button class="sec" style="font-size:13px;padding:5px 10px">⬇️ Скачать в Excel</button></a></h2>
    <p class="muted">Тип оплаты: «% от заказа» (химчистка, окна) или «ставка в час» (клининг). Заполни нужное поле - % или Ft/час.</p>
    <table><tr><th></th><th>Имя · телефон · тип · % · Ft/час · статус</th></tr>${rows || `<tr><td colspan="2" class="muted">нет мастеров</td></tr>`}</table></div>
  <div class="panel"><h2>➕ Добавить мастера</h2>
    <form method="post" action="?key=${k}&action=master_save"><div class="row">
      <div><label>Имя</label><input name="name" required></div>
      <div><label>Телефон</label><input name="phone"></div>
      <div><label>Тип оплаты</label><select name="pay_type">${payOpts("percent")}</select></div>
      <div><label>% от заказа</label><input name="default_pct" type="number" value="${esc(cfg.default_master_pct || "30")}"></div>
      <div><label>Ставка Ft/час</label><input name="hourly_rate" type="number" value="0"></div>
      <div><label>Район</label><input name="district" placeholder="напр. XIV"></div>
      <div><label>Опыт</label><select name="experience">${expOpts("none")}</select></div>
      <div style="flex:1 1 100%"><label>Доступность (окна, отпуска, ограничения)</label><input name="availability_note" placeholder="напр. август каждый день кроме пятницы 8 ч, с сентября только выходные"></div>
    </div><div style="margin-top:10px"><button>Добавить</button></div></form></div>`;
}
async function viewData(cfg: Cfg, k: string): Promise<string> {
    const { data: spend } = await supabase.from("crm_ad_spend").select("*").order("imported_at", { ascending: false }).limit(200);
    const rows = (spend ?? []).map((s) => `<tr><td>${esc(s.campaign)}</td><td>${s.date_start ?? ""} → ${s.date_stop ?? ""}</td><td>${fmt(Number(s.spend))} ${esc(s.currency)}</td><td>${fmt(Number(s.impressions))}</td><td>${fmt(Number(s.clicks))}</td><td>${s.leads_reported}</td><td>${esc(String(s.source_file || "").slice(0, 28)) || "meta_api"}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">пока ничего не импортировано</td></tr>`;
    const sync = cfg.meta_ads_last_sync_at ? fmtLocal(cfg.timezone || "Europe/Budapest", String(cfg.meta_ads_last_sync_at)) : "";
    const syncErr = String(cfg.meta_ads_last_sync_error || "");
    const syncLine = syncErr
        ? `<div style="color:#c53030"><b>⚠ Синхронизация с Meta не отработала:</b> ${esc(syncErr.slice(0, 160))}. Расход за последние дни может быть неполным - тогда пригодится резервный импорт ниже.</div>`
        : `<div style="color:#2d6a4f">✓ Расход на рекламу приходит из Meta сам${sync ? `, последний раз ${sync}` : ""}. Вручную загружать не нужно.</div>`;
    return `<div class="panel"><h2>⬇️ Экспорт</h2><p>Скачать данные в CSV (для Excel, расчёта маржи и т.д.).</p>
    <a href="?key=${k}&action=export&type=leads"><button>Лиды (CSV)</button></a>
    <a href="?key=${k}&action=export&type=deals"><button>Сделки (CSV)</button></a>
    <a href="?key=${k}&action=export&type=masters"><button>Мастера (CSV)</button></a></div>
  <div class="panel"><h2>📣 Расход на рекламу</h2>
    ${syncLine}
    <table style="margin-top:14px"><tr><th>Кампания</th><th>Период</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды</th><th>Откуда</th></tr>${rows}</table>
    <details style="margin-top:16px">
      <summary style="cursor:pointer;font-size:13px;color:#6b7280">Резервный ручной импорт расходов</summary>
      <p class="muted" style="margin-top:8px">Нужен, только если синхронизация с Meta встала: протух токен, слетели права, поменялся API. В обычной работе не трогать - загрузка периода, который уже пришёл из Meta, задваивает расход и занижает маржу.</p>
      <p class="muted">Экспортируй отчёт из Ads Manager в CSV (колонки: Campaign name, Amount spent, Impressions, Clicks, Results/Leads, Reporting starts/ends), открой его и вставь весь текст сюда.</p>
      <form method="post" action="?key=${k}&action=import_ads"><textarea name="csv" style="min-height:140px" placeholder="Campaign name,Amount spent (EUR),Impressions,...&#10;..."></textarea>
        <div style="margin-top:8px"><button>Импортировать</button></div></form>
    </details></div>`;
}
async function viewOrders(cfg: Cfg, k: string): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    const { data: deals } = await supabase.from("crm_deals").select("*").order("created_at", { ascending: false }).limit(500);
    const { data: leads } = await supabase.from("crm_leads").select("id,name,phone,service");
    const { data: masters } = await supabase.from("crm_masters").select("id,name");
    const leadById = new Map((leads ?? []).map((l) => [l.id, l]));
    const masterName = (id: unknown) => (masters ?? []).find((m) => m.id === id)?.name ?? "";
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const future = (deals ?? []).filter((d) => d.job_date && String(d.job_date) > todayStr);
    const done = (deals ?? []).filter((d) => !(d.job_date && String(d.job_date) > todayStr));
    let totRev = 0, totPay = 0, totNet = 0;
    const byMaster = new Map<string, {
        count: number;
        rev: number;
        pay: number;
    }>();
    for (const d of done) {
        const rev = Number(d.amount), pay = Number(d.master_payout), ex = Number(d.extra_costs);
        totRev += rev;
        totPay += pay;
        totNet += rev - pay - ex;
        const mn = d.master_id ? (masterName(d.master_id) || "?") : "Без мастера";
        const s = byMaster.get(mn) ?? { count: 0, rev: 0, pay: 0 };
        s.count++;
        s.rev += rev;
        s.pay += pay;
        byMaster.set(mn, s);
    }
    const rowHtml = (d: Record<string, unknown>) => {
        const l = leadById.get(d.lead_id);
        const net = Number(d.amount) - Number(d.master_payout) - Number(d.extra_costs);
        const basis = d.hours != null ? `${d.hours} ч` : (d.master_pct != null ? `${d.master_pct}%` : "");
        const mOpts = (masters ?? []).map((m) => `<option value="${m.id}" ${m.id === d.master_id ? "selected" : ""}>${esc(m.name)}</option>`).join("");
        return `<tr>
      <td><input form="df${d.id}" name="job_date" type="date" value="${d.job_date ?? ""}" style="width:140px"></td>
      <td>${esc(l?.name) || "?"}${l?.phone ? `<div class="muted" style="font-size:11px">${esc(l.phone)}</div>` : ""}</td>
      <td>${esc(d.service_done) || esc(l?.service) || ""}${basis ? ` <span class="muted">(${basis})</span>` : ""}</td>
      <td><form id="df${d.id}" method="post" action="?key=${k}&action=deal_edit" class="row" style="gap:6px;align-items:flex-end;margin:0;flex-wrap:wrap">
        <input type="hidden" name="deal_id" value="${d.id}"><input type="hidden" name="lead" value="${d.lead_id}">
        <label style="display:flex;flex-direction:column;font-size:9px;color:#8a94a6;gap:1px">Сумма<input name="amount" type="number" step="1" value="${Number(d.amount)}" style="width:86px"></label>
        <label style="display:flex;flex-direction:column;font-size:9px;color:#8a94a6;gap:1px">Мастеру<input name="master_payout" type="number" step="1" value="${Number(d.master_payout)}" style="width:80px"></label>
        <label style="display:flex;flex-direction:column;font-size:9px;color:#8a94a6;gap:1px">Доп<input name="extra_costs" type="number" step="1" value="${Number(d.extra_costs)}" style="width:62px"></label>
        <label style="display:flex;flex-direction:column;font-size:9px;color:#8a94a6;gap:1px;flex:1">Разбивка / заметка (свободный текст)<input name="notes" value="${esc(d.notes)}" placeholder="напр. Окна 75 · Мария 14 · Катя 10 · Петя 26 · бензин 7к" style="min-width:180px"></label>
        <button class="sec" style="padding:5px 9px;font-size:12px" title="Сохранить">💾</button>
      </form></td>
      <td><select form="df${d.id}" name="master_id" style="width:130px"><option value="">- без мастера</option>${mOpts}</select></td>
      <td class="pos">${Ft(net)}</td>
    </tr>`;
    };
    const rows = done.map(rowHtml).join("") || `<tr><td colspan="6" class="muted">пока нет отработанных заказов</td></tr>`;
    const futureRows = future.map(rowHtml).join("");
    const summary = [...byMaster.entries()].sort((a, b) => b[1].count - a[1].count)
        .map(([mn, s]) => `<tr><td>${esc(mn)}</td><td>${s.count}</td><td>${Ft(s.rev)}</td><td>${Ft(s.pay)}</td></tr>`).join("")
        || `<tr><td colspan="4" class="muted">нет данных</td></tr>`;
    const futurePanel = futureRows
        ? `<div class="panel"><h2>📅 Запланировано (ещё не выполнено)</h2>
    <p class="muted">Выезд в будущем (по дате работы). В «Выручку» и «Чистыми» ниже НЕ попадает - учтётся, когда наступит дата. Если работа уже сделана - поправь дату в строке на сегодня/прошлое.</p>
    <table><tr><th>Дата</th><th>Клиент</th><th>Услуга</th><th>Сумма · Мастеру · Доп · Заметка</th><th>Мастер</th><th>Чистыми</th></tr>${futureRows}</table></div>`
        : "";
    return `${futurePanel}<div class="panel"><h2>📦 Отработанные заказы</h2>
    <p class="muted">Все выполненные сделки в одном месте. Поправь сумму / оплату мастеру / доп. расходы прямо в строке (допродажа или скидка) и нажми 💾 - Маржа пересчитается. «Чистыми» = сумма − мастеру − доп.</p>
    <div class="kpis">
      <div class="kpi"><div class="v">${done.length}</div><div class="l">Заказов</div></div>
      <div class="kpi"><div class="v">${Ft(totRev)}</div><div class="l">Выручка</div></div>
      <div class="kpi"><div class="v">${Ft(totPay)}</div><div class="l">Мастерам</div></div>
      <div class="kpi"><div class="v pos">${Ft(totNet)}</div><div class="l">Чистыми</div></div>
    </div>
    <table><tr><th>Дата</th><th>Клиент</th><th>Услуга</th><th>Сумма · Мастеру · Доп · Заметка</th><th>Мастер</th><th>Чистыми</th></tr>${rows}</table></div>
  <div class="panel"><h2>👷 По мастерам</h2>
    <table><tr><th>Мастер</th><th>Заказов</th><th>Выручка</th><th>Выплата</th></tr>${summary}</table></div>`;
}
async function viewUsers(cfg: Cfg, k: string): Promise<string> {
    const { data: users } = await supabase.from("crm_users").select("id,username,role,master_id,active").order("username");
    const { data: masters } = await supabase.from("crm_masters").select("id,name").order("name");
    const mName = (id: string) => (masters ?? []).find((m) => m.id === id)?.name ?? "";
    const mopts = (sel?: string) => `<option value="">-</option>` + (masters ?? []).map((m) => `<option value="${m.id}" ${sel === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("");
    const roleLabel = (r: string) => r === "full" ? "Полный" : r === "marketer" ? "Маркетолог" : r === "supervisor" ? "Супервайзер" : "Мастер";
    const rows = (users ?? []).map((u) => `<tr><td>${esc(u.username)}</td><td>${roleLabel(u.role)}</td><td>${esc(mName(u.master_id))}</td><td>${u.active ? "🟢" : "⚪"}</td>
    <td><form method="post" action="?key=${k}&action=user_delete" style="display:inline"><input type="hidden" name="id" value="${u.id}"><button class="sec" style="padding:2px 8px;font-size:12px">удалить</button></form></td></tr>`).join("") || `<tr><td colspan="5" class="muted">нет пользователей</td></tr>`;
    return `<div class="panel"><h2>👥 Доступы</h2>
    <p class="muted">«Полный» - ты и маркетолог (видят всё). «Мастер» - только свои назначенные заказы и свою оплату. Раздай людям логин/пароль; ключ-ссылку больше никому не давай. Создание пользователя с тем же логином меняет пароль/роль.</p>
    <table><tr><th>Логин</th><th>Роль</th><th>Мастер</th><th>Вкл</th><th></th></tr>${rows}</table></div>
  <div class="panel"><h2>➕ Добавить / изменить пользователя</h2>
    <form method="post" action="?key=${k}&action=user_save"><div class="row">
      <div><label>Логин</label><input name="username" required></div>
      <div><label>Пароль</label><input name="password" required></div>
      <div><label>Роль</label><select name="role"><option value="full">Полный (владелец)</option><option value="marketer">Маркетолог (всё кроме удаления)</option><option value="supervisor">Супервайзер (без рекламы)</option><option value="master">Мастер (свои заказы)</option></select></div>
      <div><label>Если мастер - кто</label><select name="master_id">${mopts()}</select></div>
    </div><div style="margin-top:10px"><button>Сохранить</button></div></form></div>`;
}
const PHOTO_MIN = 10;
async function viewGallery(cfg: Cfg, k: string, svc: string): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    const LIMIT = 160;
    const { data: ph } = await supabase.from("crm_job_photos")
        .select("lead_id,path,phase,created_at")
        .order("created_at", { ascending: false }).limit(LIMIT);
    if (!ph?.length)
        return `<div class="panel"><h2>📸 ${t("Фото работ")}</h2><div class="muted">${t("Пока ни одной работы не сфотографировали.")}</div></div>`;
    const ids = [...new Set(ph.map((p) => p.lead_id))];
    const { data: leads } = await supabase.from("crm_leads")
        .select("id,name,phone,service,what_to_clean").in("id", ids);
    const leadById = new Map((leads ?? []).map((l) => [l.id, l]));
    const groups: {
        id: string;
        items: typeof ph;
    }[] = [];
    for (const p of ph) {
        const g = groups.find((x) => x.id === p.lead_id);
        if (g)
            g.items.push(p);
        else
            groups.push({ id: p.lead_id as string, items: [p] });
    }
    const services = [...new Set((leads ?? []).map((l) => String(l.service || "")).filter(Boolean))].sort();
    const chip = (v: string, label: string) => `<a class="btn" style="padding:4px 10px;font-size:12px;${svc === v ? "background:#0b6b7e;color:#fff" : ""}" href="?key=${k}&view=gallery${v ? "&svc=" + encodeURIComponent(v) : ""}">${esc(label)}</a>`;
    const filter = `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">${chip("", t("Все"))}${services.map((x) => chip(x, x)).join("")}</div>`;
    const cards = await Promise.all(groups.map(async (g) => {
        const l = leadById.get(g.id) as Record<string, unknown> | undefined;
        if (svc && String(l?.service || "") !== svc)
            return "";
        const before = g.items.filter((p) => p.phase === "before");
        const after = g.items.filter((p) => p.phase !== "before");
        const tile = async (p: typeof g.items[number]) => {
            const path = p.path as string;
            const isVid = /\.(mp4|mov|webm)$/i.test(path);
            const file = path.split("/").pop() || "photo.jpg";
            const { data: view } = await supabase.storage.from("job-photos").createSignedUrl(path, 3600);
            const { data: dl } = await supabase.storage.from("job-photos")
                .createSignedUrl(path, 3600, { download: file });
            if (!view?.signedUrl)
                return "";
            const media = isVid
                ? `<video src="${view.signedUrl}" muted playsinline preload="metadata" style="width:150px;height:150px;object-fit:cover;border-radius:8px;background:#000"></video>`
                : `<img src="${view.signedUrl}" loading="lazy" style="width:150px;height:150px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">`;
            return `<figure style="margin:0 8px 8px 0;display:inline-block;text-align:center">
        <a href="${view.signedUrl}" target="_blank" title="${fmtLocal(tz, p.created_at as string)}">${media}</a>
        <figcaption style="font-size:11px;margin-top:2px"><a href="${dl?.signedUrl ?? view.signedUrl}">${t("скачать")}</a></figcaption>
      </figure>`;
        };
        const col = async (title: string, arr: typeof g.items, color: string) => {
            if (!arr.length)
                return "";
            const tiles = (await Promise.all(arr.map(tile))).join("");
            return `<div style="min-width:170px"><div style="font-size:12px;font-weight:700;color:${color};margin-bottom:4px">${title} · ${arr.length}</div>${tiles}</div>`;
        };
        const missing = !before.length
            ? `<div style="font-size:12px;color:#c53030;margin-top:4px">⚠ ${t("нет фото ДО - работу не показать как «до и после»")}</div>` : "";
        const when = fmtLocal(tz, g.items[0].created_at as string);
        return `<div class="panel" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <div><b><a href="?key=${k}&lead=${g.id}">${esc(String(l?.name || "-"))}</a></b>
          <span class="muted" style="font-size:12px">· ${esc(String(l?.service || ""))} · ${when}</span></div>
        <div class="muted" style="font-size:12px">${esc(String(l?.what_to_clean || "").slice(0, 90))}</div>
      </div>${missing}
      <div class="row" style="gap:18px;align-items:flex-start;margin-top:8px">
        ${await col(t("ДО"), before, "#c53030")}${await col(t("ПОСЛЕ"), after, "#2d6a4f")}
      </div></div>`;
    }));
    const shown = cards.filter(Boolean).length;
    return `<div class="panel"><h2>📸 ${t("Фото работ")}</h2>
    <div class="muted" style="font-size:12px">${t("Свежие сверху. Показано клиентов")}: ${shown}. ${t("Ссылка «скачать» отдаёт файл на диск, годен для карточки Google.")}</div>
    ${filter}</div>${cards.join("")}`;
}
async function photoGroup(leadId: string): Promise<string> {
    const { data: ph } = await supabase.from("crm_job_photos").select("path,phase,created_at").eq("lead_id", leadId).order("created_at", { ascending: true });
    if (!ph?.length)
        return "";
    const before = ph.filter((p) => p.phase === "before");
    const after = ph.filter((p) => p.phase !== "before");
    const block = async (title: string, arr: typeof ph) => {
        if (!arr.length)
            return "";
        const imgs = await Promise.all(arr.map(async (p) => {
            const { data } = await supabase.storage.from("job-photos").createSignedUrl(p.path as string, 3600);
            return data?.signedUrl ? `<a href="${data.signedUrl}" target="_blank" title="${fmtLocal("Europe/Budapest", p.created_at as string)}"><img src="${data.signedUrl}" loading="lazy" style="width:84px;height:84px;object-fit:cover;border-radius:8px;margin:3px;border:1px solid #e5e7eb"></a>` : "";
        }));
        const ok = arr.length >= PHOTO_MIN;
        return `<div style="margin-top:8px"><div style="font-size:12px;font-weight:700;color:${ok ? "#2d6a4f" : "#c53030"}">${title}: ${arr.length}/${PHOTO_MIN} ${ok ? "✓" : ""}</div><div style="display:flex;flex-wrap:wrap">${imgs.join("")}</div></div>`;
    };
    return (await block("Фото ДО", before)) + (await block("Фото ПОСЛЕ", after));
}
function photoUploaderScript(): string {
    return `<script>(function(){
document.querySelectorAll('.photobox input[type=file]').forEach(function(inp){
  inp.addEventListener('change',async function(){
    var box=inp.closest('.photobox');var lead=box.getAttribute('data-lead');var phase=inp.getAttribute('data-phase');
    var st=box.querySelector('.upstatus');var files=[].slice.call(inp.files);if(!files.length)return;var done=0;
    for(var i=0;i<files.length;i++){var fd=new FormData();fd.append('lead',lead);fd.append('phase',phase);fd.append('photo',files[i]);
      st.textContent='⏳ Загрузка '+(done+1)+' из '+files.length+'...';
      try{await fetch('?action=photo_upload&xhr=1',{method:'POST',body:fd});done++;}catch(e){}}
    st.textContent='✅ Загружено: '+done;location.reload();});});})();</script>`;
}
async function viewCalendar(cfg: Cfg, k: string, weekParam: string, mode: string): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const base = /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : todayLocal;
    const [by, bm, bd] = base.split("-").map(Number);
    const bdte = new Date(Date.UTC(by, bm - 1, bd));
    const iso = bdte.getUTCDay() === 0 ? 7 : bdte.getUTCDay();
    const monday = new Date(bdte.getTime() - (iso - 1) * 86400000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const isMonth = mode === "month";
    const mFirst = new Date(Date.UTC(by, bm - 1, 1));
    const mIso = mFirst.getUTCDay() === 0 ? 7 : mFirst.getUTCDay();
    const monthKey = `${by}-${String(bm).padStart(2, "0")}`;
    const gridStart = isMonth ? new Date(mFirst.getTime() - (mIso - 1) * 86400000) : monday;
    const cellCount = isMonth ? Math.ceil((mIso - 1 + new Date(Date.UTC(by, bm, 0)).getUTCDate()) / 7) * 7 : 7;
    const days = Array.from({ length: cellCount }, (_, i) => new Date(gridStart.getTime() + i * 86400000));
    const dayStrs = days.map(ymd);
    const prevWeek = isMonth ? ymd(new Date(Date.UTC(by, bm - 2, 1))) : ymd(new Date(monday.getTime() - 7 * 86400000));
    const nextWeek = isMonth ? ymd(new Date(Date.UTC(by, bm, 1))) : ymd(new Date(monday.getTime() + 7 * 86400000));
    const modeQ = isMonth ? "&cal=month" : "";
    const { data: masters } = await supabase.from("crm_masters").select("id,name,work_days,active").eq("active", true);
    const mName = (id: unknown) => (masters ?? []).find((m) => m.id === id)?.name || "";
    const { data: deals } = await supabase.from("crm_deals").select("lead_id,job_date");
    const dealDate = new Map<string, string>();
    for (const d of deals ?? []) {
        if (d.job_date && !dealDate.has(d.lead_id))
            dealDate.set(d.lead_id, String(d.job_date));
    }
    const sel = "id,name,service,what_to_clean,scheduled_at,assigned_master_id,status";
    const { data: schedLeads } = await supabase.from("crm_leads").select(sel).not("scheduled_at", "is", null).limit(1000);
    const dealIds = [...dealDate.keys()];
    const { data: dealLeads } = dealIds.length ? await supabase.from("crm_leads").select(sel).in("id", dealIds) : { data: [] as Record<string, unknown>[] };
    const seen = new Set<string>();
    const cand: Record<string, unknown>[] = [];
    for (const l of [...(schedLeads ?? []), ...(dealLeads ?? [])]) {
        if (!seen.has(l.id as string)) {
            seen.add(l.id as string);
            cand.push(l);
        }
    }
    const byDay = new Map<string, Record<string, unknown>[]>();
    for (const s of dayStrs)
        byDay.set(s, []);
    for (const l of cand) {
        const eff = l.scheduled_at ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(l.scheduled_at as string)) : dealDate.get(l.id as string);
        const dd = dealDate.get(l.id as string);
        if (eff && byDay.has(eff))
            byDay.get(eff)!.push({ ...l, _done: !!dd && dd <= todayLocal });
    }
    for (const arr of byDay.values())
        arr.sort((a, b) => String(a.scheduled_at ?? "").localeCompare(String(b.scheduled_at ?? "")));
    const { data: unschedRaw } = await supabase.from("crm_leads").select("id,name,service,what_to_clean,status").is("scheduled_at", null).eq("status", "won").neq("source", "job_application").order("created_at", { ascending: false }).limit(200);
    const unsched = (unschedRaw ?? []).filter((l) => !dealDate.has(l.id as string));
    const DOW = LANG === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const timeOf = (isoStr: string) => new Intl.DateTimeFormat(LANG === "en" ? "en-GB" : "ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(isoStr));
    const cols = days.map((d, i) => {
        const ds = ymd(d);
        const items = byDay.get(ds) || [];
        const isToday = ds === todayLocal;
        const cards = items.map((l) => {
            const done = !!l._done;
            const noM = !l.assigned_master_id && !done;
            const bg = noM ? "#fff7ed" : done ? "#f0f7f2" : "#fff";
            const tm = l.scheduled_at ? timeOf(l.scheduled_at as string) + " · " : "";
            const planned = !done && dealDate.has(l.id as string);
            const status = done
                ? `✅ ${LANG === "en" ? "done" : "выполнен"}${l.assigned_master_id ? " · " + esc(mName(l.assigned_master_id)) : ""}`
                : planned
                    ? `📅 ${LANG === "en" ? "booked" : "запланирован"}${l.assigned_master_id ? " · " + esc(mName(l.assigned_master_id)) : ""}`
                    : (l.assigned_master_id ? "🧹 " + esc(mName(l.assigned_master_id)) : (LANG === "en" ? "⚠️ unassigned" : "⚠️ не назначен"));
            return `<a href="?key=${k}&lead=${l.id}" style="display:block;background:${bg};border:1px solid ${noM ? "#f59e0b" : "#e5e7eb"};border-left:3px solid ${STATUS_COLOR[l.status as string] || "#ccc"};border-radius:8px;padding:6px 8px;margin-bottom:6px">
        <div style="font-weight:700;font-size:12px">${tm}${esc(l.name) || "-"}</div>
        ${isMonth ? "" : `<div style="color:#6b7280;font-size:11px">${esc(l.what_to_clean) || esc(l.service) || ""}</div>`}
        <div style="font-size:11px;color:${noM ? "#c2410c" : "#2d6a4f"};font-weight:600">${status}</div>
      </a>`;
        }).join("") || `<div class="muted" style="font-size:11px;padding:4px">—</div>`;
        const isoWd = i + 1;
        const avail = (masters ?? []).filter((mm) => ((mm.work_days as number[] | null) ?? []).includes(isoWd)).map((mm) => mm.name);
        const availLbl = LANG === "en" ? "free" : "свободны";
        const availHtml = `<div style="font-size:10px;color:#2d6a4f;margin-top:6px;border-top:1px solid #e5e7eb;padding-top:4px">🟢 ${availLbl}: ${avail.length ? avail.map((n) => esc(n)).join(", ") : "—"}</div>`;
        const outside = isMonth && ds.slice(0, 7) !== monthKey;
        const head = isMonth ? `${DOW[i % 7]} ${ds.slice(8)}` : `${DOW[i]} ${ds.slice(8)}.${ds.slice(5, 7)}`;
        const box = isMonth ? "min-height:88px;" : "flex:1;min-width:150px;";
        return `<div style="${box}background:${isToday ? "#e6f4ec" : outside ? "#fafafa" : "#f7f8fa"};${outside ? "opacity:.45;" : ""}border-radius:10px;padding:8px"><div style="font-weight:700;font-size:12px;margin-bottom:6px">${head}${isToday ? " •" : ""}</div>${cards}${isMonth ? "" : availHtml}</div>`;
    }).join("");
    const unTitle = LANG === "en" ? "No date — set a time" : "Без даты — назначь время";
    const unschedHtml = (unsched ?? []).length ? `<div class="panel"><h2>🗓 ${unTitle} (${unsched!.length})</h2><div style="display:flex;flex-wrap:wrap;gap:6px">${unsched!.map((l) => `<a href="?key=${k}&lead=${l.id}" style="background:#fff7ed;border:1px solid #f59e0b;border-radius:8px;padding:6px 10px;font-size:12px">${esc(l.name) || "-"} · ${esc(l.what_to_clean) || esc(l.service) || ""}</a>`).join("")}</div></div>` : "";
    const note = LANG === "en"
        ? "Orange = no cleaner assigned yet. Click a job to open its card, assign a cleaner and time — the cleaner gets a Telegram notification."
        : "Оранжевым — заказы без назначенного мастера. Клик по заказу открывает карточку: там назначаешь мастера и время, мастеру уходит уведомление в Telegram.";
    return `<div class="panel"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2 style="margin:0">🗓 ${t("Календарь")}</h2>
    <div class="row" style="gap:6px;margin:0"><a href="?key=${k}&view=calendar&week=${prevWeek}${modeQ}"><button class="sec">←</button></a><a href="?key=${k}&view=calendar${modeQ}"><button class="sec">${LANG === "en" ? "today" : "сегодня"}</button></a><a href="?key=${k}&view=calendar&week=${nextWeek}${modeQ}"><button class="sec">→</button></a>
    <a href="?key=${k}&view=calendar&week=${base}"><button class="${isMonth ? "sec" : ""}">${LANG === "en" ? "Week" : "Неделя"}</button></a><a href="?key=${k}&view=calendar&week=${base}&cal=month"><button class="${isMonth ? "" : "sec"}">${LANG === "en" ? "Month" : "Месяц"}</button></a>
    ${isMonth ? `<input type="month" value="${monthKey}" onchange="if(this.value)location.href='?key=${k}&view=calendar&cal=month&week='+this.value+'-01'" style="padding:6px 8px;border:1px solid #d5dbe3;border-radius:8px;font-size:13px">` : ""}</div></div>
    <div style="${isMonth ? "display:grid;grid-template-columns:repeat(7,minmax(0,1fr));" : "display:flex;overflow-x:auto;"}gap:8px;margin-top:12px">${cols}</div>
    <p class="muted" style="margin-top:8px">${note}</p></div>${unschedHtml}`;
}
async function viewMasterOrders(cfg: Cfg, masterId?: string | null): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    if (!masterId)
        return `<div class="panel">Профиль мастера не привязан к аккаунту. Обратитесь к администратору.</div>`;
    const { data: mrow } = await supabase.from("crm_masters").select("*").eq("id", masterId).limit(1);
    const m = mrow?.[0];
    const [{ data: own }, { data: shared }] = await Promise.all([
        supabase.from("crm_leads").select("*").eq("assigned_master_id", masterId).neq("status", "lost").order("scheduled_at", { ascending: true }),
        supabase.from("crm_leads").select("*").contains("crew", [{ m: masterId }]).neq("status", "lost").order("scheduled_at", { ascending: true }),
    ]);
    const seen = new Set((own ?? []).map((l) => l.id));
    const leads = [...(own ?? []), ...(shared ?? []).filter((l) => !seen.has(l.id))]
        .sort((a, b) => String(a.scheduled_at ?? "").localeCompare(String(b.scheduled_at ?? "")));
    const { data: deals } = await supabase.from("crm_deals").select("lead_id,master_payout,hours").eq("master_id", masterId);
    const dealByLead = new Map((deals ?? []).map((d) => [d.lead_id, d]));
    const pay = (lead: Record<string, unknown>) => {
        const d = dealByLead.get(lead.id as string);
        if (d)
            return `Оплата: <b>${Ft(Number(d.master_payout))}</b>${d.hours != null ? ` (${d.hours} ч)` : ""}`;
        if (m?.pay_type === "hourly")
            return `Ставка: <b>${Ft(Number(m.hourly_rate))}/час</b>`;
        return `Ваш процент: <b>${m?.default_pct ?? "-"}%</b>`;
    };
    const cards = (await Promise.all((leads ?? []).map(async (l) => `<div class="panel">
    <h2>${esc(l.name) || "Клиент"} <span class="pill" style="background:${STATUS_COLOR[l.status]}">${STATUS[l.status]}</span></h2>
    <div class="kv">
      ${l.scheduled_at ? `<div class="l">Когда</div><div><b>${fmtLocal(tz, l.scheduled_at)}</b></div>` : ""}
      ${l.address ? `<div class="l">Адрес</div><div>${esc(l.address)}</div>` : ""}
      <div class="l">Что делать</div><div>${esc(l.what_to_clean) || esc(l.service) || "-"}${l.area ? " · " + esc(l.area) : ""}</div>
      ${l.phone ? `<div class="l">Телефон</div><div>${esc(l.phone)}</div>` : ""}
      <div class="l">Оплата</div><div>${pay(l)}</div>
    </div>
    <div class="photobox" data-lead="${l.id}" style="margin-top:10px">
      <p class="muted" style="font-size:12px;margin:0 0 4px">Нужно минимум ${PHOTO_MIN} фото ДО и ${PHOTO_MIN} ПОСЛЕ уборки.</p>
      <label>📷 Фото ДО уборки</label>
      <input type="file" accept="image/*" capture="environment" multiple data-phase="before">
      <label style="margin-top:8px">📷 Фото ПОСЛЕ уборки</label>
      <input type="file" accept="image/*" capture="environment" multiple data-phase="after">
      <div class="upstatus muted" style="font-size:12px;margin-top:6px"></div>
    </div>
    ${await photoGroup(l.id as string)}</div>`))).join("") || `<div class="panel muted">Назначенных заказов пока нет.</div>`;
    const myDays = (m?.work_days as number[] | null) ?? [];
    const daysPanel = `<div class="panel"><h2>📅 Мои рабочие дни</h2>
    <form method="post" action="?action=master_days">
      <div class="days">${DOW_RU.map((lbl, i) => { const d = i + 1; return `<label><input type="checkbox" name="d${d}" ${myDays.includes(d) ? "checked" : ""}> ${lbl}</label>`; }).join("")}</div>
      <div style="margin-top:10px"><button>Сохранить дни</button></div>
    </form>
    <p class="muted" style="font-size:12px;margin-top:6px">Отметь дни недели, когда готов работать — Алекс видит это при распределении заказов.</p></div>`;
    return `<div class="kpis"><div class="kpi"><div class="v">${(leads ?? []).length}</div><div class="l">Мои заказы</div></div></div>
  <h2 style="margin:6px 2px">Привет, ${esc(m?.name || "мастер")}!</h2>${daysPanel}
  <h2 style="margin:14px 2px 6px">Твои выезды:</h2>${cards}${photoUploaderScript()}`;
}
function findCol(header: string[], ...needles: string[]): number {
    const low = header.map((h) => h.toLowerCase().trim());
    for (const n of needles) {
        const i = low.findIndex((h) => h.includes(n));
        if (i >= 0)
            return i;
    }
    return -1;
}
function detectCurrency(header: string): string { const m = header.match(/\(([A-Z]{3})\)/); return m ? m[1] : ""; }
async function importAds(cfg: Cfg, csv: string): Promise<number> {
    const rows = parseCsv(csv);
    if (rows.length < 2)
        return 0;
    const header = rows[0];
    const ci = findCol(header, "campaign name", "campaign");
    const si = findCol(header, "amount spent", "spend");
    const ii = findCol(header, "impression");
    const cli = findCol(header, "link click", "clicks (all)", "click");
    const li = findCol(header, "leads", "results", "result");
    const dsi = findCol(header, "reporting starts", "starts", "day", "date");
    const dei = findCol(header, "reporting ends", "ends");
    const curCol = findCol(header, "currency");
    const headerCur = si >= 0 ? detectCurrency(header[si]) : "";
    if (ci < 0 || si < 0)
        return 0;
    const num = (v: string) => Number(String(v ?? "").replace(/[^\d.\-]/g, "")) || 0;
    const recs: Record<string, unknown>[] = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const campaign = (row[ci] ?? "").trim();
        if (!campaign)
            continue;
        recs.push({
            campaign, spend: num(row[si]),
            currency: (curCol >= 0 ? row[curCol] : "") || headerCur || cfg.base_currency || "HUF",
            impressions: ii >= 0 ? num(row[ii]) : 0, clicks: cli >= 0 ? num(row[cli]) : 0, leads_reported: li >= 0 ? num(row[li]) : 0,
            date_start: dsi >= 0 && /^\d{4}-\d{2}-\d{2}/.test((row[dsi] ?? "").trim()) ? row[dsi].trim().slice(0, 10) : null,
            date_stop: dei >= 0 && /^\d{4}-\d{2}-\d{2}/.test((row[dei] ?? "").trim()) ? row[dei].trim().slice(0, 10) : null,
            source_file: "paste",
        });
    }
    if (!recs.length)
        return 0;
    const campSet = [...new Set(recs.map((r) => r.campaign as string))];
    await supabase.from("crm_ad_spend").delete().in("campaign", campSet);
    const { error } = await supabase.from("crm_ad_spend").insert(recs);
    if (error)
        console.error("import_ads", error);
    return recs.length;
}
async function exportCsv(type: string): Promise<string> {
    if (type === "masters") {
        const [{ data: ms }, { data: ds }] = await Promise.all([
            supabase.from("crm_masters").select("*").order("name"),
            supabase.from("crm_deals").select("master_id,master_payout,hours"),
        ]);
        const agg = new Map<string, {
            jobs: number;
            paid: number;
            hours: number;
        }>();
        for (const d of ds ?? []) {
            const key = String(d.master_id ?? "");
            if (!key)
                continue;
            const a = agg.get(key) ?? { jobs: 0, paid: 0, hours: 0 };
            a.jobs++;
            a.paid += Number(d.master_payout) || 0;
            a.hours += Number(d.hours) || 0;
            agg.set(key, a);
        }
        const head = ["Имя", "Телефон", "Тип оплаты", "Ставка Ft/час", "Процент", "Язык", "Телеграм привязан", "Активен", "Заказов", "Выплачено всего", "Часов всего"];
        const body = (ms ?? []).map((m) => {
            const a = agg.get(String(m.id)) ?? { jobs: 0, paid: 0, hours: 0 };
            return csvRow([m.name, m.phone, m.pay_type === "hourly" ? "ставка в час" : "% от заказа",
                Number(m.hourly_rate) || 0, Number(m.default_pct) || 0,
                m.language === "en" ? "английский" : m.language === "ru" ? "русский" : "не выбран",
                m.tg_chat_id ? "да" : "нет", m.active ? "да" : "нет", a.jobs, a.paid, a.hours]);
        });
        return [csvRow(head), ...body].join("\n");
    }
    if (type === "deals") {
        const { data } = await supabase.from("crm_deals").select("*");
        const { data: leads } = await supabase.from("crm_leads").select("id,name,phone,campaign");
        const lmap = new Map((leads ?? []).map((l) => [l.id, l]));
        const head = ["created_at", "lead_name", "phone", "campaign", "amount", "currency", "master_pct", "hours", "master_payout", "extra_costs", "extra_costs_note", "net", "service_done", "job_date"];
        const body = (data ?? []).map((d) => { const l = (lmap.get(d.lead_id) ?? {}) as Record<string, unknown>; const net = Number(d.amount) - Number(d.master_payout) - Number(d.extra_costs); return csvRow([d.created_at, l.name, l.phone, l.campaign, d.amount, d.currency, d.master_pct, d.hours, d.master_payout, d.extra_costs, d.extra_costs_note, net, d.service_done, d.job_date]); });
        return [csvRow(head), ...body].join("\n");
    }
    const { data } = await supabase.from("crm_leads").select("*").order("created_at", { ascending: false });
    const head = ["created_at", "status", "name", "phone", "language", "service", "what_to_clean", "area", "budget", "address", "when_text", "contact_method", "gift", "extra_services", "campaign", "source", "received_at"];
    const body = (data ?? []).map((l) => csvRow(head.map((h) => (l as Record<string, unknown>)[h])));
    return [csvRow(head), ...body].join("\n");
}
async function handleAction(cfg: Cfg, action: string, form: URLSearchParams): Promise<string> {
    const tz = cfg.timezone || "Europe/Budapest";
    const leadId = form.get("lead") || "";
    const getLead = async () => { const { data } = await supabase.from("crm_leads").select("*").eq("id", leadId).limit(1); return data?.[0]; };
    if (action === "status") {
        const status = form.get("status") || "";
        if (STATUS_KEYS.includes(status) || HIRE_KEYS.includes(status)) {
            const lead = await getLead();
            if (lead && lead.status !== status) {
                const cand = String(lead.source ?? "") === "job_application";
                const nm = (v: string) => (cand ? HIRE[v] ?? STATUS[v] : STATUS[v] ?? HIRE[v]) ?? v;
                await supabase.from("crm_leads").update({ status, status_changed_at: new Date().toISOString() }).eq("id", leadId);
                await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "status_change", body: `${nm(lead.status)} → ${nm(status)}` });
                await refreshCardTg(cfg, { ...lead, status });
                if (status === "junk" || status === "lost")
                    await offerClosingTg(cfg, { ...lead, status }, status === "junk" ? "junk" : "lost");
                if ((status === "junk" || status === "lost") && lead.status === "won")
                    await cancelMasterJobs(supabase, cfg.telegram_bot_token, String(lead.id), (iso) => fmtLocal(cfg.timezone || "Europe/Budapest", iso));
            }
        }
        return leadId;
    }
    if (action === "feedback_mark") {
        await supabase.from("crm_leads").update({ feedback_asked_at: new Date().toISOString() }).eq("id", leadId);
        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: "💬 Запрошен фидбек после заказа" });
        return leadId;
    }
    if (action === "review_mark") {
        await supabase.from("crm_leads").update({ review_requested_at: new Date().toISOString() }).eq("id", leadId);
        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: "⭐ Попросили отзыв в Google" });
        return leadId;
    }
    if (action === "phone") {
        const raw = String(form.get("phone") || "").trim().slice(0, 40);
        const digits = raw.replace(/[^0-9]/g, "");
        const lead = await getLead();
        if (lead && digits.length >= 8 && digits.length <= 15) {
            const next = raw.startsWith("+") ? `+${digits}` : `+${digits}`;
            if (next !== lead.phone) {
                const attr = (lead.attribution && typeof lead.attribution === "object" ? lead.attribution : {}) as Record<string, unknown>;
                const attribution = lead.phone && !attr.form_phone ? { ...attr, form_phone: lead.phone } : attr;
                await supabase.from("crm_leads").update({ phone: next, attribution, updated_at: new Date().toISOString() }).eq("id", leadId);
                await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: `📱 Номер изменён: ${lead.phone || "пусто"} → ${next}` });
            }
        }
        else if (lead) {
            await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: `📱 Номер не изменён: «${raw}» не похож на телефон (нужно 8-15 цифр).` });
        }
        return leadId;
    }
    if (action === "note") {
        const note = (form.get("note") || "").trim();
        await supabase.from("crm_leads").update({ notes: note }).eq("id", leadId);
        await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: note });
        return leadId;
    }
    if (action === "cand_update") {
        const status = form.get("status") || "";
        const note = (form.get("note") || "").trim();
        const lead = await getLead();
        if (lead) {
            if (HIRE_KEYS.includes(status) && lead.status !== status) {
                await supabase.from("crm_leads").update({ status, status_changed_at: new Date().toISOString() }).eq("id", leadId);
                const nm = (v: string) => HIRE[v] ?? STATUS[v] ?? v;
                await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "status_change", body: `${nm(lead.status)} → ${nm(status)}` });
            }
            if (note)
                await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: note });
        }
        return "::candidates";
    }
    if (action === "task") {
        const title = (form.get("title") || "").trim();
        if (title) {
            const due = form.get("due") ? dtLocalToUtc(tz, form.get("due")!) : null;
            await supabase.from("crm_tasks").insert({ lead_id: leadId, title, due_at: due ? due.toISOString() : null, source: "manual" });
            await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "task_created", body: title, meta: { due_at: due?.toISOString() ?? null } });
        }
        return leadId;
    }
    if (action === "task_done") {
        const tid = form.get("task_id");
        if (tid) {
            await supabase.from("crm_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", tid);
            const { data: t } = await supabase.from("crm_tasks").select("title").eq("id", tid).limit(1);
            if (leadId)
                await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "task_done", body: t?.[0]?.title ?? "" });
        }
        return leadId;
    }
    if (action === "assign") {
        const lead = await getLead();
        if (lead) {
            const masterId = form.get("assigned_master_id") || null;
            const sched = form.get("scheduled_at") ? dtLocalToUtc(tz, form.get("scheduled_at")!) : null;
            const address = form.get("address") || "";
            const brief = form.get("master_brief") ?? "";
            const changed = String(lead.assigned_master_id ?? "") !== String(masterId ?? "");
            await supabase.from("crm_leads").update({ assigned_master_id: masterId, scheduled_at: sched ? sched.toISOString() : null, address, master_brief: brief, ...(changed ? { master_confirmed_at: null } : {}) }).eq("id", leadId);
            if (masterId) {
                const cur = Array.isArray(lead.crew) ? lead.crew : [];
                if (!cur.length) {
                    await supabase.from("crm_leads").update({
                        crew: [{ m: String(masterId), brief: String(brief).slice(0, 400), sum: String(lead.budget ?? ""), pay: "", sent: null, ok: null }],
                    }).eq("id", leadId);
                }
                else if (cur.length === 1 && String((cur[0] as Record<string, unknown>).m ?? "") !== String(masterId)) {
                    await supabase.from("crm_leads").update({
                        crew: [{ ...(cur[0] as Record<string, unknown>), m: String(masterId), sent: null, ok: null }],
                    }).eq("id", leadId);
                }
            }
            const master = masterId ? (await supabase.from("crm_masters").select("name,tg_chat_id,pay_type,default_pct,hourly_rate,language,pair_master_id").eq("id", masterId).limit(1)).data?.[0] : null;
            const mn = master?.name ?? (masterId ? "" : "снят");
            await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: `Назначен мастер: ${mn}${sched ? ` · ${fmtLocal(tz, sched.toISOString())}` : ""}${address ? ` · ${address}` : ""}` });
            if (changed)
                await sendMasterJobDM(cfg, { ...lead, scheduled_at: sched ? sched.toISOString() : null, address, master_brief: brief }, master, tz);
        }
        return leadId;
    }
    if (action === "notify_master") {
        const lead = await getLead();
        if (lead?.assigned_master_id) {
            const master = (await supabase.from("crm_masters").select("name,tg_chat_id,pay_type,default_pct,hourly_rate,language,pair_master_id").eq("id", lead.assigned_master_id).limit(1)).data?.[0];
            const sent = await sendMasterJobDM(cfg, lead, master, tz);
            await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: sent ? `📨 Заказ отправлен мастеру (${master?.name ?? ""}) в Telegram` : `⚠️ Не удалось отправить заказ: мастер не привязал Telegram` });
        }
        return leadId;
    }
    if (action === "crew_save") {
        const lead = await getLead();
        const masterId = String(form.get("m") ?? "");
        if (lead && masterId) {
            const crew = crewOf(lead);
            const raw = String(form.get("idx") ?? "");
            const idx = raw === "" ? crew.length : Number(raw);
            const prev = crew[idx];
            crew[idx] = {
                m: masterId,
                brief: String(form.get("brief") ?? ""),
                sum: String(form.get("sum") ?? ""),
                pay: String(form.get("pay") ?? ""),
                sent: prev && prev.m === masterId ? prev.sent : null,
                ok: prev && prev.m === masterId ? prev.ok : null,
            };
            await supabase.from("crm_leads").update({ crew }).eq("id", leadId);
            const mn = (await supabase.from("crm_masters").select("name").eq("id", masterId).limit(1)).data?.[0]?.name ?? "";
            await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: `👥 Заказ поделён: добавлен мастер ${mn}` });
        }
        return leadId;
    }
    if (action === "crew_notify") {
        const lead = await getLead();
        const idx = Number(form.get("idx") ?? -1);
        const slot = crewOf(lead ?? {})[idx];
        if (lead && slot) {
            const master = (await supabase.from("crm_masters").select("name,tg_chat_id,pay_type,default_pct,hourly_rate,language,pair_master_id").eq("id", slot.m).limit(1)).data?.[0];
            const sent = await sendMasterJobDM(cfg, lead, master, tz, { idx, brief: slot.brief, sum: slot.sum, pay: slot.pay ?? "" });
            await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: sent ? `📨 Заказ отправлен мастеру (${master?.name ?? ""}) в Telegram` : `⚠️ Не удалось отправить заказ: мастер не привязал Telegram` });
        }
        return leadId;
    }
    if (action === "crew_del") {
        const lead = await getLead();
        const idx = Number(form.get("idx") ?? -1);
        if (lead && crewOf(lead)[idx]) {
            const crew = crewOf(lead).filter((_, i) => i !== idx);
            await supabase.from("crm_leads").update({ crew }).eq("id", leadId);
        }
        return leadId;
    }
    if (action === "deal") {
        const lead = await getLead();
        if (lead) {
            const amount = Number(form.get("amount") || 0);
            const masterId = form.get("master_id") || null;
            let payType = "percent", defPct: number | null = null, rate = 0;
            if (masterId) {
                const { data: m } = await supabase.from("crm_masters").select("pay_type,default_pct,hourly_rate").eq("id", masterId).limit(1);
                if (m?.[0]) {
                    payType = m[0].pay_type;
                    defPct = Number(m[0].default_pct);
                    rate = Number(m[0].hourly_rate);
                }
            }
            const masterName = (form.get("master_name") || "").trim();
            const directPayout = Number(form.get("master_payout") || 0);
            const hours = form.get("hours") ? Number(form.get("hours")) : null;
            const jobRate = form.get("hourly_rate") ? Number(form.get("hourly_rate")) : rate;
            const { payout, pct: pctStore, hourly: paidHourly } = computePayout({
                amount, directPayout, hours, jobRate, masterPayType: payType,
                masterPct: form.get("master_pct") ? Number(form.get("master_pct")) : defPct,
            });
            const extra = Number(form.get("extra_costs") || 0);
            const mLabel = masterId ? "" : masterName;
            if (amount > 0) {
                const dupSince = new Date(Date.now() - 86400000).toISOString();
                const { data: dup } = await supabase.from("crm_deals").select("id").eq("lead_id", leadId).eq("amount", amount).gte("created_at", dupSince).limit(1);
                if (dup?.length)
                    return leadId;
                await supabase.from("crm_deals").insert({ lead_id: leadId, master_id: masterId, master_name: mLabel, amount, currency: cfg.base_currency || "HUF", master_pct: pctStore, hours, master_payout: payout, extra_costs: extra, extra_costs_note: form.get("extra_costs_note") || "", service_done: form.get("service_done") || "", notes: form.get("notes") || "", job_date: form.get("job_date") || null, closed_at: new Date().toISOString() });
                const payBasis = directPayout > 0 ? "фикс" : paidHourly ? `${hours || 0} ч × ${Ft(jobRate)}` : (pctStore != null ? `${pctStore}%` : "⚠️ выплата не задана");
                await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "deal_won", body: `Сделка ${Ft(amount)} · мастер ${mLabel ? esc(mLabel) + " " : ""}${Ft(payout)} (${payBasis})${extra ? ` · доп ${Ft(extra)}` : ""}` });
                if (lead.status !== "won") {
                    await supabase.from("crm_leads").update({ status: "won" }).eq("id", leadId);
                    await refreshCardTg(cfg, { ...lead, status: "won" });
                }
            }
        }
        return leadId;
    }
    if (action === "analyze") {
        const chat = (form.get("chat") || "").trim();
        const lead = await getLead();
        if (lead && chat && cfg.anthropic_api_key) {
            try {
                const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(new Date());
                const a = await analyzeChat(cfg.anthropic_api_key, todayLocal, tz, lead, chat);
                const upd: Record<string, unknown> = {};
                if (a.status && STATUS_KEYS.includes(a.status))
                    upd.status = a.status;
                const due = resolveDue(tz, a.due);
                if (a.booked) {
                    upd.status = "won";
                    if (due)
                        upd.scheduled_at = due.toISOString();
                }
                if (Object.keys(upd).length)
                    await supabase.from("crm_leads").update(upd).eq("id", leadId);
                await supabase.from("crm_timeline").insert({ lead_id: leadId, kind: "whatsapp_summary", body: a.summary ?? "", meta: { price_quoted: a.price_quoted ?? null, agreed_amount: a.agreed_amount ?? null, booked: a.booked ?? false, sentiment: a.sentiment ?? null } });
                if (a.next_action) {
                    await supabase.from("crm_tasks").insert({ lead_id: leadId, title: a.next_action, due_at: due ? due.toISOString() : null, source: "ai", reason: "из анализа переписки" });
                }
                await refreshCardTg(cfg, { ...lead, ...upd });
            }
            catch (e) {
                console.error("analyze", e);
            }
        }
        return leadId;
    }
    if (action === "master_save") {
        const name = (form.get("name") || "").trim();
        if (name) {
            const wdRaw = form.getAll ? form.getAll("work_days") : [];
            const rec: Record<string, unknown> = { name, phone: form.get("phone") || "", pay_type: form.get("pay_type") === "hourly" ? "hourly" : "percent", default_pct: Number(form.get("default_pct") || 30), hourly_rate: Number(form.get("hourly_rate") || 0), active: (form.get("active") ?? "true") === "true", district: form.get("district") || "", availability_note: form.get("availability_note") || "", experience: form.get("experience") || "none" };
            if (form.has("wd_present"))
                rec.work_days = wdRaw.map((x) => Number(x)).filter((n) => n >= 1 && n <= 7);
            const id = form.get("id");
            if (id)
                await supabase.from("crm_masters").update(rec).eq("id", id);
            else
                await supabase.from("crm_masters").insert(rec);
        }
        return "::masters";
    }
    if (action === "ad_add") {
        const sp = Number(form.get("spend") || 0);
        const campaign = (form.get("campaign") || "").trim();
        const ds = form.get("date_start") || "", de = form.get("date_stop") || "";
        if (sp > 0 && campaign && ds && de) {
            await supabase.from("crm_ad_spend").insert({ campaign, date_start: ds, date_stop: de >= ds ? de : ds, spend: sp, currency: form.get("currency") || "EUR", source_file: "manual" });
        }
        return "::money";
    }
    if (action === "ad_del") {
        const id = form.get("id");
        if (id)
            await supabase.from("crm_ad_spend").delete().eq("id", id);
        return "::money";
    }
    if (action === "expense_add") {
        const amount = Number(form.get("amount") || 0);
        const spentOn = form.get("spent_on") || "";
        if (amount > 0 && spentOn)
            await supabase.from("crm_expenses").insert({ spent_on: spentOn, amount, note: form.get("note") || "" });
        return "::money";
    }
    if (action === "expense_del") {
        const id = form.get("id");
        if (id)
            await supabase.from("crm_expenses").delete().eq("id", id);
        return "::money";
    }
    if (action === "master_delete") {
        const id = form.get("id");
        if (id) {
            const { data: dh } = await supabase.from("crm_deals").select("id").eq("master_id", id).limit(1);
            if (dh?.length) {
                await supabase.from("crm_masters").update({ active: false }).eq("id", id);
            }
            else {
                await supabase.from("crm_leads").update({ assigned_master_id: null }).eq("assigned_master_id", id);
                await supabase.from("crm_masters").delete().eq("id", id);
            }
        }
        return "::masters";
    }
    if (action === "user_save") {
        const username = (form.get("username") || "").trim().toLowerCase();
        const password = form.get("password") || "";
        if (username && password) {
            const ph = await hashPassword(cfg.session_secret || cfg.dashboard_secret || "x", username, password);
            const roleIn = form.get("role");
            const urole = roleIn === "full" ? "full" : roleIn === "marketer" ? "marketer" : roleIn === "supervisor" ? "supervisor" : "master";
            const rec = { username, password_hash: ph, role: urole, master_id: form.get("master_id") || null, active: true };
            await supabase.from("crm_users").upsert(rec, { onConflict: "username" });
        }
        return "::users";
    }
    if (action === "user_delete") {
        const id = form.get("id");
        if (id)
            await supabase.from("crm_users").delete().eq("id", id);
        return "::users";
    }
    if (action === "lead_delete") {
        if (leadId) {
            await supabase.from("crm_deals").delete().eq("lead_id", leadId);
            await supabase.from("crm_tasks").delete().eq("lead_id", leadId);
            await supabase.from("crm_timeline").delete().eq("lead_id", leadId);
            await supabase.from("crm_leads").delete().eq("id", leadId);
        }
        return "::board";
    }
    if (action === "deal_delete") {
        const dealId = form.get("deal_id");
        if (dealId)
            await supabase.from("crm_deals").delete().eq("id", dealId);
        return leadId || "::orders";
    }
    if (action === "deal_edit") {
        const id = form.get("deal_id");
        if (id) {
            const amount = Number(form.get("amount") || 0);
            const payout = Number(form.get("master_payout") || 0);
            const extra = Number(form.get("extra_costs") || 0);
            const upd: Record<string, unknown> = { master_payout: payout >= 0 ? payout : 0, extra_costs: extra >= 0 ? extra : 0, notes: form.get("notes") || "" };
            if (amount > 0)
                upd.amount = amount;
            if (form.has("master_id"))
                upd.master_id = form.get("master_id") || null;
            if (form.has("job_date"))
                upd.job_date = form.get("job_date") || null;
            await supabase.from("crm_deals").update(upd).eq("id", id);
        }
        return leadId || "::orders";
    }
    if (action === "deal_parse") {
        const id = form.get("deal_id");
        if (id && cfg.anthropic_api_key) {
            const { data: rows } = await supabase.from("crm_deals").select("amount").eq("id", id).limit(1);
            const amount = Number(form.get("amount") || rows?.[0]?.amount || 0);
            try {
                const p = await parsePayoutNote(cfg.anthropic_api_key, amount, String(form.get("notes") || ""));
                const upd: Record<string, unknown> = {
                    master_payout: Math.max(0, Number(p.master_payout) || 0),
                    extra_costs: Math.max(0, Number(p.extra_costs) || 0),
                    notes: p.breakdown || form.get("notes") || "",
                };
                if (amount > 0)
                    upd.amount = amount;
                if (p.hours != null && Number(p.hours) > 0)
                    upd.hours = Number(p.hours);
                await supabase.from("crm_deals").update(upd).eq("id", id);
            }
            catch (e) {
                console.error("deal_parse", e);
            }
        }
        return leadId || "::orders";
    }
    if (action === "import_ads") {
        await importAds(cfg, form.get("csv") || "");
        return "::data";
    }
    return "::board";
}
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        const url = new URL(req.url);
        const cfg = await getConfig();
        const sessionSecret = cfg.session_secret || cfg.dashboard_secret || "x";
        const action = url.searchParams.get("action") || "";
        LANG = getCookie(req, "crm_lang") === "en" ? "en" : "ru";
        if (req.method === "POST" && action === "photo_import") {
            if (req.headers.get("x-reminder-secret") !== cfg.reminder_secret) {
                return new Response("forbidden", { status: 403 });
            }
            const fd = await req.formData();
            const leadId = String(fd.get("lead") || "");
            const phase = fd.get("phase") === "before" ? "before" : "after";
            const masterId = String(fd.get("master") || "") || null;
            let saved = 0;
            if (leadId) {
                for (const f of fd.getAll("photo")) {
                    if (f instanceof File && f.size > 0 && f.size <= 15 * 1024 * 1024) {
                        const path = `${leadId}/${Date.now()}_${Math.round(performance.now())}.jpg`;
                        const buf = new Uint8Array(await f.arrayBuffer());
                        const { error } = await supabase.storage.from("job-photos").upload(path, buf, { contentType: f.type || "image/jpeg", upsert: false });
                        if (!error) {
                            await supabase.from("crm_job_photos").insert({ lead_id: leadId, master_id: masterId, path, phase });
                            saved++;
                        }
                    }
                }
            }
            return new Response(JSON.stringify({ ok: true, saved }), { headers: { "Content-Type": "application/json" } });
        }
        if (req.method === "POST" && action === "notify_master_internal") {
            if (!cfg.reminder_secret || req.headers.get("x-reminder-secret") !== cfg.reminder_secret) {
                return new Response("forbidden", { status: 403 });
            }
            const body = await req.json().catch(() => ({})) as Record<string, unknown>;
            const { data: lead } = await supabase.from("crm_leads").select("*").eq("id", String(body.lead ?? "")).maybeSingle();
            let sent = false;
            if (lead?.assigned_master_id) {
                const master = (await supabase.from("crm_masters").select("name,tg_chat_id,pay_type,default_pct,hourly_rate,language,pair_master_id").eq("id", lead.assigned_master_id).limit(1)).data?.[0];
                sent = await sendMasterJobDM(cfg, lead, master, cfg.timezone || "Europe/Budapest");
                await supabase.from("crm_timeline").insert({ lead_id: lead.id, kind: "note", body: sent ? `📨 Заказ отправлен мастеру (${master?.name ?? ""}) в Telegram` : "⚠️ Не удалось отправить заказ мастеру" });
            }
            return new Response(JSON.stringify({ ok: sent }), { headers: { "Content-Type": "application/json" } });
        }
        if (req.method === "POST" && action === "login") {
            const form = new URLSearchParams(await req.text());
            const username = (form.get("username") || "").trim().toLowerCase();
            const password = form.get("password") || "";
            const { data: u } = await supabase.from("crm_users").select("*").eq("username", username).eq("active", true).limit(1);
            const user = u?.[0];
            const ok = !!user && user.password_hash === (await hashPassword(sessionSecret, username, password));
            const next = form.get("next") || "";
            if (!ok)
                return new Response(loginPage("Неверный логин или пароль", next), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
            const token = await makeSession(sessionSecret, { u: username, r: user.role, m: user.master_id ?? null, exp: Date.now() + 30 * 864e5 });
            const role = user.role as "full" | "master";
            const np = new URLSearchParams(next.startsWith("?") ? next.slice(1) : "");
            const nLead = np.get("lead");
            let body: string;
            if (role === "master")
                body = await viewMasterOrders(cfg, user.master_id);
            else if (nLead)
                body = await viewLead(cfg, nLead, "", role);
            else
                body = await viewBoard(cfg, "");
            return new Response(page(navHtml("", role === "master" ? "orders" : "board", role), body), {
                headers: { "content-type": "text/html; charset=utf-8", "set-cookie": `crm_sess=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` },
            });
        }
        if (action === "logout") {
            return new Response(loginPage(""), { headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "crm_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
        }
        let auth: Auth | null = null;
        const sess = await readSession(sessionSecret, getCookie(req, "crm_sess"));
        if (sess && sess.r)
            auth = { role: sess.r as "full" | "master", masterId: (sess.m as string) ?? null, username: sess.u as string };
        if (!auth)
            return new Response(loginPage("", url.search || ""), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
        const k = "";
        if (req.method === "POST" && action === "photo_upload") {
            const fd = await req.formData();
            const leadId = String(fd.get("lead") || "");
            let okLead = auth.role === "full";
            if (!okLead && leadId && auth.masterId) {
                const { data: lr } = await supabase.from("crm_leads").select("assigned_master_id").eq("id", leadId).limit(1);
                okLead = lr?.[0]?.assigned_master_id === auth.masterId;
            }
            const phase = fd.get("phase") === "before" ? "before" : "after";
            if (okLead && leadId) {
                for (const f of fd.getAll("photo")) {
                    if (f instanceof File && f.size > 0 && f.size <= 15 * 1024 * 1024) {
                        const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
                        const path = `${leadId}/${Date.now()}_${Math.round(performance.now())}.${ext}`;
                        const buf = new Uint8Array(await f.arrayBuffer());
                        const { error } = await supabase.storage.from("job-photos").upload(path, buf, { contentType: f.type || "image/jpeg", upsert: false });
                        if (!error)
                            await supabase.from("crm_job_photos").insert({ lead_id: leadId, master_id: auth.masterId ?? null, path, phase });
                    }
                }
            }
            if (url.searchParams.get("xhr"))
                return new Response("ok");
            if (auth.role === "master")
                return new Response(page(navHtml(k, "orders", "master"), await viewMasterOrders(cfg, auth.masterId)), { headers: { "content-type": "text/html; charset=utf-8" } });
            return new Response(page(navHtml(k, "board", auth.role), await viewLead(cfg, leadId, k, auth.role), k), { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        if (auth.role === "master") {
            if (req.method === "POST" && action === "master_days" && auth.masterId) {
                const form = new URLSearchParams(await req.text());
                const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => form.get("d" + d));
                await supabase.from("crm_masters").update({ work_days: days }).eq("id", auth.masterId);
            }
            return new Response(page(navHtml(k, "orders", "master"), await viewMasterOrders(cfg, auth.masterId)), { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        if (url.searchParams.get("view") === "makati" || action === "makati_update") {
            if (auth.role !== "full")
                return new Response("forbidden", { status: 403 });
            if (req.method === "POST" && action === "makati_update") {
                try {
                    await makatiUpdate(supabase, new URLSearchParams(await req.text()));
                }
                catch {
                    return new Response("Could not save Makati inquiry", { status: 400 });
                }
            }
            else if (req.method !== "GET")
                return new Response("method not allowed", { status: 405 });
            return new Response(page(navHtml(k, "makati", auth.role), await makatiView(supabase, k, url.searchParams.get("makati_id")), k), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        }
        if (req.method === "GET" && action === "wa_open") {
            const leadId = url.searchParams.get("lead") ?? "";
            const { data: lead } = await supabase.from("crm_leads").select("*").eq("id", leadId).maybeSingle();
            if (!lead || lead.source === "job_application")
                return new Response("not found", { status: 404 });
            const [{ data: messages }, { data: jobs }] = await Promise.all([
                supabase.from("crm_wa_messages").select("direction,sent_at").eq("lead_id", leadId).order("sent_at", { ascending: false }).limit(30),
                supabase.from("crm_wa_outbox").select("status,sent_at").eq("lead_id", leadId).eq("kind", "first_touch").order("created_at", { ascending: false }).limit(1),
            ]);
            const sentJob = jobs?.find((job) => job.status === "sent");
            const evidenceAt = String(messages?.[0]?.sent_at ?? sentJob?.sent_at ?? lead.last_contact_at ?? "");
            const alreadyContacted = Boolean(messages?.length || sentJob || lead.last_contact_at);
            if (lead.status === "new" && alreadyContacted) {
                const target = messages?.some((message) => message.direction === "incoming") ? "in_progress" : "contacted";
                const now = new Date().toISOString();
                const update: Record<string, unknown> = { status: target, status_changed_at: now };
                if (evidenceAt)
                    update.last_contact_at = evidenceAt;
                const { data: corrected } = await supabase.from("crm_leads").update(update).eq("id", leadId).eq("status", "new").select("id").maybeSingle();
                if (corrected) {
                    await supabase.from("crm_timeline").insert({
                        lead_id: leadId, kind: "status_change",
                        body: `Статус исправлен при открытии WhatsApp: Новый → ${target === "in_progress" ? "В работе" : "Написал, ждём ответа"}`,
                        meta: { source: "whatsapp_evidence" },
                    });
                }
            }
            const phone = waDigits(lead.phone);
            if (!phone)
                return new Response("invalid phone", { status: 400 });
            const { data: waInsight } = await supabase.from("crm_wa_insights").select("suggested_reply,objection").eq("lead_id", leadId).maybeSingle();
            const destination = lead.status === "new" && alreadyContacted
                ? `https://api.whatsapp.com/send?phone=${phone}`
                : waUrl(lead, waInsight);
            const safeDestination = JSON.stringify(destination).replace(/</g, "\\u003c");
            return new Response(`<!doctype html><meta charset="utf-8"><title>WhatsApp</title><script>location.replace(${safeDestination})</script><a href="${esc(destination)}">Открыть WhatsApp</a>`, {
                headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
            });
        }
        if (req.method === "GET" && action === "export") {
            const raw = url.searchParams.get("type") ?? "";
            const type = raw === "deals" || raw === "masters" ? raw : "leads";
            const csv = await exportCsv(type);
            return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${type}.csv"` } });
        }
        if (req.method === "POST" && action === "gbp_reply") {
            const note = auth.role === "full" ? await publishGbpReply(new URLSearchParams(await req.text())) : "Только владелец";
            return new Response(page(navHtml(k, "reviews", auth.role), await viewReviews(cfg, k, note), k), { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        if (req.method === "POST") {
            const form = new URLSearchParams(await req.text());
            let dest = "::board";
            let canRun = true;
            if (["lead_delete", "deal_delete", "master_delete", "user_save", "user_delete", "expense_add", "expense_del"].includes(action))
                canRun = auth.role === "full";
            else if (["import_ads", "ad_add", "ad_del"].includes(action))
                canRun = auth.role === "full" || auth.role === "marketer";
            if (canRun) {
                try {
                    dest = await handleAction(cfg, action, form);
                }
                catch (e) {
                    console.error("action", action, e);
                }
            }
            let view = "board", body: string;
            if (dest === "::masters") {
                view = "masters";
                body = await viewMasters(cfg, k);
            }
            else if (dest === "::money") {
                view = "money";
                body = await viewMoney(cfg, auth.role, k);
            }
            else if (dest === "::data") {
                view = "data";
                body = await viewData(cfg, k);
            }
            else if (dest === "::orders") {
                view = "orders";
                body = await viewOrders(cfg, k);
            }
            else if (dest === "::users") {
                view = "users";
                body = await viewUsers(cfg, k);
            }
            else if (dest === "::candidates") {
                view = "candidates";
                body = await viewCandidates(cfg, k);
            }
            else if (dest && dest !== "::board") {
                body = await viewLead(cfg, dest, k, auth.role);
            }
            else
                body = await viewBoard(cfg, k);
            return new Response(page(navHtml(k, view, auth.role), body, k), { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        const leadId = url.searchParams.get("lead");
        let view = url.searchParams.get("view") || "board";
        let body: string;
        if (leadId) {
            body = await viewLead(cfg, leadId, k, auth.role);
            view = "board";
        }
        else if (view === "calendar")
            body = await viewCalendar(cfg, k, url.searchParams.get("week") || "", url.searchParams.get("cal") || "");
        else if (view === "money")
            body = await viewMoney(cfg, auth.role, k);
        else if (view === "analytics")
            body = await viewAnalytics(cfg, k, url.searchParams.get("from") || "", url.searchParams.get("to") || "", url.searchParams.get("city") || "budapest", url.searchParams.get("mode") || "job");
        else if (view === "candidates")
            body = await viewCandidates(cfg, k);
        else if (view === "masters")
            body = await viewMasters(cfg, k);
        else if (view === "data" && (auth.role === "full" || auth.role === "marketer"))
            body = await viewData(cfg, k);
        else if (view === "orders")
            body = await viewOrders(cfg, k);
        else if (view === "gallery")
            body = await viewGallery(cfg, k, url.searchParams.get("svc") || "");
        else if (view === "users" && auth.role === "full")
            body = await viewUsers(cfg, k);
        else if (view === "reviews" && auth.role === "full")
            body = await viewReviews(cfg, k);
        else {
            view = "board";
            body = await viewBoard(cfg, k);
        }
        return new Response(page(navHtml(k, view, auth.role), body, k), { headers: { "content-type": "text/html; charset=utf-8" } });
    });
