export function proactiveFollowupProblems(value: unknown): string[] {
    const text = String(value ?? "").trim();
    const problems: string[] = [];
    if (/\b(?:not a chase|still weighing it|just circling back|gentle reminder)\b/iu.test(text))
        problems.push("mechanical follow-up phrase");
    if (/\b(?:fill(?:s|ing)? up first|slots? (?:are )?filling|last chance|act now)\b/iu.test(text))
        problems.push("unverified pressure or scarcity");
    if (text.length > 420)
        problems.push("too long for a personal follow-up");
    if ((text.match(/\n\s*\n/gu) ?? []).length > 1)
        problems.push("too many paragraphs");
    return problems;
}
