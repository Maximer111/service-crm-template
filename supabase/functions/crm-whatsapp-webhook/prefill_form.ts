export type PrefillFields = {
    name?: string;
    service?: string;
    area?: string;
    gift?: string;
    extra_services?: string;
    budget?: string;
};
export function parsePrefillForm(body: string): PrefillFields {
    const out: PrefillFields = {};
    for (const raw of String(body ?? "").split(/\n/)) {
        const m = raw.replace(/^[\s\d.⁠]+/u, "").match(/^(.+?):+\s*(.+)$/u);
        if (!m)
            continue;
        const q = m[1].toLowerCase(), a = m[2].trim();
        if (/full name|имя|név/.test(q))
            out.name = a;
        else if (/type of cleaning|вид уборки|какую уборку|что будем чистить|milyen takar/.test(q)) {
            out.service = /deep|генерал|nagytakar|mély/i.test(a) ? "deep"
                : /regular|постоян|регуляр|rendszeres/i.test(a) ? "regular"
                    : /sofa|диван|kanapé|upholster|химчист|kárpit|матрас|mattress/i.test(a) ? "upholstery"
                        : /window|окн|ablak/i.test(a) ? "windows" : "cleaning";
        }
        else if (/size|площад|méret/.test(q))
            out.area = a;
        else if (/gift|подар|ajándék/.test(q))
            out.gift = a;
        else if (/additional|доп|további|kiegészít/.test(q))
            out.extra_services = a;
        else if (/budget|бюджет|költség/.test(q))
            out.budget = a;
    }
    return out;
}
