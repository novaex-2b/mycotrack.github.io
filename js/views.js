// Screens. Each returns HTML for <main>; buttons carry data-action / data-go and are handled in app.js.

import * as C from "./core.js";
import { S, esc, sp, prefs, today, D, relDays, dueChip, tChip, fChip, statusClass, stars, T, weight, VERSION } from "./state.js";

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "—");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const isLive = (c) => c.status === "active" || c.status === "stored";

// ------------------------------------------------------------------ welcome (no database yet)
export function welcome() {
  return `<div class="welcome">
  <svg viewBox="0 0 96 96" aria-hidden="true"><path fill="var(--primary)" d="M48 10C25 10 8 24 8 40c0 3 2 5 5 5h70c3 0 5-2 5-5 0-16-17-30-40-30z"/>
  <path fill="var(--secondary)" d="M38 45h20v30a10 10 0 0 1-20 0z"/><circle cx="34" cy="28" r="5" fill="var(--bg)"/><circle cx="58" cy="24" r="4" fill="var(--bg)"/><circle cx="66" cy="35" r="3" fill="var(--bg)"/></svg>
  <h1>MycoTrack</h1>
  <p class="sub">Cultures, grows and harvests on your phone, using the same database file as the desktop app.</p>
  <div class="actions">
    <button class="btn primary" data-action="open-file">Open mycotrack.db</button>
    <button class="btn" data-action="new-db">Start a new database</button>
    <button class="btn ghost" data-action="demo-db">Try it with sample data</button>
  </div>
  <ol class="steps">
    <li>On your computer the database is <span class="code">~/.local/share/mycotrack/mycotrack.db</span> (<span class="code">mycotrack path</span> shows it).</li>
    <li>Put it in a folder that syncs to your phone (Syncthing, Dropbox, Google Drive …), or copy it over.</li>
    <li>Open it here. Changes are kept on the phone until you tap the file name at the top and <b>Save</b> it back.</li>
  </ol></div>`;
}

// ------------------------------------------------------------------ dashboard
export function dashboard() {
  const ds = S.ds, day = today();
  const active = ds.grows.filter((g) => ds.isActive(g));
  const contam = ds.grows.filter((g) => g.outcome === "contaminated").length;
  const wet = [...ds.flushes.values()].flat().reduce((a, f) => a + (f.wet_g || 0), 0);
  const live = [...ds.cultures.values()].filter(isLive).length;
  let h = `<div class="stats">
    <div class="stat"><b>${live}</b><span>live cultures</span></div>
    <div class="stat"><b>${active.length}</b><span>active grows</span></div>
    <div class="stat${contam ? " bad" : ""}"><b>${ds.grows.length ? pct(contam, ds.grows.length) : "0%"}</b><span>contaminated</span></div>
    <div class="stat"><b>${(wet / 1000).toFixed(1)}</b><span>kg harvested</span></div></div>`;

  const preds = ds.dashboardPredictions(day);
  h += `<h2>Coming up</h2>`;
  if (!preds.length) h += `<p class="empty">No active grows with a forecast.</p>`;
  for (const [g, m] of preds) {
    const c = ds.cultures.get(g.culture_id), left = m.eta - day;
    h += `<a class="card" href="#/grow/${g.id}"><div class="row1"><span class="name">${esc(m.name)}</span>
      <span class="dim">${esc(g.label)} · ${esc(c.name)}</span><span class="right">${m.late ? `<span class="late">late ${m.late}d</span>` : relDays(left)}</span></div>
      <div class="row2">${D(m.eta)} (${D(m.lo).slice(5)} – ${D(m.hi).slice(5)}) · <span class="${statusClass(ds.stage(g))}">${ds.stage(g)}</span> · ${basis(m)}</div></a>`;
  }

  const att = ds.attention(day);
  h += `<h2>Transfers due</h2>`;
  if (!att.length) h += `<p class="empty">No cultures due for transfer in the next 7 days.</p>`;
  for (const r of att.slice(0, 10)) {
    const c = r.culture;
    h += `<a class="card" href="#/culture/${c.id}"><div class="row1"><span class="name mono">${esc(c.name)}</span>
      <span class="dim">${esc(C.kindLabel(c.kind))}</span><span class="right">${dueChip(r) || `in ${r.left}d`}</span></div>
      <div class="row2">${sp(c.species)} · last used ${D(r.last)}, every ${r.every}d</div></a>`;
  }
  if (att.length > 10) h += `<p class="dim">… and ${att.length - 10} more.</p>`;

  const old = ds.senescence();
  if (old.length) {
    h += `<h2>Senescence (more than ${ds.senescenceT} transfers)</h2>`;
    for (const c of old.slice(0, 8))
      h += `<a class="card" href="#/culture/${c.id}"><div class="row1"><span class="name mono">${esc(c.name)}</span>
        <span class="right">${tChip(c.id)}</span></div><div class="row2">go back to an earlier transfer, a cryo vial or spores</div></a>`;
  }

  const ready = [...ds.batches.values()].map((b) => [b, ds.unitsLeft(b.id)]).filter(([, n]) => n)
    .sort((a, b) => C.cmp(a[0].prepared || "", b[0].prepared || ""));
  h += `<h2>Ready to inoculate</h2>`;
  if (!ready.length) h += `<p class="empty">No prepared batches waiting.</p>`;
  for (const [b, n] of ready.slice(0, 8)) h += batchCard(b, n, day);

  h += `<div class="actions" style="margin-top:20px">
    <button class="btn" data-action="temp">Log a temperature</button>
    <a class="btn" href="#/scan">Scan a label</a></div>`;
  return h;
}
function basis(m) {
  let s = m.n ? `${esc(m.basis)} (n=${m.n}, ${m.confidence})` : `${esc(m.basis)} (low)`;
  if (m.temp !== null) s += ` @ ${T(m.temp)}`;
  return s;
}
function batchCard(b, n, day) {
  const ds = S.ds, r = ds.recipes.get(b.recipe_id), age = C.toDay(b.prepared) !== null ? day - C.toDay(b.prepared) : null;
  const stale = age !== null && age > ds.staleAfter(b.id);
  return `<a class="card" href="#/batch/${b.id}"><div class="row1"><span class="name mono">${esc(b.label)}</span>
    <span class="dim">${esc(r ? r.name : "no recipe")}</span><span class="right">${n} of ${b.units} left</span></div>
    <div class="row2">${age !== null ? `prepared ${age}d ago` : "no prep date"}${stale ? ` · <span class="warn-t">use soon or close it</span>` : ""}</div></a>`;
}

// ------------------------------------------------------------------ cultures
export function cultures(q = "") {
  const ds = S.ds, day = today(), open = new Set(prefs.get("open", [])), filter = q.trim().toLowerCase();
  let h = `<div class="row1" style="display:flex;gap:8px;align-items:center"><h1 style="margin-right:auto">Cultures</h1>
    <button class="btn primary" data-action="new-culture">+ New</button></div>
    <input class="search" type="search" id="culture-search" placeholder="Filter by code, species, strain…" value="${esc(q)}" autocomplete="off">`;
  const groups = ds.speciesGroups();
  if (!groups.length) h += `<p class="empty">No cultures yet.</p>`;
  for (const g of groups) {
    const hit = (c) => !filter || [c.name, c.species, c.strain, c.storage].some((x) => (x || "").toLowerCase().includes(filter));
    const members = filter && g.species.toLowerCase().includes(filter) ? g.cultures : g.cultures.filter(hit);
    if (!members.length) continue;
    const live = g.cultures.filter(isLive), old = live.filter((c) => ds.senescent(c.id));
    const due = g.cultures.filter(isLive).map((c) => ds.transferDue(c.id, day)).filter((r) => r && r.left < 0).length;
    const isOpen = filter || open.has(g.species);
    h += `<details class="species" data-species="${esc(g.species)}"${isOpen ? " open" : ""}><summary>
      <span class="sp-name">${g.species === "(no species)" ? '<span class="dim">(no species)</span>' : sp(g.species)}</span>
      <span class="sp-meta">${g.cultures.length} · ${live.length} live${old.length ? ` · <span class="bad-t">${old.length} ⚠</span>` : ""}${due ? ` · <span class="late">${due} overdue</span>` : ""}</span></summary>`;
    for (const [c, level] of ds.lineageOrder(members)) {
      const r = isLive(c) ? ds.transferDue(c.id, day) : null;
      h += `<a class="member" href="#/culture/${c.id}">${level ? `<span class="indent">${"&nbsp;&nbsp;".repeat(level - 1)}└</span>` : ""}
        <span><span class="nm">${esc(c.name)}</span><br><span class="kind">${esc(C.kindLabel(c.kind))} · <span class="${statusClass(c.status)}">${esc(c.status)}</span>${c.keeper ? " · ✓" : ""}</span></span>
        <span class="tail">${fChip(c.id)}${tChip(c.id)}${dueChip(r)}</span></a>`;
    }
    h += `</details>`;
  }
  return h;
}

// ------------------------------------------------------------------ one culture
export function culture(id) {
  const ds = S.ds, c = ds.cultures.get(id);
  if (!c) return notFound("culture");
  const day = today(), p1 = ds.cultures.get(c.parent_id), mate = ds.cultures.get(ds.mate(id));
  const t = ds.tgen.get(id), f = ds.filial.get(id), lim = ds.senescenceT;
  let h = `<p class="sub"><a href="#/cultures">Cultures</a></p><h1 class="mono">${esc(c.name)}</h1>
    <p class="sub">${sp(c.species)}${c.strain ? ` · ${esc(c.strain)}` : ""}</p>
    <div class="chips"><span class="chip">${esc(C.kindLabel(c.kind))}</span>${fChip(id)}${tChip(id)}
      <span class="chip ${statusClass(c.status)}">${esc(c.status)}</span>${c.rating ? `<span class="chip warn">${stars(c.rating)}</span>` : ""}${c.keeper ? '<span class="chip ok">keeper ✓</span>' : ""}</div>`;
  if (t !== null && t !== undefined && t > lim)
    h += `<div class="banner bad"><b>T${t}: past the senescence limit (T${lim})</b><p>Watch for slow, patchy or weak growth. Go back to an earlier transfer, a cryo vial or spores.</p></div>`;
  else if (t === lim) h += `<div class="banner warn"><b>T${t}: at the limit</b><p>A transfer from this would be T${t + 1}.</p></div>`;
  const due = isLive(c) ? ds.transferDue(id, day) : null;
  if (due && due.left <= 7) h += `<div class="banner ${due.left < 0 ? "bad" : "warn"}"><b>${due.left < 0 ? `Transfer overdue by ${-due.left} days` : due.left ? `Transfer due in ${due.left} days` : "Transfer due today"}</b><p>Last used ${D(due.last)}; every ${due.every} days.</p></div>`;

  h += `<div class="actions">
    <button class="btn primary" data-action="transfer" data-id="${id}">Transfer</button>
    <button class="btn" data-action="start-grow" data-culture="${id}">Start a grow</button>
    <button class="btn" data-action="note" data-col="culture_id" data-id="${id}">Note / photo</button>
    <button class="btn" data-action="culture-status" data-id="${id}">Status, rating</button>
    <button class="btn" data-action="cross" data-id="${id}">Cross</button>
    <button class="btn ghost" data-action="edit-culture" data-id="${id}">Edit</button></div>`;

  h += `<dl class="kv">
    <dt>Filial gen</dt><dd>${f === null || f === undefined ? '<span class="dim">— (no cross recorded)</span>' : `F${f}${c.filial !== null && c.filial !== undefined ? ' <span class="dim">(set by hand)</span>' : ds.crossOf.get(id) === id && mate ? ' <span class="dim">new cross</span>' : ds.crossOf.get(id) && ds.cultures.get(ds.crossOf.get(id)) ? ` <span class="dim">from the cross ${esc(ds.cultures.get(ds.crossOf.get(id)).name)}</span>` : ""}`}</dd>
    <dt>Transfer gen</dt><dd>${t === null || t === undefined ? '<span class="dim">— (spores)</span>' : `T${t}${c.transfer_gen !== null && c.transfer_gen !== undefined ? ' <span class="dim">(set by hand)</span>' : ""}`}</dd>
    <dt>Parent</dt><dd>${p1 ? `<a href="#/culture/${p1.id}">${esc(p1.name)}</a>` : "—"}${mate ? ` × <a href="#/culture/${mate.id}">${esc(mate.name)}</a>` : ""}</dd>
    <dt>Lineage</dt><dd>${esc(ds.lineageName(id))}</dd>
    <dt>Created</dt><dd>${esc(C.fmtDate(c.created))}</dd>
    ${c.source ? `<dt>Source</dt><dd>${esc(c.source)}</dd>` : ""}
    ${c.storage ? `<dt>Storage</dt><dd>${esc(c.storage)}</dd>` : ""}
    ${c.batch_id && ds.batches.get(c.batch_id) ? `<dt>Made on</dt><dd><a href="#/batch/${c.batch_id}">${esc(ds.batches.get(c.batch_id).label)}</a></dd>` : ""}
    ${due ? `<dt>Transfer</dt><dd>due ${D(due.due)} (every ${due.every}d)</dd>` : ""}
    ${c.status === "contaminated" && c.contam_type ? `<dt>Contaminant</dt><dd>${esc(c.contam_type)}${c.contam_date ? `, ${esc(c.contam_date)}` : ""}</dd>` : ""}
  </dl>${c.notes ? `<div class="note"><p>${esc(c.notes)}</p></div>` : ""}`;

  h += `<h2>Lineage</h2><div class="tree">${tree(id)}</div>`;
  const crosses = [...ds.cultures.values()].filter((x) => ds.mate(x.id) === id);
  if (crosses.length) h += `<p class="dim">Mated into: ${crosses.map((x) => `<a href="#/culture/${x.id}">${esc(x.name)}</a>`).join(", ")}</p>`;

  const grows = ds.grows.filter((g) => g.culture_id === id);
  if (grows.length) {
    h += `<h2>Grows (${grows.length})</h2>`;
    for (const g of [...grows].reverse()) h += growCard(g);
  }
  h += notesFor("culture_id", id);
  return h;
}
function tree(cid) {
  const ds = S.ds, root = ds.root.get(cid), lines = [];
  const walk = (id, prefix, last, top, seen) => {
    if (seen.has(id) || lines.length > 300) return;
    seen.add(id);
    const c = ds.cultures.get(id), conn = top ? "" : last ? "└─ " : "├─ ";
    const g = ds.genLabel(id), mate = ds.mate(id);
    lines.push(`${esc(prefix + conn)}<a href="#/culture/${id}" class="${id === cid ? "me" : ""}">${esc(c.name)}</a>` +
      (g ? ` <span class="${ds.senescent(id) ? "bad-t" : "dim"}">${esc(g)}</span>` : "") +
      (mate !== null ? ` <span class="warn-t">× ${esc(ds.cultures.get(mate).name)}</span>` : "") +
      (c.status === "contaminated" || c.status === "dead" ? ` <span class="st-contaminated">${esc(c.status)}</span>` : ""));
    const kids = ds.children(id);
    kids.forEach((k, i) => walk(k.id, prefix + (top ? "" : last ? "   " : "│  "), i === kids.length - 1, false, seen));
  };
  walk(root, "", true, true, new Set());
  return lines.join("\n");
}

// ------------------------------------------------------------------ grows
export function grows(mode = "active") {
  const ds = S.ds;
  const list = ds.grows.filter((g) => (mode === "active" ? ds.isActive(g) : true));
  let h = `<div style="display:flex;gap:8px;align-items:center"><h1 style="margin-right:auto">Grows</h1>
    <button class="btn primary" data-action="start-grow">+ Start</button></div>
    <div class="seg"><button data-action="grows-mode" data-mode="active" class="${mode === "active" ? "on" : ""}">Active (${ds.grows.filter((g) => ds.isActive(g)).length})</button>
    <button data-action="grows-mode" data-mode="all" class="${mode === "all" ? "on" : ""}">All (${ds.grows.length})</button></div>`;
  if (!list.length) h += `<p class="empty">${mode === "active" ? "No active grows." : "No grows yet."}</p>`;
  for (const g of [...list].reverse()) h += growCard(g);
  return h;
}
function growCard(g) {
  const ds = S.ds, c = ds.cultures.get(g.culture_id), st = ds.stage(g);
  const next = ds.isActive(g) ? ds.predict(g, today())[0] : null;
  const wet = ds.wetTotal(g.id);
  return `<a class="card" href="#/grow/${g.id}"><div class="row1"><span class="name mono">${esc(g.label)}</span>
    <span class="dim">${esc(c ? c.name : "?")}</span><span class="right ${statusClass(st)}">${st}</span></div>
    <div class="row2">${ds.isSpawn(g) ? "spawn · " : ""}inoculated ${esc(C.fmtDate(g.inoculated))}${wet ? ` · ${weight(wet)}` : ""}${next ? ` · next: ${esc(next.name)} ${next.late ? `<span class="late">late ${next.late}d</span>` : relDays(next.eta - today())}` : ""}</div></a>`;
}

export function grow(id) {
  const ds = S.ds, g = ds.growById.get(id);
  if (!g) return notFound("grow");
  const c = ds.cultures.get(g.culture_id), b = ds.batches.get(g.batch_id), r = ds.recipes.get(g.recipe_id), st = ds.stage(g);
  const spawn = ds.isSpawn(g), day = today(), active = ds.isActive(g);
  let h = `<p class="sub"><a href="#/grows">Grows</a></p><h1 class="mono">${esc(g.label)}</h1>
    <p class="sub"><a href="#/culture/${c.id}">${esc(c.name)}</a> · ${sp(c.species)}</p>
    <div class="chips"><span class="chip ${statusClass(st)}">${st}</span><span class="chip">${spawn ? "spawn (grain)" : "bulk"}</span>
      ${ds.genLabel(c.id) ? `<span class="chip">culture ${esc(ds.genLabel(c.id))}</span>` : ""}${ds.senescent(c.id) ? '<span class="chip bad">culture past the senescence limit</span>' : ""}</div>`;
  const acts = [];
  if (g.outcome === "active") {
    if (!g.colonized) acts.push(`<button class="btn primary" data-action="milestone" data-id="${id}">Mark colonized</button>`);
    else if (!spawn && !g.pinned) acts.push(`<button class="btn primary" data-action="milestone" data-id="${id}">Mark pins</button>`);
    if (!spawn) acts.push(`<button class="btn${g.pinned || ds.flushesOf(id).length ? " primary" : ""}" data-action="harvest" data-id="${id}">Log harvest</button>`);
    if (spawn && g.colonized && !ds.spawned(g)) acts.push(`<button class="btn primary" data-action="spawn-to-bulk" data-id="${id}">Spawn to bulk</button>`);
  }
  acts.push(`<button class="btn" data-action="temp" data-id="${id}">Temperature</button>`,
    `<button class="btn" data-action="note" data-col="grow_id" data-id="${id}">Note / photo</button>`,
    `<button class="btn ghost" data-action="outcome" data-id="${id}">Outcome…</button>`);
  h += `<div class="actions">${acts.join("")}</div>`;

  // timeline: what happened, then what's expected
  const events = [];
  if (g.inoculated) events.push([C.toDay(g.inoculated), "Inoculated", `${g.units_used || 1} unit(s)`]);
  if (g.colonized) events.push([C.toDay(g.colonized), "Fully colonized", dur(g.inoculated, g.colonized)]);
  if (g.pinned) events.push([C.toDay(g.pinned), "First pins", dur(g.colonized, g.pinned)]);
  for (const f of ds.flushesOf(id))
    events.push([C.toDay(f.harvested), `Flush ${f.number}`, [f.wet_g ? `${weight(f.wet_g)} wet` : "", f.dry_g ? `${weight(f.dry_g)} dry` : ""].filter(Boolean).join(", ")]);
  if (g.contam_date) events.push([C.toDay(g.contam_date), "Contamination spotted", g.contam_type || ""]);
  for (const x of ds.grows.filter((y) => y.spawn_grow_id === id))
    events.push([C.toDay(x.inoculated), `Spawned to ${x.label}`, ""]);
  events.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  h += `<h2>Timeline</h2><ul class="timeline">${events.map(([d, e, x]) => `<li><span class="d">${D(d)}</span><span class="e">${esc(e)}</span><span class="x">${esc(x)}</span></li>`).join("")}`;
  if (active) for (const m of ds.predict(g, day))
    h += `<li class="future"><span class="d">${D(m.eta)}</span><span class="e">${esc(m.name)} expected</span>
      <span class="x">${m.late ? `<span class="late">late ${m.late}d</span>` : relDays(m.eta - day)} · ${D(m.lo).slice(5)} – ${D(m.hi).slice(5)}</span></li>`;
  h += `</ul>`;
  if (active) {
    const ms = ds.predict(g, day);
    if (ms.length) h += `<p class="dim">Based on ${basis(ms[0])}.</p>`;
  }
  const [tc, td] = ds.currentTemp(g, day);
  const wet = ds.wetTotal(id);
  h += `<dl class="kv">
    <dt>Batch</dt><dd>${b ? `<a href="#/batch/${b.id}">${esc(b.label)}</a>` : "—"}${r ? ` · ${esc(r.name)}` : ""}</dd>
    ${g.substrate_g ? `<dt>Substrate</dt><dd>${weight(g.substrate_g)}</dd>` : ""}
    ${g.spawn_grow_id && ds.growById.get(g.spawn_grow_id) ? `<dt>Spawn from</dt><dd><a href="#/grow/${g.spawn_grow_id}">${esc(ds.growById.get(g.spawn_grow_id).label)}</a></dd>` : ""}
    <dt>Temperature</dt><dd>${tc !== null ? `${T(tc)} <span class="dim">since ${D(td)}</span>` : '<span class="dim">no readings</span>'}</dd>
    ${wet ? `<dt>Harvested</dt><dd>${weight(wet)} wet${g.substrate_g ? ` · ${Math.round(wet / (g.substrate_g / 1000))} g/kg` : ""}</dd>` : ""}
    ${g.outcome === "contaminated" ? `<dt>Contaminant</dt><dd>${esc(g.contam_type || "unspecified")}</dd>` : ""}
  </dl>${g.notes ? `<div class="note"><p>${esc(g.notes)}</p></div>` : ""}`;
  h += notesFor("grow_id", id);
  return h;
}
const dur = (a, z) => { const x = C.toDay(a), y = C.toDay(z); return x !== null && y !== null ? `${y - x} days` : ""; };

// ------------------------------------------------------------------ batches
export function batches() {
  const ds = S.ds, day = today();
  const open = [...ds.batches.values()].filter((b) => !b.closed).sort((a, b) => C.cmp(b.prepared || "", a.prepared || ""));
  const closed = [...ds.batches.values()].filter((b) => b.closed).sort((a, b) => C.cmp(b.prepared || "", a.prepared || ""));
  let h = `<p class="sub"><a href="#/more">More</a></p><h1>Batches</h1><p class="sub">Prepared substrate. Add new batches in the desktop app.</p>`;
  if (!open.length) h += `<p class="empty">No open batches.</p>`;
  for (const b of open) h += batchCard(b, ds.unitsLeft(b.id), day);
  if (closed.length) {
    h += `<h2>Closed</h2>`;
    for (const b of closed.slice(0, 20)) h += batchCard(b, 0, day);
  }
  return h;
}
export function batch(id) {
  const ds = S.ds, b = ds.batches.get(id);
  if (!b) return notFound("batch");
  const r = ds.recipes.get(b.recipe_id), run = ds.runs.get(b.steril_id), left = ds.unitsLeft(id), day = today();
  const age = C.toDay(b.prepared) !== null ? day - C.toDay(b.prepared) : null, media = ds.isMediaBatch(id);
  let h = `<p class="sub"><a href="#/batches">Batches</a></p><h1 class="mono">${esc(b.label)}</h1>
    <p class="sub">${esc(r ? r.name : "no recipe")}${media ? " · agar / LC media" : ""}</p>
    <div class="chips"><span class="chip ${left ? "ok" : ""}">${left} of ${b.units} left</span>${b.discarded ? `<span class="chip bad">${b.discarded} failed</span>` : ""}${b.closed ? '<span class="chip">closed</span>' : ""}</div>`;
  if (age !== null && left && age > ds.staleAfter(id)) h += `<div class="banner warn"><b>Prepared ${age} days ago</b><p>Use it soon or close it.</p></div>`;
  h += `<div class="actions">${left ? `<button class="btn primary" data-action="inoculate" data-id="${id}">${media ? "Make plates / jars" : "Inoculate"}</button>
    <button class="btn" data-action="batch-failed" data-id="${id}">Unit failed</button>` : ""}
    <button class="btn" data-action="note" data-col="batch_id" data-id="${id}">Note / photo</button>
    <button class="btn ghost" data-action="batch-close" data-id="${id}">${b.closed ? "Reopen" : "Close batch"}</button></div>
    <dl class="kv"><dt>Prepared</dt><dd>${esc(C.fmtDate(b.prepared))}${age !== null ? ` <span class="dim">(${age}d ago)</span>` : ""}</dd>
    <dt>Run</dt><dd>${run ? `${esc(run.label)} · ${esc(run.method)}` : "—"}</dd>
    ${b.container ? `<dt>Container</dt><dd>${esc(b.container)}</dd>` : ""}
    ${b.unit_g ? `<dt>Per unit</dt><dd>${weight(b.unit_g)}</dd>` : ""}</dl>`;
  const gs = ds.growsFromBatch(id), cs = ds.culturesFromBatch(id);
  if (gs.length) { h += `<h2>Grows from this batch</h2>`; for (const g of gs) h += growCard(g); }
  if (cs.length) {
    h += `<h2>Cultures made on this batch</h2>`;
    for (const c of cs) h += `<a class="card" href="#/culture/${c.id}"><div class="row1"><span class="name mono">${esc(c.name)}</span><span class="right ${statusClass(c.status)}">${esc(c.status)}</span></div></a>`;
  }
  h += notesFor("batch_id", id);
  return h;
}

// ------------------------------------------------------------------ notes
function notesFor(col, id) {
  const ns = S.db.all(`SELECT id, created, text, photo, photo_data IS NOT NULL AS has_photo FROM notes WHERE ${col}=? ORDER BY created DESC, id DESC`, [id]);
  if (!ns.length) return "";
  return `<h2>Notes</h2>` + ns.map((n) => `<div class="note"><div class="when">${esc(C.fmtDate(n.created))}${n.photo && !n.has_photo ? " · 📷 photo on the computer" : ""}</div>
    ${n.text ? `<p>${esc(n.text)}</p>` : ""}${n.has_photo ? `<img data-photo="${n.id}" alt="photo" loading="lazy">` : ""}</div>`).join("");
}

// ------------------------------------------------------------------ scan
export function scan() {
  return `<h1>Scan a label</h1><p class="sub">Point the camera at the QR code on a culture, grow or batch label.</p>
    <div class="scanner" id="scanner"><video id="scan-video" playsinline muted></video><div class="frame"></div></div>
    <p class="dim" id="scan-status">Starting the camera…</p>
    <h2>Or type a code</h2>
    <form id="code-form" class="row1" style="display:flex;gap:8px"><input class="search" style="margin:0" id="code-input" placeholder="PE-001.2, G-014, B-003" autocomplete="off" autocapitalize="characters">
    <button class="btn primary">Go</button></form>`;
}

// ------------------------------------------------------------------ more
export function more() {
  const m = S.meta || {};
  const theme = prefs.get("theme", "auto");
  const themes = [["auto", "Everforest (follows the phone)"], ["everforest-dark", "Everforest Dark"], ["everforest-light", "Everforest Light"],
    ["mycelium", "Mycelium"], ["mycelium-light", "Mycelium Light"]];
  let h = `<h1>More</h1>`;
  if (S.db) {
    h += `<h2>Database file</h2><div class="card"><div class="row1"><span class="name">${esc(m.name || "mycotrack.db")}</span>
      <span class="right">${m.dirty ? '<span class="warn-t">unsaved changes</span>' : '<span class="dim">saved</span>'}</span></div>
      <div class="row2">opened ${new Date(m.openedAt).toLocaleString()}${m.savedAt ? ` · saved ${new Date(m.savedAt).toLocaleString()}` : ""}</div></div>
      <div class="actions"><button class="btn primary" data-action="save-file">Save file</button>
      <button class="btn" data-action="open-file">Open another…</button>
      ${m.handle ? `<button class="btn" data-action="reload-file">Reload from file</button>` : ""}
      <button class="btn" data-action="undo"${S.undo.length ? "" : " disabled"}>Undo${S.undo.length ? `: ${esc(S.undo[S.undo.length - 1].label)}` : ""}</button></div>
      <h2>Records</h2><div class="actions"><a class="btn" href="#/batches">Batches</a><a class="btn" href="#/conditions">Temperatures</a>
      <button class="btn" data-action="shared-settings">Units & warnings</button></div>`;
  } else {
    h += `<div class="actions"><button class="btn primary" data-action="open-file">Open mycotrack.db</button>
      <button class="btn" data-action="new-db">Start a new database</button><button class="btn" data-action="demo-db">Try sample data</button></div>`;
  }
  h += `<h2>Theme</h2><div class="field"><select id="theme-select">${themes.map(([v, l]) => `<option value="${v}"${v === theme ? " selected" : ""}>${l}</option>`).join("")}</select></div>
    <h2>How saving works</h2><p class="sub">The phone keeps its own working copy, so it works offline. Tap <b>Save file</b> to write it back
    ${"showSaveFilePicker" in window ? "to the file you opened" : "(it's shared or downloaded as mycotrack.db; put it back in your sync folder)"}.
    Don't edit on the phone and the computer at the same time: the last file saved wins. The desktop app reloads by itself when the file is replaced.</p>
    <p class="dim">MycoTrack mobile ${VERSION}. Uses sql.js (MIT) and jsQR (Apache-2.0). Everforest palette © sainnhe (MIT).</p>`;
  return h;
}

export function conditions() {
  const ds = S.ds, unit = ds.tempUnit;
  const rows = S.db.all("SELECT * FROM env_logs ORDER BY logged DESC, id DESC LIMIT 60");
  let h = `<p class="sub"><a href="#/more">More</a></p><div style="display:flex;align-items:center"><h1 style="margin-right:auto">Temperatures</h1>
    <button class="btn primary" data-action="temp">+ Log</button></div>
    <p class="sub">A reading applies from its date until the next one. Readings without a grow are general room readings.</p>`;
  if (!rows.length) h += `<p class="empty">No readings yet.</p>`;
  for (const e of rows) {
    const g = ds.growById.get(e.grow_id);
    h += `<div class="card"><div class="row1"><span class="name">${e.temp_c !== null ? esc(C.fmtTemp(e.temp_c, unit)) : "—"}${e.rh !== null ? ` · ${Math.round(e.rh)}% RH` : ""}</span>
      <span class="dim">${g ? esc(g.label) : "room"}</span><span class="right dim">${esc(C.fmtDate(e.logged))}</span></div>${e.notes ? `<div class="row2">${esc(e.notes)}</div>` : ""}</div>`;
  }
  return h;
}

function notFound(what) { return `<h1>Not found</h1><p class="sub">That ${what} isn't in this database.</p><p><a href="#/">Back to today</a></p>`; }
export { plural };
