import { ruName, SVC_EN, SVC_RU } from "../_shared/first_touch.ts";
export const CADENCE_DAYS = 2;
export const CADENCE_CLOSE_AFTER_HOURS = 24;
export const CADENCE_MAX_ROUNDS = 3;
export const CADENCE_PER_DAY = 8;
export const CADENCE_GAP_MINUTES = 30;
export function cadenceGapMs(lastSentAt: string): number {
    return (CADENCE_GAP_MINUTES + (new Date(lastSentAt).getUTCSeconds() * 7) % 61) * 60000;
}
export const CADENCE_NEW_LEADS_FROM = "2026-10-01T00:00:00Z";
export function cadenceText(lead: Record<string, unknown>, round: number): string {
    const ru = lead.language === "ru";
    const first = String(lead.name ?? "").trim().split(/\s+/)[0].replace(/[^\p{L}'-]/gu, "") || ruName(lead.name, ru);
    const svcKey = String(lead.service ?? "");
    const svc = ru ? (SVC_RU[svcKey] || "уборку") : (SVC_EN[svcKey] || "cleaning");
    const hi = first ? (ru ? `${first}, ` : `${first}, `) : "";
    const status = String(lead.status ?? "");
    if (round >= CADENCE_MAX_ROUNDS) {
        return ru
            ? `${hi}не буду больше беспокоить 🙂 Если понадобится ${svc}, просто напишите сюда, подберу время.`
            : `${hi}I won't bother you further 🙂 If you need ${svc} later, just message me here and I'll find a time.`;
    }
    if (status === "contacted") {
        return ru
            ? `${hi}напомню о себе 🙂 Вы спрашивали про ${svc}. Ещё актуально? Могу подобрать день на этой неделе.`
            : `${hi}a quick reminder from me 🙂 You asked about ${svc}. Is it still relevant? I can find a day this week.`;
    }
    if (status === "follow_up") {
        return ru
            ? `${hi}это Алекс из CLB 🙂 Как у вас с планами на ${svc}? Если в силе, найду время на ближайшие дни.`
            : `${hi}Alex from CLB here 🙂 How are your plans for ${svc}? If it's still on, I can fit you in over the next few days.`;
    }
    return ru
        ? `${hi}возвращаюсь к нашему разговору про ${svc} 🙂 Подобрать вам удобный день? На этой неделе есть свободные окна.`
        : `${hi}coming back to our chat about ${svc} 🙂 Shall I find a day that suits you? I have free slots this week.`;
}
const HOLD_RE = /сам[аи]? (?:вам )?напиш|не надо|не нужно|дорого|позже|подума|не сейчас|won.?t (?:be )?need|not (?:right )?now|later|let you know|i.?ll (?:write|text|message|get back)|get back to you|too expensive|no thanks|schedule keeps|nem kell|majd (?:írok|szólok|jelentkez)|drága|később|átgondol/iu;
export function holdCadence(lastClientBody: unknown): boolean {
    return HOLD_RE.test(String(lastClientBody ?? ""));
}
