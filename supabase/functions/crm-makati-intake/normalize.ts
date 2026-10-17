export function normalize(body: Record<string, unknown>) {
    const text = (key: string, max: number) => String(body[key] ?? '').trim().slice(0, max);
    if (body.branch !== 'makati')
        throw new Error('branch must be makati');
    const phone = text('phone', 40).replace(/[^+\d]/g, '');
    if (phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)
        throw new Error('valid phone required');
    const method = text('contact_method', 20) || 'phone';
    if (!['phone', 'whatsapp', 'viber', 'email'].includes(method))
        throw new Error('invalid contact_method');
    const input = body.attribution && typeof body.attribution === 'object' && !Array.isArray(body.attribution) ? body.attribution as Record<string, unknown> : {};
    const attribution: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'landing', 'referrer', 'first_seen', 'gclid', 'fbclid', 'ga_client_id', 'ga_session_id']) {
        if (typeof input[key] === 'string')
            attribution[key] = input[key].slice(0, 1000);
    }
    return { branch: 'makati', source: 'website', name: text('name', 200), phone, email: text('email', 254), contact_method: method, service: text('service', 200) || text('what_to_clean', 200), campaign: text('campaign', 300), raw_text: text('raw_text', 12000), attribution };
}
