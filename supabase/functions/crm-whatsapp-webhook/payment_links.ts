type PaymentConfig = Record<string, string>;
type PaymentMethod = "wise" | "revolut" | "both";
function requestedMethod(body: unknown): PaymentMethod | "" {
    const text = String(body ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!text)
        return "";
    const wise = /\bwise\b/iu.test(text);
    const revolut = /\brevolut\b/iu.test(text);
    if (wise && revolut)
        return "both";
    if (wise)
        return "wise";
    if (revolut)
        return "revolut";
    if (/\b(?:payment|pay)\s+(?:link|details)\b|\b(?:how|where)\s+(?:can|do)\s+i\s+pay\b|\bsend\s+(?:me\s+)?(?:the\s+)?payment\b|(?:ссылк[^\s]*\s+(?:для\s+)?оплат|как\s+(?:можно\s+)?оплатить|куда\s+оплатить|реквизит)|(?:fizetési\s+link|hogyan\s+(?:tudok\s+)?fizetni|hová\s+fizessek)/iu.test(text)) {
        return "both";
    }
    return "";
}
function languageOf(body: unknown, language: unknown): "ru" | "hu" | "en" {
    const configured = String(language ?? "").toLowerCase();
    if (configured.startsWith("ru"))
        return "ru";
    if (configured.startsWith("hu"))
        return "hu";
    const text = String(body ?? "");
    if (/[а-яё]/iu.test(text))
        return "ru";
    if (/[áéíóöőúüű]/iu.test(text))
        return "hu";
    return "en";
}
export function paymentLinkReply(cfg: PaymentConfig, body: unknown, language: unknown): string {
    const method = requestedMethod(body);
    if (!method)
        return "";
    const wise = String(cfg.payment_wise_url ?? "").trim();
    const revolut = String(cfg.payment_revolut_url ?? "").trim();
    const lines: string[] = [];
    if ((method === "wise" || method === "both") && wise)
        lines.push(`Wise: ${wise}`);
    if ((method === "revolut" || method === "both") && revolut)
        lines.push(`Revolut: ${revolut}`);
    if (!lines.length)
        return "";
    const languageCode = languageOf(body, language);
    if (languageCode === "ru")
        return `Конечно 🙂 Оплата после работы, в тот же день. Когда закончим, можно перевести сюда${lines.length > 1 ? ", как вам удобнее" : ""}:\n\n${lines.join("\n")}\n\nНапишите, когда отправите, и я отмечу платёж в заказе.`;
    if (languageCode === "hu")
        return `Persze 🙂 A fizetés a munka után van, aznap. Amikor elkészültünk, ide tudsz utalni${lines.length > 1 ? ", amelyik kényelmesebb" : ""}:\n\n${lines.join("\n")}\n\nÍrj, amikor elküldted, és rögzítem a megrendelésnél.`;
    return `Of course 🙂 Payment is after the work, on the same day. Once the job is done you can send it here${lines.length > 1 ? ", whichever is easier for you" : ""}:\n\n${lines.join("\n")}\n\nJust tell me when it's sent and I'll mark it on your order.`;
}
