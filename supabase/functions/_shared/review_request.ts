import { ruName, waDigits } from "./first_touch.ts";
export const REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJQywVUFv34wYRFMeuTn0DoI4";
const SVC: Record<string, Record<string, string>> = {
    ru: { upholstery: "химчистку мебели", windows: "мойку окон", deep: "генеральную уборку", regular: "регулярную уборку", cleaning: "уборку" },
    en: { upholstery: "upholstery cleaning", windows: "window cleaning", deep: "deep cleaning", regular: "regular cleaning", cleaning: "cleaning" },
    hu: { upholstery: "kárpittisztítást", windows: "ablaktisztítást", deep: "nagytakarítást", regular: "rendszeres takarítást", cleaning: "takarítást" },
};
type Lead = Record<string, unknown>;
const lang = (l: Lead) => (["ru", "hu"].includes(String(l.language)) ? String(l.language) : "en");
function firstName(l: Lead): string {
    const parts = String(l.name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length || /^[-\d+]/.test(parts[0]))
        return "";
    if (lang(l) === "hu")
        return parts.length === 1 ? parts[0] : "";
    if (lang(l) === "ru")
        return ruName(parts[0], true);
    return parts[0];
}
export function jobDone(l: Lead, hasDeal = false, now = Date.now()): boolean {
    if (l.status !== "won" || l.source === "job_application")
        return false;
    if (hasDeal)
        return true;
    const at = l.scheduled_at ? Date.parse(String(l.scheduled_at)) : NaN;
    return Number.isFinite(at) && at < now;
}
export const reviewCity = (l: Lead) => !l.city || l.city === "budapest";
export function reviewRequestText(l: Lead): string {
    const lg = lang(l);
    const svc = SVC[lg][String(l.service)] ?? SVC[lg].cleaning;
    const n = firstName(l);
    if (lg === "ru")
        return `${n ? n + ", с" : "С"}пасибо, что доверили нам ${svc}!\nБудем благодарны за короткий отзыв в Google, он очень помогает нашей небольшой команде:\n${REVIEW_URL}`;
    if (lg === "hu")
        return `${n ? `Kedves ${n}, k` : "K"}öszönjük, hogy ránk bízta a ${svc}!\nÍrna nekünk egy rövid Google-értékelést? Kis csapatunknak sokat segít:\n${REVIEW_URL}`;
    return `Hi${n ? " " + n : ""}, thank you for trusting us with your ${svc}!\nCould you leave us a short Google review? It helps our small team a lot:\n${REVIEW_URL}`;
}
export function reviewWaUrl(l: Lead): string {
    const dg = waDigits(l.phone);
    return dg ? `https://api.whatsapp.com/send?phone=${dg}&text=${encodeURIComponent(reviewRequestText(l))}` : "";
}
