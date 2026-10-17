export type QuoteLine = {
    label: string;
    units: number;
    unit: string;
    each: number;
    total: number;
};
export type Localized = {
    ru: string;
    en: string;
    hu: string;
};
export type QuoteResult = {
    hold?: string;
    lines: QuoteLine[];
    subtotal: number;
    total: number;
    missing: Localized[];
    indicative: Localized[];
    clientNotes: Localized[];
    notes: string[];
    vat: boolean;
};
type LeadLike = {
    language?: unknown;
    service?: unknown;
    what_to_clean?: unknown;
    area?: unknown;
    answers?: unknown;
    campaign?: unknown;
    soft_review?: unknown;
};
export type SoftReview = {
    items?: {
        label?: unknown;
        units?: unknown;
        each?: unknown;
    }[];
    price?: unknown;
    master?: unknown;
};
export const HOURLY_ONE_OFF = 7500;
export const HOURLY_REGULAR = 6500;
export const MIN_CALLOUT_CLEANING = CLEANING.base.rate * CLEANING.base.minHours;
export const MIN_CALLOUT_UPHOLSTERY = 15000;
const has = (text: string, re: RegExp) => re.test(text);
function countNear(text: string, subject: RegExp): number | null {
    const words: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8,
        egy: 1, kettő: 2, két: 2, három: 3, négy: 4, öt: 5, hat: 6, hét: 7, nyolc: 8,
    };
    const number = "(?<![\\p{L}\\d])(\\d{1,3}|" + Object.keys(words).join("|") + ")(?![\\p{L}\\d])";
    const source = subject.source;
    const before = new RegExp(`${number}\\s*(?:\\w+\\s+){0,2}(?:${source})`, "iu");
    const after = new RegExp(`(?:${source})\\D{0,12}?${number}\\b`, "iu");
    const subjectRe = new RegExp(source, "iu");
    let hit: RegExpMatchArray | null = null;
    for (const part of text.split(/[.!?\n]/u)) {
        if (!subjectRe.test(part))
            continue;
        hit = part.match(before) ?? part.match(after);
        if (hit)
            break;
    }
    if (!hit)
        return null;
    const raw = hit[1].toLowerCase();
    const value = words[raw] ?? Number(raw);
    return Number.isFinite(value) && value > 0 && value <= 200 ? value : null;
}
const line = (label: string, units: number, unit: string, each: number): QuoteLine => ({
    label, units, unit, each, total: units * each,
});
export function buildQuote(lead: LeadLike, transcript: string, latestBody = ""): QuoteResult {
    const text = `${latestBody} ${transcript} ${lead.what_to_clean ?? ""} ${lead.service ?? ""} ${JSON.stringify(lead.answers ?? {})}`.toLowerCase();
    const lines: QuoteLine[] = [];
    const missing: Localized[] = [];
    const indicative: Localized[] = [];
    const clientNotes: Localized[] = [];
    const notes: string[] = [];
    const company = has(text, /\b(?:company|office|hotel)\b|(?<![\p{L}])(?:iroda\p{L}*|cég\p{L}*|szálloda\p{L}*|офис\p{L}*|компани\p{L}*|отел\p{L}*)/iu);
    const regular = has(text, /(?:once a month|twice a month|every month|monthly|every week|weekly|regular (?:cleaning|basis|service)|havonta|hetente|rendszeres takarít|раз в месяц|два раза в месяц|регулярн\w* уборк|постоянн\w* уборк|еженедельн)/iu);
    const postRenovation = has(text, /(?:after (?:the )?renovation|after builders|post-renovation|после ремонт|felújítás után)/iu);
    const service = String(lead.service ?? "").toLowerCase();
    const wantsCleaning = ["deep", "regular", "cleaning", "standard"].includes(service)
        || has(text, /(?:deep clean|general clean|cleaning|takarít|nagytakar|уборк|генералк|клининг)/iu);
    const area = pricingArea(String(lead.area ?? "")) ?? pricingArea(text);
    const statedHours = countNear(text, /hours?|órá|час(?:а|ов)?/iu);
    const deep = service === "deep" || has(text, /(?:deep clean|general clean|генеральн|генералк|nagytakar|move[- ]?(?:in|out)|end of tenancy|после выезда|перед въездом|kiköltöz|beköltöz)/iu);
    const base = ["standard", "regular"].includes(service) || regular
        || has(text, /(?:standard clean|basic clean|maintenance clean|стандартн|базов\p{L}* уборк|поддерживающ|обычн\p{L}* уборк|alaptakar|standard takar)/iu);
    const tier: CleaningTier | null = deep ? "deep" : base ? "base" : null;
    if (wantsCleaning && !postRenovation) {
        const neglected = has(text, /(?:not cleaned (?:in|for) (?:years|a long time)|never (?:been )?cleaned|годами не убирал|давно не убирал|очень грязн|nagyon koszos)/iu);
        if (tier && (area || statedHours)) {
            const rate = regular ? HOURLY_REGULAR : CLEANING[tier].rate;
            const hours = Math.max(statedHours ?? 0, area ? cleaningHours(area, tier) : CLEANING[tier].minHours);
            lines.push(line(regular ? "Регулярная уборка" : tier === "deep" ? "Генеральная уборка" : "Стандартная уборка", hours, "ч", rate));
            if (neglected)
                notes.push("Клиент говорит, что не убирали давно. По прайсу это надбавка от 50 до 100 процентов, решение за владельцем, в сумму не включено");
        }
        else if (area) {
            const hb = cleaningHours(area, "base"), hd = cleaningHours(area, "deep");
            const pb = hb * CLEANING.base.rate, pd = hd * CLEANING.deep.rate;
            const f = (n: number, l: string) => l === "en" ? n.toLocaleString("en-US") : n.toLocaleString("hu-HU");
            const said = String(lead.area ?? "").trim();
            const ru = said || `${area} м²`, en = said || `${area} m²`;
            indicative.push({
                ru: `Ориентировочно на ${ru}: стандартная уборка около ${hb} ч, это ${f(pb, "ru")} Ft, генеральная около ${hd} ч, это ${f(pd, "ru")} Ft. Точную сумму подтвержу, когда пойму объём.`,
                en: `As a guide for ${en}: a standard clean is about ${hb} hours, ${f(pb, "en")} Ft, a deep clean about ${hd} hours, ${f(pd, "en")} Ft. I'll confirm the exact total once I know the scope.`,
                hu: `Tájékoztatásul ${en} alapterületre: standard takarítás kb. ${hb} óra, ${f(pb, "hu")} Ft, nagytakarítás kb. ${hd} óra, ${f(pd, "hu")} Ft. A pontos összeget a részletek után megerősítem.`,
            });
            missing.push({
                ru: "Вам нужна стандартная уборка или генеральная, с мытьём шкафов внутри, техники и застарелой грязи?",
                en: "Do you need a standard clean, or a deep clean with the inside of cupboards, appliances and built-up dirt?",
                hu: "Standard takarításra van szüksége, vagy nagytakarításra, a szekrények belsejével, a gépekkel és a lerakódott szennyeződéssel?",
            });
        }
        else {
            indicative.push({
                ru: `Для ориентира: стандартная уборка ${CLEANING.base.rate.toLocaleString("hu-HU")} Ft в час, от ${(CLEANING.base.rate * CLEANING.base.minHours).toLocaleString("hu-HU")} Ft за выезд, генеральная ${CLEANING.deep.rate.toLocaleString("hu-HU")} Ft в час, от ${(CLEANING.deep.rate * CLEANING.deep.minHours).toLocaleString("hu-HU")} Ft.`,
                en: `As a guide: a standard clean is ${CLEANING.base.rate.toLocaleString("en-US")} Ft an hour, from ${(CLEANING.base.rate * CLEANING.base.minHours).toLocaleString("en-US")} Ft a visit, a deep clean ${CLEANING.deep.rate.toLocaleString("en-US")} Ft an hour, from ${(CLEANING.deep.rate * CLEANING.deep.minHours).toLocaleString("en-US")} Ft.`,
                hu: `Tájékoztatásul: standard takarítás ${CLEANING.base.rate.toLocaleString("hu-HU")} Ft óránként, kiszállásonként ${(CLEANING.base.rate * CLEANING.base.minHours).toLocaleString("hu-HU")} Ft-tól, nagytakarítás ${CLEANING.deep.rate.toLocaleString("hu-HU")} Ft óránként, ${(CLEANING.deep.rate * CLEANING.deep.minHours).toLocaleString("hu-HU")} Ft-tól.`,
            });
            missing.push({
                ru: "Площадь квартиры в квадратных метрах. Без неё часы посчитать нельзя.",
                en: "The size of the flat in square metres. Without it I cannot work out the hours.",
                hu: "A lakás alapterülete négyzetméterben. Enélkül nem tudom kiszámolni az órákat.",
            });
        }
    }
    else if (postRenovation) {
        notes.push("Уборка после ремонта: ставка 9 500 - 10 500 в час, только почасово, решение за владельцем");
        indicative.push({
            ru: "Уборку после ремонта считаю по часам: 9 500-10 500 Ft в час за одного человека, оплата по фактическому времени. Окна в ставку не входят, их считаю отдельно по рамам.",
            en: "Cleaning after renovation I charge by the hour: 9,500-10,500 Ft per hour per cleaner, and you pay for the actual time. Windows are not part of the hourly rate, I price them separately by frame.",
            hu: "A felújítás utáni takarítást óradíjban számolom: 9 500-10 500 Ft óránként takarítónként, a ténylegesen ledolgozott idő szerint. Az ablakok nincsenek benne az óradíjban, azokat keretenként külön számolom.",
        });
        if (!area)
            missing.push({
                ru: "Площадь в квадратных метрах и что осталось после строителей.",
                en: "The area in square metres and what the builders left behind.",
                hu: "Az alapterület négyzetméterben, és mi maradt a munkások után.",
            });
    }
    if (has(text, /\boven\b|(?:sütő|духовк)/iu)) {
        lines.push(line("Духовка", 1, "шт", 8000));
        clientNotes.push({
            ru: "Духовка посчитана как обычная, 8 000. Если стекло дверцы придётся разбирать, чтобы достать жир между стёклами, это 15 000, и мастер скажет об этом до начала работы, а не после.",
            en: "The oven is priced as a standard one, 8,000. If the glass door has to come apart to reach the grease between the panes, that version is 15,000, and the cleaner will tell you before starting, never after.",
            hu: "A sütőt normál árral számoltam, 8 000. Ha az üvegajtót szét kell szedni a lapok közötti zsírhoz, az 15 000, és a takarító a munka előtt szól, nem utána.",
        });
    }
    if (has(text, /\b(?:fridge|refrigerator)\b|(?:hűtő|холодильник)/iu) && !has(text, /(?:free fridge|бесплатн\w* холодильник|does not need|не нужн)/iu)) {
        lines.push(line("Холодильник изнутри", 1, "шт", 5000));
    }
    if (has(text, /\b(?:extractor|hood)\b|(?:páraelszívó|вытяжк)/iu))
        lines.push(line("Вытяжка с фильтром", 1, "шт", 6000));
    if (has(text, /\bchandelier\b|(?:csillár|люстр)/iu))
        lines.push(line("Люстра", 1, "шт", 5000));
    if (has(text, /(?:steam|grout|gőz|fugá|пар(?:оочист)?|затирк|швы)/iu)) {
        const steamSentence = text.split(/[.!?\n]/u).find((part) => /(?:steam|grout|gőz|fugá|пар(?:оочист)?|затирк|швы)/iu.test(part)) ?? "";
        const named = [/bathroom|fürdőszoba|ванн/iu, /toilet|\bwc\b|mosdó|туалет/iu, /kitchen|konyha|кухн/iu]
            .filter((re) => re.test(steamSentence)).length;
        const rooms = named || countNear(steamSentence, /rooms?|helyiség|помещени|комнат/iu);
        if (rooms)
            lines.push(line("Пар по плитке и затирке", rooms, "помещение", 20000));
        else
            missing.push({
                ru: "В каких именно помещениях нужен пар по затирке: только ванная, или ещё туалет и кухня. Считается по 20 000 за помещение, потому что идёт около часа на 10 м² пола.",
                en: "Which rooms need the steam on the grout: just the bathroom, or the toilet and kitchen too. It is 20,000 per room, because it runs about an hour per 10 square metres of floor.",
                hu: "Mely helyiségekben kell a gőz a fugára: csak a fürdőszoba, vagy a mosdó és a konyha is. Helyiségenként 20 000, mert körülbelül egy óra 10 négyzetméter padlónként.",
            });
    }
    if (has(dropNegatedWindows(text), /\bwindows?\b|(?<![\p{L}])(?:ablak|окн|окон)/iu)) {
        missing.push({
            ru: "Фото каждого окна целиком. Считаем не окна, а рамы: обе стороны, рама, подоконник, направляющие, и глухая рама тоже. В двустворчатом окне рам две, поэтому по описанию число всегда выходит примерно вдвое меньше настоящего. Рама до 1,5 м стоит 3 000, от 1,5 до 2 м 4 500, выше 2 м 5 500, балконная дверь 6 500, у старых деревянных двойных цена удваивается.",
            en: "A photo of each window, the whole window. We count frames, not windows: both sides, the frame, the sill, the tracks, and a fixed frame counts too. A double window is two frames, so a description always gives about half the real number. A frame up to 1.5 m is 3,000, from 1.5 to 2 m it is 4,500, above 2 m it is 5,500, a balcony door is 6,500, and old wooden double frames count double.",
            hu: "Fotó minden ablakról, a teljes ablakról. Nem ablakot számolunk, hanem keretet: mindkét oldal, keret, párkány, sínek, és a fix keret is. Egy kétszárnyú ablak két keret, ezért a leírásból mindig nagyjából fele jön ki. Egy keret 1,5 m-ig 3 000, 1,5-2 m között 4 500, 2 m felett 5 500, erkélyajtó 6 500, a régi fa dupla keret duplán számít.",
        });
        clientNotes.push({
            ru: "Окна в эту сумму пока не входят: их я посчитаю по фото, по рамам.",
            en: "The windows are not in this total yet: I price them from the photos, by frame.",
            hu: "Az ablakok még nincsenek ebben az összegben: fotó alapján, keretenként számolom.",
        });
    }
    const softAsked = has(text, /\b(?:sofa|couch|armchair|mattress|carpet|rug|upholstery)\b|(?<![\p{L}])(?:kanapé|fotel|matrac|szőnyeg|kárpit|диван|кресл[\p{L}]*|матрас[\p{L}]*|ков[её]р|ковр[\p{L}]*|химчистк[\p{L}]*)(?![\p{L}])/iu);
    if (softAsked) {
        const review = (lead.soft_review ?? null) as SoftReview | null;
        const masterPrice = Number(review?.price ?? 0);
        const confirmed = (review?.items ?? []).filter((item) => Number(item?.units) > 0 && Number(item?.each) > 0);
        if (masterPrice > 0) {
            const what = confirmed.map((item) => String(item.label ?? "")).filter(Boolean).join(", ");
            lines.push(line(what ? `Химчистка: ${what}` : "Химчистка", 1, "шт", masterPrice));
        }
        else if (confirmed.length) {
            for (const item of confirmed) {
                lines.push(line(String(item.label ?? "Химчистка"), Number(item.units), "шт", Number(item.each)));
            }
        }
        else {
            missing.push({
                ru: "Фото каждого предмета отдельно, целиком и вблизи пятен. По ним мастер скажет точно: диван прямой или угловой (22-25 тысяч против 30-35), матрас с одной стороны или с двух (15 000 против 25 000), ткань это или кожа (кожу чистят вручную, экстракцией нельзя). По коврам ещё нужен размер в сантиметрах: по фото он не виден, а 120x170 и 160x230 отличаются по цене вдвое.",
                en: "A photo of each item separately, the whole piece plus close-ups of the stains. From those our specialist says exactly what it is: a straight sofa or a corner one (22-25k against 30-35k), a mattress on one side or both (15,000 against 25,000), fabric or leather (leather is done by hand, never by extraction). For rugs I also need the size in centimetres: a photo does not show it, and 120x170 against 160x230 is double the price.",
                hu: "Fotó minden darabról külön, az egészről és a foltokról közelről. Ezekből a szakemberünk pontosan megmondja: egyenes vagy sarok kanapé (22-25 ezer vagy 30-35), matrac egy oldalon vagy mindkettőn (15 000 vagy 25 000), szövet vagy bőr (a bőrt kézzel tisztítjuk, extrakcióval soha). Szőnyegnél a méret is kell centiméterben: fotón nem látszik, és a 120x170 a 160x230-hoz képest dupla ár.",
            });
            clientNotes.push({
                ru: "Химчистка в эту сумму пока не входит: её посчитаю по фото, когда мастер подтвердит предметы.",
                en: "The upholstery cleaning is not in this total yet: I price it from the photos once our specialist confirms the items.",
                hu: "A kárpittisztítás még nincs ebben az összegben: a fotók alapján, a szakember megerősítése után árazom.",
            });
        }
    }
    if (has(text, /\b(?:pet (?:odour|odor|smell)|urine|dogs?|cats?)\b|(?<![\p{L}])(?:kutya|macska|собач[\p{L}]*|кошач[\p{L}]*|моч[аиойу]|запах\s+животн[\p{L}]*)(?![\p{L}])/iu)) {
        missing.push({
            ru: "Устранение запаха ферментом идёт 10 000 за каждое изделие, а не за заказ. Сколько изделий обрабатываем.",
            en: "Enzyme odour removal is 10,000 per item, not per visit. How many items need it.",
            hu: "Az enzimes szagtalanítás darabonként 10 000, nem alkalmanként. Hány darabot kell kezelni.",
        });
    }
    const holds: string[] = [];
    const hoursLine = lines.find((item) => item.unit === "ч");
    if (hoursLine && area && tier && hoursLine.units < cleaningHours(area, tier)) {
        holds.push(`часы ${hoursLine.units} меньше, чем нужно на ${area} м² по правилам сайта`);
    }
    const sillyCount = lines.find((item) => item.unit === "шт" && item.units >= 3 && /диван|кресл|матрас/iu.test(item.label));
    if (sillyCount)
        holds.push(`${sillyCount.label}: ${sillyCount.units} штук, число похоже на чужое`);
    const subtotal = lines.reduce((sum, item) => sum + item.total, 0);
    const upholsteryOnly = lines.length > 0 && lines.every((item) => /диван|кресл|матрас|ков/iu.test(item.label));
    const floor = upholsteryOnly ? MIN_CALLOUT_UPHOLSTERY : MIN_CALLOUT_CLEANING;
    let total = subtotal;
    if (subtotal > 0 && subtotal < floor) {
        total = floor;
        const shown = floor.toLocaleString("hu-HU");
        const shownEn = floor.toLocaleString("en-US");
        notes.push(`Сумма строк ниже минимального выезда ${shown} Ft, взят минимум`);
        clientNotes.push({
            ru: `По строкам выходит меньше, но минимальный выезд у меня ${shown} Ft и он не зависит от объёма: дорога и оборудование одинаковы везде.`,
            en: `The lines add up to less, but my minimum call-out is ${shownEn} Ft and it does not depend on the size: the travel and the equipment are the same everywhere.`,
            hu: `A tételek kevesebbet adnak ki, de a minimum kiszállási díj ${shown} Ft, és ez nem függ a mennyiségtől: az út és a felszerelés mindenhol ugyanannyi.`,
        });
    }
    if (company)
        notes.push("Клиент юрлицо: цену называть как «+ ÁFA», НДС 27% сверху, и сказать это ДО работы");
    return { hold: holds.join("; ") || undefined, lines, subtotal, total, missing, indicative, clientNotes, notes, vat: company };
}
import { CLEANING, type CleaningTier, cleaningHours, dropNegatedWindows, pricingArea, replyLanguage } from "./pricing.ts";
const money = (value: number, language: string) => language === "en" ? value.toLocaleString("en-US") : value.toLocaleString("hu-HU");
const LABELS: Record<string, Record<string, string>> = {
    en: {
        "Генеральная уборка": "Deep clean of the flat", "Стандартная уборка": "Standard clean of the flat", "Регулярная уборка": "Regular cleaning",
        "Духовка": "Oven inside", "Холодильник изнутри": "Fridge inside", "Вытяжка с фильтром": "Extractor with filter",
        "Люстра": "Chandelier", "Пар по плитке и затирке": "Steam on tiles and grout", "Окна": "Windows",
        "Угловой диван": "Corner sofa", "Диван 2-3 места": "Sofa", "Кресло": "Armchair",
    },
    hu: {
        "Генеральная уборка": "A lakás nagytakarítása", "Стандартная уборка": "A lakás standard takarítása", "Регулярная уборка": "Rendszeres takarítás",
        "Духовка": "Sütő belül", "Холодильник изнутри": "Hűtő belül", "Вытяжка с фильтром": "Páraelszívó szűrővel",
        "Люстра": "Csillár", "Пар по плитке и затирке": "Gőz a csempén és a fugán", "Окна": "Ablakok",
        "Угловой диван": "Sarok kanapé", "Диван 2-3 места": "Kanapé", "Кресло": "Fotel",
    },
};
const UNITS: Record<string, Record<string, [
    string,
    string
]>> = {
    en: { "ч": ["hour", "hours"], "шт": ["", ""], "помещение": ["room", "rooms"], "створка": ["sash", "sashes"] },
    hu: { "ч": ["óra", "óra"], "шт": ["", ""], "помещение": ["helyiség", "helyiség"], "створка": ["szárny", "szárny"] },
    ru: { "ч": ["ч", "ч"], "шт": ["", ""], "помещение": ["помещение", "помещения"], "створка": ["створка", "створки"] },
};
const label = (text: string, language: string) => language === "ru" ? text : (LABELS[language]?.[text.split(",")[0]] ?? text);
export function quoteReply(lead: {
    name?: unknown;
    language?: unknown;
}, quote: QuoteResult, latestBody: string, previousOutgoing: string[] = []): {
    reply: string;
    calculation: string;
} | null {
    const flat = previousOutgoing.map((item) => String(item ?? "").toLowerCase()).join("\n");
    const missing = quote.missing.filter((item) => {
        const asked = String(item[replyLanguage(lead, latestBody) as keyof Localized] ?? "").toLowerCase().slice(0, 45);
        return asked.length < 15 || !flat.includes(asked);
    });
    if (!quote.lines.length && !missing.length && !quote.indicative.length)
        return null;
    const language = replyLanguage(lead, latestBody);
    const name = String(lead.name ?? "").trim().split(/\s+/)[0] ?? "";
    const parts: string[] = [];
    const head = language === "ru"
        ? `${name ? name + ", отвечаю" : "Отвечаю"} сразу, чтобы вы не ждали.`
        : language === "hu"
            ? `${name ? name + ", rögtön" : "Rögtön"} válaszolok, hogy ne kelljen várnia.`
            : `${name ? name + ", answering" : "Answering"} straight away so you're not left waiting.`;
    if (!quote.lines.length && quote.indicative.length) {
        parts.push(head, ...quote.indicative.map((item) => item[language as keyof Localized]));
    }
    if (quote.lines.length) {
        const rows = quote.lines.map((item) => {
            const forms = UNITS[language]?.[item.unit] ?? [item.unit, item.unit];
            const unit = item.units === 1 ? forms[0] : forms[1];
            const units = item.unit === "шт" && item.units === 1 ? "" : `${item.units}${unit ? " " + unit : ""}, `;
            return `${label(item.label, language)}: ${units}${money(item.total, language)} Ft`;
        });
        const totalLine = language === "ru"
            ? `Итого ${money(quote.total, language)} Ft${quote.vat ? " + ÁFA 27%" : ""}.`
            : language === "hu"
                ? `Összesen ${money(quote.total, language)} Ft${quote.vat ? " + ÁFA 27%" : ""}.`
                : `That comes to ${money(quote.total, language)} Ft${quote.vat ? " + 27% VAT" : ""}.`;
        parts.push(head, rows.join("\n"), totalLine);
        for (const note of quote.clientNotes)
            parts.push(note[language as keyof Localized]);
    }
    if (missing.length) {
        const rest = quote.lines.length > 0;
        const intro = language === "ru"
            ? (rest ? "Чтобы назвать точное число по остальному, мне не хватает вот этого:" : "Чтобы назвать точную сумму, подскажите:")
            : language === "hu"
                ? (rest ? "A többihez ennyi hiányzik, hogy pontos számot tudjak mondani:" : "A pontos összeghez ezt kérdezném:")
                : (rest ? "To put a firm number on the rest, this is what I still need:" : "To give you the exact total, one thing:");
        const asked = missing.slice(0, 2).map((item) => item[language as keyof Localized]);
        parts.push(`${intro}\n${asked.join("\n")}`);
    }
    if (quote.lines.length && !missing.length) {
        parts.push(language === "ru"
            ? "Какой день посмотреть первым?"
            : language === "hu"
                ? "Melyik napot nézzem meg először?"
                : "Which day should I look at first?");
    }
    if (!quote.lines.length)
        return { reply: parts.join("\n\n"), calculation: "" };
    const calculation = quote.lines.map((item) => `${item.label} ${item.units}x${item.each}`).join(" + ")
        + ` = ${quote.subtotal}${quote.total !== quote.subtotal ? ` -> ${quote.total} (minimum)` : ""}`;
    return { reply: parts.join("\n\n"), calculation };
}
