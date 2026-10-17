export function submittedWebsiteFields(source: string, body: Record<string, unknown>, rawText: string) {
    const fields: {
        service?: string;
        what_to_clean?: string;
        contact_method?: string;
    } = {};
    if (source !== "website")
        return fields;
    let form: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            form = { ...parsed, ...(parsed.simple && typeof parsed.simple === "object" && !Array.isArray(parsed.simple) ? parsed.simple : {}) };
        }
    }
    catch { }
    const pick = (...keys: string[]) => {
        for (const data of [body, form])
            for (const key of keys) {
                if (typeof data[key] === "string" && data[key].trim())
                    return data[key].trim().slice(0, 200);
            }
        return "";
    };
    const service = pick("service").toLowerCase();
    const item = /^(sofa|mattress|carpet)$/.test(service) ? service : "";
    if (item || service === "upholstery")
        fields.service = "upholstery";
    else if (["cleaning", "deep", "regular"].includes(service))
        fields.service = service;
    const what = pick("what_to_clean", "whatToClean", "items", "type", "rooms") || item;
    if (what)
        fields.what_to_clean = what;
    const contact = pick("contact_method", "contactMethod");
    if (contact)
        fields.contact_method = contact;
    return fields;
}
