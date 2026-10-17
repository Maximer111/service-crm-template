import { createClient } from "jsr:@supabase/supabase-js@2";
import { validMetaSignature } from "../_shared/meta_signature.ts";
import { pageTokenFor } from "../_shared/meta_page_token.ts";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
interface LeadField {
    name: string;
    values: string[];
}
const NAME_KEYS = ["full_name", "full name", "name", "имя", "ваше_имя", "ф.и.о", "фио"];
const PHONE_KEYS = ["phone_number", "phone", "телефон", "номер"];
function pickField(fields: LeadField[], keys: string[]): string {
    for (const f of fields) {
        const n = (f.name || "").toLowerCase();
        if (keys.some((k) => n.includes(k)))
            return (f.values || []).join(", ").trim();
    }
    return "";
}
function buildRawText(lead: Record<string, unknown>, fields: LeadField[]): string {
    const lines: string[] = [];
    const name = pickField(fields, NAME_KEYS);
    const phone = pickField(fields, PHONE_KEYS);
    if (name)
        lines.push(`Имя: ${name}`);
    if (phone)
        lines.push(`Телефон: ${phone}`);
    for (const f of fields) {
        const n = (f.name || "").toLowerCase();
        if (NAME_KEYS.some((k) => n.includes(k)) || PHONE_KEYS.some((k) => n.includes(k)))
            continue;
        const v = (f.values || []).join(", ").trim();
        if (v)
            lines.push(`${f.name}: ${v}`);
    }
    if (lead.campaign_name)
        lines.push(`Кампания: ${lead.campaign_name}`);
    return lines.join("\n");
}
async function fetchLead(version: string, leadgenId: string, token: string): Promise<Record<string, unknown> | null> {
    const fields = "field_data,campaign_name,ad_name,adset_name,form_id,created_time";
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const j = await res.json().catch(() => null);
    if (!res.ok) {
        console.error("graph fetch", leadgenId, JSON.stringify(j));
        return null;
    }
    return j;
}
async function forwardToIntake(payload: Record<string, unknown>, intakeSecret: string): Promise<boolean> {
    const base = Deno.env.get("SUPABASE_URL")!;
    const res = await fetch(`${base}/functions/v1/crm-lead-intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-intake-secret": intakeSecret },
        body: JSON.stringify(payload),
    });
    if (!res.ok)
        console.error("intake forward", res.status, await res.text().catch(() => ""));
    return res.ok;
}
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        const url = new URL(req.url);
        const cfg = await getConfig();
        if (req.method === "GET") {
            const mode = url.searchParams.get("hub.mode");
            const tok = url.searchParams.get("hub.verify_token");
            const challenge = url.searchParams.get("hub.challenge") ?? "";
            if (mode === "subscribe" && cfg.fb_verify_token && cfg.fb_verify_token !== "CHANGE_ME" && tok === cfg.fb_verify_token) {
                return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
            }
            return new Response("forbidden", { status: 403 });
        }
        if (req.method !== "POST")
            return new Response("ok");
        const rawBody = await req.text();
        const sig = req.headers.get("x-hub-signature-256");
        let signed = false;
        for (const s of [cfg.meta_app_secret, cfg.fb_app_secret])
            if (s && !signed)
                signed = await validMetaSignature(s, rawBody, sig);
        if (!signed) {
            return new Response("bad signature", { status: 403 });
        }
        let payload: Record<string, any>;
        try {
            payload = JSON.parse(rawBody);
        }
        catch {
            return new Response("ok");
        }
        if (payload.object !== "page")
            return new Response("ok");
        if ((payload.entry ?? []).some((e: Record<string, unknown>) => Array.isArray(e.messaging))) {
            const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/crm-ig-webhook`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-hub-signature-256": req.headers.get("x-hub-signature-256") ?? "" },
                body: rawBody,
            }).catch(() => null);
            return new Response("ok", { status: res?.ok ? 200 : 500 });
        }
        const version = cfg.fb_graph_version || "v21.0";
        const intakeSecret = cfg.intake_secret || "";
        let okAll = true, seen = 0;
        for (const entry of payload.entry ?? []) {
            for (const change of entry.changes ?? []) {
                if (change.field !== "leadgen")
                    continue;
                seen++;
                const v = change.value ?? {};
                const leadgenId = String(v.leadgen_id ?? v.leadgenId ?? "");
                if (!leadgenId) {
                    okAll = false;
                    continue;
                }
                const token = await pageTokenFor(cfg, String(entry.id ?? v.page_id ?? ""), cfg.fb_page_token || "");
                if (!token) {
                    console.error("no page token: meta_system_token / fb_page_token");
                    okAll = false;
                    continue;
                }
                const lead = await fetchLead(version, leadgenId, token);
                if (!lead) {
                    okAll = false;
                    continue;
                }
                const fields = (lead.field_data as LeadField[]) ?? [];
                const intakePayload = {
                    name: pickField(fields, NAME_KEYS),
                    phone: pickField(fields, PHONE_KEYS),
                    campaign: String(lead.campaign_name ?? v.campaign_name ?? ""),
                    received_at: lead.created_time ?? v.created_time ?? null,
                    raw_text: buildRawText(lead, fields),
                    source: "facebook",
                    meta_lead_id: leadgenId,
                };
                const ok = await forwardToIntake(intakePayload, intakeSecret);
                if (!ok)
                    okAll = false;
            }
        }
        return new Response(JSON.stringify({ ok: okAll, processed: seen }), {
            status: okAll ? 200 : 500,
            headers: { "content-type": "application/json" },
        });
    });
