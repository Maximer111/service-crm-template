type AnyMap = Record<string, any>;
type Cfg = Record<string, string>;
export function styleGuideProblems(text: unknown): string[] {
    const value = String(text ?? "").trim();
    const problems: string[] = [];
    if (value.length < 40)
        problems.push("too short to be a voice card");
    if (value.length > 2000)
        problems.push("longer than the prompt budget");
    if (/\d/u.test(value))
        problems.push("contains a number, which means it carries a fact");
    if (/[$€£]|\bft\b|\bhuf\b|\beur\b/iu.test(value))
        problems.push("contains a currency");
    const promise = /\b(?:book(?:ed|ing)|confirm|availab|guarantee|promise)/iu;
    const negated = /\b(?:never|not|no|avoid|without|don'?t|do not|refrain|instead of)\b/iu;
    const offending = value.split(/[\n.;]+/u).some((sentence) => promise.test(sentence) && !negated.test(sentence));
    if (offending)
        problems.push("contains a promise");
    return problems;
}
async function claude(cfg: Cfg, prompt: string, maxTokens = 1200): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.anthropic_api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
            model: cfg.whatsapp_decision_model || "claude-sonnet-5",
            max_tokens: maxTokens,
            thinking: { type: "disabled" },
            messages: [{ role: "user", content: prompt }],
        }),
    });
    if (!res.ok)
        throw new Error(`Claude ${res.status}`);
    const out = await res.json() as AnyMap;
    const text = String((out.content ?? []).map((x: AnyMap) => x.text ?? "").join("")).trim();
    if (!text)
        throw new Error(`Claude returned nothing (stop_reason ${String(out.stop_reason ?? "unknown")})`);
    return text;
}
async function telegram(cfg: Cfg, text: string): Promise<boolean> {
    const token = String(cfg.telegram_bot_token ?? "");
    const chatId = String(cfg.owner_tg_id ?? cfg.cards_chat_id ?? "");
    if (!token || !chatId)
        return false;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
    });
    return res.ok;
}
export async function runReviewSweep(supabase: AnyMap, cfg: Cfg, minutes = 90) {
    if (!cfg.anthropic_api_key)
        return { enabled: false };
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const { data: sent } = await supabase.from("crm_wa_messages")
        .select("lead_id,body,sent_at,raw_meta").eq("direction", "outgoing").gte("sent_at", since)
        .order("sent_at", { ascending: false }).limit(40);
    const automated = (sent ?? []).filter((m: AnyMap) => m.raw_meta?.automated === true);
    if (!automated.length)
        return { checked: 0, flagged: 0 };
    const leadIds = [...new Set(automated.map((m: AnyMap) => String(m.lead_id)))];
    const { data: leads } = await supabase.from("crm_leads")
        .select("id,name,status,service,what_to_clean,scheduled_at").in("id", leadIds);
    const byLead = new Map<string, AnyMap>((leads ?? []).map((l: AnyMap) => [String(l.id), l]));
    const blocks: string[] = [];
    for (const message of automated.slice(0, 20)) {
        const { data: before } = await supabase.from("crm_wa_messages")
            .select("direction,body,sent_at").eq("lead_id", message.lead_id).lt("sent_at", message.sent_at)
            .order("sent_at", { ascending: false }).limit(6);
        const lead: AnyMap = byLead.get(String(message.lead_id)) ?? {};
        const context = [...(before ?? [])].reverse()
            .map((m: AnyMap) => `${m.direction === "incoming" ? "CLIENT" : "OWNER"}: ${String(m.body ?? "").slice(0, 400)}`).join("\n");
        blocks.push(`--- ${String(lead.name ?? "?")} | статус ${String(lead.status ?? "")} | ${String(message.sent_at).slice(11, 16)}
${context}
BOT SENT: ${String(message.body ?? "").slice(0, 700)}`);
    }
    const verdict = await claude(cfg, `You audit a WhatsApp sales bot for a Budapest cleaning company. For each block decide whether the bot's message was wrong. Return only JSON:
{"problems":[{"client":"","time":"","sent":"","why":"","fix":""}]}

Something counts as wrong only when a person would be annoyed or misled: it answers a question that was not asked, repeats what was already said or agreed, contradicts the order card, quotes a total or a cleaner from a different job, promises a time or a booking, stalls with "I will come back to you" when the answer was already available, or replies in the wrong language. A short, plain, useful reply is NOT a problem. An answer that hands a genuinely complex question to Alex is NOT a problem.

Write "why" and "fix" in Russian, one line each. Empty array when everything is fine.

${blocks.join("\n\n")}`, 1500);
    const parsed = ((): AnyMap => {
        const match = verdict.match(/\{[\s\S]*\}/);
        try {
            return match ? JSON.parse(match[0]) : {};
        }
        catch {
            return {};
        }
    })();
    const problems: AnyMap[] = Array.isArray(parsed.problems) ? parsed.problems : [];
    if (problems.length) {
        await telegram(cfg, ["🔍 Обход переписок, найдено: " + problems.length, ...problems.slice(0, 6).map((p) => `\n${String(p.client ?? "")} ${String(p.time ?? "")}\nУшло: ${String(p.sent ?? "").slice(0, 200)}\nПочему не так: ${String(p.why ?? "")}\nЧто сделать: ${String(p.fix ?? "")}`)].join("\n"));
    }
    return { checked: automated.length, flagged: problems.length };
}
export async function runSelfLearn(supabase: AnyMap, cfg: Cfg) {
    if (!cfg.anthropic_api_key)
        return { enabled: false };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: corrections }, { data: manual }] = await Promise.all([
        supabase.from("crm_timeline").select("meta,created_at").eq("kind", "sales_style_feedback")
            .gte("created_at", since).order("created_at", { ascending: false }).limit(25),
        supabase.from("crm_wa_messages").select("body,raw_meta,sent_at").eq("direction", "outgoing")
            .gte("sent_at", since).order("sent_at", { ascending: false }).limit(120),
    ]);
    const byHand = (manual ?? []).filter((m: AnyMap) => m.raw_meta?.automated !== true)
        .map((m: AnyMap) => String(m.body ?? "").trim()).filter((b: string) => b.length > 15).slice(0, 40);
    const pairs = (corrections ?? []).map((x: AnyMap) => `BOT DRAFT: ${String(x.meta?.draft ?? "").slice(0, 400)}\nOWNER SENT INSTEAD: ${String(x.meta?.sent ?? "").slice(0, 400)}`);
    if (!byHand.length && !pairs.length)
        return { learned: false, reason: "нечему учиться за сутки" };
    const current = String(cfg.style_guide ?? "").slice(0, 2000);
    let guide = "";
    try {
        guide = await claude(cfg, `You maintain the voice card for Alex's WhatsApp sales assistant at CLB Cleaning Budapest. Below is how Alex actually wrote to clients in the last day, and the places where he replaced the bot's draft with his own words.

Rewrite the voice card. Rules:
- Voice only: rhythm, sentence length, warmth, what he never says. Never a fact, price, number, date, cleaner name, discount or promise.
- No digits at all. No currency. No client names.
- At most 12 short lines, plain text, no headers, no markdown, no em dash.
- Keep what still holds from the current card, drop what today's messages contradict, add at most two genuinely new observations.
- Write it in English as instructions to the assistant.

Current card:
${current || "(empty)"}

How Alex wrote today:
${byHand.join("\n")}

Where he replaced the draft:
${pairs.join("\n\n")}`, 4000);
    }
    catch (error) {
        const reason = String(error instanceof Error ? error.message : error);
        await telegram(cfg, `🧠 Ночное обучение не отработало: ${reason}. Карточка стиля осталась прежней.`);
        return { learned: false, problems: [reason] };
    }
    const problems = styleGuideProblems(guide);
    if (problems.length) {
        await telegram(cfg, `🧠 Ночное обучение: новая карточка стиля отклонена проверкой (${problems.join(", ")}). Осталась прежняя.`);
        return { learned: false, problems, preview: guide.slice(0, 300), material: { manual: byHand.length, corrections: pairs.length } };
    }
    await supabase.from("crm_app_config").upsert({ key: "style_guide", value: guide }, { onConflict: "key" });
    await telegram(cfg, `🧠 Ночное обучение по ${byHand.length} твоим сообщениям и ${pairs.length} правкам. Карточка стиля обновлена:\n\n${guide}`);
    return { learned: true, manual: byHand.length, corrections: pairs.length };
}
