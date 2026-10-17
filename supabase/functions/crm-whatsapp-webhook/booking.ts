export type BookingDraft = {
    ready?: unknown;
    blockers?: unknown;
    price_huf?: unknown;
    hours?: unknown;
    date?: unknown;
    time?: unknown;
    when_text?: unknown;
    address?: unknown;
    service?: unknown;
    work_ru?: unknown;
    brief_ru?: unknown;
    day_options?: unknown;
    time_options?: unknown;
    access_ru?: unknown;
};
export function bookingChoices(draft: BookingDraft, now = new Date()): {
    date: string;
    time: string;
}[] {
    const days = (Array.isArray(draft.day_options) ? draft.day_options : []).map(String)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .filter((d) => new Date(`${d}T23:59:00Z`).getTime() > now.getTime());
    const times = (Array.isArray(draft.time_options) ? draft.time_options : []).map(String)
        .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
    const hours = times.length ? times : String(draft.time ?? "").match(/^([01]\d|2[0-3]):[0-5]\d$/) ? [String(draft.time)] : [];
    const out: {
        date: string;
        time: string;
    }[] = [];
    for (const date of [...new Set(days)].slice(0, 3)) {
        for (const time of [...new Set(hours)].slice(0, 3))
            out.push({ date, time });
    }
    return out.slice(0, 6);
}
export type ChatMessage = {
    direction: string;
    body: string;
    sent_at: string;
};
export function pricesIn(text: string): number[] {
    const found: number[] = [];
    const value = String(text ?? "");
    for (const m of value.matchAll(/(?<![\d])(\d{1,3}(?:[ ., ]\d{3})+|\d{4,7})(?![\d])/gu)) {
        found.push(Number(m[1].replace(/[ ., ]/gu, "")));
    }
    for (const m of value.matchAll(/(?<![\d.,])(\d{1,3}(?:[.,]\d)?)\s*(?:k|к|ezer|тыс)(?![\p{L}])/giu)) {
        found.push(Math.round(Number(m[1].replace(",", ".")) * 1000));
    }
    return found.filter((n) => n >= 3000 && n <= 3000000);
}
function budapestToUtc(date: string, time: string): Date | null {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const t = /^(\d{2}):(\d{2})$/.exec(time);
    if (!d || !t)
        return null;
    const guess = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]));
    const local = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Budapest" }));
    const utcView = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(guess.getTime() - (local.getTime() - utcView.getTime()));
}
export function bookingSlot(draft: BookingDraft): Date | null {
    return budapestToUtc(String(draft.date ?? ""), String(draft.time ?? ""));
}
export function masterForService(service: unknown): "Мария" | "Иван" | null {
    if (service === "cleaning")
        return "Мария";
    if (service === "upholstery" || service === "windows")
        return "Иван";
    return null;
}
export function bookingProblems(draft: BookingDraft, messages: ChatMessage[], now = new Date()): string[] {
    const problems: string[] = [];
    const blockers = Array.isArray(draft.blockers) ? draft.blockers.map(String).filter(Boolean) : [];
    if (draft.ready !== true || blockers.length) {
        problems.push(blockers.length ? blockers.join("; ") : "в переписке есть открытый момент");
    }
    const price = Math.round(Number(draft.price_huf ?? 0));
    const hours = Number(draft.hours ?? 0);
    const statesPrice = (body: string) => pricesIn(body).includes(price) ||
        (hours > 0 && pricesIn(body).some((rate) => rate * hours === price) &&
            new RegExp(`(?<![\\d])${hours}\\s*(?:hours?|h\\b|óra|час)`, "iu").test(body));
    const priceAt = price > 0
        ? messages.map((m, i) => (m.direction === "outgoing" && statesPrice(m.body) ? i : -1)).filter((i) => i >= 0).pop() ?? -1
        : -1;
    if (price <= 0)
        problems.push("цена не определена");
    else if (priceAt < 0)
        problems.push(`цена ${price} Ft не звучала в наших сообщениях`);
    else if (!messages.slice(priceAt + 1).some((m) => m.direction === "incoming"))
        problems.push("клиент не ответил после цены");
    const slot = bookingSlot(draft);
    const hour = Number(String(draft.time ?? "").slice(0, 2));
    if (!slot)
        problems.push("нет точной даты и времени");
    else if (slot.getTime() < now.getTime() + 2 * 3600 * 1000)
        problems.push("дата уже прошла или слишком близко");
    else if (slot.getTime() > now.getTime() + 120 * 86400 * 1000)
        problems.push("дата дальше четырёх месяцев");
    else if (hour < 7 || hour > 19)
        problems.push("время вне рабочего дня");
    const address = String(draft.address ?? "").trim();
    if (address.length < 8 || !/\d/.test(address))
        problems.push("адрес неполный");
    if (!masterForService(draft.service))
        problems.push("смешанный или непонятный вид работ, мастеров распределяешь ты");
    const last = messages[messages.length - 1];
    if (last?.direction === "incoming" && last.body.includes("?"))
        problems.push("последний вопрос клиента без ответа");
    return problems;
}
export function worthChecking(messages: ChatMessage[]): boolean {
    const priceAt = messages.map((m, i) => (m.direction === "outgoing" && pricesIn(m.body).length ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    return priceAt >= 0 && messages.slice(priceAt + 1).some((m) => m.direction === "incoming");
}
