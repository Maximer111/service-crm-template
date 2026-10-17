import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const TZ = "Europe/Budapest";
const Ft = (n: number) => `${new Intl.NumberFormat("ru-RU").format(Math.round(n))} Ft`;
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
type Row = Record<string, unknown>;
const rt = (text: string, bold = false) => ({ type: "text", text: { content: text.slice(0, 1900) }, annotations: { bold } });
const h2 = (text: string) => ({ object: "block", type: "heading_2", heading_2: { rich_text: [rt(text)] } });
const para = (text: string) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [rt(text)] } });
const bullet = (label: string, value: string) => ({
    object: "block", type: "bulleted_list_item",
    bulleted_list_item: { rich_text: [rt(`${label}: `), rt(value, true)] },
});
const line = (text: string) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [rt(text)] } });
const SVC_RULES: Array<[
    string,
    RegExp
]> = [
    ["Химчистка", /химч|upholster|диван|ков[ёе]р|матрас|кресл|обивк/],
    ["Окна", /окн|window/],
    ["Регулярная", /регуляр|regular|еженедель/],
    ["Генералка", /генерал|deep|после ремонта|post-renovation|переезд|пустой квартиры|детальная уборка|baby prep/],
    ["Уборка", /уборк|clean/],
];
export function svcLabel(dealSvc: unknown, leadSvc: unknown): string {
    const pick = (text: string) => {
        let best = "", at = Infinity;
        for (const [name, re] of SVC_RULES) {
            const i = text.search(re);
            if (i >= 0 && i < at) {
                at = i;
                best = name;
            }
        }
        return best;
    };
    return pick(String(dealSvc ?? "").toLowerCase()) || pick(String(leadSvc ?? "").toLowerCase()) || "Уборка";
}
function adDirection(lead: Row): string {
    const c = String(lead.campaign ?? "").toLowerCase();
    const src = String(lead.source ?? "");
    if (src === "google" || src === "website" || src === "seo")
        return "Органика: сайт и Google";
    if (src === "referral")
        return "Рекомендации";
    if (!c && (src === "whatsapp" || src === "instagram" || src === "direct"))
        return "Источник неизвестен";
    if (!c || src === "manual" || /без рекламы|входящий|повтор/.test(c))
        return "Не с рекламы";
    const ru = /\(ru\)|_ru|рус|\bру\b/.test(c);
    if (/chim|хим|uphol/.test(c))
        return ru ? "Химчистка RU" : "Химчистка EN";
    if (/window|окн/.test(c))
        return ru ? "Окна RU" : "Окна EN";
    if (/clean|клин/.test(c))
        return ru ? "Клининг RU" : "Клининг EN";
    return "Прочие кампании";
}
async function build(ty?: number, tm?: number): Promise<Record<string, unknown>[]> {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const [cy, cm, cd] = parts.split("-").map(Number);
    const y = ty ?? cy, m = tm ?? cm;
    const isCurrent = y === cy && m === cm;
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const today = parts;
    const { data: deals, error: dealsErr } = await supabase.from("crm_deals")
        .select("amount,master_payout,extra_costs,extra_costs_note,notes,hours,job_date,created_at,closed_at,service_done,master_name,crm_leads(name,campaign,source,service,status,country)")
        .limit(500);
    if (dealsErr)
        throw new Error(`deals query failed: ${dealsErr.message}`);
    const FOREIGN = new Set(["US", "CA", "DE", "PH"]);
    const live = (deals ?? []).filter((x) => {
        const l = (x.crm_leads ?? {}) as unknown as Row;
        return !["lost", "junk"].includes(String(l.status ?? "")) && !FOREIGN.has(String(l.country ?? ""));
    });
    const noDate = isCurrent ? live.filter((x) => !x.job_date) : [];
    const isDone = (x: Row, dt: string) => dt < today || (dt === today && !!x.closed_at);
    const inMonth = live.filter((x) => {
        if (!x.job_date)
            return false;
        const dt = String(x.job_date);
        return dt >= first && dt <= last;
    });
    let revDone = 0, netDone = 0, cntDone = 0, revNext = 0, netNext = 0, cntNext = 0;
    const byDir = new Map<string, {
        n: number;
        rev: number;
        net: number;
    }>();
    const bySvc = new Map<string, {
        n: number;
        rev: number;
        net: number;
    }>();
    const upcoming: string[] = [];
    const noAds: string[] = [];
    const allRows: string[] = [];
    let noAdsRev = 0, noAdsNet = 0, estimated = 0;
    const partial: string[] = [];
    const done: {
        when: string;
        text: string;
    }[] = [];
    const PARTIAL_MARK = /не включен|не внесен|часть заказа|оценка на месте|оценить на месте|на месте до старта|предварительн|довести до|уточнить/i;
    const PARTIAL_DONE = /исправлено|сумма финальная|чек финальный/i;
    const futureOutside = !isCurrent ? [] : live.filter((x) => !!x.job_date && String(x.job_date) > last);
    for (const x of futureOutside) {
        const dt = String(x.job_date);
        const amount = Number(x.amount);
        const lead = (x.crm_leads ?? {}) as unknown as Row;
        revNext += amount;
        cntNext++;
        upcoming.push(`${dt.slice(8, 10)}.${dt.slice(5, 7)} · ${String(lead.name ?? "-")} · ${svcLabel(x.service_done, lead.service)} · ${Ft(amount)}`);
    }
    for (const x of inMonth) {
        const dt = String(x.job_date);
        const doneNow = isDone(x as unknown as Row, dt);
        const amount = Number(x.amount);
        const payRaw = Number(x.master_payout ?? 0);
        const hrs = Number(x.hours ?? 0);
        const payEst = payRaw > 0 ? payRaw : (hrs > 0 ? hrs * 3000 : Math.round(amount * 0.4));
        if (payRaw <= 0 && amount > 0)
            estimated++;
        const net = amount - payEst - Number(x.extra_costs ?? 0);
        const lead = (x.crm_leads ?? {}) as unknown as Row;
        if (doneNow) {
            revDone += amount;
            netDone += net;
            cntDone++;
            const who = String(x.master_name ?? "").trim();
            done.push({
                when: dt,
                text: `${dt.slice(8, 10)}.${dt.slice(5, 7)} · ${String(lead.name ?? "-")} · ${svcLabel(x.service_done, lead.service)} · ${Ft(amount)} · мастерам ${Ft(payEst)}${payRaw <= 0 ? " (оценка)" : ""} · чистыми ${Ft(net)}${who ? ` · ${who}` : ""}`,
            });
        }
        else {
            revNext += amount;
            netNext += net;
            cntNext++;
            upcoming.push(`${dt.slice(8, 10)}.${dt.slice(5, 7)} · ${String(lead.name ?? "-")} · ${svcLabel(x.service_done, lead.service)} · ${Ft(amount)}`);
        }
        allRows.push(`${dt.slice(8, 10)}.${dt.slice(5, 7)} · ${String(lead.name ?? "-")} · ${Ft(amount)} · мастерам ${Ft(payEst)} · чистыми ${Ft(net)}${payRaw <= 0 && amount > 0 ? " · ⚠️ выплата оценкой" : ""}${!doneNow ? " · впереди" : ""}`);
        const flag = `${x.notes ?? ""} ${x.extra_costs_note ?? ""}`;
        if (PARTIAL_MARK.test(flag) && !PARTIAL_DONE.test(flag)) {
            partial.push(`${dt.slice(8, 10)}.${dt.slice(5, 7)} · ${String(lead.name ?? "-")} · в сделке ${Ft(amount)} · ${flag.replace(/\s+/g, " ").trim().slice(0, 110)}`);
        }
        const adDir = adDirection(lead);
        if (adDir === "Не с рекламы" || adDir === "Источник неизвестен" || adDir === "Органика: сайт и Google" || adDir === "Рекомендации") {
            if (doneNow) {
                noAdsRev += amount;
                noAdsNet += net;
            }
            const mark = adDir === "Источник неизвестен"
                ? ` · ⚠️ источник неизвестен (${String(lead.source ?? "")})`
                : adDir === "Органика: сайт и Google" ? " · 🟢 органика, сайт или Google"
                    : adDir === "Рекомендации" ? " · 🤝 рекомендация" : "";
            noAds.push(`${dt.slice(8, 10)}.${dt.slice(5, 7)} · ${String(lead.name ?? "-")} · ${svcLabel(x.service_done, lead.service)} · ${Ft(amount)} · чистыми ${Ft(net)}${!doneNow ? " · впереди" : ""}${mark}`);
        }
        if (doneNow) {
            const dir = adDirection(lead);
            const g = byDir.get(dir) ?? { n: 0, rev: 0, net: 0 };
            g.n++;
            g.rev += amount;
            g.net += net;
            byDir.set(dir, g);
            const sv = svcLabel(x.service_done, lead.service);
            const gs = bySvc.get(sv) ?? { n: 0, rev: 0, net: 0 };
            gs.n++;
            gs.rev += amount;
            gs.net += net;
            bySvc.set(sv, gs);
        }
    }
    const { data: wonAll, error: wonErr } = await supabase.from("crm_leads")
        .select("id,name,phone,service,what_to_clean,scheduled_at,status_changed_at,budget,campaign,country")
        .eq("status", "won").neq("source", "job_application");
    const isToronto = (l: Row) => /toronto|торонто/i.test(`${String(l.name ?? "")} ${String(l.campaign ?? "")}`);
    if (wonErr)
        throw new Error(`won leads query failed: ${wonErr.message}`);
    const wonLeads = (wonAll ?? []).filter((l) => !isToronto(l as Row) && !FOREIGN.has(String((l as Row).country ?? "")));
    const { data: dealLeadIds, error: dealIdsErr } = await supabase.from("crm_deals").select("lead_id");
    if (dealIdsErr || !dealLeadIds)
        throw new Error(`crm_deals lead_id query failed: ${dealIdsErr?.message ?? "no data"}`);
    const withDeal = new Set((dealLeadIds ?? []).map((x) => String(x.lead_id)));
    const fmtD = (v: unknown) => v ? String(v).slice(8, 10) + "." + String(v).slice(5, 7) : "";
    const openNoCheck = (wonLeads ?? []).filter((l) => {
        if (withDeal.has(String(l.id)))
            return false;
        const at = String(l.scheduled_at ?? "");
        return !(at && at.slice(0, 10) >= today);
    });
    const dayOf = (l: Row) => String(l.scheduled_at ?? "").slice(0, 10);
    const undated = openNoCheck.filter((l) => !dayOf(l)).length;
    const oldNoCheck = openNoCheck.filter((l) => dayOf(l) && dayOf(l) < first).length;
    const noCheck = openNoCheck.filter((l) => dayOf(l) >= first).map((l) => {
        const when = fmtD(l.scheduled_at) || fmtD(l.status_changed_at);
        const what = String(l.what_to_clean || l.service || "").slice(0, 60);
        return `${l.name}${when ? ` · ${when}` : ""}${what ? ` · ${what}` : ""}${l.phone ? ` · ${l.phone}` : ""}`;
    });
    const plainFt = (v: unknown): number => {
        const s = String(v ?? "").trim();
        if (!s || !/^[0-9\s.,]+$/.test(s))
            return 0;
        return Number(s.replace(/[^0-9]/g, "")) || 0;
    };
    const bookedRows: {
        when: string;
        text: string;
        sum: number;
    }[] = [];
    for (const l of wonLeads ?? []) {
        if (withDeal.has(String(l.id)))
            continue;
        const at = String(l.scheduled_at ?? "");
        if (!at || at.slice(0, 10) < today)
            continue;
        const sum = plainFt(l.budget);
        bookedRows.push({
            when: at,
            sum,
            text: `${fmtD(at)} · ${l.name} · ${String(l.what_to_clean || l.service || "").slice(0, 50)} · ${sum ? Ft(sum) : String(l.budget ?? "сумма не назначена")}`,
        });
    }
    bookedRows.sort((a, b) => a.when.localeCompare(b.when));
    if (!isCurrent)
        bookedRows.length = 0;
    const bookedSum = bookedRows.reduce((s, r) => s + r.sum, 0);
    const { data: expRows } = await supabase.from("crm_expenses")
        .select("spent_on,amount,note").is("lead_id", null).gte("spent_on", first).lte("spent_on", last);
    const expTotal = (expRows ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    const { data: cfgRows } = await supabase.from("crm_app_config").select("key,value");
    const cfg = Object.fromEntries((cfgRows ?? []).map((r: {
        key: string;
        value: string;
    }) => [r.key, r.value]));
    const eurHuf = Number(cfg.fx_eur_huf) || 395;
    const usdHuf = Number(cfg.fx_usd_huf) || 360;
    const toHuf = (v: number, cur: string) => cur === "EUR" ? v * eurHuf : cur === "USD" ? v * usdHuf : v;
    const { data: spendRows } = await supabase.from("crm_ad_spend")
        .select("campaign,spend,currency,date_start,date_stop,impressions,clicks,leads_reported,source_file").limit(3000);
    const metaCampaigns = new Set((spendRows ?? [])
        .filter((sp) => sp.source_file === "meta_api" && String(sp.date_stop ?? sp.date_start ?? "") >= first && String(sp.date_start ?? sp.date_stop ?? "") <= last)
        .map((sp) => String(sp.campaign ?? "").trim().toLowerCase()));
    const spendBy = new Map<string, number>();
    const adsMetrics = new Map<string, {
        impressions: number;
        clicks: number;
        metaLeads: number;
    }>();
    let adHuf = 0, adVacancyHuf = 0;
    for (const sp of spendRows ?? []) {
        const k = String(sp.campaign).trim().toLowerCase();
        if (sp.source_file !== "meta_api" && metaCampaigns.has(k))
            continue;
        const a = new Date(String(sp.date_start ?? sp.date_stop ?? "") + "T00:00:00Z");
        const b = new Date(String(sp.date_stop ?? sp.date_start ?? "") + "T00:00:00Z");
        if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a)
            continue;
        const days = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
        let hit = 0;
        for (let i = 0; i < days; i++) {
            const dd = new Date(a.getTime() + i * 86400000).toISOString().slice(0, 10);
            if (dd >= first && dd <= last)
                hit++;
        }
        if (!hit)
            continue;
        const eur = Number(sp.spend) * (hit / days);
        const huf = toHuf(eur, String(sp.currency ?? "EUR"));
        adHuf += huf;
        if (/vacancy|вакан/i.test(String(sp.campaign ?? "")))
            adVacancyHuf += huf;
        spendBy.set(k, (spendBy.get(k) ?? 0) + eur);
        const metrics = adsMetrics.get(k) ?? { impressions: 0, clicks: 0, metaLeads: 0 };
        metrics.impressions += Number(sp.impressions ?? 0) * (hit / days);
        metrics.clicks += Number(sp.clicks ?? 0) * (hit / days);
        metrics.metaLeads += Number(sp.leads_reported ?? 0) * (hit / days);
        adsMetrics.set(k, metrics);
    }
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dayNum = (y === cy && m === cm) ? cd : daysInMonth;
    const perDay = dayNum > 0 ? revDone / dayNum : 0;
    const stamp = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(now);
    const blocks: Record<string, unknown>[] = [
        para(`Обновлено автоматически ${stamp}. Все суммы в форинтах. Страница перезаписывается ежедневно, правки на ней не сохраняются.`),
        h2("Итого за месяц"),
        bullet("Выполнено заказов", String(cntDone)),
        bullet("Выручка выполненных", Ft(revDone)),
        bullet("Чистыми после мастеров", Ft(netDone)),
        bullet("Общие расходы месяца", `${Ft(expTotal)} (бензин, проездной, химия, такси)`),
        bullet("Чистыми после расходов", Ft(netDone - expTotal)),
        bullet("Реклама за месяц", `${Ft(adHuf)}${adVacancyHuf ? ` (из них ${Ft(adVacancyHuf)} на вакансии, это найм)` : ""}`),
        bullet("ЧИСТЫМИ ПОСЛЕ РЕКЛАМЫ", Ft(netDone - expTotal - adHuf)),
        ...(isCurrent ? [bullet("Забронировано вперёд", `${cntNext + bookedRows.length} заказов на ${Ft(revNext + bookedSum)}`)] : []),
        bullet("Средний чек", cntDone ? Ft(revDone / cntDone) : "-"),
        bullet("Темп", `${Ft(perDay)} в день (${dayNum} дн. месяца)`),
        h2("Все заказы месяца"),
        para("Каждая сделка месяца одной строкой, по датам. Это полный список: блоки ниже - разрезы того же самого, поэтому одного заказа в них может не быть. Заказ появляется здесь только когда в него вписана сумма; согласованные, но не закрытые, лежат внизу в «Требует внимания»."),
    ];
    if (allRows.length)
        allRows.sort().forEach((r) => blocks.push(line(r)));
    else
        blocks.push(para("Заказов с суммой за месяц ещё нет."));
    blocks.push(...[
        h2("Откуда пришли клиенты"),
        para("По КАМПАНИИ, из которой пришёл клиент. Объявление про химчистку регулярно приводит клиента на уборку, поэтому судить по этому блоку о марже нельзя - он про рекламу. Только выполненные заказы."),
    ]);
    for (const [dir, g] of [...byDir.entries()].sort((a, b) => b[1].rev - a[1].rev)) {
        blocks.push(line(`${dir}: ${g.n} заказов · выручка ${Ft(g.rev)}`));
    }
    blocks.push(h2("Что сделали в этом месяце"));
    blocks.push(para("Каждый выполненный заказ строкой. По этому списку сходятся все итоги выше: если заказа тут нет, значит его нет и в выручке."));
    if (done.length) {
        [...done].sort((a, b) => a.when.localeCompare(b.when)).forEach((r) => blocks.push(line(r.text)));
    }
    else
        blocks.push(line("Выполненных заказов за месяц нет."));
    blocks.push(h2("По фактической услуге"));
    blocks.push(para("Что реально сделали и сколько на этом заработали. Вот здесь смотрим маржу. Только выполненные заказы."));
    for (const [sv, g] of [...bySvc.entries()].sort((a, b) => b[1].net - a[1].net)) {
        const pct = g.rev ? Math.round((g.net / g.rev) * 100) : 0;
        blocks.push(line(`${sv}: ${g.n} заказов · ${Ft(g.rev)} · чистыми ${Ft(g.net)} (${pct}%)`));
    }
    if (isCurrent) {
        blocks.push(h2("Впереди"));
        blocks.push(para(`Согласованные заказы, работа ещё не сделана - в выручку месяца попадут после выезда. Всего ${Ft(revNext + bookedSum)} на ${cntNext + bookedRows.length} заказов.`));
        if (bookedRows.length)
            bookedRows.forEach((r) => blocks.push(line(r.text)));
        if (upcoming.length)
            upcoming.sort().forEach((u) => blocks.push(line(u)));
        if (!bookedRows.length && !upcoming.length)
            blocks.push(para("Забронированных заказов нет."));
    }
    const { data: allLeads } = await supabase.from("crm_leads")
        .select("id,campaign,status,source,received_at,created_at")
        .neq("source", "job_application").gte("created_at", first + "T00:00:00Z").limit(3000);
    const { data: allDeals } = await supabase.from("crm_deals").select("lead_id,amount").limit(1000);
    const revByLead = new Map<string, number>();
    for (const dd of allDeals ?? []) {
        const k = String(dd.lead_id);
        revByLead.set(k, (revByLead.get(k) ?? 0) + Number(dd.amount));
    }
    const camp = new Map<string, {
        leads: number;
        won: number;
        rev: number;
    }>();
    for (const l of allLeads ?? []) {
        const c = String(l.campaign ?? "").trim();
        if (!c || /без рекламы|входящий|вакансия/i.test(c))
            continue;
        const g = camp.get(c) ?? { leads: 0, won: 0, rev: 0 };
        g.leads++;
        if (l.status === "won")
            g.won++;
        g.rev += revByLead.get(String(l.id)) ?? 0;
        camp.set(c, g);
    }
    blocks.push(h2("Кампании: что приводят"));
    blocks.push(para("Заявки и заказы за текущий месяц. В списке только кампании, по которым в этом месяце что-то приходило. Расход тоже за этот месяц: периоды, заходящие в соседний месяц, поделены по дням."));
    const campRows = [...camp.entries()].sort((a, b) => b[1].leads - a[1].leads).slice(0, 20);
    if (!campRows.length)
        blocks.push(para("В этом месяце заявок с рекламы ещё не было."));
    for (const [name, g] of campRows) {
        const conv = g.leads ? Math.round((g.won / g.leads) * 100) : 0;
        const eur = spendBy.get(name.toLowerCase());
        const metrics = adsMetrics.get(name.toLowerCase());
        const cpl = eur && g.leads ? ` · заявка ${(eur / g.leads).toFixed(1)} €` : "";
        const ctr = metrics?.impressions ? (metrics.clicks / metrics.impressions) * 100 : 0;
        const cpc = eur && metrics?.clicks ? eur / metrics.clicks : 0;
        const delivery = metrics?.impressions
            ? ` · показы ${Math.round(metrics.impressions).toLocaleString("ru-RU")} · клики ${Math.round(metrics.clicks)} · CTR ${ctr.toFixed(1)}%${cpc ? ` · CPC ${cpc.toFixed(2)} €` : ""} · лиды Meta ${Math.round(metrics.metaLeads)}`
            : "";
        const spendTxt = eur ? ` · расход ${eur.toFixed(0)} €${cpl}${delivery}` : " · расход не импортирован";
        blocks.push(line(`${name} — ${g.leads} заявок · ${g.won} заказов (${conv}%) · выручка ${Ft(g.rev)}${spendTxt}`));
    }
    blocks.push(h2("Мимо рекламных кампаний"));
    blocks.push(para(`Заказы вне рекламы. Выполнено на ${Ft(noAdsRev)}, чистыми ${Ft(noAdsNet)}; строки с пометкой «впереди» в этот итог не входят, они лежат в блоке «Впереди». 🟢 органика - человек нашёл нас через сайт или поиск Google, платить за него не пришлось. 🤝 рекомендация - привёл клиент или знакомый. ⚠️ источник неизвестен - написал напрямую в WhatsApp или Instagram, минуя форму: он мог прийти с объявления, поэтому считать его бесплатным нельзя. Только последние требуют действия: если знаешь кампанию, впиши её в карточку.`));
    if (noAds.length)
        noAds.sort().forEach((t) => blocks.push(line(t)));
    else
        blocks.push(para("В этом месяце таких заказов не было."));
    blocks.push(h2("Общие расходы месяца"));
    blocks.push(para("Расходы, которые не относятся к конкретному заказу: бензин, проездной, химия и тряпки, такси, парковка. Считаются один раз за месяц и вычитаются из общей прибыли, а не размазываются по заказам."));
    if (expRows?.length) {
        [...expRows].sort((a, b) => String(a.spent_on).localeCompare(String(b.spent_on)))
            .forEach((r) => blocks.push(line(`${String(r.spent_on).slice(8, 10)}.${String(r.spent_on).slice(5, 7)} · ${Ft(Number(r.amount))} · ${String(r.note ?? "")}`)));
        blocks.push(line(`Итого ${Ft(expTotal)}`));
    }
    else
        blocks.push(line("Расходов за месяц не записано."));
    blocks.push(h2("Требует внимания"));
    if (cfg.meta_ads_access_token) {
        const lastMeta = Date.parse(cfg.meta_ads_last_sync_at || "");
        if (!Number.isFinite(lastMeta) || Date.now() - lastMeta > 36 * 3600000) {
            blocks.push(line(`⚠️ Данные Meta Ads устарели${cfg.meta_ads_last_sync_error ? `: ${cfg.meta_ads_last_sync_error.slice(0, 220)}` : " — последняя успешная синхронизация была больше 36 часов назад"}.`));
        }
    }
    if (partial.length) {
        blocks.push(line(`❗ Сумма в сделке неполная у ${partial.length} заказов: часть работы оценивалась на месте или осталась припиской. В отчёте они считаются по той сумме, что стоит в сделке, то есть выручка занижена. Впиши фактический чек:`));
        partial.forEach((t) => blocks.push(line(t)));
    }
    if (noDate.length) {
        blocks.push(line(`📅 Сделка есть, а дата выезда не проставлена (${noDate.length}). В выручку не идут, пока не поставишь день: иначе отменённый или будущий заказ считается сделанным.`));
        noDate.forEach((x) => {
            const l = (x.crm_leads ?? {}) as unknown as Row;
            blocks.push(line(`   ${String(l.name ?? "-")} · ${Ft(Number(x.amount))} · ${svcLabel(x.service_done, l.service)}`));
        });
    }
    if (estimated)
        blocks.push(line(`Выплата мастерам не проставлена у ${estimated} заказов - посчитана оценочно по 3 000 Ft за час. Впиши фактические суммы, чтобы прибыль была точной.`));
    if (noCheck.length) {
        blocks.push(line(`Выиграно без вписанной суммы (${noCheck.length}) - выручка занижена на эти заказы:`));
        noCheck.slice(0, 15).forEach((t) => blocks.push(line(`   ${t}`)));
    }
    else
        blocks.push(line("Все выигранные заказы этого месяца с суммами."));
    if (undated)
        blocks.push(line(`${undated} выигранных заказов без даты и без суммы - непонятно, когда была работа и была ли вообще. Дашборд, фильтр «выиграно».`));
    if (oldNoCheck)
        blocks.push(line(`Ещё ${oldNoCheck} выигранных заказов без суммы за прошлые месяцы - они не влияют на цифры этого месяца, но выручку за прошлые занижают. Дашборд, фильтр «выиграно».`));
    return blocks;
}
async function ensureMonthPage(token: string, parentId: string, y: number, m: number): Promise<string> {
    const h = { "Authorization": `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" };
    const title = `${MONTHS[m - 1]} ${y}`;
    const cur = await fetch(`${NOTION}/blocks/${parentId}/children?page_size=100`, { headers: h });
    const j = await cur.json();
    if (!cur.ok)
        throw new Error(`Notion children: ${cur.status} ${JSON.stringify(j).slice(0, 200)}`);
    const hit = ((j.results ?? []) as Record<string, unknown>[])
        .find((b) => b.type === "child_page" && (b.child_page as Record<string, unknown> | undefined)?.title === title);
    if (hit)
        return String(hit.id);
    const r = await fetch(`${NOTION}/pages`, {
        method: "POST", headers: h,
        body: JSON.stringify({ parent: { page_id: parentId }, properties: { title: [{ type: "text", text: { content: title } }] } }),
    });
    const created = await r.json();
    if (!r.ok)
        throw new Error(`Notion create page: ${r.status} ${JSON.stringify(created).slice(0, 300)}`);
    return String(created.id);
}
async function writePage(token: string, pageId: string, blocks: Record<string, unknown>[]) {
    const h = { "Authorization": `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" };
    const old: {
        id: string;
        type?: string;
    }[] = [];
    let cursor: string | null = null;
    for (;;) {
        const url: string = `${NOTION}/blocks/${pageId}/children?page_size=100` + (cursor ? `&start_cursor=${cursor}` : "");
        const cur: Response = await fetch(url, { headers: h });
        const curJson: Record<string, unknown> = await cur.json();
        if (!cur.ok)
            throw new Error(`Notion children: ${cur.status} ${JSON.stringify(curJson).slice(0, 200)}`);
        for (const b of (curJson.results ?? []) as {
            id: string;
            type?: string;
        }[]) {
            if (b.type !== "child_page")
                old.push(b);
        }
        if (!curJson.has_more)
            break;
        cursor = String(curJson.next_cursor);
    }
    for (let i = 0; i < old.length; i += 30) {
        await Promise.all(old.slice(i, i + 30).map((b) => fetch(`${NOTION}/blocks/${b.id}`, { method: "DELETE", headers: h }).catch(() => null)));
    }
    for (let i = 0; i < blocks.length; i += 100) {
        const r = await fetch(`${NOTION}/blocks/${pageId}/children`, {
            method: "PATCH", headers: h, body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
        });
        if (!r.ok)
            throw new Error(`Notion append: ${r.status} ${JSON.stringify(await r.json()).slice(0, 300)}`);
    }
}
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        const { data: cfgRows } = await supabase.from("crm_app_config").select("key,value");
        const cfg: Record<string, string> = {};
        for (const r of cfgRows ?? [])
            cfg[String(r.key)] = String(r.value);
        if (!cfg.reminder_secret || req.headers.get("x-reminder-secret") !== cfg.reminder_secret) {
            return new Response("forbidden", { status: 403 });
        }
        const token = cfg.notion_token, pageId = cfg.notion_report_page_id;
        if (!token || !pageId) {
            return new Response(JSON.stringify({ ok: false, error: "нет notion_token или notion_report_page_id в crm_app_config" }), { status: 400, headers: { "content-type": "application/json" } });
        }
        try {
            const arg = new URL(req.url).searchParams.get("month");
            let y: number, m: number;
            if (arg && /^\d{4}-\d{2}$/.test(arg)) {
                [y, m] = arg.split("-").map(Number);
            }
            else {
                const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
                y = p[0];
                m = p[1];
            }
            const monthPage = await ensureMonthPage(token, pageId, y, m);
            const blocks = await build(y, m);
            await writePage(token, monthPage, blocks);
            await writePage(token, pageId, [{
                    object: "block", type: "paragraph",
                    paragraph: { rich_text: [{ type: "text", text: { content: "Отчёты по месяцам ниже. Каждый месяц на своей странице, обновляется автоматически каждое утро. Правки на этих страницах не сохраняются - они перезаписываются из базы." } }] },
                }]);
            return new Response(JSON.stringify({ ok: true, month: `${y}-${String(m).padStart(2, "0")}`, blocks: blocks.length }), { headers: { "content-type": "application/json" } });
        }
        catch (e) {
            console.error("notion report", e);
            return new Response(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }), { status: 500, headers: { "content-type": "application/json" } });
        }
    });
