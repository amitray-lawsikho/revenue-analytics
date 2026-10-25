/* Sales Analytics Dashboard — Revenue Metrics. Data: Supabase RPC rev_agg_json / rev_dims_json / rev_courses (RLS on). */
const sb = supabase.createClient(CP_CONFIG.supabaseUrl, CP_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const PAGES = {
  overall: { title: "Overall Performance", level: "none" },
  vertical: { title: "Vertical Wise Performance", level: "vertical", label: "Vertical" },
  team: { title: "Teamwise Performance", level: "team", label: "Team" },
  caller: { title: "Caller Wise Performance", level: "caller", label: "Caller" },
};
const STATUS = { current: "Current", resigned: "Resigned", direct: "Direct", "no caller": "No caller details" };
const S = { page: "overall", dims: [], charts: {}, sort: { k: "revenue", dir: -1 }, pivotMetric: "revenue", seq: 0, lineKeys: null };

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
  if (g === "week") return "Wk of " + d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
  if (g === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  const y = d.getUTCFullYear(); return `FY ${y}-${String(y + 1).slice(2)}`;
}
const lyKey = (p, g) => (g === "week" ? addDays(p, -364) : lastYear(p));  // the same period one year earlier
function preset(p) {
  const t = istToday(), ms = t.slice(0, 8) + "01";
  switch (p) {
    case "today": return [t, t, "day"];
    case "yesterday": { const y = addDays(t, -1); return [y, y, "day"]; }
    case "week": return [addDays(t, -((D(t).getUTCDay() + 6) % 7)), t, "day"];
    case "month": return [ms, t, "part"];
    case "lastmonth": { const e = addDays(ms, -1); return [e.slice(0, 8) + "01", e, "part"]; }
    case "all": return ["2023-04-01", t, "fy"];
  }
}

/* ---------- data (one request per query) ---------- */
async function rpcJson(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data || []; }
const agg = (args) => rpcJson("rev_agg_json", { p_vertical: null, p_team: null, p_status: null, p_caller: null, ...args });
function range() { const from = $("from").value, to = $("to").value; return { from, to, pf: lastYear(from), pt: lastYear(to), grain: $("grain").value }; }
function filters(level) {
  const f = {};
  if (level !== "none") f.p_vertical = $("f-vertical").value || null;
  if (level === "team" || level === "caller") f.p_team = $("f-team").value || null;
  if (level === "caller") f.p_status = $("f-status").value || null;
  return f;
}
const tot = (rows) => rows.reduce((a, r) => ({ revenue: a.revenue + Number(r.revenue || 0),
  enrolments: a.enrolments + Number(r.enrolments || 0), payments: a.payments + Number(r.payments || 0) }), { revenue: 0, enrolments: 0, payments: 0 });

/* ---------- charts ---------- */
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const palette = () => ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"].map(css);
const barLabels = {  // writes enrolment counts on bars: one dataset (labels) or every dataset (all), optionally rotated
  id: "barLabels",
  afterDatasetsDraw(chart) {
    const o = chart.options.plugins.barLabels; if (!o) return;
    const sets = o.all ? o.all.map((l, i) => [i, l]) : o.labels ? [[o.dataset ?? 0, o.labels]] : [];
    const ctx = chart.ctx, horiz = chart.options.indexAxis === "y"; ctx.save();
    ctx.font = `600 ${o.size || 11}px Inter, sans-serif`; ctx.fillStyle = css("--ink");
    for (const [di, labels] of sets) {
      const meta = chart.getDatasetMeta(di); if (!meta || meta.hidden || meta.data.length > (o.max || 45)) continue;
      meta.data.forEach((el, i) => {
        const t = labels[i]; if (!t || el.y == null || isNaN(el.y)) return;
        if (horiz) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(t, el.x + 6, el.y); }
        else if (o.rotate) { ctx.save(); ctx.translate(el.x, Math.min(el.y, el.base) - 4); ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(t, 0, 0); ctx.restore(); }
        else { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(t, el.x, Math.min(el.y, el.base) - 4); }
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
function revenueBarsConfig(labels, rev, enr, extraTip) {
  return {
    type: "bar",
    data: { labels, datasets: [{ label: "Revenue", data: rev, backgroundColor: css("--gold"), borderRadius: 4, maxBarThickness: 46 }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } },
      plugins: { legend: { display: false }, barLabels: { labels: enr.map((e) => `${num(e)} enr`) },
        tooltip: { callbacks: { label: (c) => ` Revenue ${both(c.raw)}`, afterLabel: (c) => ` New enrolments ${num(enr[c.dataIndex])}` + (extraTip ? extraTip(c.dataIndex) : "") } } },
      scales: { y: yRupees(), x: { grid: { display: false } } } },
  };
}

/* ---------- page shell ---------- */
function kpi(label, valueHtml, cur, prev, prevText, periodText) {
  return `<div class="kpi"><div class="k">${esc(label)}</div><div class="v">${valueHtml}</div>${periodText ? `<div class="p">${esc(periodText)}</div>` : ""}
    ${prevText ? `<div class="d">${chHtml(change(cur, prev))} vs ${esc(prevText)}</div>` : ""}</div>`;
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
async function render() {
  const seq = ++S.seq;
  $("content").classList.add("loading");
  try {
    if (S.page === "overall") await renderOverall(seq);
    else { const r = range(); if (!r.from || !r.to || r.from > r.to) return; setSub(); await renderLevel(r, seq, PAGES[S.page]); }
  } catch (e) { if (seq === S.seq) $("content").innerHTML = `<div class="card empty">Could not load data: ${esc(e.message || e)}</div>`; }
  $("content").classList.remove("loading");
}

/* ---------- Overall: KPIs, all years, current FY by month, current month in 3 parts ---------- */
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
  const days = await agg({ p_from: "2023-04-01", p_to: today, p_grain: "day", p_group: "none" });
  if (seq !== S.seq) return;
  const curFy = fyOf(today), fys = [...new Set(days.map((d) => fyOf(d.period)))].sort();
  if (!fys.includes(curFy)) fys.push(curFy);
  const curMonth = +today.slice(5, 7), curDay = +today.slice(8, 10), mIdx = (curMonth + 8) % 12;
  const ms = today.slice(0, 8) + "01", fs = fyStart(today);
  const mCur = sumRange(days, ms, today), mPrev = sumRange(days, lastYear(ms), lastYear(today));
  const fCur = sumRange(days, fs, today), fPrev = sumRange(days, lastYear(fs), lastYear(today));
  const fy = new Map(fys.map((y) => [y, { y, revenue: 0, enrolments: 0, payments: 0, ytdRev: 0, ytdEnr: 0, mtdRev: 0, partRev: 0,
    months: MONTHS.map(() => ({ revenue: 0, enrolments: 0 })) }]));
  const parts = new Map(fys.map((y) => [y, PARTS.map(() => ({ revenue: 0, enrolments: 0 }))]));
  for (const d of days) {
    const y = fyOf(d.period), o = fy.get(y), rev = +d.revenue, enr = +d.enrolments, m = +d.period.slice(5, 7), mi = (m + 8) % 12, day = +d.period.slice(8, 10);
    o.revenue += rev; o.enrolments += enr; o.payments += +d.payments;
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

  $("page-sub").innerHTML = `All payments · every comparison uses <b>the same dates in earlier years</b>`;
  $("content").innerHTML = `
    <section class="kpis">
      ${kpi(`Revenue · ${monthName} ${today.slice(0, 4)}`, money(mCur.revenue), mCur.revenue, mPrev.revenue, `${nice(lastYear(ms))} – ${nice(lastYear(today))}`, `${nice(ms)} – ${nice(today)}`)}
      ${kpi(`New enrolments · ${monthName} ${today.slice(0, 4)}`, num(mCur.enrolments), mCur.enrolments, mPrev.enrolments, `${nice(lastYear(ms))} – ${nice(lastYear(today))}`, `${nice(ms)} – ${nice(today)}`)}
      ${kpi(`Revenue · ${fyName(curFy)}`, money(fCur.revenue), fCur.revenue, fPrev.revenue, `${nice(lastYear(fs))} – ${nice(lastYear(today))}`, `${nice(fs)} – ${nice(today)}`)}
      ${kpi(`New enrolments · ${fyName(curFy)}`, num(fCur.enrolments), fCur.enrolments, fPrev.enrolments, `${nice(lastYear(fs))} – ${nice(lastYear(today))}`, `${nice(fs)} – ${nice(today)}`)}
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
  const grouped = (labels, revOf, enrOf, rotate) => ({
    type: "bar",
    data: { labels, datasets: fys.map((y, i) => ({ label: fyName(y), data: labels.map((_, j) => revOf(y, j)), backgroundColor: cols[i],
      borderRadius: 3, barPercentage: .9, categoryPercentage: .84 })) },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: rotate ? 44 : 22 } },
      plugins: { legend: { position: "bottom" },
        barLabels: { all: fys.map((y) => labels.map((_, j) => (revOf(y, j) == null ? "" : num(enrOf(y, j))))), rotate, size: rotate ? 10 : 11, max: 60 },
        tooltip: { mode: "index", callbacks: { label: (c) => c.raw == null ? null : ` ${c.dataset.label}: ${both(c.raw)} · ${num(enrOf(fys[c.datasetIndex], c.dataIndex))} enr` } } },
      scales: { y: yRupees(), x: { grid: { display: false } } } },
  });
  chart("ch-month", grouped(MONTHS, (y, i) => (y === curFy && i > mIdx ? null : fy.get(y).months[i].revenue), (y, i) => fy.get(y).months[i].enrolments, true));
  chart("ch-parts", grouped(PARTS.map((p) => `Days ${p}`), (y, i) => (y === curFy && i > partOf(curDay) ? null : parts.get(y)[i].revenue), (y, i) => parts.get(y)[i].enrolments, false));
}

/* ---------- Vertical / Team / Caller ---------- */
const keyOf = { vertical: (x) => x.vertical, team: (x) => `${x.team}||${x.vertical}`, caller: (x) => `${x.caller}||${x.caller_status}||${x.team}||${x.vertical}` };
const spanDays = (a, b) => Math.round((D(b) - D(a)) / 864e5) + 1;
async function renderLevel(r, seq, page) {
  const lvl = page.level, base = { p_group: lvl, ...filters(lvl) };
  const tg = r.grain === "day" && spanDays(r.from, r.to) > 62 ? "month" : r.grain;   // trends: never hundreds of day columns
  const [cur, ly, series] = await Promise.all([
    agg({ p_from: r.from, p_to: r.to, p_grain: "none", ...base }),
    agg({ p_from: r.pf, p_to: r.pt, p_grain: "none", ...base }),
    agg({ p_from: r.from, p_to: r.to, p_grain: tg, ...base }),
  ]);
  if (seq !== S.seq) return;
  const k = keyOf[lvl], lyBy = new Map(ly.map((x) => [k(x), x]));
  const q = ($("f-caller").value || "").trim().toLowerCase();
  const match = (x) => !q || (x.caller || "").toLowerCase().includes(q);
  let rows = cur.filter(match).map((x) => { const l = lyBy.get(k(x));
    return { key: k(x), vertical: x.vertical, team: x.team, caller: x.caller, status: x.caller_status,
      revenue: +x.revenue, enrolments: +x.enrolments, payments: +x.payments, ly_revenue: l ? +l.revenue : 0, ly_enrolments: l ? +l.enrolments : 0 }; });
  const ser = series.filter(match);
  const c = tot(rows), pTot = tot(ly.filter(match)), all = c.revenue || 1;
  rows.forEach((x) => { x.share = x.revenue / all; x.change = change(x.revenue, x.ly_revenue); });
  rows.sort((a, b) => S.sort.dir * (((a[S.sort.k] ?? -Infinity) > (b[S.sort.k] ?? -Infinity)) ? 1 : -1));
  rows.forEach((x, i) => (x._i = i));
  S.rows = rows;
  const byRev = [...rows].sort((a, b) => b.revenue - a.revenue), top = byRev.slice(0, 15);
  const name = (x) => lvl === "vertical" ? x.vertical : lvl === "team" ? x.team : x.caller;
  const prevText = `${nice(r.pf)} – ${nice(r.pt)}`, curText = `${nice(r.from)} – ${nice(r.to)}`;
  const periods = [...new Set(ser.map((x) => x.period))].sort();
  const cell = new Map(); ser.forEach((x) => { cell.set(k(x) + "@" + x.period, x); });
  const gnote = tg !== r.grain ? ` (shown by month: the dates span more than 62 days)` : "";

  const cols = [{ h: "#", f: (x) => (x._total ? "" : x._i + 1) }];
  if (lvl === "caller") cols.push({ h: "Caller", k: "caller", l: 1 },
    { h: "Type", l: 1, f: (x) => x._total ? "" : `<span class="badge ${x.status === "no caller" ? "" : esc(x.status)}">${esc(STATUS[x.status] || x.status)}</span>` });
  if (lvl !== "vertical") cols.push({ h: "Team", k: "team", l: 1 });
  cols.push({ h: "Vertical", k: "vertical", l: 1 },
    { h: "Revenue", k: "revenue", f: (x) => money(x.revenue) }, { h: "New enrolments", k: "enrolments", f: (x) => num(x.enrolments) },
    { h: "Payments", k: "payments", f: (x) => num(x.payments) }, { h: "Share", k: "share", f: (x) => pct(x.share) },
    { h: "Revenue last year", k: "ly_revenue", f: (x) => money(x.ly_revenue) }, { h: "Enrolments last year", k: "ly_enrolments", f: (x) => num(x.ly_enrolments) },
    { h: "Change", k: "change", f: (x) => chHtml(x.change) });
  const totalRow = { _total: 1, _i: -1, caller: "Total", team: lvl === "team" ? "Total" : "", vertical: lvl === "vertical" ? "Total" : "",
    revenue: c.revenue, enrolments: c.enrolments, payments: c.payments, share: 1, ly_revenue: pTot.revenue, ly_enrolments: pTot.enrolments, change: change(c.revenue, pTot.revenue) };

  // trend (vertical/team): one bar per group in each period — every vertical; the 10 biggest teams + Others
  const bigKeys = (lvl === "vertical" ? byRev : top.slice(0, 10)).map((x) => x.key), grp = new Map();
  for (const x of ser) { const key = bigKeys.includes(k(x)) ? k(x) : "Others";
    if (!grp.has(key)) grp.set(key, new Map()); const m = grp.get(key), o = m.get(x.period) || { revenue: 0, enrolments: 0 };
    o.revenue += +x.revenue; o.enrolments += +x.enrolments; m.set(x.period, o); }
  const metric = S.pivotMetric, pf = metric === "revenue" ? money : num;
  const pivRows = byRev.map((x) => { const o = { n: name(x) + (lvl === "team" ? ` (${x.vertical})` : "") }; let t = 0;
    periods.forEach((p) => { const v = cell.get(x.key + "@" + p); o[p] = v ? +v[metric] : 0; t += o[p]; }); o.t = t; return o; });

  // caller trends: heatmap of top 25 + line chart of chosen callers (default top 10)
  const heat = byRev.slice(0, 25), maxCell = Math.max(1, ...heat.flatMap((x) => periods.map((p) => +(cell.get(x.key + "@" + p)?.revenue || 0))));
  if (!S.lineKeys || !S.lineKeys.every((key) => rows.some((x) => x.key === key))) S.lineKeys = byRev.filter((x) => x.status === "current" || x.status === "resigned").slice(0, 10).map((x) => x.key);
  const callerTrends = lvl !== "caller" ? "" : `
    <section class="card"><div class="card-h"><h3>Caller trends${gnote ? " · by month" : ""}</h3>
      <span class="muted small">Revenue per ${{ day: "day", part: "part of month", month: "month", fy: "financial year", week: "week" }[tg]} · the View by filter sets the periods${esc(gnote)}</span></div>
      <div class="chips" id="chips">${S.lineKeys.map((key, i) => { const x = rows.find((y) => y.key === key);
        return `<span class="chip"><i style="background:${palette()[i % 8]}"></i>${esc(x ? x.caller : key)}<button data-k="${esc(key)}" title="Remove">✕</button></span>`; }).join("")}
        <input id="add-caller" list="callers-in-view" placeholder="+ Add a caller to the chart"><datalist id="callers-in-view">${byRev.slice(0, 1500).map((x) => `<option value="${esc(x.caller)}">`).join("")}</datalist></div>
      <div class="chart-box" style="height:340px"><canvas id="ch-lines"></canvas></div></section>
    <section class="card"><div class="card-h"><h3>Top 25 callers by period</h3><span class="muted small">Darker = more revenue · small figure = new enrolments</span></div>
      <div class="table-wrap heat">${table([{ h: "Caller", k: "caller", l: 1 }, ...periods.map((p) => ({ h: periodLabel(p, tg), f: (x) => {
          const v = cell.get(x.key + "@" + p); if (!v) return "";
          return `<span title="${full(+v.revenue)} · ${num(+v.enrolments)} new enrolments">${rupees(+v.revenue)}<small>${num(+v.enrolments)} enr</small></span>`; } })),
        { h: "Total", f: (x) => money(x.revenue) }], heat)}</div></section>`;

  $("content").innerHTML = `
    <section class="kpis">
      ${kpi("Revenue (Fee paid)", money(c.revenue), c.revenue, pTot.revenue, prevText, curText)}
      ${kpi("New enrolments", num(c.enrolments), c.enrolments, pTot.enrolments, prevText, curText)}
      ${kpi(`${page.label}s with revenue`, num(rows.filter((x) => x.revenue > 0).length), null, null, "", curText)}
    </section>
    <section class="card"><div class="card-h"><h3>${lvl === "caller" ? "Top 15 callers" : `Revenue by ${page.label.toLowerCase()}`}</h3>
      <span class="muted small">Gold = selected dates · grey = same dates last year · label = new enrolments and change</span></div>
      <div class="chart-box" style="height:${Math.max(260, 70 + top.length * 42)}px"><canvas id="ch-rank"></canvas></div></section>
    ${callerTrends}
    ${lvl === "caller" ? "" : `<section class="card"><div class="card-h"><h3>Trend by ${page.label.toLowerCase()}</h3>
      <span class="muted small">One bar per ${page.label.toLowerCase()}${lvl === "team" ? " (10 biggest + Others)" : ""} · number on each bar = its new enrolments${esc(gnote)}</span></div>
      <div class="chart-box" style="height:400px"><canvas id="ch-trend"></canvas></div></section>`}
    <section class="card"><div class="card-h"><h3>${lvl === "caller" ? "Caller leaderboard" : `${page.label} table`}</h3>
      <span class="muted small">${lvl === "caller" ? "Click a caller for their trend and courses · " : ""}click a column to sort · hover an amount for the exact figure</span></div>
      <div class="table-wrap" id="board">${table(cols, [...rows, totalRow], { sort: true, click: lvl === "caller" })}</div></section>
    ${lvl === "caller" ? "" : `<section class="card"><div class="card-h"><h3>${page.label} by period</h3>
      <div class="seg" id="pivot-metric"><button data-m="revenue" class="${metric === "revenue" ? "on" : ""}">Revenue</button>
      <button data-m="enrolments" class="${metric === "enrolments" ? "on" : ""}">New enrolments</button></div></div>
      <div class="table-wrap">${table([{ h: page.label, k: "n", l: 1 }, ...periods.map((p) => ({ h: periodLabel(p, tg), f: (x) => pf(x[p]) })), { h: "Total", f: (x) => pf(x.t) }], pivRows)}</div></section>`}`;

  // heatmap shading
  if (lvl === "caller") document.querySelectorAll(".heat tbody tr").forEach((tr, ri) => {
    [...tr.children].slice(1, 1 + periods.length).forEach((td, ci) => {
      const v = +(cell.get(heat[ri]?.key + "@" + periods[ci])?.revenue || 0);
      td.classList.add("cell"); if (v) td.style.background = `color-mix(in srgb, var(--gold) ${Math.round(8 + 52 * v / maxCell)}%, transparent)`;
    });
  });

  chart("ch-rank", {
    type: "bar",
    data: { labels: top.map((x) => lvl === "team" ? [x.team, x.vertical] : lvl === "caller" ? [x.caller, `${x.team} · ${STATUS[x.status] || ""}`] : x.vertical),
      datasets: [
        { label: "Selected dates", data: top.map((x) => x.revenue), backgroundColor: css("--gold"), borderRadius: 3, barPercentage: .9, categoryPercentage: .78 },
        { label: "Same dates last year", data: top.map((x) => x.ly_revenue), backgroundColor: css("--ly"), borderRadius: 3, barPercentage: .9, categoryPercentage: .78 },
      ] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 120 } },
      plugins: { legend: { position: "bottom" }, barLabels: { dataset: 0, labels: top.map((x) => `${num(x.enrolments)} enr  ${chTxt(x.change)}`) },
        tooltip: { callbacks: { label: (cc) => ` ${cc.dataset.label}: ${both(cc.raw)} · ${num(cc.datasetIndex ? top[cc.dataIndex].ly_enrolments : top[cc.dataIndex].enrolments)} enr` } } },
      scales: { x: yRupees(), y: { grid: { display: false }, ticks: { color: css("--ink") } } } },
  });
  if (lvl !== "caller") {
    const pal = palette(), keys = [...grp.keys()].sort((a, b) => (a === "Others") - (b === "Others") || bigKeys.indexOf(a) - bigKeys.indexOf(b));
    const keyName = (key) => key === "Others" ? "Others" : (lvl === "team" ? key.split("||")[0] : key);
    const val = (key, p) => grp.get(key).get(p) || { revenue: 0, enrolments: 0 };
    chart("ch-trend", {
      type: "bar",
      data: { labels: periods.map((p) => periodLabel(p, tg)),
        datasets: keys.map((key, i) => ({ label: keyName(key), data: periods.map((p) => val(key, p).revenue),
          backgroundColor: key === "Others" ? css("--ly") : pal[i % pal.length], borderRadius: 3, barPercentage: .92, categoryPercentage: .86, maxBarThickness: 34 })) },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 44 } },
        plugins: { legend: { position: "bottom" },
          barLabels: { all: keys.map((key) => periods.map((p) => (val(key, p).revenue ? num(val(key, p).enrolments) : ""))), rotate: true, size: 10, max: 400 },
          tooltip: { mode: "index", callbacks: { label: (cc) => ` ${cc.dataset.label}: ${both(cc.raw)} · ${num(val(keys[cc.datasetIndex], periods[cc.dataIndex]).enrolments)} enr` } } },
        scales: { x: { grid: { display: false } }, y: yRupees() } },
    });
  } else {
    const pal = palette();
    chart("ch-lines", {
      type: "line",
      data: { labels: periods.map((p) => periodLabel(p, tg)),
        datasets: S.lineKeys.map((key, i) => { const x = rows.find((y) => y.key === key);
          return { label: x ? x.caller : key, data: periods.map((p) => +(cell.get(key + "@" + p)?.revenue || 0)), borderColor: pal[i % 8], backgroundColor: pal[i % 8],
            tension: .3, pointRadius: 3, borderWidth: 2 }; }) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (cc) => { const v = cell.get(S.lineKeys[cc.datasetIndex] + "@" + periods[cc.dataIndex]);
          return ` ${cc.dataset.label}: ${both(cc.raw)} · ${num(v ? +v.enrolments : 0)} enr`; } } } },
        scales: { y: yRupees(), x: { grid: { display: false } } } },
    });
    $("chips").onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) { S.lineKeys = S.lineKeys.filter((key) => key !== b.dataset.k); render(); } };
    $("add-caller").onchange = (e) => { const x = byRev.find((y) => y.caller === e.target.value);
      if (x && !S.lineKeys.includes(x.key)) { S.lineKeys = [...S.lineKeys, x.key]; render(); } };
  }

  $("board").onclick = (e) => {
    const th = e.target.closest("th[data-k]");
    if (th && th.dataset.k) { const key = th.dataset.k; S.sort = { k: key, dir: S.sort.k === key ? -S.sort.dir : -1 }; render(); return; }
    const tr = e.target.closest("tr.click"); if (tr && +tr.dataset.i >= 0) openCaller(S.rows[+tr.dataset.i]);
  };
  const pm = $("pivot-metric"); if (pm) pm.onclick = (e) => { const b = e.target.closest("button"); if (b) { S.pivotMetric = b.dataset.m; render(); } };
}

/* ---------- caller drawer ---------- */
async function openCaller(x) {
  const r = range(), tg = r.grain === "day" && spanDays(r.from, r.to) > 62 ? "month" : r.grain;
  $("d-name").textContent = x.caller;
  $("d-sub").innerHTML = `${esc(STATUS[x.status] || x.status)} · ${esc(x.team)} · ${esc(x.vertical)}<br>${nice(r.from)} – ${nice(r.to)}, compared with ${nice(r.pf)} – ${nice(r.pt)}`;
  $("d-kpis").innerHTML = kpi("Revenue", money(x.revenue), x.revenue, x.ly_revenue, "same dates last year") +
    kpi("New enrolments", num(x.enrolments), x.enrolments, x.ly_enrolments, "same dates last year");
  $("drawer").hidden = false;
  const args = { p_vertical: x.vertical, p_team: x.team, p_status: x.status, p_caller: x.caller };
  const [trend, courses] = await Promise.all([
    agg({ p_from: r.from, p_to: r.to, p_grain: tg, p_group: "none", ...args }),
    sb.rpc("rev_courses", { p_from: r.from, p_to: r.to, p_caller: x.caller, p_vertical: x.vertical, p_team: x.team }),
  ]);
  chart("d-trend", revenueBarsConfig(trend.map((t) => periodLabel(t.period, tg)), trend.map((t) => +t.revenue), trend.map((t) => +t.enrolments)));
  $("d-courses").innerHTML = courses.error ? `<tr><td>${esc(courses.error.message)}</td></tr>` :
    table([{ h: "Course", f: (cc) => `<span style="white-space:normal">${esc(cc.course)}</span>`, l: 1 }, { h: "Revenue", f: (cc) => money(+cc.revenue) },
      { h: "New enr.", f: (cc) => num(+cc.enrolments) }, { h: "Payments", f: (cc) => num(+cc.payments) }], courses.data).replace(/^<table>|<\/table>$/g, "");
}

/* ---------- filters ---------- */
function fillFilters() {
  const v = $("f-vertical").value, t = $("f-team").value;
  const verts = [...new Set(S.dims.map((d) => d.vertical))].filter(Boolean).sort();
  const teams = [...new Set(S.dims.filter((d) => !v || d.vertical === v).map((d) => d.team))].filter(Boolean).sort();
  const opt = (el, all, items, sel) => { el.innerHTML = `<option value="">${all}</option>` +
    items.map((x) => `<option value="${esc(x)}" ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join(""); };
  opt($("f-vertical"), "All verticals", verts, v);
  opt($("f-team"), "All teams", teams, teams.includes(t) ? t : "");
  const tt = $("f-team").value;
  const callers = [...new Set(S.dims.filter((d) => (!v || d.vertical === v) && (!tt || d.team === tt)).map((d) => d.caller))].sort();
  $("callers").innerHTML = callers.slice(0, 2000).map((cc) => `<option value="${esc(cc)}">`).join("");
}
function showFilters() {
  document.querySelector(".filters").hidden = S.page === "overall";   // Overall always shows every year
  document.querySelectorAll(".filter-row label[data-for]").forEach((l) => { l.hidden = !l.dataset.for.split(" ").includes(S.page); });
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
  S.page = p; S.sort = { k: "revenue", dir: -1 }; S.lineKeys = null;
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
      btn.disabled = false; await loadDims(); render(); return; }
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
async function loadDims() { try { S.dims = await rpcJson("rev_dims_json", {}); fillFilters(); } catch (_) {} }
async function start() {
  themeButton();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("auth").hidden = false; $("app").hidden = true; return; }
  const { data: ok } = await sb.rpc("is_allowed");
  if (!ok) { $("auth").hidden = false; $("app").hidden = true;
    $("auth-msg").textContent = `${session.user.email} is signed in but not on the allowed list. Ask Amit to add it.`; return; }
  $("auth").hidden = true; $("app").hidden = false;
  fillFy();
  const [f, t, g] = preset("month"); $("from").value = f; $("to").value = t; $("grain").value = g; markPreset("month");
  setPage(location.hash.slice(1));
  lastRun().then(showFresh); loadDims();   // in the background: never delay the first page
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
["f-vertical", "f-team"].forEach((id) => $(id).addEventListener("change", () => { fillFilters(); S.lineKeys = null; render(); }));
$("f-status").addEventListener("change", () => { S.lineKeys = null; render(); });
let typing; $("f-caller").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => { S.lineKeys = null; render(); }, 350); });
$("update").addEventListener("click", update);
$("d-close").addEventListener("click", () => { $("drawer").hidden = true; });
$("menu").addEventListener("click", () => {
  if (matchMedia("(max-width: 820px)").matches) { $("side").classList.toggle("open"); return; }
  const cc = $("app").classList.toggle("collapsed"); try { localStorage.setItem("sa-side", cc ? "hidden" : "shown"); } catch (_) {}
  setTimeout(() => Object.values(S.charts).forEach((ch) => ch.resize()), 50);
});
try { if (localStorage.getItem("sa-side") === "hidden") $("app").classList.add("collapsed"); } catch (_) {}

start();
