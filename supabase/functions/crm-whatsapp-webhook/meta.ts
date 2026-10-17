export type AnyMap = Record<string, any>;
export type MetaMessage = {
    accountId: string;
    externalId: string;
    phone: string;
    direction: "incoming" | "outgoing";
    type: string;
    body: string;
    timestamp: unknown;
    contactName: string;
    history: boolean;
};
const marker = (type: string) => type === "text" ? "" : `[${type || "unknown"}]`;
function content(message: AnyMap): {
    type: string;
    body: string;
} {
    const type = String(message.type ?? (message.text ? "text" : "unknown")).toLowerCase();
    if (type === "text")
        return { type, body: String(message.text?.body ?? message.body ?? "") };
    const media = message[type] ?? {};
    const caption = String(media.caption ?? message.caption ?? "").trim();
    return { type, body: caption ? `${marker(type)} ${caption}` : marker(type) };
}
function candidate(message: AnyMap, accountId: string, direction: "incoming" | "outgoing", history: boolean, names: Map<string, string>): MetaMessage | null {
    const externalId = String(message.id ?? message.message_id ?? message.key?.id ?? "");
    const phone = String(direction === "incoming"
        ? (message.from ?? message.sender_id ?? message.key?.remoteJid ?? "")
        : (message.to ?? message.recipient_id ?? message.key?.remoteJid ?? ""));
    if (!externalId || !phone)
        return null;
    const parsed = content(message.message ?? message);
    return {
        accountId,
        externalId,
        phone,
        direction,
        type: parsed.type,
        body: parsed.body,
        timestamp: message.timestamp ?? message.message_timestamp ?? message.sent_at,
        contactName: names.get(phone.replace(/\D/g, "")) ?? String(message.profile?.name ?? ""),
        history,
    };
}
function collectHistory(node: unknown, accountId: string, names: Map<string, string>, out: MetaMessage[]) {
    if (!node || typeof node !== "object")
        return;
    if (Array.isArray(node)) {
        for (const item of node)
            collectHistory(item, accountId, names, out);
        return;
    }
    const value = node as AnyMap;
    if (Array.isArray(value.messages)) {
        for (const message of value.messages) {
            const fromMe = Boolean(message.from_me ?? message.fromMe ?? message.key?.fromMe);
            const parsed = candidate(message, accountId, fromMe ? "outgoing" : "incoming", true, names);
            if (parsed)
                out.push(parsed);
        }
    }
    for (const [key, child] of Object.entries(value)) {
        if (key !== "messages")
            collectHistory(child, accountId, names, out);
    }
}
export function metaMessages(payload: AnyMap): MetaMessage[] {
    if (payload.object !== "whatsapp_business_account")
        return [];
    const out: MetaMessage[] = [];
    for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
            const value = change.value ?? {};
            const accountId = String(value.metadata?.phone_number_id ?? entry.id ?? "");
            const names = new Map<string, string>();
            for (const contact of value.contacts ?? []) {
                names.set(String(contact.wa_id ?? "").replace(/\D/g, ""), String(contact.profile?.name ?? ""));
            }
            for (const message of value.messages ?? []) {
                const parsed = candidate(message, accountId, "incoming", false, names);
                if (parsed)
                    out.push(parsed);
            }
            for (const echo of [...(value.smb_message_echoes ?? []), ...(value.message_echoes ?? [])]) {
                const parsed = candidate(echo, accountId, "outgoing", false, names);
                if (parsed)
                    out.push(parsed);
            }
            if (value.history)
                collectHistory(value.history, accountId, names, out);
        }
    }
    const seen = new Set<string>();
    return out.filter((message) => {
        const key = `${message.accountId}\u0000${message.externalId}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
