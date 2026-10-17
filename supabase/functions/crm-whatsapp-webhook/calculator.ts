export const RATE = { one_off: 7500, recurring: 6500 } as const;
export const MIN_HOURS = 4;
const MIN_HOURS_BY_TIER = { standard: 4, regular: 4, deep: 5 } as const;
const MIN_VISIT = { standard: 26000, regular: 26000, deep: 37500 } as const;
const MINUTES_PER_M2 = { standard: 3.5, regular: 3.5, deep: 8 } as const;
export type CleaningTier = "standard" | "regular" | "deep" | "post_renovation";
export type QuoteInput = {
    cleaning?: {
        tier: CleaningTier;
        area_m2?: number;
        bathrooms?: number;
        stairs_flights?: number;
        pets?: boolean;
        neglect?: "none" | "some" | "heavy";
    };
    windows?: {
        type: "standard" | "large" | "tall" | "panoramic" | "balcony_door" | "roof";
        sashes: number;
        old_wooden_double?: boolean;
        blinds?: boolean;
    }[];
    upholstery?: {
        item: "sofa_2_3" | "sofa_corner" | "sofa_leather_3" | "armchair" | "chair" | "mattress_one_side" | "mattress_two_sides" | "carpet_m2";
        units: number;
    }[];
    extras?: ("oven" | "oven_glass" | "fridge" | "extractor" | "chandelier")[];
    steam_rooms?: number;
};
export type QuoteLine = {
    label: string;
    units: number;
    unit: string;
    low: number;
    high: number;
};
export type Quote = {
    lines: QuoteLine[];
    hours?: number;
    rate?: number;
    hourly_only?: boolean;
    total: {
        low: number;
        high: number;
    } | null;
    minimum?: string;
    missing: string[];
    notes: string[];
};
const WINDOW: Record<string, number> = { standard: 3000, large: 4500, tall: 5500, panoramic: 6000, balcony_door: 6500, roof: 5000 };
const SOFT: Record<string, {
    label: string;
    unit: string;
    low: number;
    high: number;
    note?: string;
}> = {
    sofa_2_3: { label: "Straight sofa, 2-3 seats", unit: "pc", low: 22000, high: 25000 },
    sofa_corner: { label: "Corner sofa", unit: "pc", low: 30000, high: 35000 },
    sofa_leather_3: { label: "Leather sofa, 3 seats", unit: "pc", low: 28000, high: 28000, note: "Leather is cleaned by hand, never by extraction, and a photo has to confirm it is real leather." },
    armchair: { label: "Armchair", unit: "pc", low: 8000, high: 8000 },
    chair: { label: "Chair", unit: "pc", low: 3000, high: 3000 },
    mattress_one_side: { label: "Mattress, one side", unit: "pc", low: 15000, high: 15000, note: "Say in words that this is one side only; both sides are 25 000." },
    mattress_two_sides: { label: "Mattress, both sides", unit: "pc", low: 25000, high: 25000, note: "Say in words that both sides are included." },
    carpet_m2: { label: "Carpet", unit: "m²", low: 2500, high: 2500, note: "Each rug is its own line and needs its size in centimetres; a photo does not give the size." },
};
const EXTRA: Record<string, {
    label: string;
    price: number;
    note?: string;
}> = {
    oven: { label: "Oven inside", price: 8000, note: "Priced as a standard oven, 8 000. If the glass door has to come apart it is 15 000, and the cleaner says so before starting, never after." },
    oven_glass: { label: "Oven with the glass taken apart", price: 15000 },
    fridge: { label: "Fridge inside", price: 5000 },
    extractor: { label: "Extractor with filter", price: 6000 },
    chandelier: { label: "Chandelier", price: 5000 },
};
const MIN_UPHOLSTERY = 15000;
const STEAM_PER_ROOM = 20000;
const money = (value: number) => value.toLocaleString("hu-HU").replace(/ /g, " ");
const line = (label: string, units: number, unit: string, low: number, high = low): QuoteLine => ({ label, units, unit, low: low * units, high: high * units });
export function priceQuote(input: QuoteInput): Quote {
    const lines: QuoteLine[] = [];
    const missing: string[] = [];
    const notes: string[] = [];
    let hours: number | undefined;
    let rate: number | undefined;
    let hourlyOnly = false;
    const c = input.cleaning;
    if (c) {
        if (c.tier === "post_renovation") {
            hourlyOnly = true;
            notes.push("After renovation is hourly only: 9 500 to 10 500 Ft per hour per cleaner, paid for the time actually worked, no fixed total and no cap. Windows are not in that rate.");
        }
        else if (!c.area_m2 || c.area_m2 <= 0) {
            missing.push("The area being cleaned, in square metres. Without it there are no hours and no price.");
        }
        else {
            rate = c.tier === "regular" ? RATE.recurring : RATE.one_off;
            const extraMinutes = Math.max(0, (c.bathrooms ?? 0) - 2) * 30 + (c.stairs_flights ?? 0) * 20;
            const tier = c.tier as keyof typeof MIN_VISIT;
            const minHours = MIN_HOURS_BY_TIER[tier];
            hours = Math.max(minHours, Math.ceil((c.area_m2 * MINUTES_PER_M2[tier] + extraMinutes) / 60));
            const label = `${c.tier === "deep" ? "Deep" : c.tier === "regular" ? "Regular" : "Standard"} cleaning, ${c.area_m2} m², ${hours} hours at ${money(rate)} Ft`;
            let low = hours === minHours ? MIN_VISIT[tier] : hours * rate, high = low;
            if (c.pets) {
                low = Math.round(low * 1.15);
                high = Math.round(high * 1.15);
                notes.push("Pets add 15 percent for the hair in the textiles.");
            }
            if (c.neglect === "some") {
                high = Math.round(high * 1.5);
                notes.push("A flat that has not been cleaned in a long time takes 50 percent longer; the top of the range covers it.");
            }
            if (c.neglect === "heavy") {
                high = Math.round(high * 2);
                notes.push("A flat nobody has cleaned for years can take twice the hours; the top of the range covers it.");
            }
            lines.push({ label, units: hours, unit: "h", low, high });
            if (hours === minHours)
                notes.push(`This is the minimum visit, ${minHours} hours, ${money(MIN_VISIT[tier])} Ft.`);
        }
    }
    for (const w of input.windows ?? []) {
        const each = WINDOW[w.type];
        if (!each || !(w.sashes > 0)) {
            missing.push("For the windows: how many sashes, how tall they are and whether the frames are old wooden double ones. A window is not a unit, a sash is.");
            continue;
        }
        const price = (each + (w.blinds ? 1000 : 0)) * (w.old_wooden_double ? 2 : 1);
        lines.push(line(`Windows, ${w.type.replace("_", " ")}${w.old_wooden_double ? ", old wooden double" : ""}`, w.sashes, "sash", price));
    }
    if (input.windows?.length)
        notes.push("Windows are counted by sash and both sides, frame, sill and runners are included.");
    for (const item of input.upholstery ?? []) {
        const spec = SOFT[item.item];
        if (!spec || !(item.units > 0))
            continue;
        lines.push(line(spec.label, item.units, spec.unit, spec.low, spec.high));
        if (spec.note)
            notes.push(spec.note);
    }
    for (const key of input.extras ?? []) {
        const spec = EXTRA[key];
        if (!spec)
            continue;
        lines.push(line(spec.label, 1, "pc", spec.price));
        if (spec.note)
            notes.push(spec.note);
    }
    if (input.steam_rooms && input.steam_rooms > 0) {
        lines.push(line("Steam on tiles and grout", input.steam_rooms, "room", STEAM_PER_ROOM));
        notes.push("Steam on grout is per room, never per flat.");
    }
    const total = lines.length && !hourlyOnly
        ? { low: lines.reduce((sum, l) => sum + l.low, 0), high: lines.reduce((sum, l) => sum + l.high, 0) }
        : null;
    let minimum: string | undefined;
    const upholsteryOnly = Boolean(input.upholstery?.length) && !c && !input.windows?.length;
    if (total && upholsteryOnly && total.low < MIN_UPHOLSTERY) {
        minimum = `The smallest upholstery visit is ${money(MIN_UPHOLSTERY)} Ft, so that is the price for this one.`;
        total.low = MIN_UPHOLSTERY;
        total.high = Math.max(total.high, MIN_UPHOLSTERY);
    }
    if (total && hours && total.low / hours < 5000) {
        notes.push("This works out under 5 000 Ft per hour of work, which means something was counted wrong. Alex confirms it before it goes out.");
    }
    return { lines, hours, rate, hourly_only: hourlyOnly || undefined, total, minimum, missing, notes };
}
