export interface PayoutInput {
    amount: number;
    directPayout: number;
    hours: number | null;
    jobRate: number;
    masterPayType: string;
    masterPct: number | null;
}
export interface PayoutResult {
    payout: number;
    pct: number | null;
    hourly: boolean;
}
export function computePayout(o: PayoutInput): PayoutResult {
    if (o.directPayout > 0)
        return { payout: o.directPayout, pct: null, hourly: false };
    if (o.hours != null && o.hours > 0)
        return { payout: Math.round(o.hours * o.jobRate), pct: null, hourly: true };
    if (o.masterPayType === "hourly")
        return { payout: 0, pct: null, hourly: true };
    if (o.masterPct != null)
        return { payout: Math.round((o.amount * o.masterPct) / 100), pct: o.masterPct, hourly: false };
    return { payout: 0, pct: null, hourly: false };
}
if (import.meta.main) {
    const eq = (got: unknown, want: unknown, what: string) => {
        const a = JSON.stringify(got), b = JSON.stringify(want);
        if (a !== b)
            throw new Error(`${what}\n  получили ${a}\n  ждали   ${b}`);
        console.log("ok -", what);
    };
    const base = { amount: 100000, directPayout: 0, hours: null, jobRate: 0, masterPayType: "percent", masterPct: null };
    eq(computePayout({ ...base, masterPct: 30 }), { payout: 30000, pct: 30, hourly: false }, "процентный мастер без часов - 30% от суммы");
    eq(computePayout({ ...base, masterPct: 30, hours: 4, jobRate: 3000 }), { payout: 12000, pct: null, hourly: true }, "процентный мастер с часами - платим за часы, процент игнорируем");
    eq(computePayout({ ...base, masterPayType: "hourly", hours: 5, jobRate: 2500 }), { payout: 12500, pct: null, hourly: true }, "почасовой мастер - часы на ставку заказа");
    eq(computePayout({ ...base, masterPayType: "hourly", hours: null }), { payout: 0, pct: null, hourly: true }, "почасовой мастер без часов - выплату не выдумываем");
    eq(computePayout({ ...base, masterPct: 30, hours: 4, jobRate: 3000, directPayout: 9000 }), { payout: 9000, pct: null, hourly: false }, "фикс перебивает и часы, и процент");
    eq(computePayout({ ...base }), { payout: 0, pct: null, hourly: false }, "ничего не задано - ноль, а не тихие 30%");
    eq(computePayout({ ...base, masterPct: 0 }), { payout: 0, pct: 0, hourly: false }, "явный 0% - это 0%, а не «не задано»");
    eq(computePayout({ ...base, amount: 33333, masterPct: 30 }), { payout: 10000, pct: 30, hourly: false }, "процент округляется до форинта");
    console.log("\nвсе проверки выплаты прошли");
}
