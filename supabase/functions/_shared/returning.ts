const DAY = 86400000;
const PAST_JOB_MS = 7 * DAY;
export type ReturnKind = "reopen" | "repeat" | null;
export function returnKind(lead: {
    status?: unknown;
    source?: unknown;
    scheduled_at?: unknown;
    status_changed_at?: unknown;
}, now = new Date()): ReturnKind {
    if (String(lead.source ?? "") === "job_application")
        return null;
    const status = String(lead.status ?? "");
    if (status === "lost")
        return "reopen";
    if (status !== "won")
        return null;
    const jobAt = new Date(String(lead.scheduled_at || lead.status_changed_at || "")).getTime();
    return Number.isFinite(jobAt) && jobAt < now.getTime() - PAST_JOB_MS ? "repeat" : null;
}
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
type Db = any;
type Cfg = {
    telegram_bot_token?: string;
    cards_chat_id?: string;
    dashboard_public_base?: string;
};
export async function handleReturn(db: Db, cfg: Cfg, leadId: string, opts: {
    channel: string;
    body: string;
    extra?: string[];
}): Promise<ReturnKind> {
    const { data: lead, error } = await db.from("crm_leads")
        .select("id,name,phone,status,source,scheduled_at,status_changed_at,tg_message_id").eq("id", leadId).maybeSingle();
    if (error)
        throw error;
    if (!lead)
        return null;
    const kind = returnKind(lead);
    if (!kind)
        return null;
    const now = new Date().toISOString();
    if (kind === "reopen") {
        const { data: moved, error: e } = await db.from("crm_leads")
            .update({ status: "new", status_changed_at: now, reactivated_at: now, updated_at: now })
            .eq("id", leadId).eq("status", "lost").select("id").maybeSingle();
        if (e)
            throw e;
        if (!moved)
            return null;
        await db.from("crm_timeline").insert({
            lead_id: leadId, kind: "status_change", body: `↩︎ Клиент вернулся (${opts.channel}): ❌ Слив → Новый`,
            meta: { from: "lost", to: "new", reason: "client_returned", channel: opts.channel, automated: true },
        });
    }
    else {
        const { data: recent } = await db.from("crm_timeline").select("id").eq("lead_id", leadId)
            .eq("kind", "client_returned").gte("created_at", new Date(Date.now() - PAST_JOB_MS).toISOString()).limit(1);
        if (recent?.length)
            return null;
        await db.from("crm_timeline").insert({
            lead_id: leadId, kind: "client_returned", body: `🔁 Пишет бывший клиент (${opts.channel}), статус «Выиграно» не менялся`,
            meta: { channel: opts.channel, automated: true },
        });
    }
    const token = String(cfg.telegram_bot_token ?? ""), chatId = String(cfg.cards_chat_id ?? "");
    if (!token || !chatId)
        return kind;
    const phone = String(lead.phone ?? "").replace(/\D/g, "");
    const jobAt = lead.scheduled_at ? new Date(String(lead.scheduled_at)).toLocaleDateString("ru-RU", { timeZone: "Europe/Budapest" }) : "";
    const head = [
        kind === "reopen" ? "↩︎ <b>Клиент вернулся</b> (был ❌ Слив)" : `🔁 <b>Пишет бывший клиент</b> (✅ Выиграно${jobAt ? `, заказ ${jobAt}` : ""})`,
        `👤 ${esc(lead.name) || "Без имени"}`,
        phone ? `📞 +${phone}` : "",
        `📨 ${esc(opts.channel)}`,
        opts.body.trim() ? `✉️ ${esc(opts.body.trim().slice(0, 1500))}` : "✉️ [фото или голосовое]",
        ...(opts.extra ?? []).map(esc),
    ].filter(Boolean);
    const text = [...head, "", kind === "reopen" ? "Карточка возвращена в «Новый»." : "Статус не менял. Если это новый заказ, заведи его."].join("\n");
    const rows: Record<string, unknown>[][] = kind === "reopen" ? [
        [{ text: "В работе", callback_data: `s:${leadId}:in_progress` }, { text: "Follow-up", callback_data: `s:${leadId}:follow_up` }],
        [{ text: "✅ Выиграно", callback_data: `s:${leadId}:won` }, { text: "❌ Слив", callback_data: `s:${leadId}:lost` }, { text: "🚫 Мусор", callback_data: `s:${leadId}:junk` }],
    ] : [];
    if (phone)
        rows.unshift([{ text: "💬 Открыть чат в WhatsApp", url: `https://api.whatsapp.com/send?phone=${phone}` }]);
    if (cfg.dashboard_public_base)
        rows.push([{ text: "🔗 Открыть карточку", url: `${cfg.dashboard_public_base}/?lead=${leadId}` }]);
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
                reply_to_message_id: lead.tg_message_id ?? undefined, allow_sending_without_reply: true,
                ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
            }),
        });
        const out = await res.json().catch(() => ({})) as {
            result?: {
                message_id?: number;
                chat?: {
                    id?: number;
                };
            };
        };
        if (kind === "reopen" && out.result?.message_id) {
            await db.from("crm_leads").update({ tg_chat_id: out.result.chat?.id, tg_message_id: out.result.message_id }).eq("id", leadId);
        }
        else if (!out.result)
            console.error("return alert", leadId, JSON.stringify(out).slice(0, 300));
    }
    catch (e) {
        console.error("return alert", leadId, e);
    }
    return kind;
}
