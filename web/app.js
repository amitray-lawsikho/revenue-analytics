/* Sales Analytics Dashboard — Revenue Metrics. Data: Supabase RPC rev_aggm_json / rev_dims_json / rev_coursesm (RLS on). */
const sb = supabase.createClient(CP_CONFIG.supabaseUrl, CP_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const PAGES = {
  overall: { title: "Overall Performance", level: "none" },
  vertical: { title: "Vertical Wise Performance", level: "vertical", label: "Vertical" },
  team: { title: "Teamwise Performance", level: "team", label: "Team" },
  caller: { title: "Caller Wise Performance", level: "caller", label: "Caller" },
  iit: { title: "IIT Sold", level: "iit" },
};
const LEVELS = { vertical: "Vertical", team: "Team", caller: "Caller" };
const MODES = { all: "Revenue (Fee paid)", calling: "Calling revenue", collection: "Collection revenue", other: "Other revenue", iit: "IIT revenue" };
const COLLECTION_VERTICAL = /mayur|anmol/i;   // collection teams (Team Mayur, Team Anmol)
const STATUS = { current: "Current", resigned: "Resigned", direct: "Direct", "no caller": "No caller details" };
const GRAINS = { day: "Day", part: "Part of month", month: "Month", fy: "Financial year" };
const S = { page: "overall", dims: [], charts: {}, sort: { k: "revenue", dir: -1 }, pivotMetric: "revenue", seq: 0, cgrain: "month", dgrain: "month", iitLevel: "team",
  sel: { vertical: new Set(), team: new Set(), caller: new Set() } };

/* ---------- format ---------- */
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function rupees(v) {
  if (v == null || !isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e7) return "₹" + (v / 1e7).toFixed(3) + " Cr";
  if (a >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
  return "₹" + inr0.format(v);
}
const full = (v) => (v == null || !isFinite(v) ? "" : "₹" + inr0.format(Math.round(v)));
const money = (v) => (v == null || !isFinite(v) ? "–" : `<span class="num" title="${full(v)}">${rupees(v)}</span>`);  // hover = exact amount
const both = (v) => `${rupees(v)} (${full(v)})`;
const num = (v) => (v == null || !isFinite(v) ? "–" : inr0.format(v));
const compact = (v) => (v >= 1e4 ? (v / 1e3).toFixed(0) + "k" : v >= 1e3 ? (v / 1e3).toFixed(1) + "k" : String(v));
const pct = (v) => (v == null || !isFinite(v) ? "–" : (v * 100).toFixed(1) + "%");
const change = (c, p) => (p ? (c - p) / Math.abs(p) : null);
const chHtml = (ch) => ch == null ? `<span class="muted">–</span>` :
  `<span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(1)}%</span>`;
const chTxt = (ch) => ch == null ? "" : `${ch >= 0 ? "▲" : "▼"}${Math.abs(ch * 100).toFixed(0)}%`;

/* ---------- dates (IST) ---------- */
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const D = (s) => new Date(s + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function lastYear(s) { const [y, m, d] = s.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, daysIn(y - 1, m))).padStart(2, "0")}`; }
const fyStart = (s) => { const d = D(s); return `${d.getUTCMonth() < 3 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()}-04-01`; };
const nice = (s) => D(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const short = (s) => D(s).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
function periodLabel(p, g) {
  const d = D(p);
  if (g === "day") return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
  if (g === "part") { const day = d.getUTCDate(), end = day === 21 ? daysIn(d.getUTCFullYear(), d.getUTCMonth() + 1) : day + 9; return `${day}–${end} ${short(p)}`; }
  if (g === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  const y = d.getUTCFullYear(); return `FY ${y}-${String(y + 1).slice(2)}`;
}
const spanDays = (a, b) => Math.round((D(b) - D(a)) / 864e5) + 1;
function preset(p) {
  const t = istToday(), ms = t.slice(0, 8) + "01";
  switch (p) {
    case "today": return [t, t, "day"];
    case "yesterday": { const y = addDays(t, -1); return [y, y, "day"]; }
    case "week": return [addDays(t, -((D(t).getUTCDay() + 6) % 7)), t, "day"];
    case "lastweek": { const mon = addDays(t, -((D(t).getUTCDay() + 6) % 7) - 7); return [mon, addDays(mon, 6), "day"]; }
    case "month": return [ms, t, "part"];
    case "lastmonth": { const e = addDays(ms, -1); return [e.slice(0, 8) + "01", e, "part"]; }
    case "year": return [fyStart(t), t, "month"];
    case "lastyear": { const y = +fyStart(t).slice(0, 4) - 1; return [`${y}-04-01`, `${y + 1}-03-31`, "month"]; }
    case "all": return ["2023-04-01", t, "fy"];
  }
}

/* ---------- data (one request per query) ---------- */
async function rpcJson(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data || []; }
const CACHE = new Map();   // same filters again = instant (cleared when new data arrives)
function agg(args) {
  const a = { p_verticals: null, p_teams: null, p_status: null, p_callers: null, p_iit: false, ...args }, key = JSON.stringify(a);
  if (!CACHE.has(key)) CACHE.set(key, rpcJson("rev_aggm_json", a).catch((e) => { CACHE.delete(key); throw e; }));
  return CACHE.get(key);
}
/* Revenue type / IIT view: the summary rows carry every split, so switching costs no extra query. */
const mode = () => (S.page === "iit" ? "iit" : ($("f-rtype").value || "all"));
function vw(rows, m) {
  if (m === "all") return rows;
  return rows.map((r) => m === "iit" ? { ...r, revenue: +r.iit_rev, enrolments: +r.iit_enrol, payments: +r.iit_pay }
    : { ...r, revenue: +r[m + "_rev"], enrolments: m === "calling" ? +r.enrolments : 0 }).filter((r) => r.revenue || r.enrolments);
}
const aggV = (args, m = mode()) => agg({ ...args, p_iit: m === "iit" }).then((rows) => vw(rows, m));
function range() { const from = $("from").value, to = $("to").value; return { from, to, pf: lastYear(from), pt: lastYear(to), grain: $("grain").value }; }
const arr = (set) => (set.size ? [...set] : null);
function filters(level) {
  const f = {};
  if (level !== "none") f.p_verticals = arr(S.sel.vertical);
  if (level === "team" || level === "caller") f.p_teams = arr(S.sel.team);
  if (level === "caller") { f.p_status = $("f-status").value || null; f.p_callers = arr(S.sel.caller); }
  return f;
}
const SUMS = ["revenue", "enrolments", "payments", "calling_rev", "collection_rev", "other_rev", "iit_rev", "iit_enrol", "iit_bal", "iit_pay"];
const tot = (rows) => rows.reduce((a, r) => { SUMS.forEach((k) => (a[k] += Number(r[k] || 0))); return a; },
  Object.fromEntries(SUMS.map((k) => [k, 0])));

/* ---------- charts ---------- */
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const palette = () => ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"].map(css);
const barLabels = {  // writes enrolment counts on bars, horizontally; shortens (1.4k) when the bar is narrower than the number
  id: "barLabels",
  afterDatasetsDraw(chart) {
    const o = chart.options.plugins.barLabels; if (!o) return;
    const sets = o.all ? o.all.map((l, i) => [i, l]) : o.labels ? [[o.dataset ?? 0, o.labels]] : [];
    const ctx = chart.ctx, horiz = chart.options.indexAxis === "y"; ctx.save();
    ctx.fillStyle = css("--ink");
    for (const [di, labels] of sets) {
      const meta = chart.getDatasetMeta(di); if (!meta || meta.hidden || meta.data.length > (o.max || 60)) continue;
      meta.data.forEach((el, i) => {
        let t = labels[i]; if (t == null || t === "" || el.y == null || isNaN(el.y)) return;
        if (horiz) { ctx.font = "600 11px Inter, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(String(t), el.x + 6, el.y); return; }
        // neighbouring bars alternate between two heights, so numbers wider than a bar never collide
        const room = o.stagger ? el.width * 2 + 2 : el.width + 6;
        let size = 11; ctx.font = `600 ${size}px Inter, sans-serif`;
        if (typeof t === "number") { const s = num(t); t = ctx.measureText(s).width <= room ? s : compact(t); }
        while (ctx.measureText(t).width > room && size > 8) { size--; ctx.font = `600 ${size}px Inter, sans-serif`; }
        const lift = o.stagger && di % 2 ? 14 : 0;
        ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(t, el.x, Math.min(el.y, el.base) - 3 - lift);
      });
    }
    ctx.restore();
  },
};
function chart(id, cfg) {
  if (S.charts[id]) S.charts[id].destroy();
  const el = $(id); if (!el) return;
  Chart.defaults.color = css("--muted"); Chart.defaults.borderColor = css("--line");
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: css("--raise"), titleColor: css("--gold-2"), bodyColor: css("--ink"),
    borderColor: css("--line-2"), borderWidth: 1, padding: 10, boxPadding: 4 });
  cfg.plugins = [barLabels];
  S.charts[id] = new Chart(el, cfg);
}
const yRupees = () => ({ beginAtZero: true, ticks: { callback: (v) => rupees(v) }, grid: { color: css("--line") }, border: { display: false } });
function revenueBarsConfig(labels, rev, enr) {
  return {
    type: "bar",
    data: { labels, datasets: [{ label: "Revenue", data: rev, backgroundColor: css("--gold"), borderRadius: 4, maxBarThickness: 46 }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
      plugins: { legend: { display: false }, barLabels: { labels: enr.map((e) => `${num(e)} enr`) },
        tooltip: { callbacks: { label: (c) => ` Revenue ${both(c.raw)}`, afterLabel: (c) => ` New enrolments ${num(enr[c.dataIndex])}` } } },
      scales: { y: yRupees(), x: { grid: { display: false } } } },
  };
}
function groupedBars(labels, sets, rotateTicks) {  // sets: [{label, color, rev[], enr[]}]
  return {
    type: "bar",
    data: { labels, datasets: sets.map((s) => ({ label: s.label, data: s.rev, backgroundColor: s.color, borderRadius: 3, barPercentage: .92, categoryPercentage: .86, maxBarThickness: 40 })) },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 38 } },
      plugins: { legend: { position: "bottom" }, barLabels: { all: sets.map((s) => s.rev.map((v, i) => (v ? s.enr[i] : ""))), max: 400, stagger: sets.length > 1 },
        tooltip: { mode: "index", callbacks: { label: (c) => c.raw == null ? null : ` ${c.dataset.label}: ${both(c.raw)} · ${num(sets[c.datasetIndex].enr[c.dataIndex])} enr` } } },
      scales: { y: yRupees(), x: { grid: { display: false }, ticks: rotateTicks ? { maxRotation: 40, minRotation: 0 } : {} } } },
  };
}

/* ---------- page shell ---------- */
function kpi(label, valueHtml, cur, prev, prevText, periodText, extra = "", hint = "") {
  return `<div class="kpi" ${hint ? `title="${esc(hint)}"` : ""}><div class="k">${esc(label)}</div><div class="v">${valueHtml}</div>${periodText ? `<div class="p">${esc(periodText)}</div>` : ""}
    ${prevText ? `<div class="d">${chHtml(change(cur, prev))} vs ${esc(prevText)}</div>` : ""}${extra ? `<div class="x">${extra}</div>` : ""}</div>`;
}
function table(cols, rows, opts = {}) {
  const head = `<thead><tr>${cols.map((c) => `<th class="${c.l ? "l" : ""} ${opts.sort && S.sort.k === c.k ? "sorted" : ""}" data-k="${c.k || ""}">${esc(c.h)}${opts.sort && S.sort.k === c.k ? (S.sort.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>`;
  const body = rows.map((r) => `<tr class="${opts.click && !r._total ? "click" : ""} ${r._total ? "total" : ""}" ${opts.click ? `data-i="${r._i}"` : ""}>${cols.map((c) =>
    `<td class="${c.l ? "l" : "num"}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body || `<tr><td class="l muted" colspan="${cols.length}">No data for these filters.</td></tr>`}</tbody></table>`;
}
function setSub() {
  const r = range();
  $("page-sub").innerHTML = `${nice(r.from)} – ${nice(r.to)} &nbsp;·&nbsp; compared with <b>${nice(r.pf)} – ${nice(r.pt)}</b> (same dates last year)`;
}
function busy(on) { $("busy").hidden = !on; $("content").classList.toggle("loading", on); }
async function render() {
  const seq = ++S.seq;
  busy(true);
  try {
    if (S.page === "overall") await renderOverall(seq);
    else { const r = range(); if (!r.from || !r.to || r.from > r.to) return; setSub();
      const page = S.page === "iit" ? { level: S.iitLevel, label: LEVELS[S.iitLevel], iit: true } : PAGES[S.page];
      await renderLevel(r, seq, page); }
  } catch (e) { if (seq === S.seq) $("content").innerHTML = `<div class="card empty">Could not load data: ${esc(e.message || e)}</div>`; }
  if (seq === S.seq) busy(false);
}

/* ---------- Overall ---------- */
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const fyOf = (s) => +fyStart(s).slice(0, 4);
const fyName = (y) => `FY ${y}-${String(y + 1).slice(2)}`;
const partOf = (day) => (day <= 10 ? 0 : day <= 20 ? 1 : 2);
const PARTS = ["1–10", "11–20", "21–end"];
const fyColors = (n) => { const base = [css("--c2"), css("--c3"), css("--c4"), css("--c5"), css("--c7")];
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? css("--gold") : base[(n - 2 - i) % base.length])); };
const sumRange = (days, a, b) => tot(days.filter((d) => d.period >= a && d.period <= b));

async function renderOverall(seq) {
  const today = istToday();
  const ms0 = today.slice(0, 8) + "01", fs0 = fyStart(today), st = (f, t) => agg({ p_from: f, p_to: t, p_grain: "none", p_group: "status" });
  const [days, dmC, dmP, dfC, dfP, fyStatus] = await Promise.all([
    agg({ p_from: "2023-04-01", p_to: today, p_grain: "day", p_group: "none" }),
    st(ms0, today), st(lastYear(ms0), lastYear(today)), st(fs0, today), st(lastYear(fs0), lastYear(today)),
    agg({ p_from: "2023-04-01", p_to: today, p_grain: "fy", p_group: "status" })]);
  if (seq !== S.seq) return;
  const direct = (rows) => rows.filter((x) => x.status === "direct").reduce((a, x) => a + +x.revenue, 0);
  const curFy = fyOf(today), fys = [...new Set(days.map((d) => fyOf(d.period)))].sort();
  if (!fys.includes(curFy)) fys.push(curFy);
  const curMonth = +today.slice(5, 7), curDay = +today.slice(8, 10), mIdx = (curMonth + 8) % 12;
  const ms = today.slice(0, 8) + "01", fs = fyStart(today);
  const mCur = sumRange(days, ms, today), mPrev = sumRange(days, lastYear(ms), lastYear(today));
  const fCur = sumRange(days, fs, today), fPrev = sumRange(days, lastYear(fs), lastYear(today));
  const fy = new Map(fys.map((y) => [y, { y, revenue: 0, enrolments: 0, ytdRev: 0, ytdEnr: 0, mtdRev: 0, partRev: 0,
    months: MONTHS.map(() => ({ revenue: 0, enrolments: 0 })) }]));
  const parts = new Map(fys.map((y) => [y, PARTS.map(() => ({ revenue: 0, enrolments: 0 }))]));
  for (const d of days) {
    const y = fyOf(d.period), o = fy.get(y), rev = +d.revenue, enr = +d.enrolments, m = +d.period.slice(5, 7), mi = (m + 8) % 12, day = +d.period.slice(8, 10);
    o.revenue += rev; o.enrolments += enr;
    o.months[mi].revenue += rev; o.months[mi].enrolments += enr;
    if (mi < mIdx || (mi === mIdx && day <= curDay)) { o.ytdRev += rev; o.ytdEnr += enr; }
    if (m === curMonth) { const p = parts.get(y)[partOf(day)]; p.revenue += rev; p.enrolments += enr;
      if (day <= curDay) { o.mtdRev += rev; if (partOf(day) === partOf(curDay)) o.partRev += rev; } }
  }
  const list = fys.map((y) => fy.get(y)), cur = fy.get(curFy);
  const monthName = D(today).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });
  const monthYear = (y) => (curMonth >= 4 ? y : y + 1);
  const lastDay = daysIn(+today.slice(0, 4), curMonth);
  const sameLabel = `1 Apr – ${D(today).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  const fyPrevText = `${nice(lastYear(fs))} – ${nice(lastYear(today))}`;
  const typeCard = (label, fc, fp, mc, mp, hint) => kpi(`${label} · ${fyName(curFy)}`, money(fc), fc, fp, fyPrevText, `${nice(fs)} – ${nice(today)}`,
    `${monthName}: <b>${rupees(mc)}</b> ${chHtml(change(mc, mp))} vs same dates last year`, hint);
  const fyType = new Map();
  for (const x of fyStatus) { const y = +String(x.period).slice(0, 4), o = fyType.get(y) || { y, calling: 0, collection: 0, other: 0, direct: 0, total: 0 };
    o.calling += +x.calling_rev; o.collection += +x.collection_rev; o.other += +x.other_rev; o.total += +x.revenue;
    if (x.status === "direct") o.direct += +x.revenue; fyType.set(y, o); }

  $("page-sub").innerHTML = `All payments · every comparison uses <b>the same dates in earlier years</b>`;
  $("content").innerHTML = `
    <section class="kpis">
      ${kpi(`Revenue · ${monthName} ${today.slice(0, 4)}`, money(mCur.revenue), mCur.revenue, mPrev.revenue, `${nice(lastYear(ms))} – ${nice(lastYear(today))}`, `${nice(ms)} – ${nice(today)}`)}
      ${kpi(`New enrolments · ${monthName} ${today.slice(0, 4)}`, num(mCur.enrolments), mCur.enrolments, mPrev.enrolments, `${nice(lastYear(ms))} – ${nice(lastYear(today))}`, `${nice(ms)} – ${nice(today)}`)}
      ${kpi(`Revenue · ${fyName(curFy)}`, money(fCur.revenue), fCur.revenue, fPrev.revenue, `${nice(lastYear(fs))} – ${nice(lastYear(today))}`, `${nice(fs)} – ${nice(today)}`)}
      ${kpi(`New enrolments · ${fyName(curFy)}`, num(fCur.enrolments), fCur.enrolments, fPrev.enrolments, `${nice(lastYear(fs))} – ${nice(lastYear(today))}`, `${nice(fs)} – ${nice(today)}`)}
    </section>
    <h4 class="section-h">Revenue by type</h4>
    <section class="kpis k4">
      ${typeCard("Calling revenue", fCur.calling_rev, fPrev.calling_rev, mCur.calling_rev, mPrev.calling_rev, "Enrollment = New enrollment or New enrollment - balance payment")}
      ${typeCard("Collection revenue", fCur.collection_rev, fPrev.collection_rev, mCur.collection_rev, mPrev.collection_rev, "Enrollment = Bootcamp collections - balance payments or Community collections - balance payments")}
      ${typeCard("Other revenue", fCur.other_rev, fPrev.other_rev, mCur.other_rev, mPrev.other_rev, "Other revenue, blank Enrollment and older labels")}
      ${typeCard("Direct payments", direct(dfC), direct(dfP), direct(dmC), direct(dmP), "Caller name Direct, Bootcamp - Direct, Bootcamp - Direct-International and the Bootcamp Joining sheet: payments with no caller. Part of the three types above.")}
    </section>
    <section class="grid2">
      <div class="card"><div class="card-h"><h3>Revenue by financial year</h3><span class="muted small">Label = new enrolments · ${fyName(curFy)} in progress</span></div>
        <div class="chart-box"><canvas id="ch-fy"></canvas></div></div>
      <div class="card"><div class="card-h"><h3>Financial years compared</h3><span class="muted small">Same dates = ${sameLabel} of each year</span></div>
        <div class="table-wrap">${table([
          { h: "Financial year", k: "n", l: 1 }, { h: "Revenue", f: (x) => money(x.revenue) }, { h: "New enrolments", f: (x) => num(x.enrolments) },
          { h: "Growth", f: (x) => chHtml(x.g) }, { h: `Revenue ${sameLabel}`, f: (x) => money(x.ytdRev) }, { h: `Enrolments ${sameLabel}`, f: (x) => num(x.ytdEnr) },
          { h: "Growth (same dates)", f: (x) => chHtml(x.gs) }],
          list.map((x, i) => ({ ...x, n: fyName(x.y), g: i && x.y !== curFy ? change(x.revenue, list[i - 1].revenue) : null, gs: i ? change(x.ytdRev, list[i - 1].ytdRev) : null })))}</div>
        <p class="note">Full-year growth stays blank for ${fyName(curFy)} until the year ends; read the same-dates columns.</p></div>
    </section>
    <section class="card"><div class="card-h"><h3>Revenue type by financial year</h3><span class="muted small">Calling + Collection + Other = total · Direct payments sit inside these types</span></div>
      <div class="table-wrap">${table([{ h: "Financial year", k: "n", l: 1 }, { h: "Calling", f: (x) => money(x.calling) }, { h: "Calling share", f: (x) => pct(x.calling / (x.total || 1)) },
        { h: "Collection", f: (x) => money(x.collection) }, { h: "Collection share", f: (x) => pct(x.collection / (x.total || 1)) },
        { h: "Other", f: (x) => money(x.other) }, { h: "Total", f: (x) => money(x.total) }, { h: "Direct payments", f: (x) => money(x.direct) }],
        [...fyType.values()].sort((a, b) => a.y - b.y).map((x) => ({ ...x, n: fyName(x.y) + (x.y === curFy ? " (so far)" : "") })))}</div></section>
    <section class="card"><div class="card-h"><h3>${fyName(curFy)} month by month, compared with earlier years</h3>
      <span class="muted small">Gold = ${fyName(curFy)} · number on each bar = new enrolments of that year</span></div>
      <div class="chart-box" style="height:400px"><canvas id="ch-month"></canvas></div>
      <div class="table-wrap" style="margin-top:14px">${table([{ h: "Month", k: "m", l: 1 },
        ...fys.flatMap((y) => [{ h: `${fyName(y)} revenue`, f: (x) => y === curFy && x.i > mIdx ? "–" : money(x[y].revenue) },
          { h: `${fyName(y)} enr.`, f: (x) => y === curFy && x.i > mIdx ? "–" : num(x[y].enrolments) }]),
        { h: `Change vs ${fyName(curFy - 1)}`, f: (x) => x.i < mIdx ? chHtml(change(x[curFy].revenue, (x[curFy - 1] || {}).revenue))
          : x.i === mIdx ? chHtml(change(cur.mtdRev, (fy.get(curFy - 1) || {}).mtdRev)) + ` <span class="muted small">(1–${curDay})</span>` : "" }],
        MONTHS.map((m, i) => { const o = { m, i }; fys.forEach((y) => (o[y] = fy.get(y).months[i])); return o; }))}</div>
      <p class="note">${MONTHS[mIdx]} is in progress: its change compares days 1–${curDay} with days 1–${curDay} of ${MONTHS[mIdx]} last year; the chart shows earlier years' full months.</p></section>
    <section class="card"><div class="card-h"><h3>${monthName} in three parts, compared with ${monthName} of earlier years</h3>
      <span class="muted small">Days 1–10, 11–20, 21–${lastDay} · gold = ${monthName} ${monthYear(curFy)}</span></div>
      <div class="chart-box"><canvas id="ch-parts"></canvas></div>
      <div class="table-wrap" style="margin-top:14px">${table([{ h: "Part of month", k: "p", l: 1 },
        ...fys.flatMap((y) => [{ h: `${monthName.slice(0, 3)} ${monthYear(y)} revenue`, f: (x) => y === curFy && x.i > partOf(curDay) ? "–" : money(x[y].revenue) },
          { h: `${monthName.slice(0, 3)} ${monthYear(y)} enr.`, f: (x) => y === curFy && x.i > partOf(curDay) ? "–" : num(x[y].enrolments) }]),
        { h: `Change vs ${monthName.slice(0, 3)} ${monthYear(curFy - 1)}`, f: (x) => x.i < partOf(curDay) ? chHtml(change(x[curFy].revenue, (x[curFy - 1] || {}).revenue))
          : x.i === partOf(curDay) ? chHtml(change(cur.partRev, (fy.get(curFy - 1) || {}).partRev)) + ` <span class="muted small">(to day ${curDay})</span>` : "" }],
        PARTS.map((p, i) => { const o = { p: `Days ${p}`, i }; fys.forEach((y) => (o[y] = parts.get(y)[i])); return o; }))}</div>
      <p class="note">Days ${PARTS[partOf(curDay)]} of ${monthName} ${monthYear(curFy)} are in progress (today is day ${curDay}); its change compares up to day ${curDay} with the same days last year.</p></section>`;

  chart("ch-fy", revenueBarsConfig(list.map((x) => fyName(x.y)), list.map((x) => x.revenue), list.map((x) => x.enrolments)));
  const cols = fyColors(fys.length);
  chart("ch-month", groupedBars(MONTHS, fys.map((y, i) => ({ label: fyName(y), color: cols[i],
    rev: MONTHS.map((_, j) => (y === curFy && j > mIdx ? null : fy.get(y).months[j].revenue)), enr: MONTHS.map((_, j) => fy.get(y).months[j].enrolments) }))));
  chart("ch-parts", groupedBars(PARTS.map((p) => `Days ${p}`), fys.map((y, i) => ({ label: fyName(y), color: cols[i],
    rev: PARTS.map((_, j) => (y === curFy && j > partOf(curDay) ? null : parts.get(y)[j].revenue)), enr: PARTS.map((_, j) => parts.get(y)[j].enrolments) }))));
}

/* ---------- Vertical / Team / Caller ---------- */
const keyOf = { vertical: (x) => x.vertical, team: (x) => `${x.team}||${x.vertical}`, caller: (x) => `${x.caller}||${x.caller_status}||${x.team}||${x.vertical}` };
const trendGrain = (g, r) => (g === "day" && spanDays(r.from, r.to) > 62 ? "month" : g);   // never hundreds of day columns
async function renderLevel(r, seq, page) {
  const lvl = page.level, m = mode(), isIit = m === "iit", base = { p_group: lvl, ...filters(page.iit ? "caller" : lvl) }, isCaller = lvl === "caller";
  const tg = trendGrain(isCaller ? S.cgrain : r.grain, r), hasEnr = ["all", "calling", "iit"].includes(m);
  if (!hasEnr) S.pivotMetric = "revenue";
  const E = (v) => (hasEnr ? v : "");   // collection / other revenue has no enrolments: no "0" labels
  const [cur, ly, series, iitCourses] = await Promise.all([
    aggV({ p_from: r.from, p_to: r.to, p_grain: "none", ...base }),
    aggV({ p_from: r.pf, p_to: r.pt, p_grain: "none", ...base }),
    isCaller ? null : aggV({ p_from: r.from, p_to: r.to, p_grain: tg, ...base }),
    isIit ? courses({ p_from: r.from, p_to: r.to, ...filters("caller"), p_iit: true }) : null,
  ]);
  if (seq !== S.seq) return;
  const k = keyOf[lvl], lyBy = new Map(ly.map((x) => [k(x), x]));
  let rows = cur.map((x) => { const l = lyBy.get(k(x));
    return { key: k(x), vertical: x.vertical, team: x.team, caller: x.caller, status: x.caller_status,
      revenue: +x.revenue, enrolments: +x.enrolments, payments: +x.payments, ly_revenue: l ? +l.revenue : 0, ly_enrolments: l ? +l.enrolments : 0,
      calling_rev: +x.calling_rev, collection_rev: +x.collection_rev, other_rev: +x.other_rev, iit_bal: +x.iit_bal, ly_iit_bal: l ? +l.iit_bal : 0 }; });
  const c = tot(rows), pTot = tot(ly), all = c.revenue || 1;
  rows.forEach((x) => { x.share = x.revenue / all; x.change = change(x.revenue, x.ly_revenue); });
  rows.sort((a, b) => S.sort.dir * (((a[S.sort.k] ?? -Infinity) > (b[S.sort.k] ?? -Infinity)) ? 1 : -1));
  rows.forEach((x, i) => (x._i = i));
  S.rows = rows;
  const byRev = [...rows].sort((a, b) => b.revenue - a.revenue), top = byRev.slice(0, 15);
  const name = (x) => lvl === "vertical" ? x.vertical : lvl === "team" ? x.team : x.caller;
  const prevText = `${nice(r.pf)} – ${nice(r.pt)}`, curText = `${nice(r.from)} – ${nice(r.to)}`;

  // caller trends: the callers chosen in the Caller filter, else the 8 biggest (people only); heatmap = top 25
  let ser = series, trendKeys = [], heat = [];
  if (isCaller) {
    const people = byRev.filter((x) => x.status === "current" || x.status === "resigned");
    trendKeys = (S.sel.caller.size ? byRev.slice(0, 15) : people.slice(0, 8)).map((x) => x.key);
    heat = byRev.slice(0, 25);
    const names = [...new Set([...heat, ...rows.filter((x) => trendKeys.includes(x.key))].map((x) => x.caller))];
    ser = names.length ? await aggV({ p_from: r.from, p_to: r.to, p_grain: tg, ...base, p_callers: names }) : [];
    if (seq !== S.seq) return;
  }
  const periods = [...new Set(ser.map((x) => x.period))].sort();
  const cell = new Map(); ser.forEach((x) => cell.set(k(x) + "@" + x.period, x));
  const gnote = tg !== (isCaller ? S.cgrain : r.grain) ? ` · shown by month (the dates span more than 62 days)` : "";

  const cols = [{ h: "#", f: (x) => (x._total ? "" : x._i + 1) }];
  if (isCaller) cols.push({ h: "Caller", k: "caller", l: 1 },
    { h: "Type", l: 1, f: (x) => x._total ? "" : `<span class="badge ${x.status === "no caller" ? "" : esc(x.status)}">${esc(STATUS[x.status] || x.status)}</span>` });
  if (lvl !== "vertical") cols.push({ h: "Team", k: "team", l: 1 });
  cols.push({ h: "Vertical", k: "vertical", l: 1 },
    { h: isIit ? "IIT revenue" : m === "all" ? "Revenue" : MODES[m], k: "revenue", f: (x) => money(x.revenue) },
    ...(hasEnr ? [{ h: isIit ? "IIT new enrolments" : "New enrolments", k: "enrolments", f: (x) => num(x.enrolments) }] : []));
  if (isIit) cols.push({ h: "IIT balance payments", k: "iit_bal", f: (x) => num(x.iit_bal) }, { h: "IIT payments", k: "payments", f: (x) => num(x.payments) });
  if (m === "all") cols.push({ h: "Calling", k: "calling_rev", f: (x) => money(x.calling_rev) }, { h: "Collection", k: "collection_rev", f: (x) => money(x.collection_rev) },
    { h: "Other", k: "other_rev", f: (x) => money(x.other_rev) });
  if (!isCaller && m === "all") cols.push({ h: "Payments", k: "payments", f: (x) => num(x.payments) });
  cols.push({ h: "Share", k: "share", f: (x) => pct(x.share) },
    { h: "Revenue last year", k: "ly_revenue", f: (x) => money(x.ly_revenue) }, ...(hasEnr ? [{ h: "Enrolments last year", k: "ly_enrolments", f: (x) => num(x.ly_enrolments) }] : []),
    { h: "Change", k: "change", f: (x) => chHtml(x.change) });
  const totalRow = { _total: 1, _i: -1, caller: "Total", team: lvl === "team" ? "Total" : "", vertical: lvl === "vertical" ? "Total" : "",
    revenue: c.revenue, enrolments: c.enrolments, payments: c.payments, share: 1, ly_revenue: pTot.revenue, ly_enrolments: pTot.enrolments, change: change(c.revenue, pTot.revenue),
    calling_rev: c.calling_rev, collection_rev: c.collection_rev, other_rev: c.other_rev, iit_bal: c.iit_bal };

  // vertical/team trend: one bar per group (every vertical; the 10 biggest teams + Others)
  const bigKeys = (lvl === "vertical" ? byRev : top.slice(0, 10)).map((x) => x.key), grp = new Map();
  if (!isCaller) for (const x of ser) { const key = bigKeys.includes(k(x)) ? k(x) : "Others";
    if (!grp.has(key)) grp.set(key, new Map()); const m = grp.get(key), o = m.get(x.period) || { revenue: 0, enrolments: 0 };
    o.revenue += +x.revenue; o.enrolments += +x.enrolments; m.set(x.period, o); }
  const metric = S.pivotMetric, pf = metric === "revenue" ? money : num;
  const pivRows = isCaller ? [] : byRev.map((x) => { const o = { n: name(x) + (lvl === "team" ? ` (${x.vertical})` : "") }; let t = 0;
    periods.forEach((p) => { const v = cell.get(x.key + "@" + p); o[p] = v ? +v[metric] : 0; t += o[p]; }); o.t = t; return o; });
  const maxCell = Math.max(1, ...heat.flatMap((x) => periods.map((p) => +(cell.get(x.key + "@" + p)?.revenue || 0))));

  const callerTrends = !isCaller ? "" : `
    <section class="card"><div class="card-h"><h3>Caller trends</h3>
      <div class="seg" id="cgrain">${Object.entries(GRAINS).map(([g, t]) => `<button data-g="${g}" class="${S.cgrain === g ? "on" : ""}">${t}</button>`).join("")}</div></div>
      <p class="muted small" style="margin:-4px 0 12px">${S.sel.caller.size ? "The callers chosen in the Caller filter" : "The 8 biggest callers in these dates — choose callers in the Caller filter to compare others"}
        · each colour is one ${GRAINS[tg].toLowerCase()} · number on each bar = new enrolments${esc(gnote)}</p>
      <div class="chart-box" style="height:max(460px, 58vh)"><canvas id="ch-ctrend"></canvas></div></section>
    <section class="card"><div class="card-h"><h3>Top 25 callers by ${GRAINS[tg].toLowerCase()}</h3><span class="muted small">Darker = more revenue · small figure = new enrolments</span></div>
      <div class="table-wrap heat">${table([{ h: "Caller", k: "caller", l: 1 }, ...periods.map((p) => ({ h: periodLabel(p, tg), f: (x) => {
          const v = cell.get(x.key + "@" + p); if (!v) return "";
          return `<span title="${full(+v.revenue)}${hasEnr ? ` · ${num(+v.enrolments)} new enrolments` : ""}">${rupees(+v.revenue)}${hasEnr ? `<small>${num(+v.enrolments)} enr</small>` : ""}</span>`; } })),
        { h: "Total", f: (x) => money(x.revenue) }], heat)}</div></section>`;

  const enrLabel = isIit ? "IIT new enrolments" : m === "all" || m === "calling" ? "New enrolments" : "";
  const iitSplit = isIit ? (() => {   // collection teams (Mayur, Anmol) vs sales teams
    const part = (list, coll) => tot(list.filter((x) => COLLECTION_VERTICAL.test(x.vertical || "") === coll));
    const sc = part(rows, false), sp = part(ly, false), cc = part(rows, true), cp = part(ly, true);
    return `<h4 class="section-h">Sales teams vs collection teams</h4><section class="kpis k4">
      ${kpi("Sales teams · IIT revenue", money(sc.revenue), sc.revenue, sp.revenue, prevText, "All verticals except Team Mayur and Team Anmol",
        `<b>${num(sc.enrolments)}</b> IIT new enrolments ${chHtml(change(sc.enrolments, sp.enrolments))} · <b>${num(sc.iit_bal)}</b> IIT balance payments`)}
      ${kpi("Collection teams · IIT revenue", money(cc.revenue), cc.revenue, cp.revenue, prevText, "Team Mayur and Team Anmol", `<b>${num(cc.payments)}</b> IIT payments`)}
    </section>`; })() : "";
  $("content").innerHTML = `
    ${page.iit ? `<div class="seg page-tabs" id="iit-level">${Object.entries(LEVELS).map(([k2, t]) => `<button data-l="${k2}" class="${S.iitLevel === k2 ? "on" : ""}">${t} wise</button>`).join("")}</div>` : ""}
    <section class="kpis">
      ${kpi(MODES[m], money(c.revenue), c.revenue, pTot.revenue, prevText, curText)}
      ${enrLabel ? kpi(enrLabel, num(c.enrolments), c.enrolments, pTot.enrolments, prevText, curText, isIit ? "New enrollment above ₹800 with an IIT / iHub course" : "") : ""}
      ${isIit ? kpi("IIT balance payments", num(c.iit_bal), c.iit_bal, pTot.iit_bal, prevText, curText, "New enrollment - balance payments with an IIT / iHub course (upgrades)") : ""}
      ${m === "all" ? kpi("Calling revenue", money(c.calling_rev), c.calling_rev, pTot.calling_rev, prevText, curText) +
        kpi("Collection revenue", money(c.collection_rev), c.collection_rev, pTot.collection_rev, prevText, curText) : ""}
      ${kpi(`${page.label}s with ${isIit ? "IIT revenue" : "revenue"}`, num(rows.filter((x) => x.revenue > 0).length), null, null, "", curText)}
    </section>
    ${iitSplit}
    <section class="card"><div class="card-h"><h3>${isCaller ? "Top 15 callers" : `Revenue by ${page.label.toLowerCase()}`}</h3>
      <span class="muted small">Gold = selected dates · grey = same dates last year · label = new enrolments and change</span></div>
      <div class="chart-box" style="height:${Math.max(260, 70 + top.length * 42)}px"><canvas id="ch-rank"></canvas></div></section>
    ${callerTrends}
    ${isCaller ? "" : `<section class="card"><div class="card-h"><h3>Trend by ${page.label.toLowerCase()}</h3>
      <span class="muted small">One bar per ${page.label.toLowerCase()}${lvl === "team" ? " (10 biggest + Others)" : ""} · number on each bar = its new enrolments${esc(gnote)}</span></div>
      <div class="chart-box" style="height:400px"><canvas id="ch-trend"></canvas></div></section>`}
    <section class="card"><div class="card-h"><h3>${isCaller ? "Caller leaderboard" : `${page.label} table`}</h3>
      <span class="muted small">Click a ${page.label.toLowerCase()} for its trend, ${lvl === "vertical" ? "teams and " : lvl === "team" ? "callers and " : ""}courses · click a column to sort · hover an amount for the exact figure</span></div>
      <div class="table-wrap" id="board">${table(cols, [...rows, totalRow], { sort: true, click: true })}</div></section>
    ${isIit ? `<section class="card"><div class="card-h"><h3>IIT courses sold</h3><span class="muted small">Course name contains IIT or iHub · top 30 by revenue</span></div>
      <div class="table-wrap">${courseTable(iitCourses)}</div></section>` : ""}
    ${isCaller ? "" : `<section class="card"><div class="card-h"><h3>${page.label} by period</h3>
      <div class="seg" id="pivot-metric"><button data-m="revenue" class="${metric === "revenue" ? "on" : ""}">Revenue</button>
      ${hasEnr ? `<button data-m="enrolments" class="${metric === "enrolments" ? "on" : ""}">New enrolments</button>` : ""}</div></div>
      <div class="table-wrap">${table([{ h: page.label, k: "n", l: 1 }, ...periods.map((p) => ({ h: periodLabel(p, tg), f: (x) => pf(x[p]) })), { h: "Total", f: (x) => pf(x.t) }], pivRows)}</div></section>`}`;

  if (isCaller) document.querySelectorAll(".heat tbody tr").forEach((tr, ri) => {
    [...tr.children].slice(1, 1 + periods.length).forEach((td, ci) => {
      const v = +(cell.get(heat[ri]?.key + "@" + periods[ci])?.revenue || 0);
      td.classList.add("cell"); if (v) td.style.background = `color-mix(in srgb, var(--gold) ${Math.round(8 + 52 * v / maxCell)}%, transparent)`;
    });
  });

  chart("ch-rank", {
    type: "bar",
    data: { labels: top.map((x) => lvl === "team" ? [x.team, x.vertical] : isCaller ? [x.caller, `${x.team} · ${STATUS[x.status] || ""}`] : x.vertical),
      datasets: [
        { label: "Selected dates", data: top.map((x) => x.revenue), backgroundColor: css("--gold"), borderRadius: 3, barPercentage: .9, categoryPercentage: .78 },
        { label: "Same dates last year", data: top.map((x) => x.ly_revenue), backgroundColor: css("--ly"), borderRadius: 3, barPercentage: .9, categoryPercentage: .78 },
      ] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 120 } },
      plugins: { legend: { position: "bottom" }, barLabels: { dataset: 0, labels: top.map((x) => `${hasEnr ? num(x.enrolments) + " enr  " : ""}${chTxt(x.change)}`) },
        tooltip: { callbacks: { label: (cc) => ` ${cc.dataset.label}: ${both(cc.raw)} · ${num(cc.datasetIndex ? top[cc.dataIndex].ly_enrolments : top[cc.dataIndex].enrolments)} enr` } } },
      scales: { x: yRupees(), y: { grid: { display: false }, ticks: { color: css("--ink") } } } },
  });
  if (!isCaller) {
    const pal = palette(), keys = [...grp.keys()].sort((a, b) => (a === "Others") - (b === "Others") || bigKeys.indexOf(a) - bigKeys.indexOf(b));
    const keyName = (key) => key === "Others" ? "Others" : (lvl === "team" ? key.split("||")[0] : key);
    const val = (key, p) => grp.get(key).get(p) || { revenue: 0, enrolments: 0 };
    chart("ch-trend", groupedBars(periods.map((p) => periodLabel(p, tg)), keys.map((key, i) => ({ label: keyName(key),
      color: key === "Others" ? css("--ly") : pal[i % pal.length], rev: periods.map((p) => val(key, p).revenue), enr: periods.map((p) => E(val(key, p).enrolments)) }))));
  } else {
    // one cluster per caller, one bar per period (oldest = lightest, latest = gold)
    const tk = trendKeys.map((key) => rows.find((x) => x.key === key)).filter(Boolean);
    const n = periods.length, gold = css("--gold");
    const shade = (i) => n <= 1 ? gold : `color-mix(in srgb, ${gold} ${Math.round(28 + 72 * i / (n - 1))}%, ${css("--panel-2")})`;
    chart("ch-ctrend", groupedBars(tk.map((x) => x.caller.length > 18 ? x.caller.slice(0, 17) + "…" : x.caller), periods.map((p, i) => ({ label: periodLabel(p, tg), color: shade(i),
      rev: tk.map((x) => +(cell.get(x.key + "@" + p)?.revenue || 0)), enr: tk.map((x) => E(+(cell.get(x.key + "@" + p)?.enrolments || 0))) })), true));
    $("cgrain").onclick = (e) => { const b = e.target.closest("button[data-g]"); if (b) { S.cgrain = b.dataset.g; render(); } };
  }

  $("board").onclick = (e) => {
    const th = e.target.closest("th[data-k]");
    if (th && th.dataset.k) { const key = th.dataset.k; S.sort = { k: key, dir: S.sort.k === key ? -S.sort.dir : -1 }; render(); return; }
    const tr = e.target.closest("tr.click"); if (tr && +tr.dataset.i >= 0) { S.dstack = []; openDetail(S.rows[+tr.dataset.i], lvl); }
  };
  const il = $("iit-level"); if (il) il.onclick = (e) => { const b = e.target.closest("button[data-l]"); if (b) { S.iitLevel = b.dataset.l; S.sort = { k: "revenue", dir: -1 }; render(); } };
  const pm = $("pivot-metric"); if (pm) pm.onclick = (e) => { const b = e.target.closest("button"); if (b) { S.pivotMetric = b.dataset.m; render(); } };
}

/* ---------- courses ---------- */
function courses(args) {
  const a = { p_caller: null, p_verticals: null, p_teams: null, p_iit: false, p_rev_type: null, ...args };
  delete a.p_status; delete a.p_callers;
  if (args.p_callers && args.p_callers.length === 1 && !a.p_caller) a.p_caller = args.p_callers[0];
  const key = "courses" + JSON.stringify(a);
  if (!CACHE.has(key)) CACHE.set(key, rpcJson("rev_coursesm", a).catch((e) => { CACHE.delete(key); throw e; }));
  return CACHE.get(key);
}
const courseTable = (list) => table([{ h: "Course", f: (cc) => `<span style="white-space:normal">${esc(cc.course)}</span>`, l: 1 },
  { h: "Revenue", f: (cc) => money(+cc.revenue) }, { h: "New enr.", f: (cc) => num(+cc.enrolments) }, { h: "Payments", f: (cc) => num(+cc.payments) }], list || []);

/* ---------- drill-down drawer: vertical -> teams -> callers ---------- */
const KID = { vertical: "team", team: "caller" };
function joinLy(cur, ly, lvl) {
  const k = keyOf[lvl], lyBy = new Map(ly.map((x) => [k(x), x]));
  return cur.map((x) => { const l = lyBy.get(k(x)) || {};
    return { key: k(x), vertical: x.vertical, team: x.team, caller: x.caller, status: x.caller_status, revenue: +x.revenue, enrolments: +x.enrolments,
      payments: +x.payments, calling_rev: +x.calling_rev, collection_rev: +x.collection_rev, other_rev: +x.other_rev, iit_bal: +x.iit_bal,
      ly_revenue: +(l.revenue || 0), ly_enrolments: +(l.enrolments || 0), change: change(+x.revenue, +(l.revenue || 0)) }; })
    .sort((p, q) => q.revenue - p.revenue);
}
async function openDetail(x, lvl) {
  S.dcur = { x, lvl };
  const r = range(), m = mode(), tg = trendGrain(S.dgrain, r), seq = (S.dseq = (S.dseq || 0) + 1);
  const name = lvl === "vertical" ? x.vertical : lvl === "team" ? x.team : x.caller;
  $("d-kind").textContent = `${LEVELS[lvl]}${m === "all" ? "" : " · " + MODES[m]}`;
  $("d-name").textContent = name;
  const where = lvl === "caller" ? `${esc(STATUS[x.status] || x.status)} · ${esc(x.team)} · ${esc(x.vertical)}<br>` : lvl === "team" ? `${esc(x.vertical)}<br>` : "";
  $("d-sub").innerHTML = `${where}${nice(r.from)} – ${nice(r.to)}, compared with ${nice(r.pf)} – ${nice(r.pt)}${tg !== S.dgrain ? " · shown by month (more than 62 days)" : ""}`;
  const ly = "same dates last year";
  $("d-kpis").innerHTML = kpi(MODES[m], money(x.revenue), x.revenue, x.ly_revenue, ly) +
    (m === "all" || m === "calling" || m === "iit" ? kpi(m === "iit" ? "IIT new enrolments" : "New enrolments", num(x.enrolments), x.enrolments, x.ly_enrolments, ly) : "") +
    (m === "all" ? kpi("Revenue by type", `<span class="num" style="font-size:18px">Calling ${rupees(x.calling_rev)}</span>`, null, null, "", "",
      `Collection <b>${rupees(x.collection_rev)}</b> · Other <b>${rupees(x.other_rev)}</b>`) : "") +
    (m === "iit" ? kpi("IIT balance payments", num(x.iit_bal), null, null, "") : "");
  $("d-grain").innerHTML = Object.entries(GRAINS).map(([g, t]) => `<button data-g="${g}" class="${S.dgrain === g ? "on" : ""}">${t}</button>`).join("");
  $("d-back").hidden = !(S.dstack || []).length;
  const kid = KID[lvl];
  $("d-kids-card").hidden = !kid;
  if (kid) { $("d-kids-h").textContent = `${LEVELS[kid]}s in this ${LEVELS[lvl].toLowerCase()}`; $("d-kids").innerHTML = `<p class="muted small">Loading…</p>`; }
  $("d-courses").innerHTML = ""; $("drawer").hidden = false; $("drawer").scrollTop = 0;
  const f = { p_verticals: [x.vertical] };
  if (lvl !== "vertical") f.p_teams = [x.team];
  if (lvl === "caller") { f.p_status = x.status; f.p_callers = [x.caller]; }
  const [trend, cs, kc, kl] = await Promise.all([
    aggV({ p_from: r.from, p_to: r.to, p_grain: tg, p_group: "none", ...f }, m),
    courses({ p_from: r.from, p_to: r.to, ...f, p_iit: m === "iit", p_rev_type: ["calling", "collection", "other"].includes(m) ? m : null }).catch((e) => ({ error: e })),
    kid ? aggV({ p_from: r.from, p_to: r.to, p_grain: "none", p_group: kid, ...f }, m) : null,
    kid ? aggV({ p_from: r.pf, p_to: r.pt, p_grain: "none", p_group: kid, ...f }, m) : null,
  ]);
  if (seq !== S.dseq) return;
  const dEnr = ["all", "calling", "iit"].includes(m);
  const cfg = revenueBarsConfig(trend.map((t) => periodLabel(t.period, tg)), trend.map((t) => +t.revenue), trend.map((t) => +t.enrolments));
  if (!dEnr) { cfg.options.plugins.barLabels = null; cfg.options.plugins.tooltip.callbacks.afterLabel = () => ""; }
  chart("d-trend", cfg);
  $("d-courses").innerHTML = cs.error ? `<tr><td>${esc(cs.error.message || cs.error)}</td></tr>` : courseTable(cs).replace(/^<table>|<\/table>$/g, "");
  if (kid) {
    const kids = joinLy(kc, kl, kid); kids.forEach((k2, i) => (k2._i = i)); S.dkids = kids;
    const cols = [{ h: LEVELS[kid], l: 1, f: (k2) => esc(kid === "team" ? k2.team : k2.caller) + (kid === "caller" ? ` <span class="badge ${k2.status === "no caller" ? "" : esc(k2.status)}">${esc(STATUS[k2.status] || k2.status)}</span>` : "") },
      { h: "Revenue", f: (k2) => money(k2.revenue) }, { h: "New enr.", f: (k2) => num(k2.enrolments) },
      { h: "Last year", f: (k2) => money(k2.ly_revenue) }, { h: "Change", f: (k2) => chHtml(k2.change) }];
    $("d-kids").innerHTML = table(cols, kids, { click: true });
  }
}
$("d-grain").addEventListener("click", (e) => { const b = e.target.closest("button[data-g]"); if (b && S.dcur) { S.dgrain = b.dataset.g; openDetail(S.dcur.x, S.dcur.lvl); } });
$("d-kids").addEventListener("click", (e) => { const tr = e.target.closest("tr.click"); if (!tr || !S.dcur) return;
  (S.dstack = S.dstack || []).push(S.dcur); openDetail(S.dkids[+tr.dataset.i], KID[S.dcur.lvl]); });
$("d-back").addEventListener("click", () => { const prev = (S.dstack || []).pop(); if (prev) openDetail(prev.x, prev.lvl); });

/* ---------- multi-select filters (with search) ---------- */
const MS = {
  vertical: { all: "All verticals", one: "vertical", opts: [] },
  team: { all: "All teams", one: "team", opts: [] },
  caller: { all: "All callers", one: "caller", opts: [] },
};
let msTimer;
function msChanged() { clearTimeout(msTimer); msTimer = setTimeout(() => { buildOptions(); render(); }, 450); }
function msButton(id) {
  const set = S.sel[id], m = MS[id], b = document.querySelector(`#ms-${id} .ms-btn`); if (!b) return;
  b.textContent = !set.size ? m.all : set.size === 1 ? [...set][0] : `${set.size} ${m.one}s selected`;
  b.classList.toggle("on", set.size > 0); b.title = [...set].join(", ");
}
function msList(id) {
  const box = document.querySelector(`#ms-${id}`), q = box.querySelector(".ms-q").value.trim().toLowerCase(), set = S.sel[id];
  const hits = MS[id].opts.filter((o) => !q || o.value.toLowerCase().includes(q) || (o.sub || "").toLowerCase().includes(q));
  const chosen = hits.filter((o) => set.has(o.value)), rest = hits.filter((o) => !set.has(o.value));
  const show = [...chosen, ...rest].slice(0, 300);
  box.querySelector(".ms-list").innerHTML = show.map((o) => `<label class="ms-item"><input type="checkbox" value="${esc(o.value)}" ${set.has(o.value) ? "checked" : ""}>
    <span>${esc(o.value)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</label>`).join("") +
    (hits.length > 300 ? `<div class="ms-more">${num(hits.length - 300)} more — type to narrow down</div>` : hits.length ? "" : `<div class="ms-more">No match</div>`);
  box._hits = hits;
}
function msInit(id) {
  const box = $(`ms-${id}`);
  box.innerHTML = `<button type="button" class="ms-btn"></button><div class="ms-pop" hidden><input class="ms-q" placeholder="Search ${MS[id].one}s…">
    <div class="ms-act"><button type="button" data-a="all">Select shown</button><button type="button" data-a="none">Clear</button></div><div class="ms-list"></div></div>`;
  const pop = box.querySelector(".ms-pop");
  box.querySelector(".ms-btn").onclick = () => { document.querySelectorAll(".ms-pop").forEach((p) => p !== pop && (p.hidden = true));
    pop.hidden = !pop.hidden; if (!pop.hidden) { msList(id); box.querySelector(".ms-q").focus(); } };
  box.querySelector(".ms-q").oninput = () => msList(id);
  box.querySelector(".ms-list").onchange = (e) => { const v = e.target.value; e.target.checked ? S.sel[id].add(v) : S.sel[id].delete(v); msButton(id); msChanged(); };
  box.querySelector(".ms-act").onclick = (e) => { const a = e.target.dataset.a; if (!a) return;
    if (a === "none") S.sel[id].clear(); else (box._hits || []).slice(0, 300).forEach((o) => S.sel[id].add(o.value));
    msList(id); msButton(id); msChanged(); };
  msButton(id);
}
document.addEventListener("click", (e) => { if (!e.target.closest(".ms")) document.querySelectorAll(".ms-pop").forEach((p) => (p.hidden = true)); });
function buildOptions() {
  const V = S.sel.vertical, T = S.sel.team, st = $("f-status").value;
  MS.vertical.opts = [...new Set(S.dims.map((d) => d.vertical))].filter(Boolean).sort().map((v) => ({ value: v }));
  MS.team.opts = [...new Map(S.dims.filter((d) => d.team && (!V.size || V.has(d.vertical))).map((d) => [d.team, d.vertical]))]
    .sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]) => ({ value: t, sub: v }));
  const cm = new Map();
  for (const d of S.dims) {
    if (!d.caller || (V.size && !V.has(d.vertical)) || (T.size && !T.has(d.team)) || (st && d.caller_status !== st)) continue;
    const o = cm.get(d.caller) || { value: d.caller, team: d.team, status: d.caller_status, last: d.last_date || "", n: 0 };
    o.n++; if ((d.last_date || "") > o.last) { o.last = d.last_date; o.team = d.team; o.status = d.caller_status; } cm.set(d.caller, o);
  }
  MS.caller.opts = [...cm.values()].sort((a, b) => a.value.localeCompare(b.value))
    .map((o) => ({ value: o.value, sub: `${STATUS[o.status] || o.status} · ${o.team}${o.n > 1 ? ` +${o.n - 1}` : ""}${o.last ? ` · last ${short(o.last)}` : ""}` }));
  for (const id of Object.keys(MS)) { msButton(id); const box = $(`ms-${id}`); if (box && !box.querySelector(".ms-pop").hidden) msList(id); }
}

/* ---------- other filters ---------- */
function showFilters() {
  document.querySelector(".filters").hidden = S.page === "overall";   // Overall always shows every year
  document.querySelectorAll(".filter-row [data-for]").forEach((l) => { l.hidden = !l.dataset.for.split(" ").includes(S.page); });
}
function fillFy() {
  const cur = +fyStart(istToday()).slice(0, 4);
  for (let y = cur; y >= 2023; y--) $("fy").insertAdjacentHTML("beforeend", `<option value="${y}">FY ${y}-${String(y + 1).slice(2)}</option>`);
}
function markPreset(p) { document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("on", b.dataset.p === p)); }
function setPreset(p) { const [f, t, g] = preset(p); $("from").value = f; $("to").value = t; $("grain").value = g; $("fy").value = ""; markPreset(p); render(); }
function setFy(y) { const t = istToday(), end = `${+y + 1}-03-31`; $("from").value = `${y}-04-01`; $("to").value = end < t ? end : t; $("grain").value = "month"; markPreset(null); render(); }
function setPage(p) {
  if (!PAGES[p]) p = "overall";
  S.page = p; S.sort = { k: "revenue", dir: -1 };
  $("page-title").textContent = PAGES[p].title; document.title = `${PAGES[p].title} · Sales Analytics Dashboard`;
  document.querySelectorAll(".side nav a").forEach((a) => a.classList.toggle("on", a.dataset.page === p));
  $("side").classList.remove("open"); $("drawer").hidden = true;
  showFilters(); render();
}

/* ---------- freshness + update button ---------- */
async function lastRun() {
  const { data } = await sb.from("refresh_log").select("run_at,status,detail").order("run_at", { ascending: false }).limit(1);
  return data && data[0];
}
function showFresh(run) {
  if (!run) { $("fresh").textContent = "Not refreshed yet"; return; }
  const t = new Date(run.run_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("fresh").innerHTML = run.status === "ok" ? `Data updated ${t} IST` : `<span class="down">Last update failed ${t} IST</span>`;
  $("fresh").title = run.status === "ok" ? "" : (run.detail?.error || "");
}
async function update() {
  const btn = $("update"); btn.disabled = true;
  const before = (await lastRun())?.run_at || "";
  const { data, error } = await sb.rpc("request_refresh");
  if (error) { $("update-msg").textContent = /token/i.test(error.message) ? "Update isn't set up yet (GitHub token missing in Supabase)." : error.message; btn.disabled = false; return; }
  $("update-msg").textContent = data === "already_running" ? "An update is already running…" : "Update started. This takes about 3–5 minutes…";
  const t0 = Date.now();
  const poll = async () => {
    const run = await lastRun();
    if (run && run.run_at > before) { showFresh(run); $("update-msg").textContent = run.status === "ok" ? "Updated." : "Update failed; see the note above.";
      btn.disabled = false; CACHE.clear(); await loadDims(); render(); return; }
    if (Date.now() - t0 > 15 * 60e3) { $("update-msg").textContent = "Still running; check back in a few minutes."; btn.disabled = false; return; }
    setTimeout(poll, 20000);
  };
  setTimeout(poll, 30000);
}

/* ---------- theme ---------- */
const SUN = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
function themeButton() { const dark = document.documentElement.dataset.theme !== "light"; $("theme").innerHTML = dark ? `${SUN} Light` : `${MOON} Dark`; }
$("theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next; try { localStorage.setItem("sa-theme", next); } catch (_) {}
  themeButton(); if (!$("app").hidden) render();
});

/* ---------- auth + start ---------- */
async function loadDims() { try { S.dims = await rpcJson("rev_dims_json", {}); buildOptions(); } catch (_) {} }
async function start() {
  themeButton();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("auth").hidden = false; $("app").hidden = true; return; }
  const { data: ok } = await sb.rpc("is_allowed");
  if (!ok) { $("auth").hidden = false; $("app").hidden = true;
    $("auth-msg").textContent = `${session.user.email} is signed in but not on the allowed list. Ask Amit to add it.`; return; }
  $("auth").hidden = true; $("app").hidden = false;
  fillFy(); Object.keys(MS).forEach(msInit);
  const [f, t, g] = preset("month"); $("from").value = f; $("to").value = t; $("grain").value = g; markPreset("month");
  setPage(location.hash.slice(1));
  lastRun().then(showFresh); loadDims();   // in the background: never delay the first page
  setTimeout(() => agg({ p_from: "2023-04-01", p_to: istToday(), p_grain: "day", p_group: "none" }).catch(() => {}), 1500);
}
$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault(); $("auth-msg").textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email: $("auth-email").value.trim().toLowerCase(), password: $("auth-pass").value });
  $("auth-msg").textContent = error ? error.message : ""; if (!error) start();
});
$("auth-signup").addEventListener("click", async () => {
  const email = $("auth-email").value.trim().toLowerCase(), password = $("auth-pass").value;
  if (!email || password.length < 8) { $("auth-msg").textContent = "Enter your email and a password of 8+ characters first."; return; }
  const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  $("auth-msg").textContent = error ? error.message : "Check your inbox and click the confirmation link, then sign in here.";
});
$("signout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

/* ---------- events ---------- */
window.addEventListener("hashchange", () => setPage(location.hash.slice(1)));
document.querySelectorAll("#presets button").forEach((b) => b.addEventListener("click", () => setPreset(b.dataset.p)));
$("fy").addEventListener("change", (e) => { if (e.target.value) setFy(e.target.value); });
["from", "to"].forEach((id) => $(id).addEventListener("change", () => { $("fy").value = ""; markPreset(null); render(); }));
$("grain").addEventListener("change", render);
$("f-status").addEventListener("change", () => { buildOptions(); render(); });
$("f-rtype").addEventListener("change", () => { $("drawer").hidden = true; render(); });
$("update").addEventListener("click", update);
$("d-close").addEventListener("click", () => { $("drawer").hidden = true; });
$("menu").addEventListener("click", () => {
  if (matchMedia("(max-width: 820px)").matches) { $("side").classList.toggle("open"); return; }
  const cc = $("app").classList.toggle("collapsed"); try { localStorage.setItem("sa-side", cc ? "hidden" : "shown"); } catch (_) {}
  setTimeout(() => Object.values(S.charts).forEach((ch) => ch.resize()), 50);
});
try { if (localStorage.getItem("sa-side") === "hidden") $("app").classList.add("collapsed"); } catch (_) {}

start();
