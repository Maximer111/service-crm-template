export type MetaContext = {
    consent: "granted" | "denied";
    captured_at: string;
    fbp?: string;
    fbc?: string;
    event_id?: string;
    event_source_url?: string;
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? { ...v as Record<string, unknown> } : {};
const has = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const valid = (v: unknown, max: number, pattern: RegExp): v is string => typeof v === "string" && v.length <= max && pattern.test(v);
export function normalizeMetaContext(value: unknown, now = new Date().toISOString()): MetaContext {
    const m = object(value);
    const consent = m.consent === "granted" ? "granted" : "denied";
    const parsed = typeof m.captured_at === "string" && m.captured_at.length <= 35
        ? Date.parse(m.captured_at) : NaN;
    const captured_at = Number.isFinite(parsed) && parsed <= Date.parse(now) + 300000
        ? new Date(parsed).toISOString() : now;
    const out: MetaContext = { consent, captured_at };
    if (consent !== "granted")
        return out;
    if (valid(m.fbp, 128, /^fb\.\d+\.\d{13}\.\d+$/))
        out.fbp = m.fbp;
    if (valid(m.fbc, 600, /^fb\.\d+\.\d{13}\.[A-Za-z0-9_-]+$/))
        out.fbc = m.fbc;
    if (valid(m.event_id, 120, /^[A-Za-z0-9_-]+$/))
        out.event_id = m.event_id;
    if (typeof m.event_source_url === "string" && m.event_source_url.length <= 2048) {
        try {
            const url = new URL(m.event_source_url);
            if (url.protocol === "https:" && url.hostname === "www.example.com"
                && !url.username && !url.password && (!url.port || url.port === "443")) {
                url.hash = "";
                out.event_source_url = url.toString();
            }
        }
        catch { }
    }
    return out;
}
const FLAT_KEYS: [
    keyof MetaContext,
    string,
    string
][] = [
    ["consent", "metaConsent", "meta_consent"],
    ["fbp", "metaFbp", "meta_fbp"],
    ["fbc", "metaFbc", "meta_fbc"],
    ["event_id", "metaEventId", "meta_event_id"],
    ["event_source_url", "metaEventSourceUrl", "meta_event_source_url"],
];
export function flatMetaContext(body: unknown): Record<string, unknown> | undefined {
    const b = object(body);
    const out: Record<string, unknown> = {};
    for (const [field, camel, snake] of FLAT_KEYS) {
        const value = has(b, camel) ? b[camel] : b[snake];
        if (typeof value === "string" && value.trim())
            out[field] = value.trim();
    }
    return Object.keys(out).length ? out : undefined;
}
export function websiteAttribution(value: unknown, body?: unknown): Record<string, unknown> {
    const attr = object(value);
    const meta = has(attr, "meta") && attr.meta !== undefined ? attr.meta : flatMetaContext(body);
    if (meta !== undefined)
        attr.meta = normalizeMetaContext(meta);
    return attr;
}
function mergeMetaContext(existing: unknown, incoming: MetaContext): MetaContext {
    if (incoming.consent !== "granted")
        return incoming;
    const prev = normalizeMetaContext(existing, incoming.captured_at);
    const out = { ...incoming };
    if (!out.fbp && prev.fbp)
        out.fbp = prev.fbp;
    if (!out.fbc && prev.fbc)
        out.fbc = prev.fbc;
    return out;
}
export function mergeWebsiteAttribution(existing: unknown, incoming: unknown): Record<string, unknown> {
    const out = object(existing);
    const attr = websiteAttribution(incoming);
    if (has(attr, "meta"))
        out.meta = mergeMetaContext(out.meta, attr.meta as MetaContext);
    if (attr.last_touch && typeof attr.last_touch === "object" && !Array.isArray(attr.last_touch)) {
        out.last_touch = { ...attr.last_touch as Record<string, unknown> };
    }
    return out;
}
export function websiteContext(attribution: unknown): MetaContext | null {
    const attr = object(attribution);
    return has(attr, "meta") ? normalizeMetaContext(attr.meta) : null;
}
export function websiteMatchingData(attribution: unknown): Record<string, string> {
    const meta = websiteContext(attribution);
    if (!meta || meta.consent !== "granted")
        return {};
    const data: Record<string, string> = {};
    if (meta.fbp)
        data.fbp = meta.fbp;
    if (meta.fbc)
        data.fbc = meta.fbc;
    return data;
}
export function websiteVisitChanged(existing: unknown, incoming: unknown): boolean {
    const old = object(existing);
    const merged = mergeWebsiteAttribution(old, incoming);
    const comparable = (attr: Record<string, unknown>) => {
        const meta = object(attr.meta);
        delete meta.captured_at;
        const fields = (v: Record<string, unknown>) => Object.entries(v).sort(([a], [b]) => a.localeCompare(b));
        return JSON.stringify([fields(meta), fields(object(attr.last_touch))]);
    };
    return comparable(old) !== comparable(merged);
}
