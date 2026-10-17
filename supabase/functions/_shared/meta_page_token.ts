type AnyMap = Record<string, any>;
export function pageTokenMap(accounts: AnyMap): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of (accounts?.data ?? []) as AnyMap[]) {
        const token = String(p?.access_token ?? "");
        if (!p?.id || !token)
            continue;
        map.set(String(p.id), token);
        if (p.instagram_business_account?.id)
            map.set(String(p.instagram_business_account.id), token);
    }
    return map;
}
let cache: {
    at: number;
    map: Map<string, string>;
} | null = null;
const TTL = 60 * 60000;
export async function pageTokenFor(cfg: Record<string, string>, accountId: string, fallback: string, fetcher: typeof fetch = fetch): Promise<string> {
    const sys = String(cfg.meta_system_token ?? "").trim();
    if (!sys)
        return fallback;
    if (!cache || Date.now() - cache.at > TTL) {
        const version = cfg.fb_graph_version || "v21.0";
        const url = `https://graph.facebook.com/${version}/me/accounts?fields=id,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(sys)}`;
        const res = await fetcher(url).catch(() => null);
        const body = await res?.json().catch(() => ({})) as AnyMap | undefined;
        const map = pageTokenMap(body ?? {});
        if (map.size)
            cache = { at: Date.now(), map };
        else
            console.error("meta_system_token: /me/accounts без страниц", res?.status ?? "no response", String(body?.error?.message ?? "").slice(0, 160));
    }
    return cache?.map.get(accountId) || fallback;
}
export function resetPageTokenCache(): void { cache = null; }
