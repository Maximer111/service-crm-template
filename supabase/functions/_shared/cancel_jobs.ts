export async function cancelMasterJobs(sb: any, token: string | undefined, leadId: string, fmt: (iso: string) => string): Promise<number> {
    const { data: lead } = await sb.from("crm_leads").select("id,name,address,scheduled_at,crew,assigned_master_id,master_notified_at").eq("id", leadId).maybeSingle();
    if (!lead)
        return 0;
    const crew = Array.isArray(lead.crew) ? lead.crew as Record<string, unknown>[] : [];
    const ids = new Set(crew.filter((c) => c.sent).map((c) => String(c.m)));
    if (lead.assigned_master_id && lead.master_notified_at)
        ids.add(String(lead.assigned_master_id));
    if (!lead.scheduled_at && !ids.size)
        return 0;
    const when = lead.scheduled_at ? fmt(String(lead.scheduled_at)) : "";
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let told = 0;
    if (ids.size && token) {
        const { data: masters } = await sb.from("crm_masters").select("id,tg_chat_id,language").in("id", [...ids]);
        for (const m of masters ?? []) {
            if (!m.tg_chat_id)
                continue;
            const en = String(m.language ?? "") === "en";
            const text = [en ? "❌ <b>Job cancelled</b>" : "❌ <b>Заказ отменён</b>", "", `👤 ${esc(lead.name)}`,
                ...(when ? [`📅 ${when}`] : []), ...(lead.address ? [`📍 ${esc(lead.address)}`] : []), "",
                en ? "The client cancelled. Do not go." : "Клиент отменил. Не выезжай."].join("\n");
            const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: m.tg_chat_id, text, parse_mode: "HTML" }) }).then((x) => x.json()).catch(() => null);
            if (r?.ok)
                told++;
        }
    }
    await sb.from("crm_leads").update({ scheduled_at: null, crew: [], assigned_master_id: null, master_notified_at: null, updated_at: new Date().toISOString() }).eq("id", leadId);
    await sb.from("crm_timeline").insert({ lead_id: leadId, kind: "note", body: `🗓 Выезд ${when || "без даты"} снят, мастерам сообщено об отмене: ${told} из ${ids.size}` });
    return told;
}
