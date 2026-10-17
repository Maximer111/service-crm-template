import { ruName } from "../_shared/first_touch.ts";
export type SilentStage = 1 | 2 | 3 | "close" | null;
type LeadLike = {
    name?: unknown;
    language?: unknown;
    service?: unknown;
    what_to_clean?: unknown;
    when_text?: unknown;
};
const HOURS = { 1: 4, 2: 24, 3: 48 } as const;
export function silentStage(outgoingCount: number, hoursSinceLastOutgoing: number): SilentStage {
    if (outgoingCount < 1)
        return null;
    if (outgoingCount === 1)
        return hoursSinceLastOutgoing >= HOURS[1] ? 1 : null;
    if (outgoingCount === 2)
        return hoursSinceLastOutgoing >= HOURS[2] ? 2 : null;
    if (outgoingCount === 3)
        return hoursSinceLastOutgoing >= HOURS[3] ? 3 : null;
    return hoursSinceLastOutgoing >= HOURS[3] ? "close" : null;
}
const firstName = (value: unknown, russian = false) => {
    const raw = String(value ?? "").trim().split(/\s+/)[0] ?? "";
    if (!/^[\p{L}'-]{2,30}$/u.test(raw))
        return "";
    return russian ? ruName(raw, true) : raw;
};
function language(lead: LeadLike): "ru" | "hu" | "en" {
    const raw = String(lead.language ?? "").toLowerCase();
    if (raw.startsWith("ru"))
        return "ru";
    if (raw.startsWith("hu"))
        return "hu";
    return "en";
}
function subject(lead: LeadLike, lang: "ru" | "hu" | "en"): string {
    const raw = String(lead.what_to_clean ?? "").trim();
    const slug = /^[a-z]+(?:_[a-z]+)+$/i.test(raw) ? raw.toLowerCase().replace(/_?cleaning$/, "") : "";
    if (raw && !slug && raw.length <= 60 && !/^\?+$/.test(raw))
        return raw;
    const service = String(lead.service ?? "").toLowerCase() || slug;
    const map: Record<string, [
        string,
        string,
        string
    ]> = {
        upholstery: ["химчистку мебели", "upholstery cleaning", "kárpittisztítás"],
        windows: ["мойку окон", "window cleaning", "ablaktisztítás"],
        deep: ["генеральную уборку", "the deep clean", "nagytakarítás"],
        regular: ["регулярную уборку", "regular cleaning", "rendszeres takarítás"],
    };
    const hit = map[service] ?? ["уборку", "the cleaning", "takarítás"];
    return lang === "ru" ? hit[0] : lang === "hu" ? hit[2] : hit[1];
}
export function silentFollowupText(lead: LeadLike, stage: 1 | 2 | 3): string {
    const lang = language(lead);
    const name = firstName(lead.name, lang === "ru");
    const what = subject(lead, lang);
    const timing = String(lead.when_text ?? "").trim().slice(0, 60);
    if (lang === "ru") {
        if (stage === 1) {
            return `${name ? name + ", е" : "Е"}щё раз здравствуйте. Вы оставляли заявку на ${what}, и я так и не понял, что именно вам нужно. Напишите пару слов, и я посчитаю точную цену.`;
        }
        if (stage === 2) {
            const when = timing ? ` Вы упоминали срок: ${timing}. Я про него помню.` : "";
            return `${name ? name + ", п" : "П"}о вашей заявке на ${what} мне не хватает буквально пары деталей, чтобы назвать цену без вилки.${when} Что скажете?`;
        }
        return `${name ? name + ", п" : "П"}ишу последний раз, чтобы не надоедать. Если ${what} сейчас неактуальна, я закрою заявку, а вы напишете мне, когда будет удобно. Если актуальна, ответьте одним словом, и я продолжу.`;
    }
    if (lang === "hu") {
        if (stage === 1) {
            return `${name ? name + ", ú" : "Ú"}jra jelentkezem. Kért egy ajánlatot: ${what}. Írjon pár szót arról, mire van szükség, és megmondom a pontos árat.`;
        }
        if (stage === 2) {
            const when = timing ? ` Említette az időpontot: ${timing}. Észben tartom.` : "";
            return `${name ? name + ", a" : "A"}z ajánlathoz (${what}) csak pár apróság hiányzik, hogy pontos árat mondjak, ne tartományt.${when} Mit gondol?`;
        }
        return `${name ? name + ", u" : "U"}toljára írok, hogy ne zavarjam. Ha a ${what} most nem aktuális, lezárom a kérést, és Ön jelentkezik, amikor alkalmas. Ha aktuális, elég egy szó, és folytatjuk.`;
    }
    if (stage === 1) {
        return `${name ? name + ", m" : "M"}e again. You asked about ${what} and I never got the details, so I could not price it. Send me a couple of lines and I will give you the exact number.`;
    }
    if (stage === 2) {
        const when = timing ? ` You mentioned the timing: ${timing}. I have that in mind.` : "";
        return `${name ? name + ", f" : "F"}or ${what} I am short of two small details to give you a fixed price instead of a range.${when} What do you say?`;
    }
    return `${name ? name + ", w" : "W"}riting once more so I stop bothering you. If ${what} is not relevant now, I will close the request and you write to me when it suits you. If it is, one word back and I carry on.`;
}
