"use strict";
// Stat × feedback dashboard. Renders data.json (written by dashboard/export.py) into SVG charts.

const END = 13000;
const METHOD_ORDER = ["BASE_SQRT", "STAT", "FEEDBACK", "STAT_FEEDBACK", "RANDOM_STAT_FEEDBACK",
  "FROZEN_BASIS", "RANK64", "LEGACY_FULLY_SCALED", "LEGACY_HELD16"];
// Color follows the method everywhere on the page (fixed categorical order).
const METHOD_COLOR = {
  BASE_SQRT: "--s1", STAT: "--s2", FEEDBACK: "--s3", STAT_FEEDBACK: "--s4",
  RANDOM_STAT_FEEDBACK: "--s5", FROZEN_BASIS: "--s6", RANK64: "--s7",
  LEGACY_FULLY_SCALED: "--s8", LEGACY_HELD16: "--s1",
};
const METHOD_LABEL = {
  BASE_SQRT: "√κ baseline", STAT: "Stat", FEEDBACK: "Feedback", STAT_FEEDBACK: "Stat × feedback",
  RANDOM_STAT_FEEDBACK: "Random basis", FROZEN_BASIS: "Frozen basis", RANK64: "Rank 64",
  LEGACY_FULLY_SCALED: "Legacy fully scaled", LEGACY_HELD16: "Legacy held-16",
  GLOBAL_CANDIDATE: "Global c", REFERENCE: "128K reference",
};
const C_COLOR = { 0.25: "--seq-250", 0.5: "--seq-350", 1: "--seq-450", 2: "--seq-550", 4: "--seq-650" };
const STATUS = {
  done: ["Complete", "--good"], pass: ["Pass", "--good"], running: ["Running", "--s1"],
  queued: ["Queued", "--muted"], failed: ["Failed", "--critical"], fail: ["Fail", "--critical"],
  stalled: ["Stalled", "--serious"], reused: ["Reused", "--muted"], not_run: ["Not scheduled", "--muted"],
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const el = (tag, attrs = {}, ...kids) => {
  const node = tag.startsWith("svg:")
    ? document.createElementNS("http://www.w3.org/2000/svg", tag.slice(4))
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid) node.append(kid);
  return node;
};
const fmt = (v, d = 4) => (v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
const fmtInt = (v) => (v === null || v === undefined ? "–" : Math.round(v).toLocaleString("en-US"));
const dur = (s) => {
  if (s === null || s === undefined) return "–";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
};
const tooltip = document.getElementById("tooltip");
function showTip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.style.opacity = 1;
  const pad = 14, w = tooltip.offsetWidth, h = tooltip.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}
const hideTip = () => { tooltip.style.opacity = 0; };
const statusBadge = (key) => {
  const [label, color] = STATUS[key] || [key, "--muted"];
  return el("span", { class: "status" }, el("span", { class: "dot", style: `background:var(${color})` }),
    el("span", { text: label }));
};

// ---------------------------------------------------------------- scales & axes
function linear(d0, d1, r0, r1) {
  const k = (r1 - r0) / ((d1 - d0) || 1);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (p) => d0 + (p - r0) / k;
  return f;
}
function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toFixed(12));
  return out;
}

// ---------------------------------------------------------------- line chart with crosshair
function lineChart(host, opts) {
  const W = opts.width || 540, H = opts.height || 280;
  const m = { l: 56, r: 14, t: 10, b: 36 };
  const series = opts.series.filter((s) => s.points.length);
  const svg = el("svg:svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img",
    "aria-label": opts.title || "line chart" });
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const xd = opts.xDomain || [Math.min(...xs), Math.max(...xs)];
  let yd = opts.yDomain || [Math.min(...ys), Math.max(...ys)];
  if (opts.includeZero) yd = [Math.min(0, yd[0]), Math.max(0, yd[1])];
  const padY = (yd[1] - yd[0]) * 0.06 || 0.01;
  yd = [yd[0] - padY, yd[1] + padY];
  const x = linear(xd[0], xd[1], m.l, W - m.r), y = linear(yd[0], yd[1], H - m.b, m.t);
  const grid = el("svg:g");
  for (const t of niceTicks(yd[0], yd[1], 5)) {
    grid.append(el("svg:line", { class: "gridline", x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
    grid.append(el("svg:text", { x: m.l - 6, y: y(t) + 3.5, "text-anchor": "end", text: opts.yFormat ? opts.yFormat(t) : t }));
  }
  for (const t of opts.xTicks || niceTicks(xd[0], xd[1], 6)) {
    grid.append(el("svg:text", { x: x(t), y: H - m.b + 16, "text-anchor": "middle", text: opts.xFormat ? opts.xFormat(t) : fmtInt(t) }));
  }
  grid.append(el("svg:line", { class: "axis", x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: css("--axis") }));
  grid.append(el("svg:text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", text: opts.xLabel || "" }));
  grid.append(el("svg:text", { x: 12, y: m.t + (H - m.b - m.t) / 2, transform: `rotate(-90 12 ${m.t + (H - m.b - m.t) / 2})`,
    "text-anchor": "middle", text: opts.yLabel || "" }));
  svg.append(grid);
  if (opts.includeZero) svg.append(el("svg:line", { class: "zero", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));
  for (const h of opts.hLines || []) {
    svg.append(el("svg:line", { x1: m.l, x2: W - m.r, y1: y(h.y), y2: y(h.y), stroke: css("--critical"),
      "stroke-dasharray": "4 3", "stroke-width": 1 }));
    svg.append(el("svg:text", { x: W - m.r - 2, y: y(h.y) - 4, "text-anchor": "end", text: h.label }));
  }
  for (const mark of opts.marks || []) {
    if (mark.x < xd[0] || mark.x > xd[1]) continue;
    svg.append(el("svg:line", { x1: x(mark.x), x2: x(mark.x), y1: m.t, y2: H - m.b, stroke: css("--muted"),
      "stroke-dasharray": "3 3", "stroke-width": 1 }));
    svg.append(el("svg:text", { x: x(mark.x) + 3, y: m.t + 10, text: mark.label }));
  }
  for (const s of series) {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    svg.append(el("svg:path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round",
      "stroke-linecap": "round", "stroke-dasharray": s.dash || null }));
    if (s.points.length === 1 || (opts.markers && s.markers !== false) || s.markers) {
      for (const p of s.points) svg.append(el("svg:circle", { cx: x(p[0]), cy: y(p[1]), r: 4, fill: s.color, stroke: css("--surface"), "stroke-width": 2 }));
    }
  }
  // Crosshair + tooltip: nearest x across all series.
  const cross = el("svg:line", { y1: m.t, y2: H - m.b, stroke: css("--muted"), "stroke-width": 1, visibility: "hidden" });
  const dots = series.map((s) => el("svg:circle", { r: 4, fill: s.color, stroke: css("--surface"), "stroke-width": 2, visibility: "hidden" }));
  svg.append(cross, ...dots);
  const hit = el("svg:rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" });
  hit.addEventListener("mousemove", (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const xv = x.invert(px);
    const rows = [];
    let snapX = null;
    series.forEach((s, i) => {
      let best = null;
      for (const p of s.points) if (!best || Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
      if (!best) return;
      snapX = snapX === null || Math.abs(best[0] - xv) < Math.abs(snapX - xv) ? best[0] : snapX;
      dots[i].setAttribute("cx", x(best[0]));
      dots[i].setAttribute("cy", y(best[1]));
      dots[i].setAttribute("visibility", "visible");
      rows.push(`<div class="row"><span class="sw" style="background:${s.color}"></span>${s.name}: <b>${
        opts.valueFormat ? opts.valueFormat(best[1]) : fmt(best[1])}</b> <span style="color:var(--muted)">@ ${opts.xFormat ? opts.xFormat(best[0]) : fmtInt(best[0])}</span></div>`);
    });
    if (snapX !== null) {
      cross.setAttribute("x1", x(snapX));
      cross.setAttribute("x2", x(snapX));
      cross.setAttribute("visibility", "visible");
    }
    showTip(evt, `<div style="margin-bottom:4px;color:var(--ink-2)">${opts.xName || "step"} ≈ ${opts.xFormat ? opts.xFormat(snapX ?? xv) : fmtInt(xv)}</div>${rows.join("")}`);
  });
  hit.addEventListener("mouseleave", () => {
    hideTip();
    cross.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
  });
  svg.append(hit);
  const card = el("div", { class: "card" });
  if (opts.title) card.append(el("h3", { text: opts.title }));
  if (series.length > 1 || opts.forceLegend) {
    card.append(el("div", { class: "legend" }, series.map((s) =>
      el("span", {}, el("span", { class: "key", style: `background:${s.color}${s.dash ? ";opacity:.6" : ""}` }), s.name))));
  }
  if (!series.length) card.append(el("p", { class: "caption", text: opts.empty || "No data yet." }));
  else card.append(svg);
  host.append(card);
}

// ---------------------------------------------------------------- sections
let DATA = null;

function renderStamp() {
  const t = new Date(DATA.generated_at * 1000);
  const stamp = document.getElementById("stamp");
  stamp.innerHTML = `Updated <b>${t.toLocaleString()}</b><br/>Protocol v1.1 · <code>${DATA.protocol.sha256.slice(0, 12)}</code>`;
}

function renderTiles() {
  const runs = DATA.runs.filter((r) => r.phase !== "base");
  const c = (k) => runs.filter((r) => r.status === k).length;
  const tiles = [
    ["Trajectories complete", `${c("done")} / ${runs.length}`, `${c("running")} running · ${c("queued")} queued · ${c("failed")} failed`],
    ["Tokens trained", `${(DATA.tokens_trained / 1e9).toFixed(2)} B`, `of ${(DATA.tokens_planned / 1e9).toFixed(1)} B planned`],
    ["GPU-hours (training)", DATA.gpu_hours.toFixed(1), "8 GPUs per trajectory, excluding checks"],
    ["Checks passed", `${DATA.checks.filter((x) => x.status === "pass").length} / ${DATA.checks.length}`,
      `${DATA.checks.filter((x) => x.status === "fail").length} failing`],
  ];
  const host = document.getElementById("tiles");
  host.replaceChildren(...tiles.map(([label, value, sub]) =>
    el("div", { class: "tile" }, el("div", { class: "label", text: label }), el("div", { class: "value", text: value }),
      el("div", { class: "sub", text: sub }))));
  const notes = document.getElementById("notices");
  notes.replaceChildren(...DATA.protocol.source_mismatches.map((m) =>
    el("div", { class: "item", html: `<b>SOURCE_MISMATCH · ${m.id}</b> — ${m.text}` })));
}

function renderFindings() {
  const items = [];
  const dev = DATA.dev;
  if (dev.rows.length) {
    const byC = {};
    for (const r of dev.rows) (byC[r.c] = byC[r.c] || []).push(r);
    const complete = Object.entries(byC).filter(([, v]) => v.length === 3)
      .map(([c, v]) => [Number(c), v.reduce((s, r) => s + r.dev_loss, 0) / 3]).sort((a, b) => a[1] - b[1]);
    if (complete.length) {
      const [bestC, bestM] = complete[0];
      items.push(`Scalar sweep (dev set, step 13,000): among ${complete.length} matrix gains with all three anchors done, c = ${bestC} leads with mean dev loss ${bestM.toFixed(4)}` +
        (dev.selected != null ? `; the protocol selection is c = ${dev.selected}.` : "; the selection waits for all five gains (c = 1 is the √κ baseline run)."));
    }
  }
  const det = DATA.determinism || [];
  const detOk = det.filter((d) => d.deterministic);
  if (detOk.length) items.push(`Training is bitwise reproducible across runs and H100 nodes only with rank-ordered reductions and deterministic kernels (${new Set(detOk.map((d) => d.digest)).size === 1 ? "verified on " + detOk.length + " nodes" : "not yet verified"}); every campaign run uses this mode.`);
  const dry = (DATA.dry_runs || []).filter((r) => r.validation_ratio != null);
  if (dry.length) {
    const single = dry.filter((r) => r.geometry_batches === 1).map((r) => r.validation_ratio);
    const pooled = dry.filter((r) => r.geometry_batches > 1).map((r) => r.validation_ratio);
    items.push(`The top-16 sharp directions from one 131K-token batch keep ${Math.round(Math.min(...single) * 100)}–${Math.round(Math.max(...single) * 100)}% of their curvature on held-out tokens` +
      (pooled.length ? `; from 1M pooled tokens they keep ${Math.round(Math.min(...pooled) * 100)}–${Math.round(Math.max(...pooled) * 100)}%.` : "."));
    const accepted = dry.filter((r) => r.stat_accepted);
    if (accepted.length) items.push(`The Stat operator is accepted in every engineering calibration that reached it (${accepted.length}); its eigenvalues lie between √κ = 4 and κ = 16, i.e. sharp directions want more than √κ movement.`);
  }
  items.push("Confirmatory trajectories have not started: they wait for the protocol revision (see Engineering).");
  document.getElementById("findings").replaceChildren(...items.map((s) => el("li", { text: s })));
}

function renderMatrix() {
  const groups = [
    ["Development · global c", (r) => r.method === "GLOBAL_CANDIDATE", 16],
    ["Primary · κ = 16", (r) => r.phase === "primary", 16],
    ["Transfer · κ = 4", (r) => r.phase === "transfer", 4],
    ["Diagnostics · κ = 16", (r) => r.phase === "diagnostic", 16],
    ["Legacy branching · κ = 16", (r) => r.phase === "legacy", 16],
  ];
  const host = document.getElementById("matrix");
  const box = el("div", { class: "matrix" });
  box.append(el("div", { class: "mrow" }, el("div"), [1000, 5000, 9000].map((a) =>
    el("div", { class: "mhead", text: `Anchor ${a.toLocaleString()} → 13,000` }))));
  for (const [title, pick] of groups) {
    const runs = DATA.runs.filter(pick);
    if (!runs.length) continue;
    const labels = [...new Set(runs.map((r) => rowKey(r)))];
    box.append(el("div", { class: "mhead", style: "margin-top:8px", text: title }));
    for (const label of labels) {
      const row = el("div", { class: "mrow" });
      const sample = runs.find((r) => rowKey(r) === label);
      row.append(el("div", { class: "rowlabel" }, el("span", { text: label }),
        el("small", { text: sample.calibrations_planned ? `rank ${sample.rank} · recalibrated every 2,048 steps` : "no calibration" })));
      for (const a of [1000, 5000, 9000]) {
        const r = runs.find((x) => rowKey(x) === label && x.anchor === a);
        row.append(r ? cell(r) : el("div", { class: "cell empty", text: "not in design" }));
      }
      box.append(row);
    }
  }
  host.replaceChildren(box);
}

function rowKey(r) {
  if (r.method === "GLOBAL_CANDIDATE") return `c = ${r.c}`;
  return METHOD_LABEL[r.method] || r.method;
}

function cell(r) {
  const node = el("div", { class: "cell" });
  const color = r.method === "GLOBAL_CANDIDATE" ? css(C_COLOR[r.c] || "--s1") : css(METHOD_COLOR[r.method] || "--s1");
  const progress = r.progress || 0;
  node.append(statusBadge(r.status));
  node.append(el("div", { class: "bar", style: "margin-top:6px" },
    el("span", { style: `width:${(progress * 100).toFixed(1)}%;background:${color}` })));
  node.append(el("div", { class: "meta" }, el("span", { text: r.step ? `step ${fmtInt(r.step)}` : "" }),
    el("span", { text: r.status === "running" ? `ETA ${dur(r.eta_seconds)}` : (r.last_training_loss ? `train ${fmt(r.last_training_loss, 3)}` : "") })));
  node.addEventListener("mousemove", (evt) => showTip(evt, [
    `<b>${r.run_id}</b>`,
    `status: ${r.status}${r.engineering_only ? " (engineering only)" : ""}`,
    `updates: ${fmtInt(r.updates_done)} / ${fmtInt(r.updates_total)}`,
    `per update: ${r.seconds_per_update ? r.seconds_per_update.toFixed(2) + " s" : "–"}`,
    `calibrations: ${(r.calibrations || []).length} / ${r.calibrations_planned}`,
    r.lane ? `lane: ${r.lane}` : "",
    r.fallbacks && Object.keys(r.fallbacks).length ? `fallbacks: ${JSON.stringify(r.fallbacks)}` : "",
  ].filter(Boolean).join("<br/>")));
  node.addEventListener("mouseleave", hideTip);
  return node;
}

function curveSeries(runs, mode, baselineFor) {
  return runs.filter((r) => r.curve && r.curve.length).map((r) => {
    let points = r.curve;
    if (mode === "diff") {
      const base = baselineFor(r);
      if (!base || base.run_id === r.run_id) return null;
      const map = new Map(base.curve.map((p) => [p[0], p[1]]));
      points = r.curve.filter((p) => map.has(p[0])).map((p) => [p[0], p[1] - map.get(p[0])]);
    }
    const isC = r.method === "GLOBAL_CANDIDATE";
    return {
      name: isC ? `c = ${r.c}` : METHOD_LABEL[r.method] || r.method,
      color: css(isC ? C_COLOR[r.c] : METHOD_COLOR[r.method]), points,
    };
  }).filter(Boolean);
}

function renderCurves() {
  const mode = document.querySelector('input[name="curve-mode"]:checked').value;
  const zoom = document.getElementById("curve-zoom").checked;
  const host = document.getElementById("curve-panels");
  host.replaceChildren();
  const pending = [];
  const base = (anchor, kappa) => DATA.runs.find((r) => r.method === "BASE_SQRT" && r.anchor === anchor && r.kappa === kappa);
  const panels = [];
  for (const kappa of [16, 4]) {
    for (const anchor of [1000, 5000, 9000]) {
      const runs = DATA.runs.filter((r) => ["primary", "transfer"].includes(r.phase) && r.anchor === anchor && r.kappa === kappa)
        .sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method));
      panels.push({ title: `Anchor ${anchor.toLocaleString()} · κ = ${kappa} (${kappa === 16 ? "2M" : "512K"} tokens)`, runs, anchor, kappa });
    }
  }
  for (const anchor of [1000, 5000, 9000]) {
    const runs = DATA.runs.filter((r) => r.method === "GLOBAL_CANDIDATE" && r.anchor === anchor)
      .concat(DATA.runs.filter((r) => r.method === "BASE_SQRT" && r.kappa === 16 && r.anchor === anchor).map((r) => ({ ...r, method: "GLOBAL_CANDIDATE", c: 1 })))
      .sort((a, b) => a.c - b.c);
    panels.push({ title: `Scalar sweep · anchor ${anchor.toLocaleString()} (matrix gain c·√κ)`, runs, anchor, kappa: 16, sweep: true });
  }
  panels.push({ title: "Diagnostics · anchor 5,000 · κ = 16", anchor: 5000, kappa: 16,
    runs: DATA.runs.filter((r) => r.phase === "diagnostic" || (r.phase === "primary" && r.anchor === 5000 && ["STAT_FEEDBACK", "BASE_SQRT"].includes(r.method))) });
  for (const p of panels) {
    let series = curveSeries(p.runs, mode, (r) => {
      const b = base(p.anchor, p.kappa);
      return r.run_id === (b && b.run_id) ? null : b;
    });
    if (!series.length) { pending.push(p.title); continue; }
    const start = zoom ? p.anchor + 1024 : p.anchor;
    series = series.map((s) => ({ ...s, points: s.points.filter((q) => q[0] >= start) }));
    if (mode === "abs" && DATA.reference_curve.length) {
      const ref = DATA.reference_curve.filter((q) => q[0] >= start);
      if (ref.length) series.push({ name: "128K reference (every 1,000)", color: css("--muted"), points: ref, dash: "4 3" });
    }
    lineChart(host, {
      title: p.title, series, xDomain: [start, END], xLabel: "reference step",
      yLabel: mode === "abs" ? "monitor loss (nats/token)" : "Δ loss vs √κ baseline",
      includeZero: mode === "diff", marks: [{ x: p.anchor + 1024, label: "a + 1,024" }],
      valueFormat: (v) => (mode === "diff" ? (v >= 0 ? "+" : "") + (v * 1000).toFixed(2) + "e-3" : fmt(v)),
      yFormat: mode === "diff" ? (v) => (v * 1000).toFixed(0) + "e-3" : (v) => v.toFixed(2),
      empty: "No evaluations yet.",
    });
  }
  document.getElementById("curve-pending").textContent = pending.length
    ? `Not started yet: ${pending.join(" · ")}.` : "";
}

function renderDev() {
  const dev = DATA.dev;
  const host = document.getElementById("dev-chart");
  host.replaceChildren();
  const cs = [0.25, 0.5, 1, 2, 4];
  const series = [1000, 5000, 9000].map((a, i) => ({
    name: `Anchor ${a.toLocaleString()}`, color: css(["--s1", "--s2", "--s3"][i]),
    points: dev.rows.filter((r) => r.anchor === a).sort((p, q) => p.c - q.c).map((r) => [Math.log2(r.c), r.dev_loss]),
  }));
  lineChart(host, {
    title: "Dev loss at step 13,000 vs matrix gain", series, xDomain: [-2, 2], xTicks: [-2, -1, 0, 1, 2],
    xLabel: "log₂ c  (c·√κ matrix gain; c = ¼ is a fixed LR, c = 4 linear)", yLabel: "dev loss",
    empty: "Dev scores appear as each candidate reaches step 13,000.", forceLegend: true,
  });
  const table = el("table", {}, el("tr", {}, el("th", { text: "c" }), [1000, 5000, 9000].map((a) => el("th", { class: "num", text: `a = ${a}` })),
    el("th", { class: "num", text: "mean" })));
  for (const c of cs) {
    const tr = el("tr", {}, el("td", { text: `${c}${dev.selected === c ? "  ← selected" : ""}` }));
    for (const a of [1000, 5000, 9000]) {
      const r = dev.rows.find((x) => x.anchor === a && x.c === c);
      tr.append(el("td", { class: "num", text: r ? fmt(r.dev_loss, 5) : "–" }));
    }
    const m = dev.means.find((x) => x.c === c);
    tr.append(el("td", { class: "num", text: m ? fmt(m.mean, 5) : "–" }));
    table.append(tr);
  }
  document.getElementById("dev-table").replaceChildren(el("div", { class: "scroll", style: "margin-top:12px" }, table));
}

// Gate outcome of every trajectory calibration point under each candidate rule variant.
const VARIANTS = [
  ["inline", "v1.1 as written", "inline during the 2M runs"],
  ["v1.2-proposal", "v1.2 candidate", "8-batch pools, held-out V, per-vector held-out residual ≤ 0.25, pooled local check"],
  ["v1.2-proposal-spiketrim", "+ spike trim", "option (b): drop sequences that own a top mode"],
  ["v1.2-proposal-cand4r", "+ 4r candidates", "replicate filter over 4r Ritz modes"],
  ["v1.2-proposal-hres0.4", "residual ≤ 0.40", "per-vector held-out residual ≤ 0.40, pooled local check"],
  ["v1.2-proposal-hres0.4-local_per_batch", "rc2", "per-vector held-out residual ≤ 0.40, local check per B0 batch (averaged)"],
  ["v1.2-proposal-hres0.4-local_per_batch-h100", "rc2 · H100 repeat", "rc2 rerun on H100 where the rc2 column ran on H200 (hardware sensitivity)"],
  ["v1.2-proposal-hres0.4-local_per_batch-ggn_tf32", "rc2 · TF32 GGN", "rc2 with TF32 matmuls in the GGN products only (Muon map and JVP stay FP32)"],
  ["v1.2-proposal-hres0.4-local_per_batch-rank64", "rc2 · rank 64", "RANK64 diagnostic arm: rc2 at rank 64 (512 Lanczos products)"],
  ["v1.2-proposal-hres0.4-local_per_batch-random", "rc2 · random basis", "RANDOM_STAT_FEEDBACK arm: Gaussian basis, only finite/QR gates on the basis"],
];

function gateCell(c) {
  if (!c) return el("td", { class: "gate empty", text: "·" });
  const part = (label, ok) => el("span", { class: "gate-part" },
    el("span", { class: "dot", style: `background:var(${ok == null ? "--muted" : ok ? "--good" : "--critical"})` }),
    el("span", { text: label + (ok == null ? "–" : ok ? "✓" : "✗") }));
  const td = el("td", { class: "gate" },
    part("B", c.basis_valid), part("S", c.basis_valid ? c.stat_accepted : null),
    part("F", c.basis_valid ? c.feedback_valid : null),
    el("span", { class: "gate-num", text: c.local_max_error != null ? c.local_max_error.toFixed(2) : "" }));
  td.addEventListener("mousemove", (evt) => showTip(evt,
    `<b>step ${fmtInt(c.step)}</b> · ${c.protocol}${c.device ? " · " + c.device : ""}<br/>` +
    `basis: ${c.basis_valid ? "valid" : "invalid (" + (c.basis_reason || "–") + ")"}` +
    (c.validation_residual_max != null ? `, max held-out residual ${c.validation_residual_max.toFixed(3)}` : "") + "<br/>" +
    `Stat: ${c.stat_accepted == null ? "–" : c.stat_accepted ? "accepted" : c.stat_reason}<br/>` +
    `local check (${c.local_mode || "pooled"}): ${c.local_max_error != null ? c.local_max_error.toFixed(3) : "–"}` +
    (c.KB_K0_relative != null ? `<br/>‖K_B − K0‖/‖K0‖ = ${c.KB_K0_relative.toFixed(2)}` : "")));
  td.addEventListener("mouseleave", hideTip);
  return td;
}

function renderGateMatrix() {
  const host = document.getElementById("gate-matrix");
  const points = new Map();
  for (const r of DATA.runs) {
    if (r.method !== "BASE_SQRT") continue;
    for (const c of r.calibrations || []) {
      const key = `${r.run_id}|${c.index}`;
      if (!points.has(key)) points.set(key, { run: r, index: c.index, step: c.step, cells: {} });
      points.get(key).cells[c.protocol] = c;
    }
  }
  const present = VARIANTS.filter(([k]) => [...points.values()].some((p) => p.cells[k]));
  if (!present.length) { host.replaceChildren(); return; }
  const rows = [...points.values()].sort((a, b) => b.run.kappa - a.run.kappa || a.run.anchor - b.run.anchor || a.index - b.index);
  const table = el("table", { class: "gates" }, el("tr", {}, el("th", { text: "calibration point" }),
    present.map(([, label, hint]) => el("th", { text: label, title: hint }))));
  for (const p of rows) {
    table.append(el("tr", {}, el("td", { text: `κ${p.run.kappa} · a${p.run.anchor} · c${p.index} · step ${fmtInt(p.step)}` }),
      present.map(([k]) => gateCell(p.cells[k]))));
  }
  const all = (c) => c && c.basis_valid && c.stat_accepted && c.feedback_valid;
  table.append(el("tr", { class: "total" }, el("td", { text: "all three gates pass" }), present.map(([k]) => {
    const cells = rows.map((p) => p.cells[k]).filter(Boolean);
    return el("td", { class: "gate", text: `${cells.filter(all).length} / ${cells.length}` });
  })));
  host.replaceChildren(el("div", { class: "card" }, el("h3", { text: "Gate outcome per calibration point and rule variant" }),
    el("p", { class: "caption", text: "Deferred diagnostics on the BASE_SQRT (diagnostics-only) trajectories: each cell reruns the calibration at the saved state under one rule. B = basis (§6.2), S = Stat accepted (§6.4), F = feedback local check ≤ 0.5 (§7); the number is the local-check max error. Hover for details. Columns are rules, not methods; no loss enters this table." }),
    el("div", { class: "scroll" }, table),
    el("p", { class: "caption", text: present.map(([, label, hint]) => `${label}: ${hint}`).join(" · ") })));
}

// Local-check max error at each trajectory point: pooled (x) against per-batch (y), same basis.
function renderLocalScatter() {
  const host = document.getElementById("local-scatter");
  const pts = [];
  for (const r of DATA.runs) {
    if (r.method !== "BASE_SQRT") continue;
    const by = {};
    for (const c of r.calibrations || []) (by[c.index] ??= {})[c.protocol] = c;
    for (const cells of Object.values(by)) {
      const y = cells["v1.2-proposal-hres0.4-local_per_batch"];
      const x = [cells["v1.2-proposal"], cells["v1.2-proposal-hres0.4"]].find((c) => c && c.local_max_error != null);
      if (y && x && y.local_max_error != null) pts.push({ kappa: r.kappa, anchor: r.anchor, step: y.step, x: x.local_max_error, y: y.local_max_error });
    }
  }
  if (!pts.length) { host.replaceChildren(); return; }
  const W = 460, H = 360, m = { l: 52, r: 16, t: 14, b: 44 }, lim = 0.7;
  const x = linear(0, lim, m.l, W - m.r), y = linear(0, lim, H - m.b, m.t);
  const svg = el("svg:svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", style: "max-width:520px", role: "img", "aria-label": "local-check error, pooled against per-batch" });
  for (const t of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
    svg.append(el("svg:line", { class: "gridline", x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
    svg.append(el("svg:text", { x: m.l - 6, y: y(t) + 3.5, "text-anchor": "end", text: t.toFixed(1) }));
    svg.append(el("svg:text", { x: x(t), y: H - m.b + 16, "text-anchor": "middle", text: t.toFixed(1) }));
  }
  svg.append(el("svg:rect", { x: x(0.5), y: m.t, width: x(lim) - x(0.5), height: y(0) - m.t, fill: css("--critical"), opacity: 0.06 }));
  svg.append(el("svg:rect", { x: m.l, y: m.t, width: x(0.5) - m.l, height: y(0.5) - m.t, fill: css("--critical"), opacity: 0.06 }));
  svg.append(el("svg:line", { x1: x(0), y1: y(0), x2: x(lim), y2: y(lim), stroke: css("--muted"), "stroke-dasharray": "3 4" }));
  svg.append(el("svg:line", { x1: x(0.5), x2: x(0.5), y1: m.t, y2: y(0), stroke: css("--critical"), "stroke-width": 1 }));
  svg.append(el("svg:line", { x1: m.l, x2: W - m.r, y1: y(0.5), y2: y(0.5), stroke: css("--critical"), "stroke-width": 1 }));
  svg.append(el("svg:text", { x: x(0.5) + 4, y: m.t + 10, text: "gate 0.5" }));
  for (const p of pts) {
    const dot = el("svg:circle", { cx: x(Math.min(p.x, lim)), cy: y(Math.min(p.y, lim)), r: 5, fill: css(p.kappa === 16 ? "--s1" : "--s2"), stroke: css("--surface"), "stroke-width": 2 });
    const hit = el("svg:circle", { cx: x(Math.min(p.x, lim)), cy: y(Math.min(p.y, lim)), r: 11, fill: "transparent" });
    hit.addEventListener("mousemove", (evt) => showTip(evt, `<b>κ${p.kappa} · a${p.anchor} · step ${fmtInt(p.step)}</b><br/>pooled ${p.x.toFixed(3)} → per-batch ${p.y.toFixed(3)}`));
    hit.addEventListener("mouseleave", hideTip);
    svg.append(dot, hit);
  }
  svg.append(el("svg:text", { x: (m.l + W - m.r) / 2, y: H - 8, "text-anchor": "middle", text: "pooled check (8-batch mean gradient)" }));
  svg.append(el("svg:text", { x: 14, y: (m.t + H - m.b) / 2, transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})`, "text-anchor": "middle", text: "per-batch check (rc2)" }));
  const legend = el("div", { class: "legend" },
    el("span", {}, el("span", { class: "dot", style: `background:${css("--s1")}` }), " κ = 16"),
    el("span", {}, el("span", { class: "dot", style: `background:${css("--s2")}` }), " κ = 4"),
    el("span", { text: "dashed: equal error · shaded: fails the 0.5 gate" }));
  host.replaceChildren(el("div", { class: "card" }, el("h3", { text: "Local-check max error: pooled vs per-batch (§7)" }),
    el("p", { class: "caption", text: "Same calibration point and basis; below the diagonal the per-batch check agrees better with K0. K0 averages Jacobians at single-B0 gradients, and the pooled check evaluates the Jacobian at an 8-batch mean, a different noise level." }),
    legend, svg));
}

function renderCalibration() {
  renderGateMatrix();
  renderLocalScatter();
  const rows = DATA.runs.flatMap((r) => (r.calibrations || []).map((c) => ({ ...c, method: r.method, anchor: r.anchor, kappa: r.kappa })))
    .concat((DATA.dry_runs || []).map((c) => ({ ...c, method: `dry run · ${c.method || ""}` })));
  const host = document.getElementById("cal-chart");
  host.replaceChildren();
  if (!rows.length) {
    host.append(el("p", { class: "caption", text: "No calibrations yet." }));
    document.getElementById("cal-table").replaceChildren();
    return;
  }
  // Strip plot of S eigenvalues (log scale), one column per calibration.
  const W = Math.max(540, rows.length * 34 + 90), H = 260, m = { l: 56, r: 10, t: 10, b: 30 };
  const svg = el("svg:svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "S eigenvalues" });
  const ly = (v) => Math.log2(Math.max(v, 1 / 8));
  const y = linear(ly(1 / 8), ly(32), H - m.b, m.t);
  for (const t of [0.25, 1, 4, 16]) {
    svg.append(el("svg:line", { class: "gridline", x1: m.l, x2: W - m.r, y1: y(ly(t)), y2: y(ly(t)) }));
    svg.append(el("svg:text", { x: m.l - 6, y: y(ly(t)) + 3.5, "text-anchor": "end", text: t }));
  }
  rows.forEach((row, i) => {
    const cx = m.l + 20 + i * 34;
    const color = css(METHOD_COLOR[row.method] || "--s1");
    (row.S_unclipped || []).forEach((v) => svg.append(el("svg:circle", { cx: cx - 5, cy: y(ly(v)), r: 3, fill: "none", stroke: color, "stroke-width": 1.5 })));
    (row.S || []).forEach((v) => svg.append(el("svg:circle", { cx: cx + 5, cy: y(ly(v)), r: 3, fill: color })));
    svg.append(el("svg:text", { x: cx, y: H - m.b + 14, "text-anchor": "middle", text: `${row.index ?? ""}` }));
    const hit = el("svg:rect", { x: cx - 14, y: m.t, width: 28, height: H - m.t - m.b, fill: "transparent" });
    hit.addEventListener("mousemove", (evt) => showTip(evt, `<b>${row.run_id || row.method}</b><br/>step ${fmtInt(row.step)} · ${row.stat_accepted ? "S accepted" : "S rejected (" + (row.stat_reason || row.basis_reason || "–") + ")"}<br/>S (clipped): ${(row.S || []).map((v) => v.toFixed(2)).join(", ")}`));
    hit.addEventListener("mouseleave", hideTip);
    svg.append(hit);
  });
  svg.append(el("svg:text", { x: 12, y: H / 2, transform: `rotate(-90 12 ${H / 2})`, "text-anchor": "middle", text: "S eigenvalue (log scale)" }));
  host.append(el("div", { class: "card" }, el("h3", { text: "Stat operator spectrum per calibration" }),
    el("div", { class: "legend" }, el("span", { text: "○ before clipping   ● after clipping to [¼, κ]" })), el("div", { class: "scroll" }, svg)));
  const head = ["run", "protocol", "step", "basis", "Lanczos", "max residual", "val. residual", "precision", "Stat", "local check", "‖T‖", "time"];
  const table = el("table", {}, el("tr", {}, head.map((h, i) => el("th", { class: i > 3 ? "num" : "", text: h }))));
  for (const r of rows) {
    table.append(el("tr", {},
      el("td", { text: r.run_id || r.method }),
      el("td", { text: r.protocol ? (r.protocol === "inline" ? "v1.1" : r.protocol.replace("-proposal", " candidate")) : "dry run" }),
      el("td", { text: fmtInt(r.step) }),
      el("td", {}, statusBadge(r.basis_valid ? "pass" : "fail"), el("small", { text: r.basis_reason ? ` ${r.basis_reason}` : "" })),
      el("td", { class: "num", text: r.lanczos_products ?? "–" }),
      el("td", { class: "num", text: r.residual_max != null ? r.residual_max.toExponential(1) : "–" }),
      el("td", { class: "num", text: r.validation_residual_max != null ? r.validation_residual_max.toFixed(3) : "–" }),
      el("td", { class: "num", text: r.precision_error != null ? r.precision_error.toFixed(4) : "–" }),
      el("td", { class: "num", text: r.stat_accepted == null ? "–" : r.stat_accepted ? "accepted" : r.stat_reason }),
      el("td", { class: "num", text: r.local_max_error != null ? `${r.local_max_error.toFixed(2)} ${r.feedback_valid ? "✓" : "✗"}` : "–" }),
      el("td", { class: "num", text: r.T_norm != null ? r.T_norm.toFixed(2) : "–" }),
      el("td", { class: "num", text: dur(r.seconds) })));
  }
  document.getElementById("cal-table").replaceChildren(el("div", { class: "scroll", style: "margin-top:12px" }, table));
}

function renderChecks() {
  const table = el("table", {}, el("tr", {}, ["check", "hardware", "status", "detail"].map((h) => el("th", { text: h }))));
  for (const c of DATA.checks) {
    table.append(el("tr", {}, el("td", { text: c.title }), el("td", { text: c.hardware || "" }),
      el("td", {}, statusBadge(c.status)), el("td", { text: c.detail || "" })));
  }
  document.getElementById("check-table").replaceChildren(el("div", { class: "scroll" }, table));
}

function renderProtocol() {
  const W = 1000, H = 150, m = { l: 20, r: 20 };
  const x = linear(0, END, m.l, W - m.r);
  const svg = el("svg:svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "timeline" });
  svg.append(el("svg:line", { x1: x(0), x2: x(END), y1: 30, y2: 30, stroke: css("--ink-2"), "stroke-width": 2 }));
  svg.append(el("svg:text", { x: x(0), y: 20, text: "128K reference run (seed 1, reused)" }));
  svg.append(el("svg:text", { x: x(END), y: 20, "text-anchor": "end", text: "step 13,000 · 1.70B tokens" }));
  [1000, 5000, 9000].forEach((a, i) => {
    const yy = 60 + i * 28;
    svg.append(el("svg:line", { x1: x(a), x2: x(a), y1: 30, y2: yy, stroke: css("--muted"), "stroke-dasharray": "2 3" }));
    svg.append(el("svg:line", { x1: x(a), x2: x(END), y1: yy, y2: yy, stroke: css("--s4"), "stroke-width": 3, "stroke-linecap": "round" }));
    for (let t = a; t < END; t += 2048) svg.append(el("svg:circle", { cx: x(t), cy: yy, r: 4.5, fill: css("--surface"), stroke: css("--s4"), "stroke-width": 2 }));
    svg.append(el("svg:text", { x: x(a) - 6, y: yy + 4, "text-anchor": "end", text: `a = ${a.toLocaleString()}` }));
  });
  svg.append(el("svg:text", { x: x(END), y: H - 6, "text-anchor": "end", text: "○ calibration every 2,048 reference steps · one update per κ reference batches" }));
  document.getElementById("timeline").replaceChildren(el("div", { class: "card" }, el("h3", { text: "Design at a glance" }), svg));
  document.getElementById("protocol-text").innerHTML = `
  <h2>Update rule</h2>
  <p>One real update at B = κ·131,072 tokens averages κ reference-batch gradients at fixed parameters, moves Muon's buffer once
  (μ = ω = 0.95), and applies <code>corrected = √κ·u<sub>B</sub> + U (T S − √κ I) Uᵀ u<sub>B</sub></code> with
  <code>w ← d·w − η̄·corrected</code>, where η̄ is the mean reference LR over the window and d the product of its weight-decay
  retentions. U spans the top-16 modes of P<sup>1/2</sup> G P<sup>1/2</sup> (P the damped polar Jacobian at the Muon buffer,
  G the Gauss–Newton matrix), re-estimated every 2,048 reference steps.</p>
  <p><b>S (Stat)</b> is a ridge fit, clipped to eigenvalues in [¼, κ], that maps large-batch projected responses and their Jacobians
  onto κ times the small-batch ones; it is accepted only if it beats √κ·I on held-out probe groups.
  <b>T (feedback)</b> sums the κ-step affine recursion R ← (I − η<sub>j</sub>K₀)R + η<sub>j</sub>I, falling back to I when
  ‖T‖ &gt; 2 or the update norm exceeds 2√κ‖u<sub>B</sub>‖.</p>
  <h2>Analysis</h2>
  <p>Single reference trajectory; the three anchors are stages, not replicates. The primary estimand is the equal-weight mean of
  Δ<sub>a</sub> = L(Stat × feedback) − L(√κ) at κ = 16, with 0.002 nats/token as the preset practical threshold. No p-values or
  seed intervals are computed. The final set is scored only after the scalar sweep is locked.</p>
  <p>Protocol SHA-256 <code>${DATA.protocol.sha256}</code>, run matrix <code>${DATA.protocol.run_matrix_sha256.slice(0, 16)}…</code>.</p>`;
}

// Sharp-subspace response and Jacobian vs batch size (stat_feedback.batch_scan).
function renderBatchScans() {
  const host = document.getElementById("eng-batch");
  if (!host) return;
  host.replaceChildren();
  const scans = DATA.batch_scans || [];
  const order = ["reference 128K", "2M from a1000", "2M from a5000", "2M from a9000", "512K from a1000", "512K from a9000"];
  const color = (t) => css(["--s1", "--s2", "--s3", "--s4", "--s5", "--s7"][Math.max(0, order.indexOf(t))]);
  const refAt = (step) => scans.find((r) => r.trajectory.startsWith("reference") && r.step === step);
  const byTraj = order.map((t) => {
    const own = scans.filter((r) => r.trajectory === t);
    const branch = t.includes(" from a") ? refAt(Number(t.split(" from a")[1])) : null;   // start at the branch point
    const pts = (branch ? [branch] : []).concat(own).sort((a, b) => a.step - b.step);
    return { name: t, color: color(t), dash: t.startsWith("reference") ? "5 4" : null,
      points: own.length ? pts.map((r) => [r.step, r.fit_mu.B_star]) : [] };
  }).filter((s) => s.points.length);
  lineChart(host, { title: "Noise scale B* of the sharp response (units of B0 = 131K tokens)", series: byTraj,
    xDomain: [0, 13000], xTicks: [1000, 3000, 5000, 7000, 9000, 11000], xLabel: "reference step of the state",
    yLabel: "B* (base batches)", yDomain: [0, 17], markers: true, forceLegend: true, valueFormat: (v) => `${v.toFixed(1)} B0 (${(v * 0.131).toFixed(2)}M tokens)`,
    yFormat: (v) => v.toFixed(0), marks: [], hLines: [{ y: 16, label: "κ = 16 (2M)" }] });
  // Matched steps on the a1000 probe tokens: color = training batch of the state, dash = step.
  const batchOf = (r) => r.trajectory.startsWith("reference") ? "128K" : r.trajectory.split(" ")[0];
  const batchColor = { "128K": color("reference 128K"), "512K": color("512K from a1000"), "2M": color("2M from a1000") };
  const near = (r) => [7000, 11000].find((st) => Math.abs(r.step - st) <= 300);
  const curves = scans.filter((r) => r.anchor === 1000 && near(r) && r.trajectory !== "hybrid")
    .sort((a, b) => near(a) - near(b) || ["128K", "512K", "2M"].indexOf(batchOf(a)) - ["128K", "512K", "2M"].indexOf(batchOf(b)))
    .map((r) => ({ name: `${batchOf(r)} state · step ${fmtInt(r.step)}`, color: batchColor[batchOf(r)],
      dash: near(r) === 7000 ? "5 4" : null, points: r.curve.map((p) => [Math.log2(p[0]), p[1]]) }));
  lineChart(host, { title: "Mean sharp response |μ_b| / |μ_1| vs batch size", series: curves,
    xDomain: [0, 7], xTicks: [0, 1, 2, 3, 4, 5, 6, 7], xFormat: (t) => `${2 ** Math.round(t)}`, xName: "b",
    xLabel: "batch b (base batches of 131K tokens, log scale)", yLabel: "|μ_b| / |μ_1|", forceLegend: true,
    valueFormat: (v) => `${v.toFixed(2)}×`, yFormat: (v) => v.toFixed(1), marks: [] });
}

// Hybrid states: parameters and the Muon buffer m from different trainings (a1000 probes).
function renderHybrids() {
  const host = document.getElementById("eng-hybrid");
  if (!host) return;
  const scans = DATA.batch_scans || [];
  const mOf = (r) => r.momentum_from ? (r.momentum_from.startsWith("own x") ? `own m × ${r.momentum_from.slice(6)} (scaled)`
    : r.momentum_from.includes("muon-s1-parent") ? "128K" : "2M")
    : r.params_from === "reference 128K" ? "128K" : r.params_from;
  const pOf = (r) => r.params_from === "reference 128K" ? "128K" : r.params_from;
  const rows = scans.filter((r) => r.anchor === 1000 && [7000, 11000].some((st) => Math.abs(r.step - st) <= 300)
    && pOf(r) !== "512K").sort((a, b) => a.step - b.step || pOf(a).localeCompare(pOf(b)) || mOf(a).localeCompare(mOf(b)));
  if (!rows.some((r) => r.trajectory === "hybrid")) { host.replaceChildren(); return; }
  const table = el("table", {}, el("tr", {}, ["step", "parameters from", "momentum m from", "B* (base batches)", "|μ₁|"].map((h, i) =>
    el("th", { class: i > 2 ? "num" : "", text: h }))));
  for (const r of rows) {
    const hybrid = r.trajectory === "hybrid";
    table.append(el("tr", {}, el("td", { text: fmtInt(r.step) }), el("td", { text: `${pOf(r)} training` }),
      el("td", {}, el("b", { text: hybrid ? (mOf(r).startsWith("own") ? mOf(r) : `${mOf(r)} training`) : "" }), el("span", { text: hybrid ? "" : `${mOf(r)} training (same state)` })),
      el("td", { class: "num", text: r.fit_mu.B_star.toFixed(2) }),
      el("td", { class: "num", text: r.mu1 != null ? r.mu1.toFixed(2) : "–" })));
  }
  host.replaceChildren(el("div", { class: "card" }, el("h3", { text: "Parameters or optimizer state? Hybrid states" }),
    el("p", { class: "caption", text: "Each hybrid takes the parameters of one state and the Muon momentum buffer m of the other (bold); scaled rows multiply the state's own m. B* follows m: the 2M-trained buffer alone reproduces the rise, the 128K buffer removes it, and shrinking the 128K buffer's size alone raises B* roughly as 1/|m|. The basis also changes with m, since P depends on it." }),
    el("div", { class: "scroll" }, table)));
}

// B* against the absolute size of the momentum buffer |c m| (log-log): each state's own m scaled.
function renderMomentumScale() {
  const host = document.getElementById("eng-mscale");
  if (!host) return;
  host.replaceChildren();
  const norms = DATA.momentum_norms || {};
  const scans = (DATA.batch_scans || []).filter((r) => r.momentum_scale != null);
  const states = [[11000, 1000, "--s1", "reference 128K", "128K", "reference 128K@11000"],
    [5000, 5000, "--s3", "reference 128K", "128K", "reference 128K@5000"],
    [11240, 1000, "--s2", "2M", "2M", "2M@11240"], [7000, 1000, "--s5", "reference 128K", "128K", "reference 128K@7000"],
    [7144, 1000, "--s4", "2M", "2M", "2M@7144"]];
  const series = [];
  for (const [step, anchor, c, params, label, key] of states) {
    const norm = norms[key];
    if (!norm) continue;
    const pts = scans.filter((r) => r.step === step && r.anchor === anchor && r.params_from === params)
      .sort((a, b) => a.momentum_scale - b.momentum_scale).map((r) => [Math.log10(r.momentum_scale * norm), Math.log2(r.fit_mu.B_star)]);
    if (pts.length < 2) continue;
    series.push({ name: `${label} state @ ${fmtInt(step)} (own |m| = ${fmtInt(norm)})`, color: css(c), markers: true, points: pts });
    const f = (DATA.momentum_fits || []).find((q) => q.step === step && q.anchor === anchor);
    if (f) {
      const fit = [];
      for (let t = 1.3; t <= 4.2; t += 0.05) fit.push([t, Math.log2(f.B_g / (1 + (10 ** t / (f.c0 * norm)) ** f.p))]);
      series.push({ name: `fit: B_g ${f.B_g.toFixed(1)}, half-point |m| = ${fmtInt(f.c0 * norm)}, p ${f.p.toFixed(1)}`, color: css(c), dash: "3 4", markers: false, points: fit });
    }
  }
  if (!series.length) return;
  lineChart(host, { title: "Noise scale B* vs absolute size of the momentum buffer (log–log)", series,
    xDomain: [1.3, 4.2], xTicks: [2, 2.5, 3, 3.5, 4], xFormat: (t) => fmtInt(10 ** t), xName: "|m|",
    xLabel: "|c·m|: Euclidean norm of the (scaled) Muon momentum buffer", yLabel: "B* (base batches, log scale)",
    yFormat: (v) => (2 ** v).toFixed(v < 2 ? 1 : 0), valueFormat: (v) => `${(2 ** v).toFixed(2)} B0`, forceLegend: true });
}

function renderEngineering() {
  renderBatchScans();
  renderHybrids();
  renderMomentumScale();
  const runs = (DATA.dry_runs || []).filter((r) => r.rho && r.rho_validation);
  const host = document.getElementById("eng-rayleigh");
  host.replaceChildren();
  const label = (r) => `a=${r.anchor} · ${r.geometry_batches === 1 ? "131K" : (r.geometry_batches * 131072 / 1048576).toFixed(0) + "M"} tokens`;
  const seen = new Map();
  for (const r of runs) { const k = label(r); if (!seen.has(k)) seen.set(k, r); }
  const studies = [...seen.values()].sort((a, b) => a.anchor - b.anchor || a.geometry_batches - b.geometry_batches);
  const palette = ["--s1", "--s2", "--s3", "--s4", "--s5"];
  const series = [];
  studies.forEach((r, i) => {
    const color = css(palette[i % palette.length]);
    series.push({ name: `${label(r)} · construction`, color, points: r.rho.map((v, j) => [j + 1, v * 1000]) });
    series.push({ name: `${label(r)} · held-out`, color, dash: "5 4", points: r.rho_validation.map((v, j) => [j + 1, v * 1000]) });
  });
  lineChart(host, { title: "Rayleigh quotient by mode", series, xDomain: [1, 16], xTicks: [1, 4, 8, 12, 16],
    xLabel: "Ritz mode (descending)", yLabel: "ρ × 10³", valueFormat: (v) => v.toFixed(2), yFormat: (v) => v.toFixed(0) });
  const res = studies.map((r, i) => ({ name: label(r), color: css(palette[i % palette.length]),
    points: (r.residuals_validation || []).map((v, j) => [j + 1, v]) }));
  lineChart(host, { title: "Held-out residual per mode (gate 0.1)", series: res, xDomain: [1, 16], xTicks: [1, 4, 8, 12, 16],
    xLabel: "Ritz mode", yLabel: "relative residual", yDomain: [0, 1], marks: [], hLines: [{ y: 0.1, label: "v1.1 gate 0.1" }],
    valueFormat: (v) => v.toFixed(3),
    yFormat: (v) => v.toFixed(1) });
  const head = ["study", "held-out ratio", "held-out residual", "S accepted", "S eigenvalues", "Stat holdout error", "local check", "|ηK₀|", "‖T‖", "time"];
  const table = el("table", {}, el("tr", {}, head.map((h, i) => el("th", { class: i ? "num" : "", text: h }))));
  for (const r of (DATA.dry_runs || [])) {
    const S = r.S || [];
    const eta = r.eta_K0_abs || [];
    table.append(el("tr", {},
      el("td", { text: `${r.run_id}${r.override ? " (gates overridden)" : ""}${r.v_source === "validation" ? " · V on held-out" : ""}` }),
      el("td", { class: "num", text: r.validation_ratio != null ? r.validation_ratio.toFixed(2) : "–" }),
      el("td", { class: "num", text: r.residuals_validation ? `${Math.min(...r.residuals_validation).toFixed(2)}–${Math.max(...r.residuals_validation).toFixed(2)}` : "–" }),
      el("td", { class: "num", text: r.stat_accepted == null ? "–" : r.stat_accepted ? "yes" : r.stat_reason }),
      el("td", { class: "num", text: S.length ? `${Math.min(...S).toFixed(1)}–${Math.max(...S).toFixed(1)}` : "–" }),
      el("td", { class: "num", text: r.holdout_error != null ? `${r.holdout_error.toFixed(1)} vs ${r.holdout_error_sqrt_kappa.toFixed(1)} (√κ)` : "–" }),
      el("td", { class: "num", text: r.local_max_error != null ? `${r.local_max_error.toFixed(2)} ${r.feedback_valid ? "✓" : "✗ (gate 0.5)"}` : "–" }),
      el("td", { class: "num", text: eta.length ? `${Math.min(...eta).toFixed(2)}–${Math.max(...eta).toFixed(2)}` : "–" }),
      el("td", { class: "num", text: r.T_norm != null ? r.T_norm.toFixed(3) : "–" }),
      el("td", { class: "num", text: dur(r.seconds) })));
  }
  document.getElementById("eng-table").replaceChildren(el("div", { class: "scroll" }, table));
  const det = DATA.determinism || [];
  const groups = [["default kernels, NCCL sum", (d) => d.reduction === "nccl"],
    ["default kernels, ordered sum", (d) => d.reduction === "ordered" && !d.deterministic && d.sdpa === "default"],
    ["efficient attention, ordered sum", (d) => d.sdpa === "efficient"],
    ["deterministic kernels, ordered sum", (d) => d.deterministic]];
  const dt = el("table", {}, el("tr", {}, ["configuration", "runs", "distinct states", "digests (node)"].map((h) => el("th", { text: h }))));
  for (const [name, pick] of groups) {
    const rows = det.filter(pick);
    if (!rows.length) continue;
    const distinct = new Set(rows.map((r) => r.digest)).size;
    dt.append(el("tr", {}, el("td", { text: name }), el("td", { class: "num", text: rows.length }),
      el("td", {}, el("span", { class: "status" }, el("span", { class: "dot", style: `background:var(${distinct === 1 ? "--good" : "--critical"})` }),
        el("span", { text: distinct === 1 ? "reproducible (1 state)" : `not reproducible (${distinct} states)` }))),
      el("td", { text: rows.map((r) => `${r.digest.slice(0, 6)} (${(r.node || "").replace("della-", "")})`).join(", ") })));
  }
  document.getElementById("eng-determinism").replaceChildren(el("div", { class: "scroll" }, dt));
}

function render() {
  renderEngineering();
  renderStamp(); renderTiles(); renderFindings(); renderMatrix(); renderCurves(); renderDev(); renderCalibration(); renderChecks(); renderProtocol();
  document.getElementById("foot").textContent =
    "Generated from the run directories by dashboard/export.py. Numbers are single-seed and provisional until the protocol lock.";
}

document.getElementById("tabs").addEventListener("click", (evt) => {
  const tab = evt.target.dataset && evt.target.dataset.tab;
  if (!tab) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.id === tab));
  history.replaceState(null, "", `#${tab}`);
});
document.querySelectorAll('input[name="curve-mode"]').forEach((i) => i.addEventListener("change", renderCurves));
document.getElementById("curve-zoom").addEventListener("change", renderCurves);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => DATA && render());

fetch(`data.json?t=${Date.now()}`).then((r) => r.json()).then((d) => {
  DATA = d;
  render();
  const want = location.hash.slice(1);
  if (want) document.querySelector(`.tabs button[data-tab="${want}"]`)?.click();
});
