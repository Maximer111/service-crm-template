const first = (text: string, re: RegExp) => text.match(re)?.[0]?.trim() ?? "";
const TIMED_PROMISE = /\b(?:shortly|in a (?:moment|minute|bit)|later today|by tonight|within (?:the|an|a few) (?:hours?|day|minutes?)|right away|asap)\b|(?<![\p{L}])(?:в течение (?:дня|часа|получаса)|скоро|сегодня же|чуть позже|через (?:час|пару часов|полчаса|минуту|пару минут))(?![\p{L}])|(?<![\p{L}])(?:hamarosan|mindjárt|egy pillanat|még ma|pár percen belül)(?![\p{L}])/iu;
const CLOCK = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}[:.]\d{2}\b|\bat \d{1,2}\b|(?<![\p{L}])\d{1,2} (?:утра|вечера|дня)(?![\p{L}])|\b\d{1,2}(?:-kor| órakor)|(?<![\p{L}])(?:в|к|ближе к|около) \d{1,2}(?![\d.,:]|\s?(?:час|мин|м²|m2))/iu;
const RU_WE = /(?<![\p{L}])(?:можем|сможем|сделаем|приедем|выедем|доедем|посчитаем|возьм[её]м|убер[её]м|почистим|отмоем|предложим|придём|придем|начн[её]м|закончим|подбер[её]м|пришл[её]м|напишем|сообщим|верн[её]мся|подтвердим|уточним|работаем|делаем|берём|берем|приезжаем|чистим|убираем)(?![\p{L}])/iu;
const HU_WE = /(?<![\p{L}])\p{L}{3,}(?:[jszy]uk|[jszy]ük|unk|ünk)(?![\p{L}])/iu;
const THIRD_PERSON_OWNER = /(?<!(?:I'm|I am|this is|it's|It's|зовут|это|Это|я|Я)\s)(?:Alex|Алекс|Алекс)(?![\p{L}])(?!,? (?:vagyok|here|from|a CLB|из CLB|на связи))/u;
const FOREIGN = /[ơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/iu;
const TIME_MENTION = /\b\d{1,2}(?::\d{2})?\s?(?:-\s?\d{1,2}(?::\d{2})?\s?)?(?:am|pm)\b|\b\d{1,2}[:.]\d{2}\b|(?<![\p{L}])\d{1,2} (?:утра|вечера|дня)(?![\p{L}])|\b\d{1,2}(?:-kor| órakor)/iu;
const BOOKED_VERB = /(?<![\p{L}])(?:записал|записываю|зафиксировал|фиксирую|ставлю|бронирую|подтвержд\p{L}*|confirmed|I've got|I have you|so that's|noted for|got you down|pencil(?:led)? (?:you )?in|put you down|slot|beírtam|felírtam|lefoglal\p{L}*)(?![\p{L}])/iu;
const SEPARATE_MESSAGE = /(?<![\p{L}])(?:напишу отдельно|отдельн\p{L}* сообщени\p{L}*|in a separate message|külön üzenetben)(?![\p{L}])/iu;
const MIXED_WORD = /\p{L}*(?:\p{Script=Latin}\p{Script=Cyrillic}|\p{Script=Cyrillic}\p{Script=Latin})\p{L}*/u;
const FEMININE = /(?<![\p{L}])(?:поняла|рада|сама|уточнила|посчитала|записала|увидела|передала|проверила|согласовала|услышала|получила)(?![\p{L}])/iu;
export function wordingObjections(reply: string): string[] {
    const text = String(reply ?? "");
    const out: string[] = [];
    const timed = first(text, TIMED_PROMISE);
    if (timed)
        out.push(`"${timed}" attaches a time to a promise. Say you will confirm it yourself, with no time.`);
    const slot = text.split(/(?<=[.!?])\s+/u).find((s) => s.includes("?") && CLOCK.test(s));
    if (slot)
        out.push(`"${slot.trim()}" offers a time slot. Ask which day suits the client, and leave the exact time open.`);
    const booked = text.split(/(?<=[.!?])\s+/u).find((s) => TIME_MENTION.test(s) && BOOKED_VERB.test(s));
    if (booked)
        out.push(`"${booked.trim()}" writes the client's time down as if it were booked. Say it is what they would like, and that you will check it and come back.`);
    const separate = first(text, SEPARATE_MESSAGE);
    if (separate)
        out.push(`"${separate}" promises a separate message later. Say you will confirm it yourself, without promising a message.`);
    const we = first(text, RU_WE) || first(text, HU_WE);
    if (we)
        out.push(`"${we}" speaks for a company. Write as one person, yourself: first-person singular verbs (могу, hozom).`);
    const third = first(text, THIRD_PERSON_OWNER);
    if (third)
        out.push(`It talks about ${third} in the third person. You are Alex: say I.`);
    if (FOREIGN.test(text))
        out.push("It is not in English, Russian or Hungarian. Write in the client's language from the card, one of those three.");
    const mixed = first(text, MIXED_WORD);
    if (mixed)
        out.push(`"${mixed}" mixes Latin and Cyrillic letters. Write names in the alphabet of the message: Maria in English or Hungarian, Мария in Russian.`);
    const feminine = first(text, FEMININE);
    if (feminine)
        out.push(`"${feminine}" is a feminine form. Alex is a man: use the masculine form.`);
    return out;
}
export function priceTokens(value: unknown): string[] {
    const text = String(value ?? "");
    return [...text.matchAll(/(\d(?:[\d \u00a0\u202f.,]*\d)?)\s*(?:ft|huf|forint|форинт\p{L}*|eur|€|usd|\$|gbp|£)(?![\p{L}])|(?:€|\$|£)\s*(\d(?:[\d \u00a0\u202f.,]*\d)?)/giu)]
        .map((m) => (m[1] ?? m[2]).trim());
}
const CYR: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
export function latinName(name: unknown): string {
    return String(name ?? "").replace(/ий(?![\p{L}])/gu, "i").replace(/\p{Script=Cyrillic}/gu, (ch) => {
        const low = ch.toLowerCase(), out = CYR[low] ?? ch;
        return ch === low ? out : out.charAt(0).toUpperCase() + out.slice(1);
    });
}
