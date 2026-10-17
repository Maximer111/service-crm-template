const normalize = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
export function looksRepeated(text: unknown, previous: unknown[], threshold = 0.6): boolean {
    const words = new Set(normalize(text).split(" ").filter((w) => w.length > 3));
    if (words.size < 4)
        return false;
    return previous.some((earlier) => {
        const other = new Set(normalize(earlier).split(" ").filter((w) => w.length > 3));
        if (other.size < 4)
            return false;
        let shared = 0;
        for (const word of words)
            if (other.has(word))
                shared++;
        return shared / Math.min(words.size, other.size) >= threshold;
    });
}
export function shouldSuppressRepeat(text: unknown, previousOutgoing: unknown[], clientSpokeSince: boolean): boolean {
    const exact = normalize(text);
    if (exact && previousOutgoing.some((earlier) => normalize(earlier) === exact))
        return true;
    if (clientSpokeSince)
        return false;
    return looksRepeated(text, previousOutgoing);
}
const ACK_WORDS = new Set([
    "ok", "okay", "okey", "oki", "alright", "sure", "thanks", "thank", "you", "thx", "ty", "very", "much", "so", "a", "lot",
    "got", "it", "noted", "perfect", "great", "super", "cool", "fine", "good", "wonderful", "appreciate", "i", "really",
    "спасибо", "большое", "огромное", "благодарю", "понял", "поняла", "поняли", "хорошо", "ок", "ладно", "отлично", "супер", "окей",
    "köszönöm", "köszi", "szépen", "nagyon", "rendben", "oké", "merci", "danke", "gracias", "grazie",
]);
export function isBareAcknowledgement(text: unknown): boolean {
    const words = normalize(text).replace(/\bno (?:problem|worries)\b|\bне за что\b|\bбез проблем\b/gu, " ").split(" ").filter(Boolean);
    if (!words.length || words.length > 8)
        return false;
    if (String(text ?? "").includes("?"))
        return false;
    return words.every((w) => ACK_WORDS.has(w));
}
const WRITE_BACK = /(?<![\p{L}])(?:отпишусь|напишу (?:позже|попозже|вечером|завтра|вам)|отвечу (?:позже|вечером|завтра)|обсужу с|посоветуюсь|подумаю|дам знать|сообщу)(?![\p{L}])|\b(?:I'?ll (?:let you know|get back|write|text|message|come back|think)|let me (?:think|check with|discuss|talk to)|will get back)\b|(?<![\p{L}])(?:visszaírok|jelentkezem|szólok|megbeszélem)(?![\p{L}])/iu;
export function promisesToWriteBack(text: unknown): boolean {
    const value = String(text ?? "");
    return !value.includes("?") && WRITE_BACK.test(value);
}
