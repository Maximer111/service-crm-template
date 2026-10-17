import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { websiteContext, websiteMatchingData } from "../_shared/meta_context.ts";
let supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
    if (!supabase) {
        supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    }
    return supabase;
}
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const MAX_BATCH = 25;
type Config = Record<string, string>;
type QueueRow = {
    deal_id: string;
    attempts: number;
};
type Deal = {
    id: string;
    lead_id: string;
    amount: number | string;
    currency: string;
    created_at: string;
    closed_at: string | null;
    job_date: string | null;
};
type DriftRow = {
    id: number;
    deal_id: string;
    kind: string;
    sent_amount: number | string | null;
    new_amount: number | string | null;
    currency: string | null;
};
type Lead = {
    id: string;
    name: string | null;
    phone: string | null;
    attribution?: Record<string, unknown> | null;
    email?: string | null;
    address?: string | null;
    country?: string | null;
    source?: string | null;
    raw_text?: string | null;
};
type StageRow = {
    lead_id: string;
    stage: string;
    event_time: string;
    attempts: number;
};
type MetaEvent = {
    event_name: string;
    event_time: number;
    event_id: string;
    user_data: Record<string, unknown>;
    custom_data?: Record<string, unknown>;
    event_source_url?: string;
};
const LEAD_FIELDS = "id,name,phone,attribution,email,address,country,source,raw_text";
const MAX_EVENT_AGE_SECONDS = 7 * 24 * 3600 - 3600;
async function getConfig(): Promise<Config> {
    const { data, error } = await db().from("crm_app_config").select("key,value");
    if (error)
        throw error;
    return Object.fromEntries((data ?? []).map((row: {
        key: string;
        value: string;
    }) => [row.key, row.value]));
}
function normalizeText(value: string): string {
    return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function normalizePhone(value: string): string {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("00"))
        digits = digits.slice(2);
    else if (digits.startsWith("06"))
        digits = `36${digits.slice(2)}`;
    else if (digits.length === 9 && digits.startsWith("1"))
        digits = `36${digits}`;
    return digits;
}
async function sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
function leadEmail(lead: Lead): string {
    const own = (lead.email || "").trim().toLowerCase();
    if (EMAIL.test(own))
        return own.match(EMAIL)![0];
    if (lead.source !== "website")
        return "";
    return (lead.raw_text || "").match(EMAIL)?.[0].toLowerCase() ?? "";
}
function budapestZip(address: string): string {
    const m = address.match(/\b(1[0-2]\d\d)\b[\s,]*budapest|budapest[\s,]*(1[0-2]\d\d)\b/i);
    return m ? (m[1] || m[2]) : "";
}
async function userData(lead: Lead): Promise<Record<string, unknown>> {
    const country = (lead.country || "hu").trim().toLowerCase();
    const data: Record<string, unknown> = {
        external_id: [await sha256(lead.id)],
        country: [await sha256(country)],
    };
    if (country === "hu") {
        data.ct = [await sha256("budapest")];
        const zip = budapestZip(lead.address || "");
        if (zip)
            data.zp = [await sha256(zip)];
    }
    const email = leadEmail(lead);
    if (email)
        data.em = [await sha256(email)];
    const phone = normalizePhone(lead.phone || "");
    if (phone)
        data.ph = [await sha256(phone)];
    const names = normalizeText(lead.name || "").split(/\s+/).filter(Boolean);
    if (names.length)
        data.fn = [await sha256(names[0])];
    if (names.length > 1)
        data.ln = [await sha256(names[names.length - 1])];
    const metaLeadId = String(lead.attribution?.meta_lead_id ?? "");
    if (/^\d{6,20}$/.test(metaLeadId))
        data.lead_id = metaLeadId;
    Object.assign(data, websiteMatchingData(lead.attribution));
    return data;
}
function eventTime(createdAt: string): number {
    const parsed = Date.parse(createdAt);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}
function purchaseTime(deal: Deal, now = Date.now()): number {
    const seconds = Math.floor(now / 1000);
    const time = eventTime(deal.closed_at || deal.job_date || deal.created_at);
    return Math.min(seconds, Math.max(time, seconds - MAX_EVENT_AGE_SECONDS));
}
function eventBody(event: MetaEvent): string {
    const payload = {
        data: [{
                ...event,
                action_source: "system_generated",
                custom_data: { event_source: "crm", lead_event_source: "CLB CRM", ...event.custom_data },
            }],
    };
    return JSON.stringify(payload).replace(/"lead_id":"(\d+)"/, '"lead_id":$1');
}
async function sendEvent(token: string, event: MetaEvent): Promise<void> {
    const pixelId = Deno.env.get("META_PIXEL_ID") || "";
    const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v23.0";
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${pixelId}/events`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
        },
        body: eventBody(event),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
        const metaError = body.error as Record<string, unknown> | undefined;
        throw new Error(`Meta ${response.status}: ${String(metaError?.message ?? "request failed")}`);
    }
    if (Number(body.events_received) !== 1)
        throw new Error(`Meta accepted ${String(body.events_received)} events`);
}
async function sendPurchase(token: string, deal: Deal, lead: Lead): Promise<void> {
    await sendEvent(token, await purchaseEvent(deal, lead));
}
async function purchaseEvent(deal: Deal, lead: Lead): Promise<MetaEvent> {
    const value = Number(deal.amount);
    if (!Number.isFinite(value) || value < 0)
        throw new Error("invalid deal amount");
    return {
        event_name: "Purchase",
        event_time: purchaseTime(deal),
        event_id: `clb-deal-${deal.id}`,
        user_data: await userData(lead),
        custom_data: {
            currency: String(deal.currency || "HUF").toUpperCase(),
            value,
            order_id: deal.id,
        },
    };
}
async function stageEvent(lead: Lead, stage: string, time: number): Promise<MetaEvent> {
    const meta = websiteContext(lead.attribution);
    const event: MetaEvent = {
        event_name: stage,
        event_time: time,
        event_id: stage === "Lead" && meta?.event_id ? meta.event_id : `clb-lead-${lead.id}-${stage.toLowerCase()}`,
        user_data: await userData(lead),
    };
    if (meta?.event_source_url)
        event.event_source_url = meta.event_source_url;
    return event;
}
async function markFailure(row: QueueRow, error: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    const delayMinutes = Math.min(24 * 60, 2 ** Math.min(attempts, 10));
    const nextAttempt = new Date(Date.now() + delayMinutes * 60000).toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await db().from("crm_meta_conversion_queue").update({
        status: "failed",
        attempts,
        next_attempt_at: nextAttempt,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
    }).eq("deal_id", row.deal_id);
}
async function processRow(token: string, row: QueueRow): Promise<"sent" | "skipped"> {
    const lock = await db().from("crm_meta_conversion_queue")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("deal_id", row.deal_id)
        .in("status", ["pending", "failed"])
        .select("deal_id").maybeSingle();
    if (lock.error)
        throw lock.error;
    if (!lock.data)
        return "skipped";
    try {
        const dealResult = await db().from("crm_deals")
            .select("id,lead_id,amount,currency,created_at,closed_at,job_date")
            .eq("id", row.deal_id).single();
        if (dealResult.error)
            throw dealResult.error;
        const deal = dealResult.data as Deal;
        const leadResult = await db().from("crm_leads")
            .select(LEAD_FIELDS)
            .eq("id", deal.lead_id).single();
        if (leadResult.error)
            throw leadResult.error;
        await sendPurchase(token, deal, leadResult.data as Lead);
        const now = new Date().toISOString();
        const done = await db().from("crm_meta_conversion_queue").update({
            status: "sent",
            attempts: row.attempts + 1,
            sent_at: now,
            last_error: "",
            sent_amount: Number(deal.amount),
            sent_currency: String(deal.currency || "HUF").toUpperCase(),
            updated_at: now,
        }).eq("deal_id", row.deal_id);
        if (done.error)
            throw done.error;
        return "sent";
    }
    catch (error) {
        await markFailure(row, error);
        throw error;
    }
}
async function processStage(token: string, row: StageRow): Promise<"sent" | "skipped"> {
    const key = { lead_id: row.lead_id, stage: row.stage };
    const lock = await db().from("crm_meta_lead_event_queue")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .match(key).in("status", ["pending", "failed"])
        .select("lead_id").maybeSingle();
    if (lock.error)
        throw lock.error;
    if (!lock.data)
        return "skipped";
    const finish = async (fields: Record<string, unknown>) => {
        const done = await db().from("crm_meta_lead_event_queue")
            .update({ ...fields, updated_at: new Date().toISOString() }).match(key);
        if (done.error)
            throw done.error;
    };
    const time = eventTime(row.event_time);
    if (Date.now() / 1000 - time > MAX_EVENT_AGE_SECONDS) {
        await finish({ status: "expired", last_error: "older than 7 days" });
        return "skipped";
    }
    try {
        const leadResult = await db().from("crm_leads").select(LEAD_FIELDS).eq("id", row.lead_id).single();
        if (leadResult.error)
            throw leadResult.error;
        const lead = leadResult.data as Lead;
        await sendEvent(token, await stageEvent(lead, row.stage, time));
        await finish({ status: "sent", attempts: row.attempts + 1, sent_at: new Date().toISOString(), last_error: "" });
        return "sent";
    }
    catch (error) {
        const attempts = row.attempts + 1;
        const delayMinutes = Math.min(24 * 60, 2 ** Math.min(attempts, 10));
        await finish({
            status: "failed",
            attempts,
            next_attempt_at: new Date(Date.now() + delayMinutes * 60000).toISOString(),
            last_error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        });
        throw error;
    }
}
function ft(value: unknown): string {
    const n = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(n))
        return "?";
    return n.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}
async function pingDrift(cfg: Config): Promise<number> {
    const pending = await db().from("crm_meta_conversion_drift")
        .select("id,deal_id,kind,sent_amount,new_amount,currency")
        .is("notified_at", null).order("noted_at", { ascending: true }).limit(20);
    if (pending.error)
        throw pending.error;
    const rows = (pending.data ?? []) as DriftRow[];
    if (!rows.length)
        return 0;
    const chat = cfg.owner_tg_id;
    if (!cfg.telegram_bot_token || !chat)
        return 0;
    const lines = rows.map((r) => {
        const cur = (r.currency || "HUF").toUpperCase();
        const deal = r.deal_id.slice(0, 8);
        return r.kind === "deleted"
            ? `\u{1F5D1} Сделка ${deal} удалена. Meta держит Purchase на ${ft(r.sent_amount)} ${cur}.`
            : `\u270F\ufe0f Сделка ${deal}: в Meta ушло ${ft(r.sent_amount)}, в CRM теперь ${ft(r.new_amount)} ${cur}.`;
    });
    const response = await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            chat_id: chat,
            disable_web_page_preview: true,
            text: [
                "\u26A0\ufe0f Выручка в Meta разошлась с CRM.",
                "",
                ...lines,
                "",
                "Второй раз не отправляю: Meta считает событие по event_id, новый id удвоит выручку. Правь в Ads Manager или оставь как есть.",
            ].join("\n"),
        }),
    });
    if (!response.ok)
        throw new Error(`Telegram ${response.status}`);
    const marked = await db().from("crm_meta_conversion_drift")
        .update({ notified_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
    if (marked.error)
        throw marked.error;
    return rows.length;
}
async function run(cfg: Config, token: string): Promise<{
    ok: true;
    selected: number;
    sent: number;
    skipped: number;
    failed: number;
    drift: number;
}> {
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - 15 * 60000).toISOString();
    const recovered = await db().from("crm_meta_conversion_queue").update({
        status: "failed",
        next_attempt_at: now,
        last_error: "recovered stale processing lock",
        updated_at: now,
    }).eq("status", "processing").lt("updated_at", staleBefore);
    if (recovered.error)
        throw recovered.error;
    const recoveredStages = await db().from("crm_meta_lead_event_queue").update({
        status: "failed",
        next_attempt_at: now,
        last_error: "recovered stale processing lock",
        updated_at: now,
    }).eq("status", "processing").lt("updated_at", staleBefore);
    if (recoveredStages.error)
        throw recoveredStages.error;
    const pending = await db().from("crm_meta_conversion_queue")
        .select("deal_id,attempts")
        .in("status", ["pending", "failed"])
        .lte("next_attempt_at", now)
        .order("created_at", { ascending: true })
        .limit(MAX_BATCH);
    if (pending.error)
        throw pending.error;
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of (pending.data ?? []) as QueueRow[]) {
        try {
            const result = await processRow(token, row);
            if (result === "sent")
                sent += 1;
            else
                skipped += 1;
        }
        catch (error) {
            failed += 1;
            console.error("crm-meta-conversions", row.deal_id, error instanceof Error ? error.message : String(error));
        }
    }
    const stages = await db().from("crm_meta_lead_event_queue")
        .select("lead_id,stage,event_time,attempts")
        .in("status", ["pending", "failed"])
        .lte("next_attempt_at", now)
        .order("event_time", { ascending: true })
        .limit(MAX_BATCH);
    if (stages.error)
        throw stages.error;
    for (const row of (stages.data ?? []) as StageRow[]) {
        try {
            const result = await processStage(token, row);
            if (result === "sent")
                sent += 1;
            else
                skipped += 1;
        }
        catch (error) {
            failed += 1;
            console.error("crm-meta-conversions", row.lead_id, row.stage, error instanceof Error ? error.message : String(error));
        }
    }
    let drift = 0;
    try {
        drift = await pingDrift(cfg);
    }
    catch (error) {
        failed += 1;
        console.error("crm-meta-conversions drift", error instanceof Error ? error.message : String(error));
    }
    return { ok: true, selected: (pending.data?.length ?? 0) + (stages.data?.length ?? 0), sent, skipped, failed, drift };
}
const handler = async (req: Request) => {
    if (req.method !== "POST")
        return new Response("method not allowed", { status: 405 });
    try {
        const cfg = await getConfig();
        if (!cfg.reminder_secret || req.headers.get("x-reminder-secret") !== cfg.reminder_secret) {
            return new Response("forbidden", { status: 403 });
        }
        const token = Deno.env.get("META_CAPI_TOKEN");
        if (!token)
            throw new Error("META_CAPI_TOKEN is not configured");
        return new Response(JSON.stringify(await run(cfg, token)), { headers: jsonHeaders });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("crm-meta-conversions", message);
        return new Response(JSON.stringify({ ok: false, error: "conversion sync failed" }), {
            status: 500,
            headers: jsonHeaders,
        });
    }
};
if (import.meta.main)
    Deno.serve(handler);
export { budapestZip, eventBody, eventTime, ft, handler, leadEmail, normalizePhone, normalizeText, purchaseTime, purchaseEvent, stageEvent, userData };
