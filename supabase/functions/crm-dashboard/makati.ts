import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const statuses = ['new', 'contacted', 'booked', 'completed', 'lost'];
export async function makatiUpdate(db: SupabaseClient, form: URLSearchParams) {
    const id = form.get('id') || '', status = form.get('status') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id) || !statuses.includes(status))
        throw new Error('Invalid Makati update');
    const { error } = await db.from('crm_makati_inquiries').update({ status, owner_notes: (form.get('owner_notes') || '').slice(0, 8000), updated_at: new Date().toISOString() }).eq('id', id);
    if (error)
        throw new Error('Could not save Makati inquiry');
}
export async function makatiView(db: SupabaseClient, key: string, id: string | null) {
    const base = '?key=' + encodeURIComponent(key) + '&view=makati';
    const heading = '<h2>Makati · Заявки / Inquiries</h2><p>Website enquiries with source attribution. Status changes here do not send messages.</p>';
    if (id) {
        const { data: r, error } = await db.from('crm_makati_inquiries').select('*').eq('id', id).maybeSingle();
        if (error || !r)
            return heading + '<p>Inquiry not found.</p>';
        const a = r.attribution || {};
        return heading + `<p><a href="${base}">← All Makati inquiries</a></p><div class="panel"><h3>${esc(r.name || 'Website inquiry')}</h3><p>Branch: Makati · Source: ${esc(r.source)} · Contact: ${esc(r.contact_method)}</p><p>Phone: ${esc(r.phone)}<br>Email: ${esc(r.email)}<br>Service: ${esc(r.service)}<br>Campaign: ${esc(r.campaign)}<br>Received: ${esc(r.created_at)}</p><p>Acquisition: ${esc(a.utm_source || 'Unattributed')} / ${esc(a.utm_medium || '')}<br>UTM campaign: ${esc(a.utm_campaign)}<br>Content: ${esc(a.utm_content)}<br>Landing: ${esc(a.landing)}<br>Referrer: ${esc(a.referrer)}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.raw_text)}</pre><form method="post" action="?key=${encodeURIComponent(key)}&action=makati_update"><input type="hidden" name="id" value="${esc(r.id)}"><label>Status <select name="status">${statuses.map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label><label>Owner notes<textarea name="owner_notes" rows="5" maxlength="8000">${esc(r.owner_notes)}</textarea></label><button>Save</button></form></div>`;
    }
    const { data: rows, error } = await db.from('crm_makati_inquiries').select('id,name,service,contact_method,status,created_at,attribution').order('created_at', { ascending: false }).limit(300);
    if (error)
        return heading + '<p>Could not load inquiries. Please retry.</p>';
    return heading + '<div class="panel" style="overflow:auto"><table><thead><tr><th>Received</th><th>Client</th><th>Service</th><th>Channel</th><th>Source</th><th>Status</th></tr></thead><tbody>' + (rows || []).map(r => `<tr><td>${esc(r.created_at)}</td><td><a href="${base}&makati_id=${esc(r.id)}">${esc(r.name || 'Website inquiry')}</a></td><td>${esc(r.service)}</td><td>${esc(r.contact_method)}</td><td>${esc(r.attribution?.utm_source || 'Unattributed')}</td><td>${esc(r.status)}</td></tr>`).join('') + '</tbody></table>' + (!rows?.length ? '<p>No Makati inquiries yet.</p>' : '') + '</div>';
}
