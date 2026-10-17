type AnyMap = Record<string, any>;
export type InboxEvent = {
    channel: "instagram" | "messenger";
    accountId: string;
    contactId: string;
    direction: "incoming" | "outgoing";
    mid: string;
    text: string;
    sentAt: string;
    referral: AnyMap | null;
};
export function messageText(msg: AnyMap): string {
    const text = String(msg?.text ?? "").trim();
    const atts = (msg?.attachments ?? []) as AnyMap[];
    if (text && !atts.length)
        return text;
    const marks = atts.map((a) => {
        const t = String(a?.type ?? "файл");
        const link = String(a?.payload?.url ?? "");
        const label = t === "image" ? "фото" : t === "video" ? "видео" : t === "audio" ? "голосовое" : t === "share" ? "репост" : t;
        return link ? `[${label}] ${link}` : `[${label}]`;
    });
    return [text, ...marks].filter(Boolean).join("\n");
}
export function parseEvent(object: string, entryId: string, ev: AnyMap): InboxEvent | null {
    const msg = ev?.message;
    if (!msg || !msg.mid)
        return null;
    const echo = Boolean(msg.is_echo);
    const contactId = String((echo ? ev.recipient?.id : ev.sender?.id) ?? "");
    if (!contactId || contactId === entryId)
        return null;
    const text = messageText(msg);
    if (!text)
        return null;
    return {
        channel: object === "instagram" ? "instagram" : "messenger",
        accountId: entryId,
        contactId,
        direction: echo ? "outgoing" : "incoming",
        mid: String(msg.mid),
        text,
        sentAt: new Date(Number(ev.timestamp) || Date.now()).toISOString(),
        referral: msg.referral ?? ev.referral ?? null,
    };
}
export function participantName(conversations: AnyMap, contactId: string): {
    name: string;
    username: string;
} {
    for (const c of (conversations?.data ?? []) as AnyMap[]) {
        for (const p of (c?.participants?.data ?? []) as AnyMap[]) {
            if (String(p?.id ?? "") === contactId)
                return { name: String(p.name ?? ""), username: String(p.username ?? "") };
        }
    }
    return { name: "", username: "" };
}
