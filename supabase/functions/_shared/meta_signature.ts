export async function validMetaSignature(secret: string, rawBody: string, signature: string | null): Promise<boolean> {
    if (!secret || secret === "CHANGE_ME" || !signature?.startsWith("sha256="))
        return false;
    const expectedHex = signature.slice(7).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedHex))
        return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
    let diff = 0;
    for (let i = 0; i < actual.length; i++)
        diff |= actual[i] ^ Number.parseInt(expectedHex.slice(i * 2, i * 2 + 2), 16);
    return diff === 0;
}
