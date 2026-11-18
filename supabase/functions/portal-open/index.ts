// portal-open (Revenue project): Revenue Analytics opens only through the Sales Intelligence Portal (Amit, 18 Nov 2026).
// The portal sends the person's portal sign-in (a Calling-project token). It is checked with the Calling project itself, then
// their Revenue access is read from the portal (portal_me). A 12-hour grant is written to public.portal_grant (read by
// is_allowed / can_see_students) and a one-time sign-in link (magic link, never emailed) to the dashboard is returned.
// verify_jwt = false: the token is a Calling one, checked below. Uses this project's own SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY;
// the Calling URL and publishable key are public by design.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PORTAL_URL = 'https://ybkldfcilvibryoxcuvq.supabase.co';
const PORTAL_KEY = 'sb_publishable_Ywx9a1pcD6tbJDDtcS_wAw_PuJBtLBw';
const TARGET = 'https://counsellor-performance.amitray.workers.dev/';
const CORS = {
  'Access-Control-Allow-Origin': 'https://sales-intelligence-portal.amitray.workers.dev',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { portal_token } = await req.json().catch(() => ({}));
    if (!portal_token) return out({ error: 'Please sign in again.' }, 401);
    const who = { apikey: PORTAL_KEY, Authorization: `Bearer ${portal_token}`, 'Content-Type': 'application/json' };
    const u = await fetch(`${PORTAL_URL}/auth/v1/user`, { headers: who });
    if (!u.ok) return out({ error: 'Please sign in again.' }, 401);
    const me = await fetch(`${PORTAL_URL}/rest/v1/rpc/portal_me`, { method: 'POST', headers: who, body: '{}' });
    const j = me.ok ? await me.json() : null;
    const email = String(j?.email || '').toLowerCase();
    const acc = j?.access?.revenue;
    if (!email || !acc) return out({ error: 'You do not have access to this dashboard. Ask a portal admin.' }, 403);

    const g = await fetch(`${SB_URL}/rest/v1/portal_grant?on_conflict=email`, {
      method: 'POST', headers: { ...admin, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ email, role: acc.role, students: !!acc.opts?.students, granted_at: new Date().toISOString() }),
    });
    if (!g.ok) return out({ error: 'Could not record access (' + g.status + ').' }, 500);

    // the person needs an account in this project too (created on first open, already confirmed, no password)
    await fetch(`${SB_URL}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email, email_confirm: true }) });
    const l = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email, redirect_to: TARGET }),
    });
    const lj = await l.json().catch(() => ({}));
    const link = lj.action_link || lj.properties?.action_link;
    if (!l.ok || !link) return out({ error: 'Could not open the dashboard: ' + (lj.msg || lj.error_description || l.status) }, 500);
    return out({ url: link });
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
});
