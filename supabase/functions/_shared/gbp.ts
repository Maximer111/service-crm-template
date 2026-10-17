const LOCATION = `https://mybusiness.googleapis.com/v4/accounts/${Deno.env.get("GBP_ACCOUNT_ID")}/locations/${Deno.env.get("GBP_LOCATION_ID")}`;
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export type GbpReview = {
    reviewId: string;
    starRating?: string;
    comment?: string;
    createTime: string;
    updateTime?: string;
    reviewer?: {
        displayName?: string;
    };
    reviewReply?: {
        comment?: string;
        updateTime?: string;
    };
};
export async function gbpToken(): Promise<string> {
    const body = new URLSearchParams({
        client_id: Deno.env.get("GBP_CLIENT_ID") ?? "", client_secret: Deno.env.get("GBP_CLIENT_SECRET") ?? "",
        refresh_token: Deno.env.get("GBP_REFRESH_TOKEN") ?? "", grant_type: "refresh_token",
    });
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token)
        throw new Error(`GBP token ${r.status} ${j.error ?? ""}`);
    return j.access_token;
}
export async function gbpListReviews(token: string): Promise<GbpReview[]> {
    const out: GbpReview[] = [];
    let page = "";
    do {
        const r = await fetch(`${LOCATION}/reviews?pageSize=50${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok)
            throw new Error(`GBP reviews ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
        out.push(...(j.reviews ?? []));
        page = j.nextPageToken ?? "";
    } while (page);
    return out;
}
export async function gbpReply(token: string, reviewId: string, comment: string): Promise<void> {
    const r = await fetch(`${LOCATION}/reviews/${encodeURIComponent(reviewId)}/reply`, {
        method: "PUT", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ comment }),
    });
    if (!r.ok)
        throw new Error(`GBP reply ${r.status} ${(await r.text()).slice(0, 200)}`);
}
export function reviewRow(v: GbpReview) {
    return {
        review_id: v.reviewId, reviewer_name: v.reviewer?.displayName ?? "", stars: STARS[v.starRating ?? ""] ?? null,
        comment: v.comment ?? "", created_at: v.createTime, updated_at: v.updateTime ?? v.createTime,
        reply_comment: v.reviewReply?.comment ?? null, reply_updated_at: v.reviewReply?.updateTime ?? null,
    };
}
export function replyProblem(text: string): string {
    const t = text.trim();
    if (!t)
        return "Пустой ответ";
    if (t.length > 4000)
        return "Длиннее 4000 символов";
    if (/https?:\/\/|www\.|\.(com|hu|net)\b/i.test(t))
        return "В ответе ссылка";
    if (/(\+?\d[\d\s().-]{6,}\d)/.test(t))
        return "В ответе номер телефона";
    if (/(kedvezm|discount|% off|скидк|акци|promo|coupon|kupon)/i.test(t))
        return "В ответе акция или скидка";
    return "";
}
export async function draftReply(apiKey: string, v: {
    reviewer_name: string;
    stars: number | null;
    comment: string;
}): Promise<string> {
    const system = `You write the owner's reply to a Google review for CLB Cleaning, a cleaning company in Budapest (home cleaning, deep cleaning, upholstery and carpet cleaning, window cleaning).
Rules:
- Reply in the language of the review. If the review has no text, reply in English.
- 2-3 short sentences, warm and specific, no clichés.
- Thank the reviewer by first name (the given name, not the surname; Hungarian names put the surname first).
- Mention the actual service from the review once; if the review does not name one, say "cleaning" in the review's language.
- If the review is negative, apologise without arguing and invite them to contact us directly, without giving any contact details.
- No links, no phone numbers, no emails, no discounts or promotions, no hashtags, no em dashes.
Output only the reply text.`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, system,
            messages: [{ role: "user", content: `Reviewer: ${v.reviewer_name}\nStars: ${v.stars ?? "?"}\nReview:\n${v.comment || "(no text)"}` }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
        throw new Error(`Claude ${r.status} ${j.error?.message ?? ""}`);
    return String(j.content?.[0]?.text ?? "").replace(/—/g, "-").trim();
}
