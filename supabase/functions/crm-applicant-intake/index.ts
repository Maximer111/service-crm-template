import { createClient } from "jsr:@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const MAX_PER_IP_PER_HOUR = 3;
const MAX_GLOBAL_PER_10MIN = 15;
type Cfg = Record<string, string>;
async function getConfig(): Promise<Cfg> {
    const { data, error } = await supabase.from("crm_app_config").select("key,value");
    if (error)
        throw error;
    return Object.fromEntries((data ?? []).map((r: {
        key: string;
        value: string;
    }) => [r.key, r.value]));
}
async function tg(token: string, method: string, payload: unknown): Promise<Record<string, unknown> | null> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok)
        console.error("tg error", method, JSON.stringify(j));
    return j;
}
const escapeHtml = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export type CC = "HU" | "US" | "CA" | "DE" | "PH" | "";
const DIAL: Record<Exclude<CC, "">, {
    code: string;
    nat: number[];
    trunk?: string;
    flag: string;
    name: string;
}> = {
    HU: { code: "36", nat: [9], trunk: "06", flag: "🇭🇺", name: "Венгрия" },
    US: { code: "1", nat: [10], trunk: "1", flag: "🇺🇸", name: "США" },
    CA: { code: "1", nat: [10], trunk: "1", flag: "🇨🇦", name: "Канада" },
    DE: { code: "49", nat: [10, 11], trunk: "0", flag: "🇩🇪", name: "Германия" },
    PH: { code: "63", nat: [10], trunk: "0", flag: "🇵🇭", name: "Филиппины" },
};
export function countryFrom(...hints: string[]): CC {
    const t = hints.filter(Boolean).join(" ").toLowerCase();
    if (/\b(hu|hun|hungary|magyar)\b|budapest|будапешт|венгр/.test(t))
        return "HU";
    if (/\b(us|usa|florida|fl)\b|orlando|орландо|флорид/.test(t))
        return "US";
    if (/\b(ca|can|canada)\b|toronto|торонто|онтарио|ontario/.test(t))
        return "CA";
    if (/\b(de|deu|germany|bayern)\b|munich|münchen|munchen|мюнхен|герман/.test(t))
        return "DE";
    if (/\b(ph|phl|philippines)\b|manila|makati|макати|манил|филиппин/.test(t))
        return "PH";
    return "";
}
export function normalizePhone(raw: string, cc: CC = ""): string {
    let s = String(raw ?? "").trim().replace(/[^\d+]/g, "");
    if (!s)
        return "";
    if (s.startsWith("+"))
        return "+" + s.slice(1).replace(/\D/g, "");
    if (s.startsWith("00"))
        return "+" + s.slice(2);
    const d = DIAL[cc as Exclude<CC, "">];
    if (!d)
        return "+" + s;
    if (s.startsWith(d.code) && d.nat.includes(s.length - d.code.length))
        return "+" + s;
    if (d.trunk && d.trunk !== d.code && s.startsWith(d.trunk) && d.nat.includes(s.length - d.trunk.length)) {
        return "+" + d.code + s.slice(d.trunk.length);
    }
    if (d.nat.includes(s.length))
        return "+" + d.code + s;
    return "+" + s;
}
export function phoneLooksValid(phone: string, cc: CC = ""): boolean {
    const n = String(phone ?? "").replace(/\D/g, "").length;
    const d = DIAL[cc as Exclude<CC, "">];
    if (!d)
        return n >= 8 && n <= 15;
    return d.nat.some((len) => n === len + d.code.length);
}
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
const EXPERIENCE: Record<string, string> = { none: "Нет опыта", "1-2": "1-2 года", "3+": "3+ лет" };
const AVAILABILITY: Record<string, string> = { full: "Полный день", part: "Частичная занятость", weekends: "Выходные" };
function guessLang(name: string): string {
    return /[а-яёіїєґ]/i.test(name) ? "ru" : "";
}
function cardText(lead: Record<string, unknown>, a: {
    district: string;
    experience: string;
    availability: string;
    subcontractor?: string;
}): string {
    const cc = String(lead.country ?? "") as CC;
    const d = DIAL[cc as Exclude<CC, "">];
    const L: string[] = [];
    L.push(`🧹 <b>КАНДИДАТ НА РАБОТУ (не клиент!)</b>`);
    L.push("");
    L.push(`👤 <b>${escapeHtml(lead.name as string) || "-"}</b>`);
    if (lead.phone) {
        L.push(`📞 ${escapeHtml(lead.phone as string)}${d ? ` ${d.flag}` : ""}`);
        if (!phoneLooksValid(String(lead.phone), cc)) {
            L.push(`⚠️ <b>Номер выглядит неполным${d ? ` для страны ${d.name}` : ""}.</b> Пиши на почту.`);
        }
    }
    if (lead.email)
        L.push(`✉️ <code>${escapeHtml(lead.email as string)}</code>`);
    L.push("");
    if (d)
        L.push(`${d.flag} Страна: ${d.name}`);
    const row = (label: string, val: string) => { if (val)
        L.push(`${label} ${escapeHtml(val)}`); };
    row("📍 Район:", a.district);
    row("🧽 Опыт:", EXPERIENCE[a.experience] ?? a.experience);
    row("🚗 Транспорт:", String((lead.answers as Record<string, unknown> | null)?.transportation ?? ""));
    row("🕐 Занятость:", AVAILABILITY[a.availability] ?? a.availability);
    if (a.subcontractor === "yes")
        L.push(`💼 <b>СУБПОДРЯДЧИК</b> (своя бригада / самозанятый, 50 на 50)`);
    L.push("");
    L.push(lead.language === "ru"
        ? `🗣 Язык: 🇷🇺 русский (имя кириллицей)`
        : `🗣 Язык: ❓ неизвестен - имя латиницей. Спроси или начни с английского, кнопки есть на обоих языках.`);
    const note = String((lead.answers as Record<string, unknown> | null)?.message ?? "").trim();
    if (note)
        L.push(`💬 <i>${escapeHtml(note.slice(0, 400))}</i>`);
    L.push(`📌 Статус: <b>Новый</b> · анкета клинера с лендинга вакансий`);
    return L.join("\n");
}
const CITY: Record<Exclude<CC, "">, string> = { HU: "Budapest", US: "Orlando", CA: "Toronto", DE: "München", PH: "Makati" };
const CITY_RU: Record<Exclude<CC, "">, string> = { HU: "Будапешта", US: "Орландо", CA: "Торонто", DE: "Мюнхена", PH: "Макати" };
function applyMsg(lang: "ru" | "en" | "es" | "de", firstName: string, cc: CC): string {
    const city = CITY[cc as Exclude<CC, "">] ?? "Budapest";
    const cityRu = CITY_RU[cc as Exclude<CC, "">] ?? "Будапешта";
    const hi = { ru: `Здравствуйте${firstName ? ", " + firstName : ""}!`, en: `Hello${firstName ? " " + firstName : ""}!`, es: `¡Hola${firstName ? " " + firstName : ""}!`, de: `Hallo${firstName ? " " + firstName : ""}!` }[lang];
    const body = {
        ru: `Это CLB Clean Life Balance по вашей заявке на работу клинером 🙂\n\nПара вопросов, чтобы двигаться дальше:\n1. В каком районе ${cityRu} удобно работать?\n2. Есть ли опыт уборки и какой?\n3. Когда готовы начать? Работа в утренние часы.\n4. Рассматриваете работу как субподрядчик (своя бригада или самозанятый, 50 на 50) - там всё своё: химия, тряпки, пылесос? Или как part-time клинер у нас, где мы даём всё?\n\nСпасибо!`,
        en: `This is CLB Clean Life Balance about your cleaner job application 🙂\n\nA few questions so we can move forward:\n1. Which part of ${city} is convenient for you to work in?\n2. Do you have cleaning experience, and what kind?\n3. When could you start? Most of our jobs are in the morning.\n4. Are you looking to work as a subcontractor (your own team or self-employed, 50/50 - you bring your own chemicals, cloths and vacuum), or as a part-time cleaner with us, where we provide everything?\n\nThank you!`,
        es: `Le escribo de CLB Clean Life Balance por su solicitud de trabajo como limpiador 🙂\n\nAlgunas preguntas para seguir adelante:\n1. ¿En qué zona de ${city} le conviene trabajar?\n2. ¿Tiene experiencia en limpieza y de qué tipo?\n3. ¿Cuándo podría empezar? Casi todo el trabajo es por la mañana.\n4. ¿Le interesa trabajar como subcontratista (su propio equipo o por cuenta propia, 50/50, usted trae sus productos, paños y aspiradora) o como limpiador a tiempo parcial con nosotros, donde ponemos todo?\n\n¡Gracias!`,
        de: `Hier ist CLB Clean Life Balance wegen Ihrer Bewerbung als Reinigungskraft 🙂\n\nEin paar Fragen, damit es weitergeht:\n1. In welchem Teil von ${city} können Sie gut arbeiten?\n2. Haben Sie Reinigungserfahrung, und welche?\n3. Wann könnten Sie anfangen? Die meisten Einsätze sind vormittags.\n4. Möchten Sie als Subunternehmer arbeiten (eigenes Team oder selbstständig, 50/50, eigene Mittel, Tücher und Staubsauger) oder als Teilzeitkraft bei uns, wo wir alles stellen?\n\nVielen Dank!`,
    }[lang];
    return `${hi} ${body}`;
}
function applicantKeyboard(leadId: string, base: string, dashKey: string, phone?: string, name?: string, lang?: string, cc: CC = "") {
    const rows: Array<Array<Record<string, string>>> = [];
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (digits && phoneLooksValid(String(phone ?? ""), cc)) {
        const firstName = String(name ?? "").trim().split(/\s+/)[0] || "";
        const btn = (l: "ru" | "en" | "es" | "de", label: string) => ({ text: label, url: `https://wa.me/${digits}?text=${encodeURIComponent(applyMsg(l, firstName, cc))}` });
        const ru = btn("ru", "💬 WhatsApp 🇷🇺"), en = btn("en", "💬 WhatsApp 🇬🇧"), es = btn("es", "💬 WhatsApp 🇪🇸"), de = btn("de", "💬 WhatsApp 🇩🇪");
        if (lang === "ru")
            rows.push([ru, en]);
        else if (cc === "US")
            rows.push([en, es]);
        else if (cc === "DE")
            rows.push([de, en]);
        else if (cc === "PH")
            rows.push([en]);
        else
            rows.push([en, ru]);
    }
    rows.push([{ text: "В работе", callback_data: `s:${leadId}:in_progress` }, { text: "Follow-up", callback_data: `s:${leadId}:follow_up` }]);
    rows.push([{ text: "✅ Принята", callback_data: `s:${leadId}:won` }, { text: "❌ Не подходит", callback_data: `s:${leadId}:lost` }]);
    rows.push([{ text: "🚫 Нет связи", callback_data: `s:${leadId}:junk` }]);
    if (base)
        rows.push([{ text: "🔗 Открыть карточку", url: `${base}/?key=${encodeURIComponent(dashKey)}&lead=${leadId}` }]);
    return { inline_keyboard: rows };
}
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        if (req.method === "OPTIONS")
            return new Response("ok", { headers: CORS });
        if (req.method !== "POST")
            return new Response("ok", { headers: CORS });
        try {
            let body: Record<string, unknown> = {};
            try {
                body = await req.json();
            }
            catch {
                return json({ ok: false, error: "bad json" }, 400);
            }
            if (String(body.website ?? "").trim() !== "")
                return json({ ok: true });
            const name = String(body.name ?? "").trim().slice(0, 120);
            const district = String(body.district ?? "").trim().slice(0, 120);
            const country = countryFrom(String(body.country ?? ""), String(body.city ?? ""), district);
            const phone = normalizePhone(String(body.phone ?? ""), country);
            const emailRaw = String(body.email ?? "").trim().slice(0, 160);
            const email = isEmail(emailRaw) ? emailRaw.toLowerCase() : "";
            if (!name || (phone.replace(/\D/g, "").length < 8 && !email))
                return json({ ok: false, error: "validation" }, 400);
            const experience = String(body.experience ?? "").trim().slice(0, 40);
            const transportation = String(body.transportation ?? "").trim().slice(0, 40);
            const message = String(body.message ?? "").trim().slice(0, 1000);
            const availability = String(body.availability ?? "").trim().slice(0, 20);
            const subcontractor = String(body.subcontractor ?? "").trim().toLowerCase() === "yes" ? "yes" : "";
            const hash = await sha256Hex(`applicant|${phone}`);
            const { data: dup } = await supabase.from("crm_leads").select("id").eq("content_hash", hash).limit(1);
            if (dup && dup.length) {
                await supabase.from("crm_timeline").insert({ lead_id: dup[0].id, kind: "note", body: "🔁 Повторная анкета клинера с лендинга", meta: { answers: { district, experience, availability } } });
                return json({ ok: true, duplicate: true, id: dup[0].id });
            }
            const p9 = phone.replace(/[^0-9]/g, "").slice(-9);
            if (p9.length >= 7) {
                const { data: prior } = await supabase.from("crm_leads").select("id")
                    .eq("source", "job_application").ilike("phone", `%${p9}`)
                    .order("created_at", { ascending: false }).limit(1);
                if (prior?.[0]) {
                    await supabase.from("crm_timeline").insert({ lead_id: prior[0].id, kind: "note", body: "🔁 Повторная анкета клинера с лендинга", meta: { answers: { district, experience, availability } } });
                    return json({ ok: true, duplicate: true, id: prior[0].id });
                }
            }
            const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
            const ipHash = ip ? (await sha256Hex(`ip|${ip}`)).slice(0, 24) : "";
            if (ipHash) {
                const hourAgo = new Date(Date.now() - 3600000).toISOString();
                const { count } = await supabase.from("crm_leads")
                    .select("id", { count: "exact", head: true })
                    .eq("source", "job_application")
                    .eq("answers->>ip_hash", ipHash)
                    .gte("created_at", hourAgo);
                if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) {
                    console.warn("applicant rate limit: ip", ipHash);
                    return json({ ok: true });
                }
            }
            const tenMinAgo = new Date(Date.now() - 600000).toISOString();
            const { count: recent } = await supabase.from("crm_leads")
                .select("id", { count: "exact", head: true })
                .eq("source", "job_application")
                .gte("created_at", tenMinAgo);
            if ((recent ?? 0) >= MAX_GLOBAL_PER_10MIN) {
                console.warn("applicant rate limit: global");
                return json({ ok: true });
            }
            const answers = { district, experience, availability, subcontractor, ip_hash: ipHash, email, country, transportation, message, phone_valid: phoneLooksValid(phone, country) };
            const rawText = [
                "🧹 КАНДИДАТ НА РАБОТУ (клинер), не клиент. Анкета с лендинга вакансий.",
                district ? `Район: ${district}` : "",
                country ? `Страна: ${DIAL[country as Exclude<CC, "">].name}` : "",
                email ? `Почта: ${email}` : "",
                transportation ? `Транспорт: ${transportation}` : "",
                message ? `От кандидата: ${message}` : "",
                phone && !phoneLooksValid(phone, country) ? "⚠️ Телефон выглядит неполным, проверить" : "",
                experience ? `Опыт: ${EXPERIENCE[experience] ?? experience}` : "",
                availability ? `Занятость: ${AVAILABILITY[availability] ?? availability}` : "",
                subcontractor ? "💼 Хочет работать как СУБПОДРЯДЧИК (своя бригада / самозанятый, 50 на 50)" : "",
            ].filter(Boolean).join("\n");
            const baseLead = {
                status: "new",
                name,
                phone,
                email,
                country,
                language: String(body.lang ?? body.language ?? "").trim() || guessLang(name),
                campaign: "🧹 ВАКАНСИЯ: клинеры",
                source: "job_application",
                raw_text: rawText,
                content_hash: hash,
                received_at: new Date().toISOString(),
                answers,
            };
            const { data: inserted, error } = await supabase.from("crm_leads").insert(baseLead).select("*").single();
            if (error) {
                console.error("insert applicant", error);
                return json({ ok: false }, 500);
            }
            const finish = (async () => {
                try {
                    const cfg = await getConfig();
                    await supabase.from("crm_timeline").insert({ lead_id: inserted.id, kind: "lead_created", body: "Анкета клинера с лендинга вакансий", meta: { answers } });
                    const token = cfg.telegram_bot_token, chatId = cfg.cards_chat_id;
                    if (token && chatId) {
                        const sent = await tg(token, "sendMessage", {
                            chat_id: chatId,
                            text: cardText(inserted, { district, experience, availability, subcontractor }),
                            parse_mode: "HTML",
                            disable_web_page_preview: true,
                            reply_markup: applicantKeyboard(inserted.id, cfg.dashboard_public_base || "", cfg.dashboard_secret || "", inserted.phone as string, inserted.name as string, inserted.language as string, country),
                        });
                        const result = sent?.result as {
                            chat?: {
                                id?: number;
                            };
                            message_id?: number;
                        } | undefined;
                        if (result?.message_id) {
                            await supabase.from("crm_leads").update({ tg_chat_id: result.chat?.id, tg_message_id: result.message_id }).eq("id", inserted.id);
                        }
                    }
                }
                catch (e) {
                    console.error("post-insert pipeline failed (applicant already saved)", e);
                }
            })();
            const er = (globalThis as {
                EdgeRuntime?: {
                    waitUntil?: (p: Promise<unknown>) => void;
                };
            }).EdgeRuntime;
            if (er?.waitUntil)
                er.waitUntil(finish);
            else
                await finish;
            return json({ ok: true, id: inserted.id });
        }
        catch (e) {
            console.error("applicant intake error", e);
            return json({ ok: false }, 500);
        }
    });
