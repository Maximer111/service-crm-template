import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalize } from './normalize.ts';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
if (import.meta.main)
    Deno.serve(async (req: Request) => {
        if (req.method !== 'POST')
            return response({ ok: false, error: 'method not allowed' }, 405);
        const { data: config, error: configError } = await db.from('crm_app_config').select('value').eq('key', 'intake_secret').maybeSingle();
        if (configError || !config?.value || config.value === 'CHANGE_ME' || req.headers.get('x-intake-secret') !== config.value)
            return response({ ok: false, error: 'forbidden' }, 403);
        let body: Record<string, unknown>;
        try {
            const raw = await req.text();
            if (raw.length > 30000)
                return response({ ok: false, error: 'payload too large' }, 413);
            body = JSON.parse(raw);
            if (!body || Array.isArray(body) || typeof body !== 'object')
                throw new Error('invalid payload');
        }
        catch {
            return response({ ok: false, error: 'invalid JSON' }, 400);
        }
        let lead;
        try {
            lead = normalize(body);
        }
        catch (e) {
            return response({ ok: false, error: (e as Error).message }, 400);
        }
        const key = [new Date().toISOString().slice(0, 10), lead.phone, lead.name, lead.email, lead.service, lead.campaign, lead.raw_text].join('|');
        const content_hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))).map(b => b.toString(16).padStart(2, '0')).join('');
        const { data, error } = await db.from('crm_makati_inquiries').insert({ ...lead, content_hash }).select('id').single();
        if (error?.code === '23505') {
            const { data: existing, error: lookupError } = await db.from('crm_makati_inquiries').select('id').eq('content_hash', content_hash).single();
            if (!lookupError && existing?.id)
                return response({ ok: true, id: existing.id, duplicate: true });
        }
        if (error || !data?.id)
            return response({ ok: false, error: 'CRM persistence failed' }, 500);
        return response({ ok: true, id: data.id, duplicate: false });
    });
