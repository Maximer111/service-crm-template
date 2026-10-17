type Row = Record<string, unknown>;
export type Lead = {
    id: string;
    status: string;
    source?: string | null;
    campaign?: string | null;
    service?: string | null;
    language?: string | null;
    country?: string | null;
    attribution?: unknown;
    answers?: unknown;
    first_msg?: string | null;
    budget?: string | null;
    scheduled_at?: string | null;
    received_at?: string | null;
    created_at?: string | null;
};
export type Deal = {
    lead_id: string;
    amount: unknown;
    master_payout?: unknown;
    extra_costs?: unknown;
    hours?: unknown;
    job_date?: string | null;
    closed_at?: string | null;
};
export type Mode = "lead" | "job";
export const CHANNELS = [
    { id: "fb", label: "Реклама Facebook", color: "#3f83f2" },
    { id: "wa", label: "WhatsApp без метки", color: "#22ab5f" },
    { id: "google", label: "Google", color: "#9a6ff0" },
    { id: "site", label: "Сайт, прямой заход", color: "#c4850c" },
    { id: "social", label: "Instagram и Facebook", color: "#dc5aa0" },
    { id: "other", label: "Повторные и прочее", color: "#7f9a1c" },
    { id: "ai", label: "ChatGPT и ИИ-поиск", color: "#13a6bd" },
    { id: "ref", label: "Рекомендации", color: "#e2653b" },
];
const AI = /chatgpt|openai|perplexity|gemini|claude|copilot/;
const SEARCH = /(^|\.)(google|bing|duckduckgo|yandex)\./;
const SOCIAL = /(^|\.)(instagram|facebook|fb|tiktok|youtube)\./;
function tagged(o: Row): string | null {
    const src = String(o.utm_source ?? "").trim().toLowerCase();
    if (src) {
        if (AI.test(src))
            return "ai";
        if (/google|bing|yandex|gbp/.test(src))
            return "google";
        if (/facebook|instagram|^fb$|^ig$|tiktok|youtube/.test(src))
            return /cpc|ppc|paid|ads/.test(String(o.utm_medium ?? "").toLowerCase()) ? "fb" : "social";
        return "other";
    }
    let h = "";
    try {
        h = new URL(String(o.referrer ?? "")).hostname.replace(/^www\./, "");
    }
    catch {
        return null;
    }
    if (AI.test(h))
        return "ai";
    if (SEARCH.test(h))
        return "google";
    if (SOCIAL.test(h))
        return "social";
    return h ? "other" : null;
}
const SELF: Record<string, string> = { google: "google", ai: "ai", social: "social", referral: "ref", returning: "other", other: "other" };
function waOrigin(o: Row): string | null {
    const w = String(o.wa_from ?? "");
    if (!w)
        return null;
    if (w === "fb_ad")
        return "fb";
    if (w === "gbp")
        return "google";
    if (w === "instagram" || w === "facebook")
        return "social";
    return tagged(o) ?? "site";
}
export function waText(text: unknown): string | null {
    const t = String(text ?? "");
    if (!t)
        return null;
    if (/chat ?gpt|perplexity|gemini|openai/i.test(t))
        return "ai";
    if (/(facebook|instagram|инстаграм|фейсбук)/i.test(t) && /\bads?\b|реклам|hirdet/i.test(t))
        return "fb";
    if (/instagram|инстаграм|инстаграме|facebook|фейсбук|tiktok|тикток/i.test(t))
        return "social";
    if (/(found|find|saw|seen|searched|googled)[^.!?]{0,30}google|google maps|google térkép|google-?(ban|on|ön|en)[^.!?]{0,20}(talál|lát)|(нашл|нашёл|увидел|искал)[^.!?]{0,30}(google|гугл)|(через|из|в) (google|гугл)/i.test(t))
        return "google";
    if (/recommended|recommend(ed)? (you|by)|посоветова|порекомендова|ajánlott|ajánlás|javasol/i.test(t))
        return "ref";
    if (/your (web)?site|on your .{0,40}page|с (вашего )?сайта|на (вашем )?сайте|weboldal|honlap/i.test(t))
        return "site";
    return null;
}
export function channelOf(l: {
    source?: unknown;
    attribution?: unknown;
    first_msg?: unknown;
}): string {
    const s = String(l.source ?? "").toLowerCase();
    const o = (l.attribution && typeof l.attribution === "object" ? l.attribution : {}) as Row;
    const self = SELF[String(o.self_reported ?? "")];
    if (s === "facebook")
        return "fb";
    if (s === "instagram")
        return "social";
    if (s.includes("repeat"))
        return "other";
    if (s.startsWith("whatsapp"))
        return waOrigin(o) ?? waText(l.first_msg) ?? self ?? "wa";
    if (s === "google" || s === "google_maps" || s === "seo")
        return "google";
    if (s === "referral")
        return "ref";
    if (s === "website")
        return tagged(o) ?? self ?? "site";
    return self ?? "other";
}
export function cityOf(campaign: unknown): string {
    const m = /^\(([^)]+)\)/.exec(String(campaign ?? ""));
    return m ? m[1].trim().toLowerCase() : "budapest";
}
const FOREIGN = new Set(["US", "CA", "DE", "PH"]);
const leadCity = (l: Lead) => { const c = cityOf(l.campaign); const cc = String(l.country ?? "").toUpperCase(); return c === "budapest" && FOREIGN.has(cc) ? cc.toLowerCase() : c; };
const EXCLUDE_AD = /hung|венг|vacancy|вакан/i;
const dayNum = (v: unknown) => { const t = Date.parse(String(v ?? "") + "T00:00:00Z"); return isNaN(t) ? null : t; };
export function countedAdRows<T extends Row>(spend: T[]): T[] {
    const apiRows = spend.filter((s) => s.source_file === "meta_api");
    const shadowed = (s: Row) => {
        if (s.source_file === "meta_api")
            return false;
        const a = dayNum(s.date_start ?? s.date_stop), b = dayNum(s.date_stop ?? s.date_start);
        if (a === null || b === null)
            return false;
        const key = String(s.campaign ?? "").trim().toLowerCase();
        return apiRows.some((r) => {
            if (String(r.campaign ?? "").trim().toLowerCase() !== key)
                return false;
            const c = dayNum(r.date_start ?? r.date_stop), d = dayNum(r.date_stop ?? r.date_start);
            return c !== null && d !== null && c <= b && d >= a;
        });
    };
    return spend.filter((s) => !EXCLUDE_AD.test(String(s.campaign || "")) && !shadowed(s));
}
export const DIRS = [
    { id: "chim_ru", label: "Химчистка RU", color: "#dc5aa0" },
    { id: "chim_en", label: "Химчистка EN", color: "#e2653b" },
    { id: "clean_ru", label: "Клининг RU", color: "#3f83f2" },
    { id: "clean_en", label: "Клининг EN", color: "#13a6bd" },
    { id: "ads_other", label: "Прочая реклама", color: "#7f9a1c" },
];
export function dirOf(campaign: unknown, known?: Set<string>): string | null {
    const raw = String(campaign ?? "").trim();
    const c = raw.toLowerCase();
    if (!c || EXCLUDE_AD.test(c))
        return null;
    if (known && !known.has(c))
        return null;
    const ru = /\(ru\)|\bru\b|рус/.test(c), en = /engl|\(en\)|\ben\b|англ/.test(c);
    if (/chim|хим/.test(c))
        return ru ? "chim_ru" : en ? "chim_en" : "ads_other";
    if (/clean|уборк|клининг/.test(c))
        return ru ? "clean_ru" : en ? "clean_en" : "ads_other";
    return "ads_other";
}
export function adCampaigns(rows: Row[]): Set<string> {
    return new Set(rows.map((r) => String(r.campaign ?? "").trim().toLowerCase()).filter(Boolean));
}
export function adByDirDay(rows: Row[], toHuf: (amount: number, currency: string) => number): Map<string, Map<string, number>> {
    const out = new Map<string, Map<string, number>>();
    for (const r of rows) {
        const dir = dirOf(r.campaign);
        if (!dir)
            continue;
        let m = out.get(dir);
        if (!m) {
            m = new Map();
            out.set(dir, m);
        }
        for (const [d, v] of spreadByDay([r], toHuf))
            m.set(d, (m.get(d) ?? 0) + v);
    }
    return out;
}
export type DirStat = {
    id: string;
    label: string;
    color: string;
    spend: number;
    leads: number;
    orders: number;
    sum: number;
    net: number;
};
const dealNet = (d: Deal) => {
    const amount = Number(d.amount || 0);
    const pay = Number(d.master_payout ?? 0);
    const hrs = Number(d.hours ?? 0);
    const payEst = pay > 0 ? pay : hrs > 0 ? hrs * 3000 : Math.round(amount * 0.4);
    return amount - payEst - Number(d.extra_costs ?? 0);
};
export function buildDirections(leads: Lead[], deals: Deal[], adDir: Map<string, Map<string, number>>, from: string, to: string, city: string, mode: Mode, known?: Set<string>): DirStat[] {
    const stats = new Map(DIRS.map((d) => [d.id, { ...d, spend: 0, leads: 0, orders: 0, sum: 0, net: 0 }]));
    for (const [dir, days] of adDir) {
        const st = stats.get(dir);
        if (!st)
            continue;
        for (const [d, v] of days)
            if (d >= from && d <= to)
                st.spend += v;
    }
    const paid = new Map<string, number>(), netBy = new Map<string, number>();
    for (const d of deals) {
        paid.set(d.lead_id, (paid.get(d.lead_id) ?? 0) + Number(d.amount || 0));
        netBy.set(d.lead_id, (netBy.get(d.lead_id) ?? 0) + dealNet(d));
    }
    const mine = leads.filter((l) => l.source !== "internal_test" && l.source !== "job_application" && (city === "all" || leadCity(l) === city));
    const byId = new Map(mine.map((l) => [l.id, l]));
    for (const l of mine) {
        const dir = dirOf(l.campaign, known);
        if (!dir)
            continue;
        const st = stats.get(dir);
        if (!st)
            continue;
        const d = leadDay(l);
        if (d >= from && d <= to) {
            st.leads++;
            if (mode === "lead" && l.status === "won") {
                st.orders++;
                st.sum += paid.get(l.id) ?? 0;
                st.net += netBy.get(l.id) ?? 0;
            }
        }
    }
    if (mode === "job") {
        for (const d of deals) {
            const jd = String(d.job_date ?? ""), l = byId.get(d.lead_id);
            if (!jd || jd < from || jd > to || !l || !d.closed_at || !(Number(d.amount) > 0))
                continue;
            const dir = dirOf(l.campaign, known);
            if (!dir)
                continue;
            const st = stats.get(dir);
            if (!st)
                continue;
            st.orders++;
            st.sum += Number(d.amount || 0);
            st.net += dealNet(d);
        }
    }
    return [...stats.values()].filter((d) => d.spend || d.leads || d.orders);
}
export function buildDirMonths(leads: Lead[], deals: Deal[], adDir: Map<string, Map<string, number>>, today: string, city: string, mode: Mode, n = 3, known?: Set<string>) {
    const months: {
        key: string;
        from: string;
        to: string;
        dirs: DirStat[];
    }[] = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today.slice(0, 8) + "01T00:00:00Z");
        d.setUTCMonth(d.getUTCMonth() - i);
        const first = d.toISOString().slice(0, 10);
        const end = new Date(d);
        end.setUTCMonth(end.getUTCMonth() + 1);
        end.setUTCDate(0);
        const last = end.toISOString().slice(0, 10);
        months.push({ key: first.slice(0, 7), from: first, to: last > today ? today : last, dirs: buildDirections(leads, deals, adDir, first, last > today ? today : last, city, mode, known) });
    }
    return months;
}
export function spreadByDay(rows: Row[], toHuf: (amount: number, currency: string) => number): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of rows) {
        const a = dayNum(r.date_start ?? r.date_stop), b = dayNum(r.date_stop ?? r.date_start);
        if (a === null || b === null || b < a)
            continue;
        const days = Math.floor((b - a) / 86400000) + 1;
        const perDay = toHuf(Number(r.spend), String(r.currency ?? "")) / days;
        for (let i = 0; i < days; i++) {
            const d = new Date(a + i * 86400000).toISOString().slice(0, 10);
            out.set(d, (out.get(d) ?? 0) + perDay);
        }
    }
    return out;
}
export function generalExpensesByDay(rows: Row[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of rows) {
        if (r.lead_id)
            continue;
        const day = String(r.spent_on ?? "").slice(0, 10), amount = Number(r.amount ?? 0);
        if (!day || !Number.isFinite(amount))
            continue;
        out.set(day, (out.get(day) ?? 0) + amount);
    }
    return out;
}
export type ChanStat = {
    id: string;
    label: string;
    color: string;
    leads: number;
    won: number;
    junk: number;
    lost: number;
    fresh: number;
    waiting: number;
    dialog: number;
    orders: number;
    sum: number;
};
export type Week = {
    start: string;
    by: Record<string, number>;
    total: number;
    won: number;
};
export type Bucket = {
    d: string;
    leads: number;
    orders: number;
    sum: number;
    ad: number;
};
export const shiftDay = (iso: string, days: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const spanDays = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
const BUDAPEST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" });
const leadDay = (l: Lead) => {
    const raw = String(l.received_at || l.created_at || "");
    const t = Date.parse(raw);
    return isNaN(t) ? raw.slice(0, 10) : BUDAPEST_DAY.format(new Date(t));
};
const monday = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
const localDay = (value: unknown, tz: string) => {
    const d = new Date(String(value ?? ""));
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d) : "";
};
function budgetHuf(lead: Lead, repeatBooking: boolean): number {
    const attribution = lead.attribution && typeof lead.attribution === "object" ? lead.attribution as Row : {};
    if (repeatBooking && attribution.repeat_booking_budget_confirmed !== true)
        return 0;
    const s = String(lead.budget ?? "").trim();
    const tagged = s.match(/(\d[\d\s.,]*)\s*(?:huf|ft)\b/i)?.[1];
    const raw = tagged ?? (/^\d[\d\s.,]*$/.test(s) ? s : "");
    if (!raw)
        return 0;
    const n = Number(raw.replace(/[\s.,]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
}
export function buildAnalytics(leads: Lead[], deals: Deal[], adByDay: Map<string, number>, from: string, to: string, city: string, mode: Mode = "lead", today = to, expenseByDay = new Map<string, number>(), timezone = "Europe/Budapest") {
    const mine = leads.filter((l) => l.source !== "internal_test" && l.source !== "job_application" && leadDay(l) && (city === "all" || leadCity(l) === city));
    const rows = mine.filter((l) => { const d = leadDay(l); return d >= from && d <= to; });
    const dealsOf = new Map<string, Deal[]>();
    for (const d of deals)
        dealsOf.set(d.lead_id, [...(dealsOf.get(d.lead_id) ?? []), d]);
    const latestDealDate = new Map<string, string>();
    for (const d of deals) {
        const jd = String(d.job_date ?? "");
        if (jd > (latestDealDate.get(d.lead_id) ?? ""))
            latestDealDate.set(d.lead_id, jd);
    }
    const unit: "day" | "week" = spanDays(from, to) > 62 ? "week" : "day";
    const series: Bucket[] = [];
    for (let d = unit === "day" ? from : monday(from); d <= to; d = shiftDay(d, unit === "day" ? 1 : 7))
        series.push({ d, leads: 0, orders: 0, sum: 0, ad: 0 });
    const slot = new Map(series.map((b) => [b.d, b]));
    const bucket = (iso: string) => slot.get(unit === "day" ? iso : monday(iso));
    const chans: ChanStat[] = CHANNELS.map((c) => ({ ...c, leads: 0, won: 0, junk: 0, lost: 0, fresh: 0, waiting: 0, dialog: 0, orders: 0, sum: 0 }));
    const byId = new Map(chans.map((c) => [c.id, c]));
    for (const l of rows) {
        const c = byId.get(channelOf(l))!, b = bucket(leadDay(l));
        c.leads++;
        if (b)
            b.leads++;
        if (l.status === "won")
            c.won++;
        if (l.status === "junk")
            c.junk++;
        if (l.status === "lost")
            c.lost++;
        if (l.status === "new")
            c.fresh++;
        if (l.status === "contacted")
            c.waiting++;
        if (["in_progress", "pushing", "follow_up", "won", "lost"].includes(l.status))
            c.dialog++;
        if (mode === "lead" && l.status === "won") {
            const all = dealsOf.get(l.id) ?? [];
            const cur = all.filter((d) => !d.job_date || String(d.job_date) >= leadDay(l));
            if (!all.length || cur.length) {
                const amt = cur.reduce((x, d) => x + Number(d.amount || 0), 0);
                c.orders++;
                c.sum += amt;
                if (b) {
                    b.orders++;
                    b.sum += amt;
                }
            }
        }
    }
    let ahead = 0, aheadSum = 0, needsClosure = 0, needsClosureSum = 0;
    let masterPayout = 0, dealExpenses = 0;
    if (mode === "job") {
        const byLead = new Map(mine.map((l) => [l.id, l]));
        const dealtVisits = new Set<string>();
        for (const d of deals) {
            const jd = String(d.job_date ?? "");
            const l = byLead.get(d.lead_id);
            if (!jd || jd < from || jd > to || !l)
                continue;
            dealtVisits.add(`${d.lead_id}|${jd}`);
            const c = byId.get(channelOf(l))!, amt = Number(d.amount || 0), b = bucket(jd);
            if (jd > today || (jd === today && !d.closed_at)) {
                ahead++;
                aheadSum += amt > 0 ? amt : 0;
                continue;
            }
            if (!d.closed_at || !(amt > 0)) {
                needsClosure++;
                needsClosureSum += amt > 0 ? amt : 0;
                continue;
            }
            c.orders++;
            c.sum += amt;
            masterPayout += Number(d.master_payout || 0);
            dealExpenses += Number(d.extra_costs || 0);
            if (b) {
                b.orders++;
                b.sum += amt;
            }
        }
        for (const l of mine) {
            const jd = localDay(l.scheduled_at, timezone);
            if (l.status !== "won" || !jd || jd < from || jd > to || dealtVisits.has(`${l.id}|${jd}`))
                continue;
            const previous = latestDealDate.get(l.id) ?? "";
            const amt = budgetHuf(l, Boolean(previous && jd > previous));
            if (jd >= today) {
                ahead++;
                aheadSum += amt;
            }
            else {
                needsClosure++;
                needsClosureSum += amt;
            }
        }
    }
    let ad = 0;
    const financialTo = mode === "job" ? (from > today ? "" : (to > today ? today : to)) : to;
    if (city === "all" || city === "budapest") {
        for (const [d, v] of adByDay) {
            if (!financialTo || d < from || d > financialTo)
                continue;
            ad += v;
            const b = bucket(d);
            if (b)
                b.ad += v;
        }
    }
    let generalExpenses = 0;
    if (city === "all" || city === "budapest") {
        for (const [d, v] of expenseByDay)
            if (financialTo && d >= from && d <= financialTo)
                generalExpenses += v;
    }
    const weeks: Week[] = [];
    const last = monday(to);
    for (let i = 7; i >= 0; i--)
        weeks.push({ start: shiftDay(last, -7 * i), by: {}, total: 0, won: 0 });
    const wk = new Map(weeks.map((w) => [w.start, w]));
    for (const l of mine) {
        const w = wk.get(monday(leadDay(l)));
        if (!w)
            continue;
        const ch = channelOf(l);
        w.by[ch] = (w.by[ch] ?? 0) + 1;
        w.total++;
        if (l.status === "won")
            w.won++;
    }
    const badPhone = rows.filter((l) => {
        const a = (l.answers && typeof l.answers === "object" ? l.answers : {}) as Record<string, unknown>;
        return a.bad_phone === true;
    }).length;
    const sum = (f: (c: ChanStat) => number) => chans.reduce((s, c) => s + f(c), 0);
    const cities = [...new Set(leads.filter((l) => l.source !== "job_application").map(leadCity))].sort();
    return {
        rows, chans, weeks, series, unit, ad, cities, mode, ahead, aheadSum, needsClosure, needsClosureSum, masterPayout, dealExpenses, generalExpenses, badPhone,
        total: rows.length, won: sum((c) => c.won), junk: sum((c) => c.junk), lost: sum((c) => c.lost),
        fresh: sum((c) => c.fresh), waiting: sum((c) => c.waiting), dialog: sum((c) => c.dialog), orders: sum((c) => c.orders), sum: sum((c) => c.sum),
        net: sum((c) => c.sum) - masterPayout - dealExpenses - generalExpenses - ad,
    };
}
export type Analytics = ReturnType<typeof buildAnalytics>;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0;
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const CITY: Record<string, string> = { all: "Все города", budapest: "Будапешт", toronto: "Торонто", makati: "Макати", orlando: "Орландо", us: "США", ca: "Канада", de: "Германия", ph: "Филиппины" };
function delta(cur: number, prev: number, better: "up" | "down" | "none" = "up", points = false): string {
    if (!prev && !cur)
        return `<span class="dx-d flat">без изменений</span>`;
    if (!prev)
        return `<span class="dx-d up" title="в прошлом периоде 0">новое</span>`;
    const ch = points ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100;
    const r = Math.round(ch);
    if (!r)
        return `<span class="dx-d flat">≈ как было</span>`;
    const tone = better === "none" ? "flat" : (better === "down" ? r < 0 : r > 0) ? "up" : "down";
    const was = points ? `${Math.round(prev)}%` : fmt(prev);
    return `<span class="dx-d ${tone}">${r > 0 ? "▲" : "▼"} ${Math.abs(r)}${points ? " п.п." : "%"}</span><span class="dx-was">было ${was}</span>`;
}
function spark(vals: number[], color: string, id: string): string {
    if (vals.length < 2 || !vals.some((v) => v))
        return `<svg class="dx-spark" viewBox="0 0 120 34" aria-hidden="true"></svg>`;
    const max = Math.max(...vals), step = 120 / (vals.length - 1);
    const xy = vals.map((v, i) => [i * step, 31 - (v / max) * 27] as const);
    const pts = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
    const [lx, ly] = xy[xy.length - 1];
    return `<svg class="dx-spark" viewBox="0 0 120 34" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><line x1="0" x2="120" y1="31.5" y2="31.5" class="dx-sbase"/><path d="M0,34 L${pts.join(" L")} L120,34 Z" fill="url(#${id})"/><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.6" fill="${color}" stroke="#0f172a" stroke-width="1.4"/><text x="118" y="9" text-anchor="end" class="dx-smax">${fmt(max)}</text></svg>`;
}
function donut(a: Analytics): string {
    const R = 54, C = 2 * Math.PI * R, gap = a.total > 1 ? 2.5 : 0;
    let off = 0;
    const segs = a.chans.filter((c) => c.leads).map((c) => {
        const len = (C * c.leads) / a.total;
        const s = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${c.color}" stroke-width="16" stroke-dasharray="${Math.max(len - gap, 0.5).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"><title>${esc(c.label)}: ${c.leads} (${pct(c.leads, a.total)}%)</title></circle>`;
        off += len;
        return s;
    }).join("");
    const ring = a.total ? `<g class="dx-ring" transform="rotate(-90 80 80)">${segs}</g>` : `<circle r="${R}" cx="80" cy="80" fill="none" stroke="#1d2842" stroke-width="16"/>`;
    return `<svg viewBox="0 0 160 160" class="dx-donut" role="img" aria-label="Заявки по каналам"><circle r="${R}" cx="80" cy="80" fill="none" stroke="#18223a" stroke-width="16"/>${ring}<text x="80" y="80" text-anchor="middle" class="dx-donut-n">${a.total}</text><text x="80" y="99" text-anchor="middle" class="dx-donut-l">заявок</text></svg>`;
}
function trend(a: Analytics): string {
    const s = a.series, n = s.length;
    const L = 36, Rm = 12, T = 18, B = 28, W = 760 - L - Rm, H = 250 - T - B;
    const top = Math.max(1, ...s.map((b) => Math.max(b.leads, b.orders)));
    const nice = Math.max(4, Math.ceil(top / 4) * 4);
    const x = (i: number) => L + (n === 1 ? W / 2 : (i * W) / (n - 1));
    const y = (v: number) => T + H - (v / nice) * H;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = Math.round(nice * f), yy = y(v).toFixed(1); return `<line x1="${L}" x2="${L + W}" y1="${yy}" y2="${yy}" class="dx-grid"/><text x="${L - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" class="dx-axis">${v}</text>`; }).join("");
    const every = Math.max(1, Math.ceil(n / 8));
    const xl = s.map((b, i) => i % every === 0 || i === n - 1 ? `<text x="${x(i).toFixed(1)}" y="${T + H + 18}" text-anchor="middle" class="dx-axis">${ddmm(b.d)}</text>` : "").join("");
    const bw = Math.max(3, Math.min(16, (W / Math.max(n, 1)) * 0.45));
    const bars = s.map((b, i) => b.orders ? `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(b.orders).toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + H - y(b.orders)).toFixed(1)}" rx="3" class="dx-bar"/>` : "").join("");
    const pts = s.map((b, i) => `${x(i).toFixed(1)},${y(b.leads).toFixed(1)}`);
    const area = n > 1 ? `<path d="M${x(0).toFixed(1)},${T + H} L${pts.join(" L")} L${x(n - 1).toFixed(1)},${T + H} Z" fill="url(#dxArea)"/><polyline points="${pts.join(" ")}" class="dx-line"/>` : "";
    const dots = n <= 31 ? s.map((b, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(b.leads).toFixed(1)}" r="2.6" class="dx-dot"/>`).join("") : "";
    const data = JSON.stringify(s.map((b, i) => ({ x: +x(i).toFixed(1), d: b.d, l: b.leads, o: b.orders, s: Math.round(b.sum) }))).replace(/</g, "\\u003c");
    return `<div class="dx-chart" data-unit="${a.unit}"><svg viewBox="0 0 760 250" role="img" aria-label="Заявки и заказы по ${a.unit === "day" ? "дням" : "неделям"}"><defs><linearGradient id="dxArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5b8def" stop-opacity=".42"/><stop offset="1" stop-color="#5b8def" stop-opacity="0"/></linearGradient></defs>${grid}${area}${bars}${dots}${xl}<line class="dx-cross" x1="0" x2="0" y1="${T}" y2="${T + H}"/><rect class="dx-hit" x="${L}" y="${T}" width="${W}" height="${H}" fill="transparent"/></svg><div class="dx-tip" hidden></div><script type="application/json" class="dx-data">${data}</script></div>`;
}
function funnel(a: Analytics): string {
    const steps = [["Заявки", a.total, "#5b8def"], ["Вышли на диалог", a.dialog, "#2bb3c0"], ["Заказ", a.won, "#34c77b"]] as const;
    const Wmax = 300, h = 56, gap = 10;
    const w = (v: number) => Wmax * Math.max(0.2, a.total ? v / a.total : 0);
    const shapes = steps.map(([label, v, color], i) => {
        const t = w(v), b = i < steps.length - 1 ? w(steps[i + 1][1]) : t * 0.82, y0 = i * (h + gap);
        const cx = 160, poly = `${cx - t / 2},${y0} ${cx + t / 2},${y0} ${cx + b / 2},${y0 + h} ${cx - b / 2},${y0 + h}`;
        const conv = i ? `<text x="318" y="${y0 - 1}" text-anchor="end" class="dx-fconv">↓ ${pct(v, steps[i - 1][1])}% из предыдущего</text>` : "";
        return `${conv}<polygon points="${poly}" fill="${color}" opacity=".9"><title>${label}: ${v}</title></polygon><text x="${cx}" y="${y0 + h / 2 - 2}" text-anchor="middle" class="dx-fn">${v}</text><text x="${cx}" y="${y0 + h / 2 + 15}" text-anchor="middle" class="dx-fl">${label} · ${pct(v, a.total)}%</text>`;
    }).join("");
    return `<svg viewBox="0 -14 320 212" class="dx-funnel" role="img" aria-label="Воронка заявок">${shapes}</svg>`;
}
function dirTable(dirs: DirStat[], prev: DirStat[], months: DirMonth[], prevLabel: string): string {
    if (!dirs.length)
        return `<div class="dx-card c12"><h3>Реклама по направлениям</h3><p class="dx-mute">За период нет ни откруток, ни заявок с кампаний.</p></div>`;
    const pBy = new Map(prev.map((d) => [d.id, d]));
    const cpl = (d: DirStat) => (d.leads ? d.spend / d.leads : 0);
    const cpo = (d: DirStat) => (d.orders ? d.spend / d.orders : 0);
    const roas = (d: {
        spend: number;
        sum: number;
        net: number;
    }, w: {
        spend: number;
        sum: number;
        net: number;
    }) => {
        if (!d.spend)
            return `<span class="dx-mute">-</span>`;
        const r = d.sum / d.spend, was = w.spend ? w.sum / w.spend : 0;
        const rn = d.net / d.spend;
        const tone = rn >= 1.5 ? "up" : rn >= 1 ? "flat" : "down";
        return `<b class="dx-${tone}">×${rn.toFixed(1)}</b><span class="dx-cd"><span class="dx-was">по внесённым/оценочным выплатам · до выплат ×${r.toFixed(1)}${was ? `, было ×${was.toFixed(1)}` : ""}</span></span>`;
    };
    const cell = (cur: number, was: number, better: "up" | "down" | "none", show = fmt) => `<b>${cur ? show(cur) : "-"}</b>${cur && was ? `<span class="dx-cd">${delta(cur, was, better)}</span>` : ""}`;
    const rows = dirs.sort((a, b) => b.spend - a.spend).map((d) => {
        const w = pBy.get(d.id) ?? { spend: 0, leads: 0, orders: 0, sum: 0, net: 0 } as DirStat;
        const alarm = d.spend > 0 && cpl(d) && cpl(w) && cpl(d) > cpl(w) * 1.25;
        return `<tr class="${alarm ? "dx-alarm" : ""}"><td><i class="dx-dot2" style="background:${d.color}"></i>${esc(d.label)}${alarm ? '<span class="dx-flag">заявка дороже</span>' : ""}</td>
      <td>${cell(d.spend, w.spend, "none")}</td>
      <td>${cell(d.leads, w.leads, "up")}</td>
      <td>${cell(cpl(d), cpl(w), "down")}</td>
      <td>${cell(d.orders, w.orders, "up")}</td>
      <td>${cell(cpo(d), cpo(w), "down")}</td>
      <td>${cell(d.sum, w.sum, "up")}</td>
      <td>${roas(d, w)}</td></tr>`;
    }).join("");
    const tot = dirs.reduce((s2, d) => ({ spend: s2.spend + d.spend, leads: s2.leads + d.leads, orders: s2.orders + d.orders, sum: s2.sum + d.sum, net: s2.net + d.net }), { spend: 0, leads: 0, orders: 0, sum: 0, net: 0 });
    const ptot = prev.reduce((s2, d) => ({ spend: s2.spend + d.spend, leads: s2.leads + d.leads, orders: s2.orders + d.orders, sum: s2.sum + d.sum, net: s2.net + d.net }), { spend: 0, leads: 0, orders: 0, sum: 0, net: 0 });
    const totRow = `<tr class="dx-tot"><td>Всего</td><td>${cell(tot.spend, ptot.spend, "none")}</td><td>${cell(tot.leads, ptot.leads, "up")}</td><td>${cell(tot.leads ? tot.spend / tot.leads : 0, ptot.leads ? ptot.spend / ptot.leads : 0, "down")}</td><td>${cell(tot.orders, ptot.orders, "up")}</td><td>${cell(tot.orders ? tot.spend / tot.orders : 0, ptot.orders ? ptot.spend / ptot.orders : 0, "down")}</td><td>${cell(tot.sum, ptot.sum, "up")}</td><td>${roas(tot, ptot)}</td></tr>`;
    const ids = [...new Set(months.flatMap((m) => m.dirs.map((d) => d.id)))];
    const mLabel = (key: string) => ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][Number(key.slice(5, 7)) - 1] ?? key;
    const mRows = ids.map((id) => {
        const meta = DIRS.find((d) => d.id === id)!;
        const cells = months.map((m) => {
            const d = m.dirs.find((x) => x.id === id);
            if (!d || (!d.leads && !d.spend))
                return `<td><span class="dx-mute">-</span></td>`;
            const c = d.spend && d.leads ? d.spend / d.leads : 0;
            const head = c ? `${fmt(c)} Ft` : `<span class="dx-mute">без расхода</span>`;
            return `<td>${head}<span class="dx-sm">${d.leads} заяв. · ${d.orders} зак.</span></td>`;
        }).join("");
        return `<tr><td><i class="dx-dot2" style="background:${meta.color}"></i>${esc(meta.label)}</td>${cells}</tr>`;
    }).join("") || `<tr><td colspan="${months.length + 1}" class="dx-mute">нет данных</td></tr>`;
    return `<div class="dx-card c12"><h3>Реклама по направлениям <small>стрелки сравнивают с предыдущим таким же периодом: ${prevLabel}</small></h3>
    <div style="overflow-x:auto"><table class="dx-dirs"><tr><th>Направление</th><th>Расход</th><th>Заявок</th><th>Цена заявки</th><th>Заказов</th><th>Цена заказа</th><th>Выручка</th><th>Остаток по расчёту*</th></tr>${rows}${totRow}</table></div>
    <p class="dx-mute" style="font-size:12px">* Если выплата не внесена, используется существующая оценка по часам или 40% чека; это не бухгалтерская чистая прибыль.</p>
    <h3 style="margin-top:22px">Цена заявки по месяцам <small>календарные месяцы, текущий неполный</small></h3>
    <div style="overflow-x:auto"><table class="dx-dirs"><tr><th>Направление</th>${months.map((m) => `<th>${mLabel(m.key)}</th>`).join("")}</tr>${mRows}</table></div></div>`;
}
export type DirMonth = {
    key: string;
    from: string;
    to: string;
    dirs: DirStat[];
};
export type Prev = {
    total: number;
    orders: number;
    sum: number;
    ad: number;
    won: number;
    junk: number;
    fbLeads: number;
    fbOrders: number;
    masterPayout: number;
    dealExpenses: number;
    generalExpenses: number;
    net: number;
    from: string;
    to: string;
};
export function renderAnalytics(a: Analytics, p: Prev, k: string, from: string, to: string, city: string, today: string, dirs: DirStat[] = [], pdirs: DirStat[] = [], months: DirMonth[] = []): string {
    const fb = a.chans.find((c) => c.id === "fb")!;
    const wa = a.chans.find((c) => c.id === "wa")!;
    const job = a.mode === "job";
    const q = (f: string, t: string, m: string) => `?key=${k}&view=analytics&city=${encodeURIComponent(city)}&mode=${m}&from=${f}&to=${t}`;
    const monthStart = today.slice(0, 8) + "01";
    const monthEnd = shiftDay(shiftDay(monthStart, 32).slice(0, 8) + "01", -1);
    const prevStart = shiftDay(monthStart, -1).slice(0, 8) + "01";
    const pill = (label: string, f: string, t: string, m = a.mode) => `<a class="dx-pill${f === from && t === to && m === a.mode ? " on" : ""}" href="${q(f, t, m)}">${label}</a>`;
    const pills = [
        pill("7 дней", shiftDay(today, -6), today), pill("14 дней", shiftDay(today, -13), today), pill("30 дней", shiftDay(today, -29), today), pill("90 дней", shiftDay(today, -89), today),
        pill("Этот месяц", monthStart, job ? monthEnd : today), pill("Прошлый месяц", prevStart, shiftDay(monthStart, -1)),
        pill("Вперёд 30 дней", today, shiftDay(today, 29), "job"),
    ].join("");
    const modeSeg = `<div class="dx-seg"><a class="${job ? "" : "on"}" href="${q(from, to, "lead")}">По дате заявки</a><a class="${job ? "on" : ""}" href="${q(from, to, "job")}">По дате работы · как в Notion</a></div>`;
    const cityOpts = ["budapest", "all", ...a.cities.filter((c) => c !== "budapest")].map((c) => `<option value="${esc(c)}"${c === city ? " selected" : ""}>${esc(CITY[c] ?? c)}</option>`).join("");
    const cpo = fb.orders && a.ad ? a.ad / fb.orders : 0, pcpo = p.fbOrders && p.ad ? p.ad / p.fbOrders : 0;
    const cpl = fb.leads && a.ad ? a.ad / fb.leads : 0, pcpl = p.fbLeads && p.ad ? p.ad / p.fbLeads : 0;
    const conv = pct(a.won, a.total), pconv = pct(p.won, p.total);
    const junkP = pct(a.junk, a.total), pjunkP = pct(p.junk, p.total);
    const S = a.series;
    const hero = (label: string, value: number, shown: string, d: string, sub: string, vals: number[], color: string, id: string) => `<div class="dx-card dx-kpi"><div class="dx-lab">${label}</div><div class="dx-big" data-count="${Math.round(value)}" data-suffix="${shown.endsWith("Ft") ? " Ft" : ""}">${shown}</div><div class="dx-row">${d}<span class="dx-subt">${sub}</span></div>${spark(vals, color, id)}</div>`;
    const mini = (label: string, shown: string, d: string) => `<div class="dx-mini"><div class="dx-lab">${label}</div><div class="dx-mv">${shown}</div>${d}</div>`;
    const legend = a.chans.filter((c) => c.leads).map((c) => `<li><i style="background:${c.color}"></i><span>${esc(c.label)}</span><b>${c.leads}</b><em>${pct(c.leads, a.total)}%</em><u><s style="width:${pct(c.leads, a.total)}%;background:${c.color}"></s></u></li>`).join("");
    const absent = a.chans.filter((c) => !c.leads).map((c) => c.label);
    const maxLeads = Math.max(1, ...a.chans.map((c) => c.leads));
    const chanRows = a.chans.filter((c) => c.leads || c.orders).map((c) => {
        const cc = pct(c.won, c.leads);
        const cac = c.id === "fb" && a.ad && c.orders ? `${fmt(a.ad / c.orders)} Ft` : `<span class="dx-mute">-</span>`;
        return `<tr><td><i class="dx-dot2" style="background:${c.color}"></i>${esc(c.label)}</td><td><div class="dx-hbar"><s style="width:${pct(c.leads, maxLeads)}%;background:${c.color}"></s></div><b>${c.leads}</b></td><td><b>${c.orders}</b></td>${job ? "" : `<td>${cc}%</td>`}<td>${pct(c.junk, c.leads)}%</td><td>${c.sum ? fmt(c.sum) + " Ft" : `<span class="dx-mute">-</span>`}</td><td>${cac}</td></tr>`;
    }).join("") || `<tr><td colspan="7" class="dx-mute">нет заявок за период</td></tr>`;
    const maxW = Math.max(1, ...a.weeks.map((w) => w.total));
    const weekCols = a.weeks.map((w) => {
        const parts = a.chans.filter((c) => w.by[c.id]).map((c) => `${c.label}: ${w.by[c.id]}`).join("\n");
        const segs = a.chans.filter((c) => w.by[c.id]).map((c) => `<i style="flex:${w.by[c.id]};background:${c.color}"></i>`).join("");
        const partial = w.start === a.weeks[a.weeks.length - 1].start && monday(today) === w.start;
        return `<div class="dx-wk" title="Неделя с ${ddmm(w.start)}${partial ? " (идёт)" : ""}: ${w.total} заявок, ${w.won} заказов&#10;${esc(parts)}"><b>${w.total || ""}</b><div class="dx-stack" style="height:${Math.round((w.total / maxW) * 140)}px">${segs}</div><span class="dx-won">${w.won ? "✓ " + w.won : ""}</span><span class="dx-mute">${ddmm(w.start)}${partial ? "*" : ""}</span></div>`;
    }).join("");
    const weekLegend = a.chans.filter((c) => a.weeks.some((w) => w.by[c.id])).map((c) => `<span><i class="dx-dot2" style="background:${c.color}"></i>${esc(c.label)}</span>`).join("");
    const notes: string[] = [];
    if (wa.leads)
        notes.push(`WhatsApp: ${wa.leads} заявок написали без метки. С новыми кнопками сайта и ссылкой из Google-профиля бот отмечает источник сам.`);
    if (absent.length)
        notes.push(`Нет заявок за период: ${absent.map(esc).join(", ")}.`);
    if (a.badPhone)
        notes.push(`📵 Заявок с неверным номером: ${a.badPhone} из ${a.total} (${pct(a.badPhone, a.total)}%). Это брак заявки, а не отказ клиента: написать таким людям нельзя.`);
    if (job) {
        const org = a.chans.filter((c) => ["google", "ai", "site"].includes(c.id));
        notes.push("Финансовые показатели включают только сделки с closed_at и положительным финальным чеком. Прошедшие незакрытые выезды показаны отдельно и не входят в P&L.");
        notes.push("Остаток рассчитан по внесённым выплатам и расходам. Если выплата мастеру или расход ещё не занесены, он может быть завышен.");
        if (a.ahead)
            notes.push(`Забронировано впереди: ${a.ahead} на ${fmt(a.aheadSum)} Ft. Это не заработанная выручка.`);
        if (a.needsClosure)
            notes.push(`Требуют финансового закрытия: ${a.needsClosure} на ${fmt(a.needsClosureSum)} Ft по текущим данным CRM.`);
        notes.push(`В Notion Google, ChatGPT и сайт идут одной строкой «Органика: сайт и Google»: ${org.reduce((s, c) => s + c.orders, 0)} заказов на ${fmt(org.reduce((s, c) => s + c.sum, 0))} Ft.`);
    }
    const period = `${ddmm(from)}.${from.slice(0, 4)} – ${ddmm(to)}.${to.slice(0, 4)}`;
    return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700&family=Fira+Code:wght@500;600;700&display=swap">
<style>
/* Приборная панель, а не «ещё один тёмный дашборд»: угольный фон вместо синего,
   одна фирменная охра на акценты, цифры моноширинным Fira Code, воздух вместо рамок. */
body{background:#0a0c10}.wrap{max-width:1320px}
.dx{
  --bg:#0a0c10;--panel:#11141b;--panel2:#141821;--line:rgba(226,232,240,.09);--line2:rgba(226,232,240,.16);
  --txt:#eef1f6;--mut:#8e98ab;--dim:#69738a;
  --acc:#e0a33a;--good:#4fc38a;--bad:#f0655f;--info:#5b9ff0;
  color:var(--txt);font-family:"Fira Sans",-apple-system,Segoe UI,Roboto,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.005em}
.dx *{box-sizing:border-box}.dx a{color:inherit}
.dx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.dx :focus-visible{outline:2px solid var(--acc);outline-offset:2px;border-radius:8px}

.dx-top{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;flex-wrap:wrap;margin:4px 0 18px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.dx-title{font-size:15px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;margin:0;color:var(--mut)}
.dx-title::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--acc);margin-right:10px;vertical-align:1px;box-shadow:0 0 0 4px rgba(224,163,58,.15)}
.dx-sub{margin-top:8px;font-family:"Fira Code",monospace;font-size:13px;color:var(--dim);letter-spacing:0}
.dx-subt{color:var(--mut);font-size:13px}
.dx-filters{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.dx-filters label{color:var(--dim);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 5px;font-weight:600}
.dx-filters input,.dx-filters select{background:var(--panel);border:1px solid var(--line2);color:var(--txt);border-radius:10px;padding:9px 11px;width:auto;color-scheme:dark;font-family:"Fira Code",monospace;font-size:13px}
.dx-filters button{background:var(--acc);color:#1a1205;border:0;border-radius:10px;font-weight:700;padding:10px 18px;cursor:pointer;transition:filter .18s ease}
.dx-filters button:hover{filter:brightness(1.08)}

.dx-bar2{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.dx-pills{display:flex;gap:6px;flex-wrap:wrap}
.dx-pill{padding:7px 13px;border-radius:8px;border:1px solid transparent;font-size:12.5px;font-weight:500;color:var(--mut);background:transparent;transition:color .18s ease,background .18s ease}
.dx-pill:hover{color:var(--txt);background:rgba(226,232,240,.05)}
.dx-pill.on{color:var(--acc);background:rgba(224,163,58,.1);border-color:rgba(224,163,58,.3)}
.dx-seg{display:inline-flex;gap:2px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:3px}
.dx-seg a{padding:7px 13px;border-radius:7px;font-size:12.5px;font-weight:500;color:var(--mut);transition:background .18s ease}
.dx-seg a.on{background:var(--panel2);color:var(--txt);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}

.dx-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.dx-grid4>.dx-card{border:0;border-radius:0;background:var(--panel);box-shadow:none}
.dx-g{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;margin-top:16px}
.dx-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px;position:relative;overflow:hidden}
.dx-card h3{margin:0 0 14px;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.dx-card h3 small{color:var(--dim);font-weight:400;font-size:11.5px;letter-spacing:.02em;text-transform:none}

.dx-kpi{display:flex;flex-direction:column;animation:dxUp .5s cubic-bezier(.2,.8,.2,1) both}
.dx-grid4>.dx-kpi:nth-child(2){animation-delay:.05s}.dx-grid4>.dx-kpi:nth-child(3){animation-delay:.1s}.dx-grid4>.dx-kpi:nth-child(4){animation-delay:.15s}
@keyframes dxUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.dx-lab{color:var(--dim);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
.dx-big{font-family:"Fira Code",monospace;font-size:clamp(26px,2.5vw,38px);white-space:nowrap;font-weight:600;letter-spacing:-.04em;margin:10px 0 8px;line-height:1}
.dx-row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;position:relative;z-index:1;min-height:22px}
.dx-d{font-family:"Fira Code",monospace;font-size:12px;font-weight:600}
.dx-d.up,.dx-up{color:var(--good)}.dx-d.down,.dx-down{color:var(--bad)}.dx-d.flat,.dx-flat{color:var(--acc)}
.dx-was{color:var(--dim);font-size:12px;white-space:nowrap;margin-left:6px}
.dx-spark{display:block;width:100%;height:40px;margin-top:auto;padding-top:12px}
.dx-sbase{stroke:rgba(226,232,240,.12)}.dx-smax{fill:var(--dim);font-size:9px;font-family:"Fira Code",monospace}

.dx-minis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-top:16px}
.dx-mini{background:var(--panel);padding:14px 16px}
.dx-mv{font-family:"Fira Code",monospace;font-size:22px;font-weight:600;margin:6px 0 4px;letter-spacing:-.02em}

.dx-chart{position:relative}.dx-chart svg{width:100%;height:auto;display:block}
.dx-grid{stroke:rgba(226,232,240,.07)}.dx-axis{fill:var(--dim);font-size:10.5px;font-family:"Fira Code",monospace}
.dx-line{fill:none;stroke:var(--info);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.dx-dot{fill:var(--panel);stroke:var(--info);stroke-width:1.5}.dx-bar{fill:var(--acc);opacity:.85}
.dx-cross{stroke:var(--mut);stroke-dasharray:2 4;opacity:0}.dx-chart.hover .dx-cross{opacity:.6}
.dx-tip{position:absolute;top:8px;pointer-events:none;background:#05070b;border:1px solid var(--line2);border-radius:10px;padding:9px 11px;font-size:12px;line-height:1.55;font-family:"Fira Code",monospace;box-shadow:0 18px 40px -20px #000;white-space:nowrap}
.dx-leg{display:flex;gap:14px;font-size:11.5px;color:var(--mut);letter-spacing:.02em;text-transform:none;font-weight:400}
.dx-leg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:0}

.dx-donutw{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.dx-donut{width:164px;height:164px;flex:0 0 164px}
.dx-donut-n{fill:var(--txt);font-size:30px;font-weight:600;font-family:"Fira Code",monospace}
.dx-donut-l{fill:var(--dim);font-size:10px;letter-spacing:.1em}
.dx-ring{animation:dxIn .8s cubic-bezier(.2,.8,.2,1) both;transform-origin:80px 80px}
@keyframes dxIn{from{opacity:0;transform:rotate(-120deg)}to{opacity:1;transform:rotate(-90deg)}}
.dx-legend{list-style:none;margin:0;padding:0;flex:1;min-width:220px}
.dx-legend li{display:grid;grid-template-columns:10px 1fr auto 42px;gap:4px 10px;align-items:center;padding:7px 0;font-size:13px}
.dx-legend i{width:8px;height:8px;border-radius:2px}
.dx-legend b{font-family:"Fira Code",monospace;font-weight:600}
.dx-legend em{font-style:normal;color:var(--dim);text-align:right;font-family:"Fira Code",monospace;font-size:12px}
.dx-legend u{grid-column:2/5;height:3px;background:rgba(226,232,240,.08);border-radius:3px;overflow:hidden;text-decoration:none}
.dx-legend s{display:block;height:100%;border-radius:3px}

.dx table{width:100%;border-collapse:collapse}
.dx th{color:var(--dim);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;text-align:left;padding:0 10px 10px;border-bottom:1px solid var(--line)}
.dx td{padding:13px 10px;border-bottom:1px solid rgba(226,232,240,.05);font-size:14px;color:#dde3ee}
.dx tr:last-child td{border-bottom:0}
.dx tbody tr:hover td,.dx table tr:hover td{background:rgba(226,232,240,.03)}
.dx-dot2{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:10px;vertical-align:1px}
.dx-mute{color:var(--dim)}
.dx-hbar{display:inline-block;width:76px;height:4px;background:rgba(226,232,240,.08);border-radius:3px;margin-right:10px;vertical-align:middle;overflow:hidden}
.dx-hbar s{display:block;height:100%;border-radius:3px}

.dx-dirs td{vertical-align:top}
.dx-dirs b{font-family:"Fira Code",monospace;font-size:15px;font-weight:600;display:block;letter-spacing:-.01em}
.dx-cd{display:block;margin-top:4px;font-size:11px}.dx-cd .dx-was{font-size:11px;margin-left:6px}
.dx-sm{display:block;color:var(--dim);font-size:11px;margin-top:3px;font-family:"Fira Code",monospace}
.dx-alarm td{background:rgba(240,101,95,.05)}
.dx-alarm td:first-child{box-shadow:inset 2px 0 0 var(--bad)}
.dx-flag{display:inline-block;margin-left:10px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--bad);border:1px solid rgba(240,101,95,.35);border-radius:5px;padding:2px 7px;vertical-align:1px}
.dx-tot td{border-top:1px solid var(--line2);font-weight:600}

.dx-funnel{width:100%;max-width:360px;display:block;margin:0 auto}
.dx-fn{fill:#fff;font-size:18px;font-weight:600;font-family:"Fira Code",monospace}
.dx-fl{fill:rgba(255,255,255,.8);font-size:10.5px}.dx-fconv{fill:var(--dim);font-size:10px}
.dx-drop{color:var(--mut);font-size:13px;line-height:1.65;margin-top:12px}

.dx-weeks{display:flex;gap:10px;align-items:flex-end;min-height:200px;overflow-x:auto;padding-top:6px}
.dx-wk{flex:1;min-width:44px;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:12px;font-family:"Fira Code",monospace}
.dx-stack{width:100%;max-width:52px;display:flex;flex-direction:column-reverse;gap:2px}
.dx-stack i{display:block;min-height:2px}.dx-stack i:last-child{border-radius:3px 3px 0 0}
.dx-won{color:var(--good);font-weight:600;min-height:16px}
.dx-wleg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--mut);margin-bottom:10px}

.dx-note{background:rgba(224,163,58,.05);border-left:2px solid rgba(224,163,58,.4);border-radius:0 10px 10px 0;padding:12px 16px;font-size:13px;line-height:1.6;color:#ddd3bd;margin-top:16px}
.dx-note p{margin:3px 0}
.dx-backlog{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap;background:rgba(224,163,58,.06);border:1px solid rgba(224,163,58,.22);border-radius:12px;padding:12px 16px;margin:0 0 16px;color:#ddd3bd}.dx-backlog b{color:var(--txt)}.dx-backlog span{color:var(--mut);font-size:12.5px}
.dx-more{margin-top:16px}
.dx-more summary{cursor:pointer;color:var(--mut);font-weight:500;padding:12px 4px;font-size:13px;letter-spacing:.04em;list-style:none}
.dx-more summary::before{content:"+ ";color:var(--acc);font-family:"Fira Code",monospace}
.dx-more[open] summary::before{content:"- "}
.dx-more .dx-card{margin-top:8px}
.dx-legacy{margin-top:18px}
.dx-legacy summary{cursor:pointer;color:var(--mut);font-weight:500;padding:12px 4px;font-size:13px}
.dx-legacy .panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;color:#dde3ee}
.dx-legacy th{color:var(--dim)}.dx-legacy td{color:#dde3ee;border-color:rgba(226,232,240,.05)}.dx-legacy .muted{color:var(--dim)}

.c3{grid-column:span 3}.c4{grid-column:span 4}.c5{grid-column:span 5}.c7{grid-column:span 7}.c8{grid-column:span 8}.c12{grid-column:span 12}
@media(max-width:980px){.dx-grid4,.dx-minis{grid-template-columns:repeat(2,1fr)}.c3,.c4,.c5,.c7,.c8{grid-column:span 12}}
@media(max-width:560px){.dx-grid4{grid-template-columns:1fr}.dx-big{font-size:32px}}
@media(prefers-reduced-motion:reduce){.dx *,.dx *::before{animation:none!important;transition:none!important}}
</style>
<div class="dx">
  <h2 class="dx-sr">Аналитика за ${period}: ${a.total} заявок, ${a.orders} заказов на ${fmt(a.sum)} Ft.</h2>
  <div class="dx-top">
    <div><h1 class="dx-title">Аналитика</h1><div class="dx-sub">${esc(CITY[city] ?? city)} · ${period} · сравнение с ${ddmm(p.from)}–${ddmm(p.to)}</div></div>
    <form method="get" class="dx-filters">
      <input type="hidden" name="key" value="${k}"><input type="hidden" name="view" value="analytics"><input type="hidden" name="mode" value="${a.mode}">
      <div><label>С</label><input type="date" name="from" value="${from}"></div>
      <div><label>По</label><input type="date" name="to" value="${to}"></div>
      <div><label>Город</label><select name="city">${cityOpts}</select></div>
      <button>Показать</button>
    </form>
  </div>
  <div class="dx-bar2"><div class="dx-pills">${pills}</div>${modeSeg}</div>
  ${job ? `<div class="dx-backlog"><div><b>Операционно: ${a.orders + a.needsClosure} прошедших выездов</b><br><span>Финансово закрыто: ${a.orders}. Требуют закрытия: ${a.needsClosure} на ${fmt(a.needsClosureSum)} Ft.</span></div><span>Backlog не включён в выручку и остаток</span></div>` : ""}
  <div class="dx-grid4">
    ${job
        ? hero("Финансово закрыто", a.orders, String(a.orders), delta(a.orders, p.orders), "closed_at + финальная сумма", S.map((b) => b.orders), "#34c77b", "dxS1")
            + hero("Подтверждённая выручка", a.sum, `${fmt(a.sum)} Ft`, delta(a.sum, p.sum), "по дате работы", S.map((b) => b.sum), "#2bb3c0", "dxS2")
            + hero("Выплаты + расходы", a.masterPayout + a.dealExpenses + a.generalExpenses, `${fmt(a.masterPayout + a.dealExpenses + a.generalExpenses)} Ft`, delta(a.masterPayout + a.dealExpenses + a.generalExpenses, p.masterPayout + p.dealExpenses + p.generalExpenses, "down"), "по закрытым сделкам + общие", S.map(() => 0), "#f0a13c", "dxS3")
            + hero("Остаток по известным данным", a.net, `${fmt(a.net)} Ft`, delta(a.net, p.net), "выручка − выплаты − расходы − реклама", S.map(() => 0), "#a78bfa", "dxS4")
        : hero("Заявки", a.total, String(a.total), delta(a.total, p.total), "", S.map((b) => b.leads), "#5b8def", "dxS1")
            + hero("Заказы", a.orders, String(a.orders), delta(a.orders, p.orders), "из заявок периода", S.map((b) => b.orders), "#34c77b", "dxS2")
            + hero("Сумма заказов", a.sum, `${fmt(a.sum)} Ft`, delta(a.sum, p.sum), "", S.map((b) => b.sum), "#2bb3c0", "dxS3")
            + hero("Цена заказа с рекламы", cpo, cpo ? `${fmt(cpo)} Ft` : "-", cpo && pcpo ? delta(cpo, pcpo, "down") : "", fb.orders ? `${fb.orders} заказов с Facebook` : "", S.map((b) => b.ad), "#f0a13c", "dxS4")}
  </div>
  <div class="dx-minis">
    ${job
        ? mini("Выплаты мастерам", `${fmt(a.masterPayout)} Ft`, delta(a.masterPayout, p.masterPayout, "down"))
            + mini("Доп. + общие расходы", `${fmt(a.dealExpenses + a.generalExpenses)} Ft`, delta(a.dealExpenses + a.generalExpenses, p.dealExpenses + p.generalExpenses, "down"))
            + mini("Реклама", `${fmt(a.ad)} Ft`, delta(a.ad, p.ad, "none"))
            + mini("Забронировано впереди", `${a.ahead} · ${fmt(a.aheadSum)} Ft`, `<span class="dx-d flat">не в выручке</span>`)
        : mini("Конверсия в заказ", `${conv}%`, delta(conv, pconv, "up", true))
            + mini("Мусор и нет связи", `${junkP}%`, delta(junkP, pjunkP, "down", true))
            + mini("Реклама Facebook", a.ad ? `${fmt(a.ad)} Ft` : "-", delta(a.ad, p.ad, "none"))
            + mini("Цена заявки с рекламы", cpl ? `${fmt(cpl)} Ft` : "-", cpl && pcpl ? delta(cpl, pcpl, "down") : "")}
  </div>
  <div class="dx-g">
    <div class="dx-card c8"><h3>Заявки и заказы <span class="dx-leg"><span><i style="background:#5b8def"></i>заявки</span><span><i style="background:#34c77b"></i>заказы ${job ? "по дате работы" : ""}</span></span></h3>${trend(a)}</div>
    <div class="dx-card c4"><h3>Откуда заявки</h3><div class="dx-donutw">${donut(a)}<ul class="dx-legend">${legend || '<li class="dx-mute">нет заявок за период</li>'}</ul></div></div>
    <div class="dx-card c8"><h3>Каналы <small>${job ? "заказы по дате работы" : "заказы из заявок периода"}</small></h3><div style="overflow-x:auto"><table><tr><th>Канал</th><th>Заявок</th><th>Заказов</th>${job ? "" : "<th>Конверсия</th>"}<th>Мусор</th><th>Сумма</th><th>Цена заказа</th></tr>${chanRows}</table></div>
      ${notes.length ? `<div class="dx-note">${notes.map((n) => `<p>${n}</p>`).join("")}</div>` : ""}</div>
    <div class="dx-card c4"><h3>Воронка</h3>${funnel(a)}<div class="dx-drop">До диалога не дошли: мусор ${a.junk}, ждём ответа ${a.waiting}, новые ${a.fresh}.<br>После диалога: слив ${a.lost}, ещё решают ${a.dialog - a.won - a.lost}.</div></div>
    ${dirTable(dirs, pdirs, months, `${ddmm(p.from)}–${ddmm(p.to)}`)}
  </div>
  <details class="dx-more"><summary>Каналы по неделям</summary>
    <div class="dx-card"><h3>Каналы по неделям <small>8 недель до ${ddmm(to)}, по дате заявки · ✓ заказы · * неделя идёт</small></h3><div class="dx-wleg">${weekLegend}</div><div class="dx-weeks">${weekCols}</div></div>
  </details>
</div>
<script>(function(){
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll(".dx-big[data-count]").forEach(function(el){
    var end = +el.getAttribute("data-count"), suf = el.getAttribute("data-suffix") || "", txt = el.textContent;
    if (reduce || !end || txt === "-") return;
    var t0 = null; function step(t){ if(!t0) t0 = t; var k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(end * e).toLocaleString("en-US") + suf; if (k < 1) requestAnimationFrame(step); else el.textContent = txt; }
    requestAnimationFrame(step);
  });
  document.querySelectorAll(".dx-chart").forEach(function(box){
    var pts = JSON.parse(box.querySelector(".dx-data").textContent), svg = box.querySelector("svg"), hit = box.querySelector(".dx-hit"), cross = box.querySelector(".dx-cross"), tip = box.querySelector(".dx-tip");
    var week = box.getAttribute("data-unit") === "week";
    function fmtD(d){ return d.slice(8,10) + "." + d.slice(5,7); }
    function show(ev){
      var r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * 760 / r.width, best = pts[0];
      pts.forEach(function(p){ if (Math.abs(p.x - sx) < Math.abs(best.x - sx)) best = p; });
      cross.setAttribute("x1", best.x); cross.setAttribute("x2", best.x); box.classList.add("hover");
      tip.hidden = false;
      tip.innerHTML = "<b>" + (week ? "Неделя с " : "") + fmtD(best.d) + "</b><br>Заявки: " + best.l + "<br>Заказы: " + best.o + (best.s ? "<br>Сумма: " + best.s.toLocaleString("en-US") + " Ft" : "");
      var px = best.x * r.width / 760, left = Math.min(Math.max(px + 12, 0), r.width - tip.offsetWidth - 4);
      tip.style.left = left + "px";
    }
    hit.addEventListener("mousemove", show); hit.addEventListener("touchstart", function(e){ show(e.touches[0]); }, { passive: true });
    hit.addEventListener("mouseleave", function(){ tip.hidden = true; box.classList.remove("hover"); });
  });
})();</script>`;
}
