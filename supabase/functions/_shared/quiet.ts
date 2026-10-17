export function applyQuiet(cfg: Record<string, string>, now = new Date()): Record<string, string> {
    const until = Date.parse(cfg.whatsapp_quiet_until ?? "");
    const cadenceFrom = Date.parse(cfg.whatsapp_cadence_from ?? "");
    const out = { ...cfg };
    for (const k of Object.keys(out)) {
        if (!/^whatsapp_.*_enabled$/.test(k))
            continue;
        const gate = k === "whatsapp_cadence_enabled" ? cadenceFrom : until;
        if (Number.isFinite(gate) && now.getTime() < gate)
            out[k] = "false";
    }
    return out;
}
