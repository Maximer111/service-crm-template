export const FAREWELL_PER_DAY = 30;
export const FAREWELL_GAP_MINUTES = 15;
export const FAREWELL_FROM_HOUR = 10;
export const FAREWELL_TO_HOUR = 18;
export type FarewellSlot = {
    ok: true;
} | {
    ok: false;
    reason: "outside_hours" | "daily_cap" | "gap";
};
export function farewellSlot(now: Date, sentLast24h: number, lastSentAt: Date | null, tz = "Europe/Budapest"): FarewellSlot {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false })
        .formatToParts(now).find((p) => p.type === "hour")?.value ?? -1);
    if (hour < FAREWELL_FROM_HOUR || hour >= FAREWELL_TO_HOUR)
        return { ok: false, reason: "outside_hours" };
    if (sentLast24h >= FAREWELL_PER_DAY)
        return { ok: false, reason: "daily_cap" };
    if (lastSentAt && now.getTime() - lastSentAt.getTime() < FAREWELL_GAP_MINUTES * 60000)
        return { ok: false, reason: "gap" };
    return { ok: true };
}
export function farewellLead<T extends Record<string, unknown>>(lead: T, chat = ""): T & {
    language: "ru" | "en";
} {
    const cyr = (chat.match(/[а-яёіїєґ]/giu) ?? []).length, lat = (chat.match(/[a-z]/gi) ?? []).length;
    const ruPhone = /^(7\d{10}|375\d{9})$/.test(String(lead.phone ?? "").replace(/\D/g, ""));
    const ru = cyr + lat > 0 ? cyr > lat : lead.language === "ru" || ruPhone || /[а-яёіїєґ]/iu.test(String(lead.name ?? ""));
    return { ...lead, language: ru ? "ru" : "en" };
}
export type PersonLead = {
    id: string;
    phone?: unknown;
    status?: unknown;
    source?: unknown;
    attribution?: unknown;
    review_requested_at?: unknown;
    feedback_asked_at?: unknown;
    wa_phones?: string[];
};
const tail9 = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };
export function personKeys(l: PersonLead): Set<string> {
    const a = (l.attribution && typeof l.attribution === "object" ? l.attribution : {}) as Record<string, unknown>;
    return new Set([l.phone, a.form_phone, ...(l.wa_phones ?? [])].map(tail9).filter(Boolean));
}
export function samePersonLeads(me: PersonLead, all: PersonLead[]): PersonLead[] {
    const keys = personKeys(me);
    if (!keys.size)
        return [];
    return all.filter((o) => o.id !== me.id && o.source !== "job_application" && [...personKeys(o)].some((k) => keys.has(k)));
}
const ACTIVE_STATUSES = new Set(["won", "in_progress", "contacted", "new"]);
export const DUPLICATE_ACTIVE_DAYS = 14;
export function activeDuplicate(others: PersonLead[], talkedRecently: Set<string>, now = new Date()): {
    id: string;
    why: string;
} | null {
    const since = now.getTime() - DUPLICATE_ACTIVE_DAYS * 86400000;
    const recent = (v: unknown) => { const t = new Date(String(v ?? "")).getTime(); return Number.isFinite(t) && t >= since; };
    for (const o of others) {
        if (ACTIVE_STATUSES.has(String(o.status ?? "")))
            return { id: o.id, why: `status ${o.status}` };
        if (talkedRecently.has(o.id))
            return { id: o.id, why: "переписка за 14 дней" };
        if (recent(o.review_requested_at) || recent(o.feedback_asked_at))
            return { id: o.id, why: "просили отзыв за 14 дней" };
    }
    return null;
}
