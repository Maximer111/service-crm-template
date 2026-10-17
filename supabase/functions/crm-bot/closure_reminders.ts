export type ClosureMaster = {
    id: string;
    name?: string | null;
    tg_chat_id?: string | number | null;
    active?: boolean | null;
    can_report_payouts?: boolean | null;
};
export type ClosureLead = {
    id: string;
    name?: string | null;
    status?: string | null;
    source?: string | null;
    scheduled_at?: string | null;
    assigned_master_id?: string | null;
    crew?: unknown;
};
export type ClosureDeal = {
    id: string;
    lead_id: string;
    job_date?: string | null;
    amount?: unknown;
    closed_at?: string | null;
};
export type ClosureGap = {
    key: string;
    leadId: string;
    name: string;
    day: string;
    reason: "no_deal" | "unclosed" | "no_amount" | "unclosed_no_amount";
};
export type ConfirmedVisitAction = {
    action: "blocked" | "create" | "reuse" | "resolved";
    deal?: ClosureDeal;
};
const nameKey = (v: unknown) => String(v ?? "").normalize("NFKD").toLowerCase().replace(/[^a-zа-яё]+/g, " ").trim();
export function selectMariaRecipient(rows: ClosureMaster[]): ClosureMaster | null {
    const matches = rows.filter((m) => m.active !== false && m.can_report_payouts === true && m.tg_chat_id && /^(maria|мария)(\s|$)/.test(nameKey(m.name)));
    return matches.length === 1 ? matches[0] : null;
}
const localDay = (tz: string, value: string | Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
}).format(typeof value === "string" ? new Date(value) : value);
function belongsTo(lead: ClosureLead, masterId: string): boolean {
    if (String(lead.assigned_master_id ?? "") === masterId)
        return true;
    const crew = Array.isArray(lead.crew) ? lead.crew as Array<Record<string, unknown>> : [];
    return crew.some((slot) => String(slot.m ?? "") === masterId);
}
export function closureGaps(leads: ClosureLead[], deals: ClosureDeal[], masterId: string, tz: string, now: Date, notBeforeDay = ""): ClosureGap[] {
    const nowMs = now.getTime(), today = localDay(tz, now);
    const owned = leads.filter((l) => l.source !== "job_application" && belongsTo(l, masterId));
    const byId = new Map(owned.map((l) => [l.id, l]));
    const result = new Map<string, ClosureGap>();
    for (const d of deals) {
        const lead = byId.get(d.lead_id), day = String(d.job_date ?? "").slice(0, 10);
        if (!lead || !day || day > today || (notBeforeDay && day < notBeforeDay))
            continue;
        const unclosed = !d.closed_at, noAmount = !(Number(d.amount) > 0);
        if (!unclosed && !noAmount)
            continue;
        const reason = unclosed && noAmount ? "unclosed_no_amount" : unclosed ? "unclosed" : "no_amount";
        result.set(`deal:${d.id}`, { key: `deal:${d.id}`, leadId: lead.id, name: String(lead.name ?? "заказ"), day, reason });
    }
    for (const lead of owned) {
        if (lead.status !== "won" || !lead.scheduled_at)
            continue;
        const scheduledMs = new Date(lead.scheduled_at).getTime();
        if (!Number.isFinite(scheduledMs) || scheduledMs >= nowMs)
            continue;
        const day = localDay(tz, lead.scheduled_at);
        if (notBeforeDay && day < notBeforeDay)
            continue;
        const visitDeal = deals.some((d) => d.lead_id === lead.id && String(d.job_date ?? "").slice(0, 10) === day);
        if (!visitDeal)
            result.set(`lead:${lead.id}:${day}`, { key: `lead:${lead.id}:${day}`, leadId: lead.id, name: String(lead.name ?? "заказ"), day, reason: "no_deal" });
    }
    return [...result.values()].sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
}
export const closureGapFingerprint = (gaps: ClosureGap[]) => gaps.map((g) => g.key).sort().join("|");
export function confirmedVisitAction(lead: ClosureLead | null | undefined, deals: ClosureDeal[], masterId: string, tz: string, now: Date, expectedDay: string): ConfirmedVisitAction {
    if (!lead || lead.status !== "won" || lead.source === "job_application" || !belongsTo(lead, masterId) || !lead.scheduled_at)
        return { action: "blocked" };
    const scheduled = new Date(lead.scheduled_at);
    if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() >= now.getTime() || localDay(tz, scheduled) !== expectedDay)
        return { action: "blocked" };
    const sameVisit = deals.find((d) => d.lead_id === lead.id && String(d.job_date ?? "").slice(0, 10) === expectedDay);
    if (!sameVisit)
        return { action: "create" };
    return sameVisit.closed_at && Number(sameVisit.amount) > 0 ? { action: "resolved", deal: sameVisit } : { action: "reuse", deal: sameVisit };
}
