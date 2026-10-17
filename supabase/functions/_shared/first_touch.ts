export const SVC_RU: Record<string, string> = { upholstery: "химчистку мебели", windows: "мойку окон", deep: "генеральную уборку", regular: "регулярную уборку", cleaning: "уборку" };
export const SVC_EN: Record<string, string> = { upholstery: "upholstery cleaning", windows: "window cleaning", deep: "deep cleaning", regular: "regular cleaning", cleaning: "cleaning" };
const TR_RU: [
    string,
    string
][] = [["shch", "щ"], ["sch", "щ"], ["zh", "ж"], ["kh", "х"], ["ts", "ц"], ["ch", "ч"], ["sh", "ш"], ["yu", "ю"], ["ya", "я"], ["yo", "ё"], ["ye", "е"], ["ia", "ия"], ["iy", "ий"], ["ay", "ай"], ["ey", "ей"], ["oy", "ой"], ["uy", "уй"], ["a", "а"], ["b", "б"], ["c", "к"], ["d", "д"], ["e", "е"], ["f", "ф"], ["g", "г"], ["h", "х"], ["i", "и"], ["j", "й"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["q", "к"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["v", "в"], ["w", "в"], ["x", "кс"], ["y", "ы"], ["z", "з"]];
const NAME_RU: Record<string, string> = { ludmila: "Людмила", liudmila: "Людмила", lyudmila: "Людмила", alexander: "Александр", aleksandr: "Александр", alexey: "Алексей", aleksey: "Алексей", sergey: "Сергей", dmitry: "Дмитрий", dmitriy: "Дмитрий", evgeny: "Евгений", andrey: "Андрей", nikolay: "Николай", ekaterina: "Екатерина", tatiana: "Татьяна", tatyana: "Татьяна", natalia: "Наталия", nataliya: "Наталия", olga: "Ольга", igor: "Игорь", mikhail: "Михаил" };
export function ruName(name: unknown, ru: boolean): string {
    const first = String(name ?? "").trim().split(/\s+/)[0] || "";
    if (!ru || !first || /[а-яё]/i.test(first))
        return first;
    if (!/^[a-z'-]+$/i.test(first))
        return first;
    const dict = NAME_RU[first.toLowerCase()];
    if (dict)
        return dict;
    let s = first.toLowerCase(), out = "";
    outer: while (s.length) {
        for (const [lat, cyr] of TR_RU) {
            if (s.startsWith(lat)) {
                out += cyr;
                s = s.slice(lat.length);
                continue outer;
            }
        }
        out += s[0];
        s = s.slice(1);
    }
    return out.charAt(0).toUpperCase() + out.slice(1);
}
export function waDigits(phone: unknown): string {
    let d = String(phone ?? "").replace(/[^0-9]/g, "");
    if (!d)
        return "";
    if (d.startsWith("06"))
        d = "36" + d.slice(2);
    else if (d.length === 9)
        d = "36" + d;
    return d.length >= 10 ? d : "";
}
export function leadDetails(l: Record<string, unknown>, ru: boolean, svc: string) {
    const answers = (l.answers ?? {}) as Record<string, unknown>;
    const clean = (v: unknown) => String(v ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
    const isCyr = (v: string) => /[а-яё]/i.test(v);
    const skipKey = /бюдж|budget|связ|contact|подар|gift|когда|when|врем|time|имя|name|phone|телеф|email|почт|площад|area|size|м²|m2/i;
    const skipVal = /^(да|нет|yes|no|ничего не нужно|nothing|none|не\s?важно|неважно|не\s?нужно|не\s?знаю|без\s?разницы|всё\s?равно|все\s?равно|любой|любое|any|not important|doesn.?t matter)/i;
    const wantKey = /что\s*чист|что\s*убир|что\s*необходимо|что\s*нужно|что\s*сделать|вид\s*убор|объект|услуг|what|service|clean|item/i;
    const pickAnswers = (want: boolean) => Object.entries(answers)
        .filter(([k]) => want ? wantKey.test(k) : !skipKey.test(k))
        .map(([, v]) => clean(v))
        .filter((v) => v && !skipVal.test(v) && v.length < 60)
        .filter((v) => ru ? true : !isCyr(v));
    const fromAnswers = pickAnswers(true).length ? pickAnswers(true) : pickAnswers(false);
    const rawWhat = clean(l.what_to_clean);
    const siteText = rawWhat.includes(" ") ? rawWhat : "";
    let what = "";
    if (siteText && (ru || !isCyr(siteText)))
        what = siteText;
    else if (fromAnswers.length)
        what = [...new Set(fromAnswers)].filter((v) => v !== clean(l.area)).join(", ");
    else if (rawWhat && (ru || !isCyr(rawWhat)))
        what = rawWhat;
    const findAnswer = (re: RegExp) => {
        const hit = Object.entries(answers).find(([k]) => re.test(k));
        return hit ? clean(hit[1]) : "";
    };
    const rawArea = clean(l.area);
    const areaA = findAnswer(/площад|area|size|м²|m2/i);
    const area = ru ? (isCyr(areaA) ? areaA : (isCyr(rawArea) ? rawArea : areaA || rawArea))
        : (!isCyr(rawArea) ? rawArea : (!isCyr(areaA) ? areaA : ""));
    const rawWhen = clean(l.when_text);
    const whenA = findAnswer(/когда|when|врем|time|дата|date/i);
    const when = ru ? (isCyr(rawWhen) ? rawWhen : (isCyr(whenA) ? whenA : rawWhen || whenA))
        : (!isCyr(rawWhen) ? rawWhen : (!isCyr(whenA) ? whenA : ""));
    const hasDate = /\d{1,2}[.\-/]\d{1,2}|\d{1,2}\s*(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(when);
    let short = (what || svc).split(",")[0].trim().slice(0, 60);
    if (ru && /^(генеральн|регулярн|поддерживающ|глубок|разов)/i.test(short))
        short += " уборка";
    return { what: what.slice(0, 220), area, when, hasDate, short };
}
const BRANCHES: [
    RegExp,
    string
][] = [
    [/toronto|торонто/i, "Toronto"],
    [/orlando|орландо/i, "Orlando"],
    [/budapest|будапешт/i, "Budapest"],
];
export function brandName(l: Record<string, unknown>): string {
    const hay = `${l.campaign ?? ""} ${l.raw_text ?? ""} ${l.address ?? ""}`;
    for (const [re, city] of BRANCHES)
        if (re.test(hay))
            return `CLB Cleaning ${city}`;
    if (waDigits(l.phone).startsWith("36"))
        return "CLB Cleaning Budapest";
    if (l.source === "facebook" || l.source === "job_application")
        return "CLB Cleaning Budapest";
    return "CLB Cleaning";
}
export function firstTouchText(l: Record<string, unknown>): string {
    const ru = l.language === "ru";
    const first = ruName(l.name, ru);
    const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
    const hi = ru ? `${first ? first + ", здравствуйте" : "Здравствуйте"}!` : `Hi${first ? " " + first : ""}!`;
    const me = ru ? `Алекс из ${brandName(l)}` : `Alex here from ${brandName(l)}`;
    const d = leadDetails(l, ru, svc);
    const softText = `${d.what} ${l.what_to_clean ?? ""}`;
    const short = String(l.what_to_clean ?? d.what).length <= 60;
    const byItem = (re: RegExp) => short && re.test(softText);
    const svc0 = String(l.service ?? "");
    const saidSoft = /upholstery|carpet|химчист/i.test(svc0) || /химчистк|пароочист|отпарк|steam clean|upholstery|carpet clean/i.test(softText);
    const saidCleaning = /генералк|уборк|клининг|apartment|кварт|\d+\s*(м²|m²|m2)/i.test(softText);
    const kind = saidSoft ? "soft"
        : /^windows$/i.test(svc0) ? "windows"
            : saidCleaning ? ""
                : byItem(/диван|кресл|матрас|ковр|ковёр|ковер|пуф|sofa|couch|mattress|carpet|rug|armchair/i) ? "soft"
                    : byItem(/окн|окон|window/i) ? "windows"
                        : "";
    const addons = `${softText} ${l.extra_services ?? ""}`;
    const addSoft = kind === "" && /химчистк|диван|кресл|матрас|ковр|ковёр|ковер|upholstery|sofa|mattress|carpet/i.test(addons);
    const hasWindows = /окн|окон|window/i.test(addons);
    const areaPhrase = d.area ? (ru ? `, площадь ${d.area}` : `, ${d.area}`) : "";
    const timing = d.when ? (ru ? ` Вижу, что по срокам вы указали ${d.when}.` : ` I also saw that your preferred timing is ${d.when}.`) : "";
    const intro = kind === "soft"
        ? (ru ? `Вижу, вам нужна химчистка мебели.${timing}` : `I saw you're looking for upholstery cleaning.${timing}`)
        : kind === "windows"
            ? (ru ? `Вижу, вам нужна мойка окон.${timing}` : `I saw you're looking for window cleaning.${timing}`)
            : (ru
                ? `Вижу, вы ищете ${svc} квартиры${areaPhrase}.${hasWindows ? " Окна тоже учёл." : ""}${addSoft ? " Химчистку мебели тоже учёл." : ""}${timing}`
                : `I saw you're looking for ${svc} for the apartment${areaPhrase}.${hasWindows ? " I noted the windows too." : ""}${addSoft ? " I noted the furniture cleaning too." : ""}${timing}`);
    const questions = kind === "soft"
        ? (ru
            ? "Хочу понять состояние: мебель нужно просто освежить или есть конкретные пятна либо запах?"
            : "Just so I understand the condition, is it mainly a refresh, or are there particular stains or odours?")
        : kind === "windows"
            ? (ru
                ? "Это обычная сезонная мойка, уборка после ремонта или подготовка к переезду?"
                : "Is this regular seasonal cleaning, cleaning after renovation, or preparation for a move?")
            : (ru
                ? "Квартира сейчас жилая, после выезда или после ремонта?"
                : "Is the apartment currently lived in, after a move-out, or after renovation?");
    const photos = kind === "soft"
        ? (ru ? "Если сможете, пришлите несколько фото мебели целиком и крупным планом, сейчас или чуть позже, как вам удобно." : "If you can, send me a few full and close-up photos of the furniture whenever it's easy, now or later today is fine.")
        : kind === "windows"
            ? (ru ? "Если сможете, пришлите по одному общему фото каждого типа окна, сейчас или чуть позже, как вам удобно." : "If you can, send me one full photo of each type of window whenever it's easy, now or later today is fine.")
            : (ru
                ? `Если сможете, пришлите 3-5 фото квартиры${hasWindows ? " и по одному общему фото окон" : ""}${addSoft ? " плюс отдельные фото мебели" : ""}, сейчас или чуть позже, как вам удобно.`
                : `If you can, send me 3-5 photos of the apartment${hasWindows ? " and one full photo of the windows" : ""}${addSoft ? " plus separate photos of the furniture" : ""} whenever it's easy, now or later today is fine.`);
    return `${hi} ${me}. ${intro} ${questions} ${photos}`;
}
export function firstTouchWaUrl(l: Record<string, unknown>): string {
    const dg = waDigits(l.phone);
    if (!dg)
        return "";
    return `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(firstTouchText(l))}`;
}
export function giftName(gift: unknown, ru: boolean): string {
    const g = String(gift ?? "").toLowerCase();
    if (!g)
        return "";
    if (/fridge|refrigerator|холодильн/.test(g))
        return ru ? "бесплатная мойка холодильника внутри" : "the free fridge clean";
    if (/balcon|балкон/.test(g))
        return ru ? "бесплатная мойка балкона" : "the free balcony clean";
    if (/microwave|микровол|свч/.test(g))
        return ru ? "бесплатная мойка микроволновки" : "the free microwave clean";
    if (/oven|духовк/.test(g))
        return ru ? "бесплатная мойка духовки внутри" : "the free oven clean";
    if (/voucher|ваучер|скид/.test(g))
        return ru ? "ваша скидка по ваучеру" : "your voucher discount";
    return "";
}
export function closingText(l: Record<string, unknown>, kind: "junk" | "lost"): string {
    const ru = l.language === "ru";
    const first = ruName(l.name, ru);
    const svc = ru ? (SVC_RU[l.service as string] || "уборку") : (SVC_EN[l.service as string] || "cleaning");
    const hi = ru ? `Здравствуйте${first ? ", " + first : ""}!` : `Hi${first ? " " + first : ""}!`;
    const me = ru ? `Алекс из ${brandName(l)}` : `Alex here from ${brandName(l)}`;
    const gift = giftName(l.gift, ru);
    const giftRu = gift ? ` ${gift.charAt(0).toUpperCase()}${gift.slice(1)} закреплена за вами до конца дня.` : "";
    const giftEn = gift ? ` ${gift.charAt(0).toUpperCase()}${gift.slice(1)} is held for you until tonight.` : "";
    if (kind === "junk") {
        return ru
            ? `${hi} ${me}. Вы оставляли заявку на ${svc}. Я писал пару раз, но ответа не получил, поэтому закрываю заявку, чтобы не беспокоить вас дальше.${giftRu}\n\nЕсли всё ещё актуально, напишите сегодня, и я верну её в работу.`
            : `${hi} ${me}. You asked us about ${svc}. I wrote a couple of times and did not hear back, so I am closing the request rather than keep messaging you.${giftEn}\n\nIf it is still relevant, just write here and I will bring it back.`;
    }
    return ru
        ? `${hi} ${me}. Понял, что сейчас ${svc} вам не подошла, спасибо, что ответили. Заявку закрываю.\n\nЕсли что-то изменится, напишите прямо сюда: историю сохранил, объяснять заново не придётся. Хорошего дня!`
        : `${hi} ${me}. Understood, ${svc} is not the right fit this time, and thank you for telling me. I am closing your request.\n\nIf anything changes, just write in this chat: I kept your details, so you will not have to explain anything twice. Have a good one!`;
}
export function reofferText(l: Record<string, unknown>): string {
    const ru = l.language === "ru";
    const first = ruName(l.name, ru);
    const svcKey = String(l.service ?? "");
    const svc = ru ? (SVC_RU[svcKey] || "уборку") : (SVC_EN[svcKey] || "cleaning");
    const hi = ru ? `Здравствуйте${first ? ", " + first : ""}!` : `Hi${first ? " " + first : ""}!`;
    const me = ru ? `Алекс из ${brandName(l)}` : `Alex here from ${brandName(l)}`;
    const why = svcKey === "windows"
        ? (ru ? "Сейчас хорошее время помыть окна до холодов, и в октябре у нас есть свободные даты."
            : "Autumn is a good time to get the windows done before the cold, and we still have free dates in October.")
        : svcKey === "upholstery"
            ? (ru ? "Перед зимой, пока окна можно держать открытыми и мебель быстро сохнет, самое удобное время для химчистки. В октябре есть свободные даты."
                : "Before winter, while windows can stay open and furniture dries quickly, is the easiest time for it. We have free dates in October.")
            : (ru ? "Сейчас набираем график на октябрь и ноябрь, и если уборка ещё в планах, подберу вам удобный день."
                : "We are filling the schedule for October and November, so if it is still on your list, I can find a day that suits you.");
    return ru
        ? `${hi} ${me}. Вы оставляли у нас заявку на ${svc}. ${why} Если забронируете до конца октября, сделаю скидку 10%.\n\nПодобрать вам день? Если уже неактуально, просто ответьте «нет», и я закрою заявку.`
        : `${hi} ${me}. You asked us about ${svc} a while ago. ${why} If you book by the end of October, I will take 10% off.\n\nShall I find a day for you? If it is no longer relevant, just reply "no" and I will close the request.`;
}
export function waButtonUrl(phone: unknown, text: string): string {
    const d = waDigits(phone);
    if (!d)
        return "";
    const full = `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
    return full.length <= 2000 ? full : `https://wa.me/${d}`;
}
