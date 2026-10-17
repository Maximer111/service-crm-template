const DECLINE_RE = new RegExp([
    String.raw `\bclose (?:the|my|this|our)? ?(?:request|enquiry|inquiry|ticket)\b`,
    String.raw `\b(?:no longer|not)\s+(?:needed|necessary|required|relevant|interested)\b`,
    String.raw `\b(?:do|does|did)\s*n[o']?t\s+need\b`,
    String.raw `\bno longer need\b`,
    String.raw `\bnot (?:needed|relevant) any ?more\b`,
    String.raw `\bnot interested\b`,
    String.raw `\b(?:found|hired|booked|chose|went with) (?:someone|somebody|another|a different|other)\b`,
    String.raw `\b(?:already|got it) (?:cleaned|done|sorted)\b`,
    String.raw `\bwithout (?:the |a )?(?:deep )?clean(?:ing)?\b`,
    String.raw `\bno need (?:any ?more|for (?:it|this|the (?:service|cleaning)))\b`,
    String.raw `\b(?:we|i)(?:'re|’re| are|'m|’m| am) (?:good|fine|all set|set|ok)\b(?! (?:for|with|to|on)\b)`,
    String.raw `\bno,? thanks?\b|\bno,? thank you\b`,
    String.raw `\bas i (?:said|told you|mentioned)\b`,
    String.raw `нет,? спасибо`,
    String.raw `^\s*(?:no|nope|нет|nem)\s*[.!]*\s*$`,
    String.raw `köszönöm,? (?:de )?nem`,
    String.raw `(?:уже )?не (?:нужн[оаы]?|актуальн[оаы]?|интересн[оаы]?|требуется)`,
    String.raw `неактуальн`,
    String.raw `неинтересн`,
    String.raw `закрыва(?:йте|ть)|закройте`,
    String.raw `нашли (?:другую|других|другого|кого-то)`,
    String.raw `передумал`,
    String.raw `nem (?:aktuális|kell|szükséges|érdekel)`,
    String.raw `már nem`,
    String.raw `lezárhat`,
    String.raw `találtunk (?:mást|valakit)`,
].join("|"), "iu");
const STILL_TALKING_RE = /\?|\b(?:but|however|instead|still (?:need|want|interested)|how much|price|quote|can you|could you)\b|(?:^|\s)(?:но|однако|вместо|сколько|можно ли)(?:\s|$|,)|\b(?:de|viszont|mennyi|helyett)\b/iu;
const AGREES_RE = /^\s*(?:yes|yeah|yep|sure|ok(?:ay)?|of course|да|ага|конечно|хорошо|ок|igen|persze|rendben|oké)\b/iu;
const DETAIL_RE = /\b(?:bring|supplies|vacuum|mop|equipment|wait|come)\b|привоз|принос|брать с собой|пылесос|швабр|инвентар|ждать|приезж|hoz(?:ni|zatok|d)|porszív|felmos|eszköz|várni|jöhet/iu;
export function declinesAfterFarewell(body: unknown): boolean {
    const text = String(body ?? "").replace(/\s+/gu, " ").trim();
    if (!text)
        return false;
    if (STILL_TALKING_RE.test(text) || AGREES_RE.test(text) || DETAIL_RE.test(text))
        return false;
    return DECLINE_RE.test(text);
}
export const LATER_RE = /\b(?:later|not (?:right )?now|maybe (?:later|next)|next (?:week|month|year)|when (?:i|we) (?:have|get|am|are|'m|'re)\b[^.!?]{0,30}|i'll (?:write|let you know|get back|contact|reach out|text)|i will (?:write|let you know|get back|contact|reach out)|get back to you|let you know)\b|позже|не сейчас|потом напишу|когда буд[уе]\s*готов|когда (?:будет|появится) (?:время|возможность)|сообщу|напишу (?:вам )?(?:позже|сам|сама|когда)|свяжусь|в следующ(?:ем|ий) (?:месяц|раз)|majd (?:írok|jelentkez|szólok)|később|jelentkezem|szólok/iu;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\s]+$/u;
const BARE_RE = /^(?:thanks?|thank you|thx|ok(?:ay)?|sure|noted|got it|спасибо(?: большое)?|благодарю|хорошо|понятно|понял[аи]?|ок|ладно|köszönöm|köszi|rendben|oké)$/iu;
const INTENT_RE = /\b(?:how much|price|quote|can you|could you|come (?:on|tomorrow|next)|available)\b|сколько|можно ли|когда (?:можете|сможете|приедете)|mennyi|mikor tud|ráér/iu;
export type FarewellReply = "decline" | "later" | "ack" | "talk";
export function farewellReplyKind(body: unknown): FarewellReply {
    const text = String(body ?? "").replace(/\s+/gu, " ").trim();
    if (!text || EMOJI_ONLY_RE.test(text))
        return "ack";
    if (declinesAfterFarewell(text))
        return "decline";
    const core = text.replace(/[.!,;:)\s]+$/u, "").replace(/^[\s(]+/u, "");
    if (BARE_RE.test(core))
        return "ack";
    if (/\?/.test(text) || /\d/.test(text) || INTENT_RE.test(text) || DETAIL_RE.test(text))
        return "talk";
    if (LATER_RE.test(text))
        return "later";
    return "talk";
}
