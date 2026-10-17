export type RenovationFacts = {
    post_renovation?: unknown;
    ready?: unknown;
    area_m2?: unknown;
    bathrooms?: unknown;
    windows?: unknown;
    day?: unknown;
    summary_ru?: unknown;
    missing?: unknown;
};
export const POST_RENOVATION_RE = /(?:renovat|after (?:the )?builders|construction dust|после ремонт|строител|felújít)/iu;
export const HOURLY_OFFER_RE = /(?:per hour|an hour|\/\s*h\b|в час|за час|óránként|óradíj)/iu;
const ft = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const RU_PEOPLE: Record<number, string> = { 1: "одного человека", 2: "двух человек", 3: "трёх человек", 4: "четырёх человек" };
export function renovationCard(lead: {
    name?: unknown;
    phone?: unknown;
    language?: unknown;
}, facts: RenovationFacts, rate: number): {
    owner: string;
    client: string;
} | null {
    const area = Math.round(Number(facts.area_m2 ?? 0));
    if (facts.post_renovation !== true || facts.ready !== true || !(area > 0))
        return null;
    const tableHours = Math.max(8, Math.ceil((area * 8) / 60));
    const baths = Math.max(0, Math.round(Number(facts.bathrooms ?? 0)));
    const extra = Math.max(0, baths - 2) * 0.5;
    const manHours = tableHours ? tableHours + extra : null;
    const people = manHours ? Math.max(1, Math.ceil(manHours / 6)) : 2;
    const windows = String(facts.windows ?? "unknown");
    const lang = String(lead.language ?? "en");
    const question = windows === "unknown"
        ? { en: " Windows are not part of the hourly rate, I price them separately by frame. Do you want them washed too?",
            ru: " Окна в почасовую ставку не входят, их считаю отдельно по рамам. Окна тоже моем?",
            hu: " Az ablakok nincsenek benne az óradíjban, azokat keretenként külön számolom. Az ablakokat is mossuk?" }
        : windows === "yes"
            ? { en: " Windows are not part of the hourly rate, I price them separately by frame: could you send one full photo of each window?",
                ru: " Окна в почасовую ставку не входят, их считаю отдельно по рамам: пришлите, пожалуйста, фото каждого окна целиком.",
                hu: " Az ablakok nincsenek benne az óradíjban, azokat keretenként külön számolom: küldene egy teljes fotót minden ablakról?" }
            : { en: " Which suits you better, morning or afternoon?", ru: " Когда удобнее, утром или днём?", hu: " Délelőtt vagy délután jobb?" };
    const client = lang === "ru"
        ? `Уборку после ремонта считаю по часам: ${ft(rate)} Ft в час за одного человека, и вы платите только за фактическое время. На ${area} м² планирую ${RU_PEOPLE[people] ?? `${people} человек`}.${question.ru}`
        : lang === "hu"
            ? `A felújítás utáni takarítást óradíjban számolom: ${ft(rate)} Ft óránként takarítónként, és csak a ténylegesen ledolgozott időt kell kifizetni. ${area} m²-re ${people} takarítót tervezek.${question.hu}`
            : `Cleaning after renovation I charge by the hour: ${ft(rate)} Ft per hour per cleaner, and you pay only for the time we actually work. For ${area} m² I'd plan ${people} cleaner${people > 1 ? "s" : ""}.${question.en}`;
    const owner = [
        "💰 Готово к цене: уборка после ремонта",
        `Клиент: ${String(lead.name ?? "")} ${String(lead.phone ?? "")}`.trim(),
        String(facts.summary_ru ?? "").trim(),
        "",
        tableHours
            ? `Для тебя, не для клиента: по правилам сайта ${area} м² это ${tableHours} ч${extra ? ` + ${extra} ч за санузлы сверх двух` : ""} = ${manHours} чел-часов, это ${people} чел. После ремонта обычно дольше, поэтому только почасово.`
            : `Для тебя: ${area} м² вне таблицы часов, считай людей сам.`,
        "Окна в почасовую не входят, считаются по рамам отдельно. " + (windows === "yes" ? "Клиент окна хочет, в черновике просьба прислать фото каждого окна." : windows === "no" ? "Окна клиенту не нужны." : "Про окна не спрашивали, вопрос стоит в черновике."),
        String(facts.day ?? "").trim() ? `Когда: ${String(facts.day)}` : "",
        "",
        "Черновик клиенту:",
        client,
    ].filter((line, i, all) => line !== "" || (all[i - 1] ?? "") !== "").join("\n");
    return { owner, client };
}
