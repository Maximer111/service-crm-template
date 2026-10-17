export function clientWords(body: unknown, messageType: unknown = ""): string {
    if (String(messageType ?? "") === "image")
        return "";
    const text = String(body ?? "");
    return /^\s*\[photo analysis\]/i.test(text) ? "" : text;
}
