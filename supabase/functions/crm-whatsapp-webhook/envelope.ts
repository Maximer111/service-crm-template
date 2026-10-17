type AnyMap = Record<string, any>;
export function unwrapMessage(message: AnyMap): AnyMap {
    let current: AnyMap = message ?? {};
    for (let depth = 0; depth < 6; depth++) {
        const next = current.editedMessage?.message
            ?? current.protocolMessage?.editedMessage
            ?? current.ephemeralMessage?.message
            ?? current.viewOnceMessage?.message
            ?? current.viewOnceMessageV2?.message
            ?? current.viewOnceMessageV2Extension?.message
            ?? current.documentWithCaptionMessage?.message
            ?? null;
        if (!next || typeof next !== "object")
            return current;
        current = next;
    }
    return current;
}
