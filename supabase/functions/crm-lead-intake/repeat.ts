import { mergeWebsiteAttribution } from "../_shared/meta_context.ts";
export type Inquiry = {
    campaign: string;
    at: string;
    source?: string;
    meta_lead_id?: string;
    attribution?: unknown;
};
export type Card = {
    campaign?: unknown;
    source?: unknown;
    attribution?: unknown;
    received_at?: unknown;
    created_at?: unknown;
};
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
const entry = (e: Record<string, unknown>): Inquiry => {
    const out: Inquiry = { campaign: String(e.campaign ?? ""), at: String(e.at ?? "") };
    const src = String(e.source ?? "");
    if (src)
        out.source = src;
    const mid = String(e.meta_lead_id ?? "");
    if (mid)
        out.meta_lead_id = mid;
    return out;
};
export function inquiryHistory(card: Card): Inquiry[] {
    const raw = obj(card.attribution).campaigns;
    if (Array.isArray(raw)) {
        const list = raw.filter((e) => e && typeof e === "object").map((e) => entry(e as Record<string, unknown>));
        if (list.length)
            return list;
    }
    const first = entry({
        campaign: card.campaign,
        at: [String(card.received_at ?? ""), String(card.created_at ?? "")].filter(Boolean).sort()[0] ?? "",
        source: card.source,
        meta_lead_id: obj(card.attribution).meta_lead_id,
    });
    return first.campaign || first.at ? [first] : [];
}
export function mergeRepeat(card: Card, inq: Inquiry): {
    campaign?: string;
    attribution: Record<string, unknown>;
} {
    const attribution = inq.source === "website"
        ? mergeWebsiteAttribution(card.attribution, inq.attribution) : obj(card.attribution);
    const at = inq.at || new Date().toISOString();
    attribution.campaigns = [...inquiryHistory(card), entry({ ...inq, at })].slice(-20);
    if (inq.meta_lead_id)
        attribution.meta_lead_id = inq.meta_lead_id;
    const out: {
        campaign?: string;
        attribution: Record<string, unknown>;
    } = { attribution };
    if (inq.campaign && inq.campaign !== String(card.campaign ?? ""))
        out.campaign = inq.campaign;
    return out;
}
