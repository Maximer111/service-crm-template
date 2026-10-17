export function needsGloss(text: unknown): boolean {
    const value = String(text ?? "").trim();
    if (!value)
        return false;
    if (/[а-яё]/iu.test(value))
        return false;
    if (/[őűáéíóöü]/iu.test(value))
        return true;
    return !/\b(?:the|and|is|are|you|your|for|with|that|this|will|can|i|me|my|it|to|of)\b/iu.test(value);
}
