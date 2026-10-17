type AnyMap = Record<string, any>;
export type WaOrigin = {
    entry: string;
    app?: string;
    ad_id?: string;
    ad_title?: string;
    ad_url?: string;
    ctwa_clid?: string;
};
const token = (v: unknown, max = 40): string => {
    const s = String(v ?? "").trim().toLowerCase();
    return /^[a-z0-9_.-]{1,40}$/.test(s) && s.length <= max ? s : "";
};
const text = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);
export function messageContext(item: AnyMap, message: AnyMap): AnyMap {
    const ctx = item?.contextInfo ?? message?.contextInfo ?? message?.messageContextInfo;
    return ctx && typeof ctx === "object" ? ctx as AnyMap : {};
}
export function waOriginFrom(context: unknown): WaOrigin | null {
    const ctx = context && typeof context === "object" ? context as AnyMap : {};
    const ad = (ctx.externalAdReply ?? ctx.referral ?? {}) as AnyMap;
    const adType = token(ad.sourceType ?? ad.source_type);
    const rawId = String(ad.sourceId ?? ad.source_id ?? "");
    const adId = adType === "ad" && /^\d{6,25}$/.test(rawId) ? rawId : "";
    const conversion = token(ctx.conversionSource ?? ctx.entryPointConversionExternalSource);
    const entry = token(ctx.entryPointConversionSource)
        || (adId ? "ctwa_ad" : conversion === "fb_ads" ? "ctwa_ad" : conversion === "fb_page" ? "page_cta" : conversion === "fb_post" ? "post_cta" : "");
    if (!entry && !adId)
        return null;
    const out: WaOrigin = { entry: entry || "ctwa_ad" };
    const app = token(ad.sourceApp ?? ctx.entryPointConversionApp);
    if (app)
        out.app = app;
    if (adId)
        out.ad_id = adId;
    const title = text(ad.title ?? ad.headline, 120);
    if (adId && title)
        out.ad_title = title;
    const url = text(ad.sourceUrl ?? ad.source_url, 300);
    if (adId && /^https:\/\//.test(url))
        out.ad_url = url;
    const clid = text(ad.ctwaClid ?? ad.ctwa_clid ?? ctx.ctwa_clid, 300);
    if (/^[A-Za-z0-9_.\-=]{6,300}$/.test(clid))
        out.ctwa_clid = clid;
    return out;
}
export function waFrom(origin: WaOrigin | null): string {
    if (!origin)
        return "";
    if (origin.ad_id || origin.entry === "ctwa_ad")
        return "fb_ad";
    if (origin.entry === "page_cta" || origin.entry === "post_cta") {
        return origin.app === "instagram" ? "instagram" : "facebook";
    }
    return "";
}
const ENTRY_RU: Record<string, string> = {
    ctwa_ad: "реклама Meta",
    page_cta: "кнопка на странице",
    post_cta: "кнопка под постом",
    click_to_chat_link: "ссылка wa.me",
    global_search_new_chat: "поиск по номеру в WhatsApp",
    phone_number_hyperlink: "номер ссылкой",
};
export function originLabel(origin: WaOrigin | null, campaign = ""): string {
    if (!origin)
        return "";
    const where = ENTRY_RU[origin.entry] ?? origin.entry;
    const app = origin.app && origin.app !== "whatsapp" ? ` (${origin.app})` : "";
    if (campaign)
        return `📢 Реклама: ${campaign}`;
    if (origin.ad_id)
        return `📢 Реклама Meta${app}, объявление ${origin.ad_id}`;
    return `📍 Пришёл: ${where}${app}`;
}
