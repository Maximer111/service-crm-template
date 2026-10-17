export function withinBotHours(spec: unknown, now = new Date(), timeZone = "Asia/Manila"): boolean {
    const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(spec ?? ""));
    if (!m)
        return true;
    const [from, to] = [Number(m[1]) % 24, Number(m[2]) % 24];
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now)) % 24;
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}
type Msg = {
    direction: string;
    body: string;
    sent_at: string;
};
export function waitingClient(messages: Msg[], now = new Date(), isAck: (text: string) => boolean = () => false): {
    since: string;
    text: string;
} | null {
    const lastOut = messages.map((m, i) => (m.direction === "outgoing" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const waiting = messages.slice(lastOut + 1).filter((m) => m.direction === "incoming");
    if (!waiting.length)
        return null;
    const age = now.getTime() - new Date(waiting[waiting.length - 1].sent_at).getTime();
    if (age < 10 * 60 * 1000 || age > 24 * 60 * 60 * 1000)
        return null;
    if (waiting.every((m) => m.body.trim() && isAck(m.body)))
        return null;
    return { since: waiting[0].sent_at, text: waiting.map((m) => m.body || "[медиа]").join("\n") };
}
export function replyDelayMinutes(spec: string | undefined, fallbackMinutes: number, now = new Date()): number | null {
    if (withinBotHours(spec, now))
        return 0;
    return fallbackMinutes > 0 ? fallbackMinutes : null;
}
