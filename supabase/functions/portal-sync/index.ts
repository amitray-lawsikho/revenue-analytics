// portal-sync (Revenue project): the Sales Intelligence Portal's Data sync page (Amit, 25 Nov 2026) shows when Revenue Analytics
// last updated and starts its Update data, without opening the dashboard. Same check as portal-open: the portal sign-in (a
// Calling-project token) is checked with the Calling project, then the person's Revenue access is read from portal_me.
// Body: { portal_token, action: "status" | "run" }. "run" = the dashboard's own Update data, for Revenue admins only (Amit, 25 Nov 2026).
// verify_jwt = false: the token is a Calling one, checked below.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PORTAL_URL = 'https://ybkldfcilvibryoxcuvq.supabase.co';
const PORTAL_KEY = 'sb_publishable_Ywx9a1pcD6tbJDDtcS_wAw_PuJBtLBw';
const CORS = {
  'Access-Control-Allow-Origin': 'https://sales-intelligence-portal.amitray.workers.dev',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const rpc = async (fn: string, args: unknown = {}) => {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: admin, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || `HTTP ${r.status}`);
  return j;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { portal_token, action } = await req.json().catch(() => ({}));
    if (!portal_token) return out({ error: 'Please sign in again.' }, 401);
    const who = { apikey: PORTAL_KEY, Authorization: `Bearer ${portal_token}`, 'Content-Type': 'application/json' };
    const u = await fetch(`${PORTAL_URL}/auth/v1/user`, { headers: who });
    if (!u.ok) return out({ error: 'Please sign in again.' }, 401);
    const me = await fetch(`${PORTAL_URL}/rest/v1/rpc/portal_me`, { method: 'POST', headers: who, body: '{}' });
    const j = me.ok ? await me.json() : null;
    const email = String(j?.email || '').toLowerCase();
    if (!email || !j?.access?.revenue) return out({ error: 'You do not have access to Revenue Analytics.' }, 403);

    if (action === 'run') {
      // only Revenue admins update the data (Amit, 25 Nov 2026)
      if (j.access.revenue.role !== 'admin') return out({ error: 'Only Revenue Analytics admins can update the data.' }, 403);
      const r = await rpc('portal_request_refresh', { p_email: email });
      return out({ result: r, status: await rpc('portal_refresh_status') });
    }
    return out({ status: await rpc('portal_refresh_status') });
  } catch (e) {
    const m = String((e as Error).message || e);
    return out({ error: /token/i.test(m) ? "Update isn't set up yet (GitHub token missing in Supabase)." : m.slice(0, 200) }, 500);
  }
});
