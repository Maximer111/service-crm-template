export type ChatMessage = {
    direction: string;
    body: string;
    sent_at: string;
};
const firstName = (value: unknown, phone: unknown = "") => {
    const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 2 && /^\+?36/.test(String(phone ?? "").replace(/\s/g, "")))
        return "";
    return parts[0] ?? "";
};
export function otherCity(lead: {
    name?: unknown;
    campaign?: unknown;
    address?: unknown;
}): boolean {
    const haystack = [lead.name, lead.campaign, lead.address].map((x) => String(x ?? "")).join(" ");
    return /toronto|orlando|торонто|орландо/iu.test(haystack);
}
export function reviewAskText(lead: {
    name?: unknown;
    language?: unknown;
    phone?: unknown;
}, url: string): string {
    const first = firstName(lead.name, lead.phone);
    const lang = String(lead.language ?? "en");
    if (lang === "ru") {
        return `Очень рад, что всё понравилось${first ? ", " + first : ""}! 🙏 Если не сложно, оставьте короткий отзыв в Google, для нашей небольшой команды это правда много значит: ${url}`;
    }
    if (lang === "hu") {
        return `Nagyon örülök, hogy minden rendben volt${first ? ", " + first : ""}! 🙏 Ha nem okoz gondot, írna egy rövid Google értékelést? A kis csapatunknak sokat jelent: ${url}`;
    }
    return `So glad everything turned out well${first ? ", " + first : ""}! 🙏 If it's not too much trouble, a short Google review would mean a lot to our small team: ${url}`;
}
export function alreadyAsked(messages: ChatMessage[], url: string): boolean {
    const mark = /g\.page|maps\.app|search\.google|\/review/iu;
    return messages.some((m) => m.direction === "outgoing" && (mark.test(m.body) || (!!url && m.body.includes(url))));
}
export function worthAskingReview(messages: ChatMessage[], now = new Date()): boolean {
    const lastInbound = messages.map((m, i) => (m.direction === "incoming" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    if (lastInbound < 0)
        return false;
    const client = messages[lastInbound];
    const age = now.getTime() - new Date(client.sent_at).getTime();
    if (!(age >= 0 && age < 3 * 3600 * 1000))
        return false;
    if (client.body.includes("?"))
        return false;
    if (messages.length - lastInbound > 2)
        return false;
    return messages.slice(0, lastInbound).some((m) => m.direction === "outgoing");
}
const MONTHS: Record<string, string[]> = {
    ru: ["в январе", "в феврале", "в марте", "в апреле", "в мае", "в июне", "в июле", "в августе", "в сентябре", "в октябре", "в ноябре", "в декабре"],
    en: ["in January", "in February", "in March", "in April", "in May", "in June", "in July", "in August", "in September", "in October", "in November", "in December"],
    hu: ["januárban", "februárban", "márciusban", "áprilisban", "májusban", "júniusban", "júliusban", "augusztusban", "szeptemberben", "októberben", "novemberben", "decemberben"],
};
export function feedbackAskText(lead: {
    name?: unknown;
    language?: unknown;
    phone?: unknown;
}, jobDate: string): string {
    const first = firstName(lead.name, lead.phone);
    const lang = String(lead.language ?? "en");
    const month = MONTHS[lang in MONTHS ? lang : "en"][Math.max(0, Math.min(11, Number(jobDate.slice(5, 7)) - 1))];
    if (lang === "ru") {
        return `${first ? first + ", з" : "З"}дравствуйте! Это Алекс из CLB Cleaning, мы убирали у вас ${month}. Скажите, как всё прошло, всё понравилось?`;
    }
    if (lang === "hu") {
        return `${first ? first + ", ü" : "Ü"}dvözlöm! Alex vagyok a CLB Cleaningtől, ${month} takarítottunk Önöknél. Mondja, hogy sikerült, elégedett volt?`;
    }
    return `Hi${first ? " " + first : ""}, it's Alex from CLB Cleaning. We cleaned your place ${month}. How did it go, were you happy with it?`;
}
