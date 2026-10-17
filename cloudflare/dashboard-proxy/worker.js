const SUPABASE_PROJECT = "YOUR_PROJECT_REF";
function ourCookies(upstream) {
    let list = [];
    if (typeof upstream.headers.getSetCookie === "function") {
        list = upstream.headers.getSetCookie();
    }
    else {
        const raw = upstream.headers.get("set-cookie");
        if (raw)
            list = raw.split(/,\s(?=[A-Za-z0-9_]+=)/);
    }
    return list.filter((c) => /^crm_sess=/.test(c));
}
export default {
    async fetch(request) {
        const src = new URL(request.url);
        const target = new URL(`https://${SUPABASE_PROJECT}.supabase.co/functions/v1/crm-dashboard`);
        for (const [k, v] of src.searchParams)
            target.searchParams.set(k, v);
        const init = { method: request.method, headers: { Accept: "text/html" } };
        const cookie = request.headers.get("cookie");
        if (cookie)
            init.headers["Cookie"] = cookie;
        if (request.method === "POST") {
            init.body = await request.text();
            init.headers["Content-Type"] = request.headers.get("content-type") || "application/x-www-form-urlencoded";
        }
        const upstream = await fetch(target.toString(), init);
        const out = new Headers();
        out.set("cache-control", "no-store");
        for (const c of ourCookies(upstream))
            out.append("set-cookie", c);
        if (src.searchParams.get("action") === "export") {
            out.set("content-type", "text/csv; charset=utf-8");
            out.set("content-disposition", upstream.headers.get("content-disposition") || "attachment; filename=export.csv");
            return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: out });
        }
        out.set("content-type", "text/html; charset=utf-8");
        return new Response(await upstream.text(), { status: upstream.status, headers: out });
    },
};
