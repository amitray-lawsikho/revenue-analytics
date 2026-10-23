/* Counsellor Performance dashboard. Data: Supabase RPC get_perf / get_courses (row level security on). */
const sb = supabase.createClient(CP_CONFIG.supabaseUrl, CP_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const S = { from: null, to: null, grain: "month", level: "person", sort: "revenue", dir: -1,
            rows: [], prev: [], roster: [], charts: {} };

/* ---------- formatting ---------- */
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function rupees(v, compact = true) {
  if (v == null || !isFinite(v)) return "–";
  const a = Math.abs(v);
  if (compact && a >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
  if (compact && a >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
  return "₹" + inr0.format(v);
}
const num = (v, d = 0) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (v) => (v == null || !isFinite(v) ? "–" : (v * 100).toFixed(1) + "%");

/* ---------- dates (IST) ---------- */
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const D = (s) => new Date(s + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5) + 1;
function fyStart(s) { const d = D(s); const y = d.getUTCMonth() < 3 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(); return `${y}-04-01`; }
function preset(p) {
  const t = istToday(), d = D(t);
  const monthStart = t.slice(0, 8) + "01";
  switch (p) {
    case "today": return [t, t, "day"];
    case "yesterday": { const y = addDays(t, -1); return [y, y, "day"]; }
    case "week": { const dow = (d.getUTCDay() + 6) % 7; return [addDays(t, -dow), t, "day"]; }
    case "month": return [monthStart, t, "day"];
    case "lastmonth": { const e = addDays(monthStart, -1); return [e.slice(0, 8) + "01", e, "week"]; }
    case "fy": return [fyStart(t), t, "month"];
    case "lastfy": { const s = fyStart(t); const ps = (+s.slice(0, 4) - 1) + "-04-01"; return [ps, addDays(s, -1), "month"]; }
  }
}
function periodLabel(p, grain) {
  const d = D(p);
  if (grain === "day") return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  if (grain === "week") return "Wk " + d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  if (grain === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
  const y = d.getUTCFullYear(); return `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

/* ---------- metrics ---------- */
const FIELDS = ["revenue", "new_enrolments", "new_enrolment_revenue", "txns", "outbound", "outbound_answered",
  "inbound", "inbound_answered", "talk_sec", "calls_2m", "calls_5m", "calls_15m"];
function sum(rows) {
  const o = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const r of rows) for (const f of FIELDS) o[f] += Number(r[f]) || 0;
  o.connects = o.outbound_answered + o.inbound_answered;
  o.avg_fee = o.new_enrolments ? o.new_enrolment_revenue / o.new_enrolments : null;
  o.balance = o.revenue - o.new_enrolment_revenue;
  o.connect_rate = o.outbound ? o.outbound_answered / o.outbound : null;
  o.talk_h = o.talk_sec / 3600;
  o.enr_per_100 = o.connects ? (o.new_enrolments * 100) / o.connects : null;
  o.rev_per_talk_h = o.talk_h ? o.revenue / o.talk_h : null;
  return o;
}
const KPIS = [
  ["revenue", "Revenue", (v) => rupees(v)],
  ["new_enrolments", "New enrolments", (v) => num(v)],
  ["avg_fee", "Avg new-enrolment fee", (v) => rupees(v)],
  ["balance", "Balance-payment revenue", (v) => rupees(v)],
  ["outbound", "Outbound dials", (v) => num(v)],
  ["connects", "Connected calls", (v) => num(v)],
  ["talk_h", "Talk hours", (v) => num(v, 1)],
  ["calls_5m", "Conversations 5 min+", (v) => num(v)],
  ["enr_per_100", "Enrolments per 100 connects", (v) => num(v, 2)],
  ["rev_per_talk_h", "Revenue per talk hour", (v) => rupees(v)],
];

/* ---------- data ---------- */
async function rpcAll(fn, args) {
  const out = []; const page = 1000;
  for (let i = 0; ; i += page) {
    const { data, error } = await sb.rpc(fn, args).range(i, i + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) return out;
  }
}
function filtered(rows) {
  const v = $("f-vertical").value, t = $("f-team").value, p = $("f-person").value;
  return rows.filter((r) => (!v || r.vertical === v) && (!t || r.team === t) && (!p || r.email === p));
}

async function load() {
  let grain = $("grain").value;
  const from = $("from").value, to = $("to").value;
  if (!from || !to || from > to) return;
  let note = "";
  if (grain === "day" && daysBetween(from, to) > 92) { grain = "week"; note = "Shown by week (over 92 days)"; }
  S.from = from; S.to = to; S.grain = grain;
  $("trend-note").textContent = note;
  const len = daysBetween(from, to);
  const pTo = addDays(from, -1), pFrom = addDays(from, -len);
  try {
    [S.rows, S.prev] = await Promise.all([
      rpcAll("get_perf", { p_from: from, p_to: to, p_grain: grain }),
      rpcAll("get_perf", { p_from: pFrom, p_to: pTo, p_grain: "fy" }),
    ]);
  } catch (e) { showError(e); return; }
  render();
}

/* ---------- render ---------- */
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function render() {
  const cur = sum(filtered(S.rows)), prev = sum(filtered(S.prev));
  $("kpis").innerHTML = KPIS.map(([k, label, fmt]) => kpiHtml(label, fmt(cur[k]), cur[k], prev[k])).join("");
  renderTrend(); renderByVertical(); renderBoard();
}
function kpiHtml(label, value, c, p) {
  let d = "";
  if (p != null && isFinite(p) && p !== 0 && c != null && isFinite(c)) {
    const ch = (c - p) / Math.abs(p);
    d = `<div class="d ${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(1)}% vs previous period</div>`;
  } else d = `<div class="d muted">no earlier data</div>`;
  return `<div class="kpi"><div class="k">${esc(label)}</div><div class="v num">${value}</div>${d}</div>`;
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}

function chart(id, cfg) {
  if (S.charts[id]) S.charts[id].destroy();
  const ink = css("--muted"), line = css("--line");
  Chart.defaults.color = ink; Chart.defaults.borderColor = line;
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  S.charts[id] = new Chart($(id), cfg);
}

function trendConfig(rows, grain) {
  const g = [...groupBy(rows, (r) => r.period)].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const labels = g.map(([p]) => periodLabel(p, grain));
  const s = g.map(([, rs]) => sum(rs));
  return {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Revenue", data: s.map((x) => x.revenue), backgroundColor: css("--c1"), borderRadius: 4, yAxisID: "y" },
        { type: "line", label: "New enrolments", data: s.map((x) => x.new_enrolments), borderColor: css("--c3"),
          backgroundColor: css("--c3"), tension: 0.3, pointRadius: 3, yAxisID: "y1" },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === "y" ? ` Revenue ${rupees(c.raw)}` : ` New enrolments ${num(c.raw)}` } } },
      scales: { y: { ticks: { callback: (v) => rupees(v) }, grid: { color: css("--line") } },
                y1: { position: "right", grid: { display: false }, beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false } } },
    },
  };
}
function renderTrend() { chart("trend", trendConfig(filtered(S.rows), S.grain)); }

function renderByVertical() {
  const rows = filtered(S.rows);
  const g = [...groupBy(rows, (r) => r.vertical)].map(([v, rs]) => [v, sum(rs)]).sort((a, b) => b[1].revenue - a[1].revenue);
  chart("byvert", {
    type: "bar",
    data: { labels: g.map(([v]) => v), datasets: [{ label: "Revenue", data: g.map(([, s]) => s.revenue),
      backgroundColor: [css("--c1"), css("--c2"), css("--c3")], borderRadius: 4 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: (c) => ` ${rupees(c.raw)} · ${num(g[c.dataIndex][1].new_enrolments)} new enrolments` } } },
      scales: { x: { ticks: { callback: (v) => rupees(v) }, grid: { color: css("--line") } }, y: { grid: { display: false } } } },
  });
}

const COLS = [
  ["revenue", "Revenue", (s) => rupees(s.revenue)],
  ["new_enrolments", "New enr.", (s) => num(s.new_enrolments)],
  ["avg_fee", "Avg fee", (s) => rupees(s.avg_fee)],
  ["balance", "Balance rev.", (s) => rupees(s.balance)],
  ["outbound", "Dials", (s) => num(s.outbound)],
  ["connects", "Connects", (s) => num(s.connects)],
  ["connect_rate", "Connect %", (s) => pct(s.connect_rate)],
  ["talk_h", "Talk h", (s) => num(s.talk_h, 1)],
  ["calls_5m", "5 min+", (s) => num(s.calls_5m)],
  ["enr_per_100", "Enr / 100 conn.", (s) => num(s.enr_per_100, 2)],
  ["rev_per_talk_h", "Rev / talk h", (s) => rupees(s.rev_per_talk_h)],
];
function renderBoard() {
  const rows = filtered(S.rows);
  const key = { vertical: (r) => r.vertical, team: (r) => r.vertical + " · " + r.team, person: (r) => r.email }[S.level];
  let g = [...groupBy(rows, key)].map(([k, rs]) => ({ k, r: rs[0], s: sum(rs) }));
  // counsellors with no activity still appear in the counsellor view
  if (S.level === "person") {
    const seen = new Set(g.map((x) => x.k));
    for (const p of rosterFiltered()) if (!seen.has(p.email)) g.push({ k: p.email, r: p, s: sum([]) });
  }
  const maxRev = Math.max(1, ...g.map((x) => x.s.revenue));
  g.sort((a, b) => S.dir * (((a.s[S.sort] ?? -Infinity) > (b.s[S.sort] ?? -Infinity)) ? 1 : -1));
  const first = S.level === "person" ? ["Counsellor", "Team", "Vertical"] : S.level === "team" ? ["Team", "Vertical"] : ["Vertical"];
  const head = `<thead><tr>${first.map((h) => `<th class="l">${h}</th>`).join("")}${COLS.map(([k, h]) =>
    `<th data-k="${k}" class="${S.sort === k ? "sorted" : ""}">${h}${S.sort === k ? (S.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>`;
  const body = g.map(({ k, r, s }) => {
    const lead = S.level === "person" ? [r.name + (r.role ? ` <span class="muted small">${esc(r.role)}</span>` : ""), r.team, r.vertical]
      : S.level === "team" ? [r.team, r.vertical] : [r.vertical];
    const cells = COLS.map(([c, , f], i) => i === 0
      ? `<td class="num"><span class="bar" style="width:${Math.max(2, (s.revenue / maxRev) * 60)}px"></span>${f(s)}</td>`
      : `<td class="num">${f(s)}</td>`).join("");
    return `<tr class="${S.level === "person" ? "click" : ""}" data-e="${esc(k)}">${lead.map((x, i) =>
      `<td class="l">${i === 0 && S.level === "person" ? x.replace(/^[^<]*/, (m) => esc(m)) : esc(x)}</td>`).join("")}${cells}</tr>`;
  }).join("");
  $("board").innerHTML = head + `<tbody>${body || `<tr><td class="l muted" colspan="20">No data for this period.</td></tr>`}</tbody>`;
}

function rosterFiltered() {
  const v = $("f-vertical").value, t = $("f-team").value, p = $("f-person").value;
  return S.roster.filter((r) => (!v || r.vertical === v) && (!t || r.team === t) && (!p || r.email === p));
}

async function openDrawer(email) {
  const person = S.roster.find((r) => r.email === email); if (!person) return;
  const rows = S.rows.filter((r) => r.email === email);
  const s = sum(rows);
  $("d-name").textContent = person.name;
  $("d-sub").textContent = `${person.role || "Counsellor"} · ${person.team} · ${person.vertical} · ${S.from} to ${S.to}`;
  $("d-kpis").innerHTML = KPIS.map(([k, label, fmt]) => `<div class="kpi"><div class="k">${esc(label)}</div><div class="v num">${fmt(s[k])}</div></div>`).join("");
  $("drawer").hidden = false;
  chart("d-trend", trendConfig(rows, S.grain));
  const { data, error } = await sb.rpc("get_courses", { p_from: S.from, p_to: S.to, p_email: email });
  $("d-courses").innerHTML = error ? `<tr><td>${esc(error.message)}</td></tr>` :
    `<thead><tr><th class="l">Course</th><th>Revenue</th><th>New enr.</th><th>Rows</th></tr></thead><tbody>` +
    (data.map((c) => `<tr><td class="l" style="white-space:normal">${esc(c.course)}</td><td class="num">${rupees(c.revenue)}</td>
      <td class="num">${num(c.new_enrolments)}</td><td class="num">${num(c.txns)}</td></tr>`).join("") ||
      `<tr><td class="l muted" colspan="4">No revenue in this period.</td></tr>`) + "</tbody>";
}

/* ---------- filters ---------- */
function fillFilters() {
  const v = $("f-vertical").value, t = $("f-team").value, p = $("f-person").value;
  const verts = [...new Set(S.roster.map((r) => r.vertical))].sort();
  const teams = [...new Set(S.roster.filter((r) => !v || r.vertical === v).map((r) => r.team))].sort();
  const people = S.roster.filter((r) => (!v || r.vertical === v) && (!t || r.team === t)).sort((a, b) => a.name.localeCompare(b.name));
  const opts = (el, all, items, sel) => { el.innerHTML = `<option value="">${all}</option>` +
    items.map(([val, lab]) => `<option value="${esc(val)}" ${val === sel ? "selected" : ""}>${esc(lab)}</option>`).join(""); };
  opts($("f-vertical"), "All three", verts.map((x) => [x, x]), v);
  opts($("f-team"), "All teams", teams.map((x) => [x, x]), teams.includes(t) ? t : "");
  opts($("f-person"), "All counsellors", people.map((x) => [x.email, x.name]), people.some((x) => x.email === p) ? p : "");
}
function setPreset(p) {
  const [f, t, g] = preset(p);
  $("from").value = f; $("to").value = t; $("grain").value = g;
  document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("on", b.dataset.p === p));
  load();
}

async function loadMeta() {
  const [{ data: roster }, { data: log }, { data: un }] = await Promise.all([
    sb.from("roster").select("email,name,role,team,vertical").order("name"),
    sb.from("refresh_log").select("run_at,status,detail").order("run_at", { ascending: false }).limit(1),
    sb.from("unmapped_names").select("name,kind,rows,fee_paid,last_seen").order("rows", { ascending: false }),
  ]);
  S.roster = roster || [];
  fillFilters();
  const last = log && log[0];
  if (last) {
    const t = new Date(last.run_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    $("fresh").textContent = last.status === "ok" ? `Updated ${t} IST` : `Last refresh failed ${t} IST`;
    $("fresh").className = "chip" + (last.status === "ok" ? "" : " bad");
    $("fresh").title = last.status === "ok" ? "" : (last.detail?.error || "");
  } else { $("fresh").textContent = "Not refreshed yet"; $("fresh").className = "chip warn"; }
  if (un && un.length) {
    $("unmapped-card").hidden = false;
    $("unmapped-count").textContent = `${un.length} names`;
    $("unmapped").innerHTML = `<thead><tr><th class="l">Name as written</th><th class="l">Where</th><th>Rows / calls</th><th>Fee paid</th><th>Last seen</th></tr></thead><tbody>` +
      un.map((u) => `<tr><td class="l">${esc(u.name)}</td><td class="l">${u.kind === "revenue" ? "Revenue sheet" : "Dialler"}</td>
        <td class="num">${num(u.rows)}</td><td class="num">${u.kind === "revenue" ? rupees(u.fee_paid) : "–"}</td><td class="num">${esc(u.last_seen || "")}</td></tr>`).join("") + "</tbody>";
  }
}

function showError(e) { $("fresh").textContent = "Error: " + (e.message || e); $("fresh").className = "chip bad"; }

/* ---------- auth ---------- */
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("auth").hidden = false; $("app").hidden = true; return; }
  const { data: ok } = await sb.rpc("is_allowed");
  if (!ok) {
    $("auth").hidden = false; $("app").hidden = true;
    $("auth-msg").textContent = `${session.user.email} is signed in but not on the allowed list. Ask Amit to add it.`;
    return;
  }
  $("auth").hidden = true; $("app").hidden = false;
  await loadMeta();
  setPreset("month");
}

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-msg").textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email: $("auth-email").value.trim().toLowerCase(), password: $("auth-pass").value });
  $("auth-msg").textContent = error ? error.message : "";
  if (!error) start();
});
$("auth-signup").addEventListener("click", async () => {
  const email = $("auth-email").value.trim().toLowerCase(), password = $("auth-pass").value;
  if (!email || password.length < 8) { $("auth-msg").textContent = "Enter your email and a password of 8+ characters first."; return; }
  const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  $("auth-msg").textContent = error ? error.message : "Check your inbox and click the confirmation link, then sign in here.";
});
$("signout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

/* ---------- events ---------- */
document.querySelectorAll("#presets button").forEach((b) => b.addEventListener("click", () => setPreset(b.dataset.p)));
["from", "to", "grain"].forEach((id) => $(id).addEventListener("change", () => {
  document.querySelectorAll("#presets button").forEach((b) => b.classList.remove("on")); load(); }));
["f-vertical", "f-team", "f-person"].forEach((id) => $(id).addEventListener("change", () => { fillFilters(); render(); }));
document.querySelectorAll("#level button").forEach((b) => b.addEventListener("click", () => {
  S.level = b.dataset.l; document.querySelectorAll("#level button").forEach((x) => x.classList.toggle("on", x === b)); renderBoard(); }));
$("board").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-k]");
  if (th) { const k = th.dataset.k; S.dir = S.sort === k ? -S.dir : -1; S.sort = k; renderBoard(); return; }
  const tr = e.target.closest("tr.click"); if (tr) openDrawer(tr.dataset.e);
});
$("d-close").addEventListener("click", () => { $("drawer").hidden = true; });
$("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("cp-theme", root.dataset.theme); } catch (_) {}
  if (S.rows.length) render();
});
try { const t = localStorage.getItem("cp-theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}

start();
