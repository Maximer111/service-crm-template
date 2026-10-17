type LeadLike = Record<string, unknown>;
const normalized = (value: unknown) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const activeStatuses = new Set(["new", "contacted", "in_progress", "follow_up", "won"]);
function dateKey(value: unknown): string {
    const date = new Date(String(value ?? ""));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
function mentionedDateKeys(body: unknown, sentAt: Date): Set<string> {
    const text = normalized(body);
    const keys = new Set<string>();
    const explicit = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/g) ?? [];
    for (const value of explicit)
        keys.add(value);
    const months: Record<string, number> = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    for (const match of text.matchAll(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/gu)) {
        const candidate = new Date(Date.UTC(sentAt.getUTCFullYear(), months[match[2]], Number(match[1])));
        keys.add(candidate.toISOString().slice(0, 10));
    }
    const weekdays: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    for (const [name, weekday] of Object.entries(weekdays)) {
        if (!new RegExp(`\\b${name}\\b`, "u").test(text))
            continue;
        const candidate = new Date(sentAt);
        const delta = (weekday - candidate.getUTCDay() + 7) % 7;
        candidate.setUTCDate(candidate.getUTCDate() + delta);
        keys.add(candidate.toISOString().slice(0, 10));
    }
    return keys;
}
export function selectLeadForMessage(leads: LeadLike[], sentAt: Date, body: unknown): LeadLike | null {
    if (!leads.length)
        return null;
    if (leads.length === 1)
        return leads[0];
    const target = Number.isNaN(sentAt.getTime()) ? Date.now() : sentAt.getTime();
    const mentioned = mentionedDateKeys(body, sentAt);
    return [...leads].sort((a, b) => {
        const aDate = dateKey(a.scheduled_at);
        const bDate = dateKey(b.scheduled_at);
        const aMentioned = Boolean(aDate && mentioned.has(aDate));
        const bMentioned = Boolean(bDate && mentioned.has(bDate));
        if (aMentioned !== bMentioned)
            return aMentioned ? -1 : 1;
        {
            const aActive = activeStatuses.has(String(a.status ?? ""));
            const bActive = activeStatuses.has(String(b.status ?? ""));
            if (aActive !== bActive)
                return aActive ? -1 : 1;
            const aScheduled = aDate ? new Date(String(a.scheduled_at)).getTime() : 0;
            const bScheduled = bDate ? new Date(String(b.scheduled_at)).getTime() : 0;
            const aUpcoming = aScheduled >= target - 12 * 60 * 60 * 1000;
            const bUpcoming = bScheduled >= target - 12 * 60 * 60 * 1000;
            if (aUpcoming !== bUpcoming)
                return aUpcoming ? -1 : 1;
            if (aUpcoming && bUpcoming && aScheduled !== bScheduled)
                return aScheduled - bScheduled;
        }
        const at = new Date(String(a.received_at ?? a.created_at ?? 0)).getTime();
        const bt = new Date(String(b.received_at ?? b.created_at ?? 0)).getTime();
        const aPast = at <= target, bPast = bt <= target;
        if (aPast !== bPast)
            return aPast ? -1 : 1;
        return aPast ? bt - at : at - bt;
    })[0] ?? null;
}
export function prefillFormPhone(body: unknown): string {
    const text = String(body ?? "");
    if (/^\s*\*CLB CLEANING, [A-Z]{2}\*/u.test(text)) {
        const w = /^[^\p{L}\d+\n]*(\+?\d[\d ()-]{7,})\s*$/mu.exec(text);
        const number = (w?.[1] ?? "").replace(/\D/g, "");
        return number.length >= 9 ? number : "";
    }
    if (!/(?:full name|phone number|телефон|telefonszám)\s*:/iu.test(text))
        return "";
    const m = /(?:phone number|номер телефона|телефон|telefonszám)\s*:\s*([+\d][\d ()-]{6,})/iu.exec(text);
    const number = (m?.[1] ?? "").replace(/\D/g, "");
    return number.length >= 9 ? number : "";
}
