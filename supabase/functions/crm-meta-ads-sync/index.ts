import { createClient } from "jsr:@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type Cfg = Record<string, string>;
type MetaAction = {
    action_type?: string;
    value?: string;
};
type Insight = {
    campaign_id?: string;
    campaign_name?: string;
    date_start?: string;
    date_stop?: string;
    spend?: string;
    impressions?: string;
    reach?: string;
    clicks?: string;
    actions?: MetaAction[];
};
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
async function getConfig(): Promise<Cfg> {
    const { data, error } = await supabase.from("crm_app_config").select("key,value");
    if (error)
        throw error;
    return Object.fromEntries((data ?? []).map((r: {
        key: string;
        value: string;
    }) => [r.key, r.value]));
}
async function setConfig(values: Record<string, string>) {
    const rows = Object.entries(values).map(([key, value]) => ({ key, value }));
    const { error } = await supabase.from("crm_app_config").upsert(rows);
    if (error)
        throw error;
}
function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}
function syncRange(now = new Date(), lookbackDays = 45): {
    since: string;
    until: string;
} {
    const until = isoDate(now);
    const lookback = new Date(now.getTime() - Math.max(1, Math.min(365, lookbackDays)) * 86400000);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { since: isoDate(lookback < monthStart ? lookback : monthStart), until };
}
function reportedLeads(actions: MetaAction[] | undefined): number {
    if (!actions)
        return 0;
    const grouped = actions.find((a) => a.action_type === "onsite_conversion.lead_grouped");
    if (grouped)
        return Number(grouped.value) || 0;
    const accepted = new Set(["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead"]);
    return actions.reduce((sum, a) => sum + (accepted.has(String(a.action_type)) ? Number(a.value) || 0 : 0), 0);
}
async function metaJson(url: URL): Promise<Record<string, unknown>> {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
        const metaError = body.error as Record<string, unknown> | undefined;
        throw new Error(`Meta ${res.status}: ${String(metaError?.message ?? "request failed")}`);
    }
    return body;
}
async function notifyOwner(cfg: Cfg, text: string) {
    if (!cfg.telegram_bot_token || !cfg.owner_tg_id)
        return;
    await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.owner_tg_id, text }),
    }).catch(() => null);
}
async function run(cfg: Cfg) {
    const token = cfg.meta_ads_access_token;
    const rawAccount = cfg.meta_ad_account_id.replace(/^act_/, "");
    if (!token || !rawAccount)
        throw new Error("не настроены meta_ads_access_token или meta_ad_account_id");
    const version = cfg.fb_graph_version || "v21.0";
    const account = `act_${rawAccount}`;
    const range = syncRange(new Date(), Number(cfg.meta_ads_lookback_days) || 45);
    const accountUrl = new URL(`https://graph.facebook.com/${version}/${account}`);
    accountUrl.searchParams.set("fields", "currency");
    accountUrl.searchParams.set("access_token", token);
    const accountInfo = await metaJson(accountUrl);
    const currency = String(accountInfo.currency || cfg.base_currency || "HUF");
    let next: URL | null = new URL(`https://graph.facebook.com/${version}/${account}/insights`);
    next.searchParams.set("access_token", token);
    next.searchParams.set("level", "campaign");
    next.searchParams.set("time_increment", "1");
    next.searchParams.set("limit", "500");
    next.searchParams.set("fields", "campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,clicks,actions");
    next.searchParams.set("time_range", JSON.stringify(range));
    const insights: Insight[] = [];
    while (next) {
        const page = await metaJson(next);
        insights.push(...((page.data as Insight[] | undefined) ?? []));
        const nextUrl = (page.paging as {
            next?: string;
        } | undefined)?.next;
        next = nextUrl ? new URL(nextUrl) : null;
    }
    const rows = insights
        .filter((x) => x.campaign_name && x.date_start)
        .map((x) => ({
        campaign: String(x.campaign_name),
        meta_campaign_id: String(x.campaign_id ?? ""),
        meta_account_id: rawAccount,
        date_start: x.date_start,
        date_stop: x.date_stop || x.date_start,
        spend: Number(x.spend) || 0,
        currency,
        impressions: Number(x.impressions) || 0,
        reach: Number(x.reach) || 0,
        clicks: Number(x.clicks) || 0,
        leads_reported: reportedLeads(x.actions),
        source_file: "meta_api",
        imported_at: new Date().toISOString(),
    }));
    const { error: deleteError } = await supabase.from("crm_ad_spend")
        .delete().eq("source_file", "meta_api").eq("meta_account_id", rawAccount)
        .gte("date_start", range.since).lte("date_start", range.until);
    if (deleteError)
        throw deleteError;
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("crm_ad_spend").insert(rows.slice(i, i + 500));
        if (error)
            throw error;
    }
    const now = new Date().toISOString();
    await setConfig({ meta_ads_last_sync_at: now, meta_ads_last_sync_error: "" });
    return { ok: true, rows: rows.length, campaigns: new Set(rows.map((r) => r.meta_campaign_id)).size, ...range, currency };
}
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        if (req.method !== "POST" && req.method !== "GET")
            return new Response("method not allowed", { status: 405 });
        let cfg: Cfg = {};
        try {
            cfg = await getConfig();
            if (!cfg.reminder_secret || req.headers.get("x-reminder-secret") !== cfg.reminder_secret) {
                return new Response("forbidden", { status: 403 });
            }
            return new Response(JSON.stringify(await run(cfg)), { headers: jsonHeaders });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("crm-meta-ads-sync", message);
            if (Object.keys(cfg).length) {
                await setConfig({ meta_ads_last_sync_error: message.slice(0, 500) }).catch(() => null);
                await notifyOwner(cfg, `⚠️ Реклама Meta не обновилась\n${message.slice(0, 350)}`);
            }
            return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: jsonHeaders });
        }
    });
export { reportedLeads, syncRange };
