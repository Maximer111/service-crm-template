const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    },
});
function safeEqual(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
if (import.meta.main)
    Deno.serve(async (req) => {
        if (req.method !== "POST")
            return json({ error: "method not allowed" }, 405);
        const operatorToken = Deno.env.get("WHATSAPP_OPS_TOKEN") ?? "";
        const supplied = req.headers.get("x-clb-ops-token") ?? "";
        if (!safeEqual(supplied, operatorToken))
            return json({ error: "forbidden" }, 403);
        let body: Record<string, unknown>;
        try {
            body = await req.json();
        }
        catch {
            return json({ error: "invalid JSON" }, 400);
        }
        const action = String(body.action ?? "");
        if (!new Set(["status", "restart", "qr"]).has(action))
            return json({ error: "invalid action" }, 400);
        const relayUrl = Deno.env.get("WHATSAPP_RELAY_URL") ?? "";
        const relaySecret = Deno.env.get("WHATSAPP_RELAY_SECRET") ?? "";
        if (!relayUrl || !relaySecret)
            return json({ error: "relay is not configured" }, 503);
        try {
            const relay = await fetch(relayUrl, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${relaySecret}`,
                },
                body: JSON.stringify({ mode: "ops", action }),
                signal: AbortSignal.timeout(20000),
            });
            const out = await relay.json().catch(() => ({}));
            return json(out, relay.status);
        }
        catch {
            return json({ error: "relay is unreachable" }, 502);
        }
    });
