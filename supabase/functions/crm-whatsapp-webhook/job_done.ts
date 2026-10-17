const PAY_RE = /wise\.com\/pay|revolut\.me\/|revolut\.com\/pay|paypal\.me\/|\bIBAN\b|számlaszám|szamlaszam|реквизит|перевод(?:ом)? на (?:карту|револют|revolut)/iu;
export function jobDoneInChat(outgoingBodies: unknown[]): boolean {
    return outgoingBodies.some((b) => PAY_RE.test(String(b ?? "")));
}
