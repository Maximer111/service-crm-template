type LeadLike = {
    name?: unknown;
    language?: unknown;
    service?: unknown;
    what_to_clean?: unknown;
    area?: unknown;
    answers?: unknown;
};
export type StandardCleaningQuote = {
    hours: number;
    rate: number;
    price: number;
    areaLabel: string;
};
export function asksForPrice(value: unknown): boolean {
    return /(?:\b(?:price|fees?|cost|how much|quote|estimate|total)\b|(?:сколько (?:стоит|выйдет|будет стоить|получится|это будет)|какая цена|цена|стоимост|по сумме|(?:итогов\p{L}*|общ\p{L}*) сумм|примерно сколько|рассчитай|посчитай)|(?:mennyibe kerül|mennyi lesz|árajánlat|árat|ár))/iu.test(String(value ?? ""));
}
export function dropNegatedWindows(value: unknown): string {
    return String(value ?? "").replace(/(?:окна?|окон)\s+(?:не\s+нужн\p{L}*|не\s+надо|не\s+моем|не\s+мыть)|без\s+(?:мыть\p{L}*\s+)?окон|не\s+(?:нужно|надо)\s+(?:мыть\s+)?окна?|no\s+windows?|(?:don'?t|do not)\s+need\s+(?:the\s+)?windows?|windows?\s+(?:are\s+)?not\s+(?:needed|necessary|included)|without\s+(?:the\s+)?windows?|ablak(?:ok)?\s+nem\s+kell|ablakok\s+nélkül/giu, " ");
}
function areaUpperBound(value: unknown): number | null {
    const numbers = [...String(value ?? "").matchAll(/\d+(?:[.,]\d+)?/g)]
        .map((match) => Number(match[0].replace(",", ".")))
        .filter((number) => Number.isFinite(number) && number > 0 && number <= 1000);
    return numbers.length ? Math.max(...numbers) : null;
}
function areaFromText(text: unknown): string {
    const hit = String(text ?? "").match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|to|до|és)?\s*(\d+(?:[.,]\d+)?)?\s*(?:m²|m2|м²|м2|nm|négyzetméter)/iu);
    return hit ? hit[0] : "";
}
export const CLEANING = {
    base: { rate: 6500, minutesPerM2: 3.5, minHours: 4 },
    deep: { rate: 7500, minutesPerM2: 8, minHours: 5 },
} as const;
export type CleaningTier = keyof typeof CLEANING;
export function cleaningHours(area: number, tier: CleaningTier): number {
    const t = CLEANING[tier];
    return Math.max(t.minHours, Math.ceil((area * t.minutesPerM2) / 60));
}
export function pricingArea(value: unknown): number | null {
    const hit = String(value ?? "").match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|to|до|és)\s*(\d+(?:[.,]\d+)?)\s*(?:m²|m2|м²|м2|nm|négyzetméter|sqm|кв)/iu)
        ?? String(value ?? "").match(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|м²|м2|nm|négyzetméter|sqm|кв\.?\s*м)/iu);
    if (!hit)
        return null;
    const a = Number(hit[1].replace(",", "."));
    const b = hit[2] ? Number(hit[2].replace(",", ".")) : a;
    const area = Math.round((a + b) / 2);
    return area > 0 && area <= 2000 ? area : null;
}
export function hoursForArea(area: number): number | null {
    if (area <= 40)
        return 5;
    if (area <= 50)
        return 6;
    if (area <= 80)
        return 7;
    if (area <= 110)
        return 8;
    if (area <= 150)
        return 12;
    if (area >= 250 && area <= 300)
        return 30;
    return null;
}
export function standardCleaningQuote(lead: LeadLike, transcript: string): StandardCleaningQuote | null {
    const service = `${lead.service ?? ""} ${lead.what_to_clean ?? ""}`.toLowerCase();
    const context = `${JSON.stringify(lead.answers ?? {})} ${transcript}`.toLowerCase();
    if (!/(?:deep|general|генерал|nagytakar)/iu.test(`${service} ${context}`))
        return null;
    if (!/(?:apartment|flat|квартир|lakás)/iu.test(`${service} ${context}`))
        return null;
    if (/(?:renovat|construction|after builders|после ремонт|строитель|felújítás|pet|dog|cat|animal|животн|собак|кошк|window|окн|ablak|sofa|couch|mattress|rug|carpet|диван|матрас|ков[её]р|oven|духов|sütő|steam|grout|затир|company|hotel|office|commercial)/iu.test(dropNegatedWindows(context)))
        return null;
    const area = pricingArea(lead.area) ?? pricingArea(areaFromText(transcript));
    if (!area)
        return null;
    const hours = cleaningHours(area, "deep");
    const rate = CLEANING.deep.rate;
    return { hours, rate, price: hours * rate, areaLabel: String(lead.area || `${area} m²`).trim() };
}
function firstName(value: unknown): string {
    const name = String(value ?? "").trim().split(/\s+/)[0] ?? "";
    return /^[\p{L}'-]{2,30}$/u.test(name) ? name : "";
}
function money(value: number, language: string): string {
    return language === "en" ? value.toLocaleString("en-US") : value.toLocaleString("hu-HU");
}
export function replyLanguage(lead: LeadLike, latestBody: string): "ru" | "hu" | "en" {
    const raw = String(lead.language ?? "").toLowerCase();
    if (/[а-яё]/iu.test(latestBody))
        return "ru";
    if (/[őűáéíóöü]/iu.test(latestBody))
        return "hu";
    if (/(?:^ru|рус)/u.test(raw))
        return "ru";
    if (/(?:^hu|hung|magyar)/u.test(raw))
        return "hu";
    return "en";
}
const MIN_CALLOUT = CLEANING.base.rate * CLEANING.base.minHours;
export function minimumCalloutReply(lead: LeadLike, latestBody: string, transcript = ""): {
    reply: string;
    calculation: string;
} | null {
    if (!asksForPrice(latestBody))
        return null;
    const text = `${latestBody} ${lead.what_to_clean ?? ""} ${lead.service ?? ""}`;
    const whole = `${text} ${lead.area ?? ""} ${transcript}`;
    if (/(?:apartment|flat|whole|entire|house|квартир|вся|целик|дом|lakás|egész|ház)/iu.test(whole))
        return null;
    const everyArea = [...whole.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|м²|м2|nm|négyzetméter)/giu)]
        .map((match) => Number(match[1].replace(",", ".")))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (everyArea.some((value) => value > 15))
        return null;
    if (/(?:sofa|couch|mattress|carpet|rug|upholster|диван|кресл|матрас|ков[её]р|обивк|kanapé|szőnyeg|matrac|window|ablak|окн|oven|sütő|духов)/iu.test(text))
        return null;
    const areas = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|м²|м2|nm|négyzetméter|кв\.?\s*м)/giu)]
        .map((match) => Number(match[1].replace(",", ".")))
        .filter((value) => Number.isFinite(value) && value > 0);
    const smallRoom = /(?:bathroom|toilet|shower room|ванн|санузел|туалет|fürdőszoba|mosdó|\bwc\b)/iu.test(text);
    const wholePlace = /(?:apartment|flat|house|whole|квартир|дом|вся|целик|lakás|ház|egész)/iu.test(text);
    const small = areas.length ? Math.max(...areas) <= 15 : (smallRoom && !wholePlace);
    if (!small)
        return null;
    const language = replyLanguage(lead, latestBody);
    const name = firstName(lead.name);
    const price = money(MIN_CALLOUT, language);
    const calculation = `minimum call-out ${MIN_CALLOUT}, job is below it`;
    if (language === "ru") {
        const opening = name ? `${name}, отвечу сразу, чтобы вы не ждали.` : "Отвечу сразу, чтобы вы не ждали.";
        return {
            reply: `${opening}\n\nМинимальный выезд у меня ${price} Ft, и он не зависит от размера: дорога и оборудование одинаковы и на маленький санузел, и на всю квартиру. Ради одной небольшой ванной это невыгодно вам самим.\n\nЕсли добавить к ней что-то ещё, например кухню или духовку, выезд себя окупает. Что ещё в квартире просится в уборку?`,
            calculation,
        };
    }
    if (language === "hu") {
        const opening = name ? `${name}, rögtön válaszolok, hogy ne kelljen várnia.` : "Rögtön válaszolok, hogy ne kelljen várnia.";
        return {
            reply: `${opening}\n\nA minimum kiszállási díj nálam ${price} Ft, és ez nem függ a mérettől: az út és a felszerelés ugyanannyi egy kis fürdőszobánál is, mint egy egész lakásnál. Egyetlen kis fürdőszobáért ez Önnek sem éri meg.\n\nHa kerül mellé még valami, például konyha vagy sütő, akkor a kiszállás megtérül. Mi van még a lakásban, amit érdemes lenne egyszerre megcsinálni?`,
            calculation,
        };
    }
    const opening = name ? `${name}, answering straight away so you're not left waiting.` : "Answering straight away so you're not left waiting.";
    return {
        reply: `${opening}\n\nMy minimum call-out is ${price} Ft, and it does not depend on the size: the travel and the equipment are the same for a small bathroom as for a whole flat. For one small bathroom on its own that is poor value for you.\n\nIf something else goes with it, a kitchen or the oven for example, the call-out pays for itself. What else in the flat could use a clean?`,
        calculation,
    };
}
