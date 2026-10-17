import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleReturn } from "../_shared/returning.ts";
import { validMetaSignature } from "../_shared/meta_signature.ts";
import { pageTokenFor } from "../_shared/meta_page_token.ts";
import { type InboxEvent, parseEvent, participantName } from "./event.ts";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type Cfg = Record<string, string>;
type AnyMap = Record<string, any>;
async function getConfig(): Promise<Cfg> {
    const { data, error } = await supabase.from("crm_app_config").select("key,value");
    if (error)
        throw error;
    return Object.fromEntries((data ?? []).map((r: {
        key: string;
        value: string;
    }) => [r.key, r.value]));
}
async function tg(token: string, method: string, payload: unknown): Promise<void> {
    if (!token)
        return;
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).catch(() => { });
}
async function fetchProfile(version: string, psid: string, token: string, channel: string): Promise<{
    name: string;
    username: string;
}> {
    const none = { name: "", username: "" };
    if (!token)
        return none;
    const get = async (url: string): Promise<AnyMap | null> => {
        const res = await fetch(url).catch(() => null);
        return res && res.ok ? await res.json().catch(() => null) as AnyMap | null : null;
    };
    const fields = channel === "instagram" ? "name,username" : "name";
    const j = await get(`https://graph.facebook.com/${version}/${encodeURIComponent(psid)}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
    if (j?.name || j?.username)
        return { name: String(j.name ?? ""), username: String(j.username ?? "") };
    const platform = channel === "instagram" ? "instagram" : "messenger";
    const conv = await get(`https://graph.facebook.com/${version}/me/conversations?platform=${platform}&user_id=${encodeURIComponent(psid)}&fields=participants&access_token=${encodeURIComponent(token)}`);
    return conv ? participantName(conv, psid) : none;
}
async function storeMessage(e: InboxEvent, leadId: string | null): Promise<boolean> {
    const { data, error } = await supabase.from("crm_messages").upsert({
        channel: e.channel, account_id: e.accountId, contact_id: e.contactId, external_id: e.mid,
        lead_id: leadId, direction: e.direction, body: e.text.slice(0, 12000), sent_at: e.sentAt, referral: e.referral,
    }, { onConflict: "channel,account_id,external_id", ignoreDuplicates: true }).select("id");
    if (error)
        throw error;
    return Boolean(data?.length);
}
async function adoptOrphans(e: InboxEvent, leadId: string): Promise<void> {
    await supabase.from("crm_messages").update({ lead_id: leadId })
        .eq("channel", e.channel).eq("account_id", e.accountId).eq("contact_id", e.contactId).is("lead_id", null);
}
async function findLeadByIgId(igId: string): Promise<AnyMap | null> {
    const { data } = await supabase.from("crm_leads")
        .select("id,name,status,tg_message_id")
        .contains("attribution", { ig_id: igId })
        .order("created_at", { ascending: false }).limit(1);
    return data?.[0] ?? null;
}
async function createLead(cfg: Cfg, e: InboxEvent, profile: {
    name: string;
    username: string;
}): Promise<string> {
    const { channel, contactId: igId, text, sentAt } = e;
    const handle = profile.username ? `@${profile.username}` : "";
    const label = channel === "instagram" ? "Instagram" : "Messenger";
    const base = Deno.env.get("SUPABASE_URL")!;
    const res = await fetch(`${base}/functions/v1/crm-lead-intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-intake-secret": cfg.intake_secret ?? "" },
        body: JSON.stringify({
            name: profile.name || handle || `${label} клиент`,
            phone: "",
            campaign: "",
            received_at: sentAt,
            raw_text: text,
            source: channel,
            attribution: {
                utm_source: label, utm_medium: "direct", ig_id: igId, ig_username: profile.username,
                meta_account_id: e.accountId,
                ...(e.referral?.ad_id ? { ad_id: String(e.referral.ad_id) } : {}),
                ...(e.referral ? { meta_referral: e.referral } : {}),
            },
        }),
    }).catch(() => null);
    if (!res || !res.ok) {
        console.error("intake failed", res?.status, await res?.text().catch(() => ""));
        return "";
    }
    const j = await res.json().catch(() => ({})) as AnyMap;
    return String(j.id ?? "");
}
async function appendMessage(cfg: Cfg, lead: AnyMap, channel: string, text: string, mid: string, sentAt: string, quiet = false): Promise<void> {
    await supabase.from("crm_timeline").insert({
        lead_id: lead.id,
        kind: "instagram_in",
        body: text.slice(0, 4000),
        meta: { mid, channel },
    });
    await supabase.from("crm_leads")
        .update({ last_contact_at: sentAt, updated_at: new Date().toISOString() })
        .eq("id", lead.id);
    const label = channel === "instagram" ? "Instagram" : "Messenger";
    if (quiet)
        return;
    await tg(cfg.telegram_bot_token ?? "", "sendMessage", {
        chat_id: cfg.cards_chat_id,
        reply_to_message_id: lead.tg_message_id ?? undefined,
        allow_sending_without_reply: true,
        text: `💬 ${label}, новое сообщение от ${lead.name || "клиента"}:\n${text.slice(0, 900)}`,
        disable_web_page_preview: true,
    });
}
const seenUnknown = new Set<string>();
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        const url = new URL(req.url);
        const cfg = await getConfig();
        const version = cfg.fb_graph_version || "v21.0";
        if (req.method === "GET") {
            const mode = url.searchParams.get("hub.mode");
            const tok = url.searchParams.get("hub.verify_token");
            const challenge = url.searchParams.get("hub.challenge") ?? "";
            if (mode === "subscribe" && cfg.ig_verify_token && tok === cfg.ig_verify_token) {
                return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
            }
            return new Response("forbidden", { status: 403 });
        }
        if (req.method !== "POST")
            return new Response("ok");
        const rawBody = await req.text();
        const sig = req.headers.get("x-hub-signature-256");
        const secrets = [cfg.meta_app_secret, cfg.ig_app_secret, cfg.fb_app_secret].filter(Boolean) as string[];
        let signed = false;
        for (const s of secrets)
            if (!signed)
                signed = await validMetaSignature(s, rawBody, sig);
        if (!signed) {
            return new Response("bad signature", { status: 403 });
        }
        let payload: AnyMap;
        try {
            payload = JSON.parse(rawBody);
        }
        catch {
            return new Response("ok");
        }
        const channel = payload.object === "instagram" ? "instagram" : "messenger";
        if (!["instagram", "page"].includes(String(payload.object)))
            return new Response("ok");
        const allow = new Set((cfg.ig_account_ids ?? "").split(",").map((s) => s.trim()).filter(Boolean));
        let handled = 0;
        for (const entry of payload.entry ?? []) {
            const entryId = String(entry.id ?? "");
            if (!allow.has(entryId)) {
                if (!seenUnknown.has(entryId)) {
                    seenUnknown.add(entryId);
                    console.warn(`ig_account_ids: ${entryId} (${channel}) не в списке, событие отброшено`);
                }
                continue;
            }
            for (const ev of (entry.messaging ?? []) as AnyMap[]) {
                try {
                    const e = parseEvent(String(payload.object), entryId, ev);
                    if (!e)
                        continue;
                    const lead = await findLeadByIgId(e.contactId);
                    if (!(await storeMessage(e, lead ? String(lead.id) : null)))
                        continue;
                    if (e.direction === "outgoing") {
                        handled++;
                        continue;
                    }
                    const { text, mid, sentAt } = e;
                    if (lead) {
                        const returned = await handleReturn(supabase, cfg, String(lead.id), { channel: channel === "instagram" ? "Instagram" : "Messenger", body: text })
                            .catch((err) => { console.error("handleReturn", lead.id, err); return null; });
                        await appendMessage(cfg, lead, channel, text, mid, sentAt, Boolean(returned));
                    }
                    else {
                        const profile = await fetchProfile(version, e.contactId, await pageTokenFor(cfg, e.accountId, cfg.ig_page_token || ""), e.channel);
                        const newId = await createLead(cfg, e, profile);
                        if (newId) {
                            await adoptOrphans(e, newId);
                            await supabase.from("crm_timeline").insert({
                                lead_id: newId, kind: "instagram_in", body: text.slice(0, 4000), meta: { mid, channel, first: true },
                            });
                        }
                    }
                    handled++;
                }
                catch (e) {
                    console.error("ig event failed", e);
                }
            }
        }
        return new Response(JSON.stringify({ ok: true, handled }), { headers: { "content-type": "application/json" } });
    });
