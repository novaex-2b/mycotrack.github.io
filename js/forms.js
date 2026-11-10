// Bottom-sheet forms and the records they write. Validation follows the desktop app's rules
// (dates in order, batch capacity, unique names, both parents for a cross …) so a phone entry is
// never something the desktop would have refused.

import * as C from "./core.js";
import { S, change, esc, toast, today, D, T } from "./state.js";

// ------------------------------------------------------------------ form engine
let current = null;

export function closeForm() {
  const root = document.getElementById("sheet-root");
  root.innerHTML = "";
  current = null;
  document.body.style.overflow = "";
}

/**
 * fields: [{ name, label, type: text|number|date|select|textarea|check|photo, value, options: [[label, value]],
 *            required, hint, hintFn(vals), min, max, integer, list: [...] (autocomplete), tidy(v),
 *            suggest(v, vals) -> [codes], show(vals) -> bool, placeholder, inputmode }]
 * submit(vals) -> error message (keeps the form open) or nothing.
 */
export function openForm({ title, lead = "", fields, submitLabel = "Save", submit, danger = false }) {
  closeForm();
  const root = document.getElementById("sheet-root");
  const id = (f) => `f_${f.name}`;
  const lists = [];
  const fieldHtml = (f) => {
    const v = f.value ?? "";
    let input;
    if (f.type === "select") {
      input = `<select id="${id(f)}" name="${f.name}">${(f.required ? "" : '<option value="">—</option>') +
        f.options.map(([l, val], i) => `<option value="${i}"${String(val) === String(v) && v !== "" ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    } else if (f.type === "textarea") {
      input = `<textarea id="${id(f)}" name="${f.name}" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
    } else if (f.type === "check") {
      return `<div class="field check" data-field="${f.name}"><label><input type="checkbox" id="${id(f)}" name="${f.name}"${v ? " checked" : ""}> ${esc(f.label)}</label>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""}</div>`;
    } else if (f.type === "photo") {
      input = `<input type="file" id="${id(f)}" name="${f.name}" accept="image/*" capture="environment"><img class="preview" hidden alt="">`;
    } else {
      const t = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
      let list = "";
      if (f.list) { list = ` list="dl_${f.name}"`; lists.push(`<datalist id="dl_${f.name}">${f.list.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>`); }
      const extra = f.type === "number" ? ` inputmode="${f.integer ? "numeric" : "decimal"}" step="${f.integer ? 1 : "any"}"${f.min !== undefined ? ` min="${f.min}"` : ""}${f.max !== undefined ? ` max="${f.max}"` : ""}` : "";
      input = `<input type="${t}" id="${id(f)}" name="${f.name}" value="${esc(v)}"${list}${extra} autocomplete="off" autocapitalize="${f.capitalize || "off"}" spellcheck="false" placeholder="${esc(f.placeholder || "")}">`;
    }
    return `<div class="field" data-field="${f.name}"><label for="${id(f)}">${esc(f.label)}${f.required ? " *" : ""}</label>${input}` +
      `<div class="suggest" data-suggest="${f.name}"></div><div class="hint" data-hint="${f.name}">${esc(f.hint || "")}</div></div>`;
  };
  root.innerHTML = `<div class="sheet-bg"><form class="sheet" novalidate role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grab"></div><h3>${esc(title)}</h3>${lead ? `<p class="lead">${lead}</p>` : ""}
    <div class="form-error" hidden></div>
    ${fields.map(fieldHtml).join("")}${lists.join("")}
    <div class="buttons"><button type="button" class="btn ghost" data-cancel>Cancel</button>
    <button type="submit" class="btn ${danger ? "danger" : "primary"}">${esc(submitLabel)}</button></div></form></div>`;
  document.body.style.overflow = "hidden";
  const form = root.querySelector("form"), bg = root.querySelector(".sheet-bg"), err = root.querySelector(".form-error");
  const photos = {};
  current = { fields, form };

  const raw = () => {
    const o = {};
    for (const f of fields) {
      const el = form.querySelector("#" + id(f));
      if (!el) continue;
      if (f.type === "check") o[f.name] = el.checked;
      else if (f.type === "select") o[f.name] = el.value === "" ? null : f.options[+el.value][1];
      else if (f.type === "photo") o[f.name] = photos[f.name] || null;
      else o[f.name] = el.value;
    }
    return o;
  };
  const refresh = () => {
    const vals = raw();
    for (const f of fields) {
      const box = form.querySelector(`[data-field="${f.name}"]`);
      if (f.show) box.hidden = !f.show(vals);
      if (f.hintFn) form.querySelector(`[data-hint="${f.name}"]`).innerHTML = f.hintFn(vals) || esc(f.hint || "");
      if (f.suggest) {
        const sug = (f.suggest(vals[f.name] || "", vals) || []).filter((x) => x && x !== vals[f.name]);
        form.querySelector(`[data-suggest="${f.name}"]`).innerHTML =
          sug.slice(0, 3).map((x) => `<button type="button" data-fill="${f.name}" data-val="${esc(x)}">${esc(x)}</button>`).join("");
      }
    }
  };
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  form.addEventListener("focusout", (e) => {          // corrections such as species capitalisation
    const f = fields.find((x) => "f_" + x.name === e.target.id);
    if (f && f.tidy && e.target.value.trim()) { const v = f.tidy(e.target.value); if (v !== e.target.value) { e.target.value = v; refresh(); } }
  });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fill]");
    if (b) { const el = form.querySelector("#f_" + b.dataset.fill); el.value = b.dataset.val; el.dispatchEvent(new Event("input", { bubbles: true })); }
    if (e.target.closest("[data-cancel]")) closeForm();
  });
  bg.addEventListener("click", (e) => { if (e.target === bg) closeForm(); });
  for (const f of fields.filter((x) => x.type === "photo")) {
    form.querySelector("#" + id(f)).addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        photos[f.name] = await shrinkPhoto(file);
        const img = form.querySelector(`[data-field="${f.name}"] .preview`);
        img.src = URL.createObjectURL(new Blob([photos[f.name]], { type: "image/jpeg" }));
        img.hidden = false;
      } catch (ex) { showErr("Couldn't read that photo: " + ex.message); }
    });
  }
  const showErr = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: "nearest" }); };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = raw(), vals = {};
    for (const f of fields) {
      const box = form.querySelector(`[data-field="${f.name}"]`);
      if (box.hidden) { vals[f.name] = null; continue; }
      let v = r[f.name];
      if (typeof v === "string") v = v.trim();
      if (f.tidy && v) v = f.tidy(v);
      if (f.type === "number") {
        if (v === "") v = null;
        else {
          const n = Number(v);
          if (!Number.isFinite(n)) return showErr(`${f.label}: not a number.`);
          if (f.integer && !Number.isInteger(n)) return showErr(`${f.label}: a whole number, please.`);
          if (f.min !== undefined && n < f.min) return showErr(`${f.label}: at least ${f.min}.`);
          if (f.max !== undefined && n > f.max) return showErr(`${f.label}: at most ${f.max}.`);
          v = n;
        }
      }
      if (f.type === "date" && v && C.toDay(v) === null) return showErr(`${f.label}: not a valid date.`);
      if ((v === "" || v === null || v === undefined) && f.required) return showErr(`${f.label} is required.`);
      vals[f.name] = v === "" ? null : v;
    }
    let msg;
    try { msg = await submit(vals); }
    catch (ex) { msg = friendly(ex); }
    if (msg) showErr(msg); else closeForm();
  });
  refresh();
  setTimeout(() => { const first = form.querySelector("input:not([type=file]):not([type=checkbox]),select,textarea"); if (first && !matchMedia("(pointer: coarse)").matches) first.focus(); }, 50);
}
export const formOpen = () => current !== null;

function friendly(e) {
  const m = String(e && e.message || e);
  if (/UNIQUE constraint failed: (\w+)\.(\w+)/.test(m)) return "That name / label is already used.";
  if (/FOREIGN KEY/.test(m)) return "That record is still used by others, so it can't be changed that way.";
  return m;
}

/** Camera photos are large: keep at most 1600 px on the long side as JPEG, so the database stays small. */
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("not an image")); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.82));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}

// ------------------------------------------------------------------ option lists
const cultureLabel = (c) => `${c.name} — ${c.species || "no species"}`;
function cultureOptions(exclude = new Set(), liveFirst = true) {
  const cs = [...S.ds.cultures.values()].filter((c) => !exclude.has(c.id));
  const live = (c) => c.status === "active" || c.status === "stored";
  cs.sort((a, b) => (liveFirst ? Number(live(b)) - Number(live(a)) : 0) || C.cmp(a.name, b.name));
  return cs.map((c) => [cultureLabel(c) + (live(c) ? "" : ` (${c.status})`), c.id]);
}
function batchOptions(media, keep = null) {
  const ds = S.ds;
  return [...ds.batches.values()]
    .filter((b) => ds.isMediaBatch(b.id) === media && (ds.unitsLeft(b.id) > 0 || b.id === keep))
    .sort((a, b) => C.cmp(b.prepared || "", a.prepared || ""))
    .map((b) => {
      const r = ds.recipes.get(b.recipe_id);
      return [`${b.label} — ${r ? r.name : "no recipe"} · ${ds.unitsLeft(b.id)} of ${b.units} left`, b.id];
    });
}
const kindOptions = () => C.CULTURE_TYPES.map(([l, v]) => [l, v]);
const tidySpecies = (v) => S.db.canonicalSpecies(v);
const allCodes = () => [...S.ds.cultures.values()].map((c) => c.name);
const codeSuggest = (v) => [C.suggestCode(v, allCodes())];
const isoToday = () => C.dayStr(today());

function nameClash(names, exceptId = null) {
  const taken = new Map([...S.ds.cultures.values()].map((c) => [c.name.toLowerCase(), c.id]));
  const seen = new Set();
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) return `“${n}” appears twice.`;
    seen.add(k);
    if (taken.has(k) && taken.get(k) !== exceptId) return `A culture called “${n}” already exists.`;
  }
  return null;
}

/** What T a new culture would get (for the form hint). */
function expectedT(kind, parentId, mateId) {
  if (C.SPORE_KINDS.has(kind)) return null;
  if (mateId || !parentId || S.ds.isSpores(parentId)) return 0;
  const t = S.ds.tgen.get(parentId);
  return t === null || t === undefined ? 0 : t + 1;
}
function tHint(kind, parentId, mateId) {
  const t = expectedT(kind, parentId, mateId);
  if (t === null) return "Spores: no transfer generation.";
  const lim = S.ds.senescenceT;
  if (t > lim) return `<span class="bad-t">This will be T${t}: past the senescence limit (T${lim}). Consider an earlier transfer, a cryo vial or spores.</span>`;
  if (t === lim) return `<span class="warn-t">This will be T${t}: at the limit; a transfer from it would be T${t + 1}.</span>`;
  return `This will be T${t}.`;
}

/** A cross between two species of one genus is a hybrid (same rule as the desktop app). */
function crossSpecies(species, p1, p2) {
  const a = S.ds.cultures.get(p1), b = S.ds.cultures.get(p2);
  if (!a || !b || !a.species || !b.species) return null;
  const x = a.species.split(" "), y = b.species.split(" ");
  if (x.length < 2 || y.length < 2 || x[0].toLowerCase() !== y[0].toLowerCase() || x[1].toLowerCase() === y[1].toLowerCase()) return null;
  if (![C.groupKey(a.species), C.groupKey(b.species), ""].includes(C.groupKey(species || ""))) return null;
  if (x.includes(C.HYBRID) || y.includes(C.HYBRID)) return null;
  return C.formatSpecies(`${x[0]} ${x[1]} x ${y[1]}`);
}

// ------------------------------------------------------------------ cultures
/** Transfer(s) from a parent culture: one or several plates / jars at once. */
export function transferForm(parentId, { batchId = null } = {}) {
  const p = S.ds.cultures.get(parentId);
  const codes = allCodes();
  const media = batchOptions(true, batchId);
  openForm({
    title: `Transfer from ${p.name}`,
    lead: `${C.speciesHtml(p.species) || "no species"} · ${esc(S.ds.genLabel(parentId) || C.kindLabel(p.kind))}`,
    fields: [
      { name: "count", label: "How many", type: "number", integer: true, min: 1, max: 48, value: 1, required: true },
      { name: "name", label: "Name / code (the first, if several)", type: "text", required: true,
        value: C.childCodes(p.name, codes, 1)[0], suggest: (v) => [C.suggestCode(v, codes), C.childCodes(p.name, codes, 1)[0]],
        hintFn: (v) => {
          if (!(v.count > 1 && v.name)) return "";
          const ns = bulkNames(v.name, +v.count, p.name, codes);
          return ns ? `${esc(ns.slice(0, 3).join(", "))} …` : "the first code must end in a number";
        } },
      { name: "kind", label: "Type", type: "select", required: true, options: kindOptions(), value: "agar plate",
        hintFn: (v) => tHint(v.kind, parentId, null) },
      { name: "batch_id", label: "Made on prepared batch (agar / LC)", type: "select", options: media, value: batchId,
        hint: media.length ? "each plate / jar uses one unit" : "no agar / LC batches with units left" },
      { name: "created", label: "Date", type: "date", value: isoToday(), required: true },
      { name: "storage", label: "Storage", type: "text", value: "" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
    submit: (v) => {
      const n = v.count || 1;
      const names = bulkNames(v.name, n, p.name, codes);
      if (!names) return "With several, the first code must end in a number so the rest can be numbered after it.";
      const clash = nameClash(names);
      if (clash) return clash;
      if (v.batch_id && S.db.unitsLeft(v.batch_id) < n) return `That batch only has ${S.db.unitsLeft(v.batch_id)} unit(s) left.`;
      const rows = names.map((name) => ({ name, species: p.species, strain: p.strain, kind: v.kind, parent_id: parentId,
        created: v.created, status: "active", source: `Transfer from ${p.name}`, storage: v.storage || "",
        notes: v.notes || "", batch_id: v.batch_id }));
      const ids = change(n === 1 ? `Added ${names[0]}` : `Added ${names[0]} … ${names[n - 1]}`, () => S.db.insertMany("cultures", rows));
      const t = S.ds.tgen.get(ids[0]);
      if (t !== null && t !== undefined && t > S.ds.senescenceT)
        setTimeout(() => toast(`${names[0]} is T${t}: past the senescence limit.`, { bad: true }), 300);
      location.hash = n === 1 ? `#/culture/${ids[0]}` : `#/culture/${parentId}`;
    },
  });
}
function bulkNames(first, n, parent, codes) {
  if (n <= 1) return [first];
  const kids = C.childCodes(parent, codes, n);
  if (first === kids[0]) return kids;
  const m = /^(.*?)(\d+)$/.exec(first);
  if (!m) return null;
  return Array.from({ length: n }, (_, i) => m[1] + String(+m[2] + i).padStart(m[2].length, "0"));
}

/** New culture (no parent, or a cross), or edit an existing one. */
export function cultureForm(id = null, preset = {}) {
  const c = id ? S.db.get("cultures", id) : { kind: "agar plate", status: "active", created: isoToday(), ...preset };
  const exclude = new Set(id ? [id, ...descendants(id)] : []);
  const opts = cultureOptions(exclude);
  const codes = allCodes().filter((n) => !id || n !== c.name);
  openForm({
    title: id ? `Edit ${c.name}` : preset.parent_id ? "New cross" : "New culture",
    lead: preset.parent_id && !id ? "Pick the strain it was mated with under “Crossed with”. A new cross is F0; spores from its fruit will be F1." : "",
    fields: [
      { name: "name", label: "Name / code", type: "text", required: true, value: c.name || "",
        suggest: (v) => [C.suggestCode(v, codes)], hint: "type the start of a series for the next free code" },
      { name: "species", label: "Species", type: "text", value: c.species || "", list: S.db.speciesList(), tidy: tidySpecies,
        capitalize: "sentences", hint: "capitalisation is corrected: Genus species" },
      { name: "strain", label: "Strain / variety", type: "text", value: c.strain || "" },
      { name: "kind", label: "Type", type: "select", required: true, options: kindOptions(), value: c.kind,
        hintFn: (v) => tHint(v.kind, v.parent_id, v.parent2_id) },
      { name: "parent_id", label: "Parent culture", type: "select", options: opts, value: c.parent_id },
      { name: "parent2_id", label: "Crossed with (second parent)", type: "select", options: opts, value: c.parent2_id,
        hint: "only for a mating / cross" },
      { name: "source", label: "Source", type: "text", value: c.source || "", capitalize: "sentences" },
      { name: "created", label: "Created", type: "date", value: c.created || isoToday() },
      { name: "status", label: "Status", type: "select", required: true, options: C.STATUSES.map((s) => [s, s]), value: c.status },
      { name: "storage", label: "Storage", type: "text", value: c.storage || "" },
      { name: "filial", label: "Filial generation F (blank = work it out)", type: "number", integer: true, min: 0, max: 99, value: c.filial ?? "" },
      { name: "transfer_gen", label: "Transfer generation T (blank = work it out)", type: "number", integer: true, min: 0, max: 99, value: c.transfer_gen ?? "",
        hint: "set 0 to restart the count, e.g. a tissue clone of your own fruit" },
      { name: "transfer_days", label: "Transfer / use every (days)", type: "number", integer: true, min: 1, max: 3650, value: c.transfer_days ?? "",
        hint: "blank = the default for the type" },
      { name: "notes", label: "Notes", type: "textarea", value: c.notes || "" },
    ],
    submit: (v) => {
      const clash = nameClash([v.name], id);
      if (clash) return clash;
      if (v.parent2_id && !v.parent_id) return "A cross needs both parents: pick the first one under Parent culture too.";
      if (v.parent2_id && v.parent2_id === v.parent_id) return "The two parents of a cross must be different cultures.";
      const d = { ...v };
      const hybrid = d.parent2_id ? crossSpecies(d.species, d.parent_id, d.parent2_id) : null;
      if (hybrid) d.species = hybrid;
      d.species = d.species || "";
      for (const k of ["strain", "source", "storage", "notes"]) d[k] = d[k] || "";
      let newId = id;
      change(id ? `Saved ${d.name}` : `Added ${d.name}`, () => {
        if (id) S.db.update("cultures", id, d); else newId = S.db.insert("cultures", d);
        if (d.species) S.db.addSpecies(d.species);
      });
      if (hybrid) setTimeout(() => toast(`Species set to the hybrid ${hybrid}.`), 300);
      location.hash = `#/culture/${newId}`;
    },
  });
}
function descendants(id) {
  const out = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of S.ds.cultures.values())
      if ((c.parent_id === cur || c.parent2_id === cur) && !out.has(c.id)) { out.add(c.id); stack.push(c.id); }
  }
  return out;
}

export function cultureStatusForm(id) {
  const c = S.db.get("cultures", id);
  openForm({
    title: `${c.name}: status`,
    fields: [
      { name: "status", label: "Status", type: "select", required: true, options: C.STATUSES.map((s) => [s, s]), value: c.status },
      { name: "contam_type", label: "Contamination type", type: "select", options: C.CONTAM_TYPES.map((x) => [x, x]), value: c.contam_type || null,
        show: (v) => v.status === "contaminated" },
      { name: "contam_date", label: "Contamination spotted", type: "date", value: c.contam_date || isoToday(), show: (v) => v.status === "contaminated" },
      { name: "rating", label: "Rating (1–5 ★)", type: "select", options: [1, 2, 3, 4, 5].map((n) => ["★".repeat(n), n]), value: c.rating },
      { name: "keeper", label: "Keeper ✓ (a culture worth keeping)", type: "check", value: !!c.keeper },
      { name: "storage", label: "Storage", type: "text", value: c.storage || "" },
    ],
    submit: (v) => {
      const d = { status: v.status, rating: v.rating, keeper: v.keeper ? 1 : 0, storage: v.storage || "" };
      if (S.db.columns("cultures").includes("contam_type")) {
        d.contam_type = v.status === "contaminated" ? v.contam_type || "" : c.contam_type || "";
        d.contam_date = v.status === "contaminated" ? v.contam_date : c.contam_date;
      }
      change(`${c.name}: ${v.status}`, () => S.db.update("cultures", id, d));
    },
  });
}

// ------------------------------------------------------------------ grows
export function growForm(preset = {}) {
  const ds = S.ds;
  const batches = batchOptions(false);
  if (!batches.length) { toast("No prepared batches with units left. Add one in the desktop app (Batches)."); return; }
  const spawnGrows = ds.grows.filter((g) => ds.isSpawn(g) && g.outcome !== "contaminated" && g.outcome !== "abandoned")
    .map((g) => [`${g.label} — ${ds.cultures.get(g.culture_id).name}${g.colonized ? "" : " (not colonized)"}`, g.id]);
  const growType = (v) => v.kind || C.growTypeFor(ds.recipes.get((ds.batches.get(v.batch_id) || {}).recipe_id));
  openForm({
    title: "Start a grow",
    fields: [
      { name: "label", label: "Grow label", type: "text", required: true, value: S.db.nextLabel("grows", "G") },
      { name: "culture_id", label: "Culture", type: "select", required: true, options: cultureOptions(), value: preset.culture_id,
        hintFn: (v) => (v.culture_id && ds.senescent(v.culture_id) ? `<span class="bad-t">⚠ ${esc(ds.cultures.get(v.culture_id).name)} is past the senescence limit.</span>` : "") },
      { name: "batch_id", label: "Prepared batch", type: "select", required: true, options: batches, value: preset.batch_id },
      { name: "units_used", label: "Units used (bags / jars)", type: "number", integer: true, min: 1, max: 999, value: 1, required: true,
        hintFn: (v) => (v.batch_id ? `${ds.unitsLeft(v.batch_id)} left in that batch` : "") },
      { name: "kind", label: "Type", type: "select", options: [["spawn (grain)", "spawn"], ["fruiting (bulk)", "fruiting"]], value: null,
        hintFn: (v) => `blank = from the batch's recipe: ${v.batch_id ? growType(v) : "—"}` },
      { name: "spawn_grow_id", label: "Spawned from grow", type: "select", options: spawnGrows, value: preset.spawn_grow_id,
        show: (v) => growType(v) === "fruiting", hint: "the grain grow this bulk came from (it's then marked spawned)" },
      { name: "inoculated", label: "Inoculated", type: "date", required: true, value: isoToday() },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
    submit: (v) => {
      const left = S.db.unitsLeft(v.batch_id);
      if (v.units_used > left) return `That batch only has ${left} unit${left === 1 ? "" : "s"} left.`;
      const d = { ...v, notes: v.notes || "", outcome: "active" };
      const gid = change(`Started ${v.label}`, () => S.db.insert("grows", d));
      location.hash = `#/grow/${gid}`;
    },
  });
}

/** Stamp the next milestone: colonized, then (fruiting grows) first pins. */
export function milestoneForm(gid) {
  const g = S.db.get("grows", gid), dg = S.ds.growById.get(gid);
  let field, label;
  if (!g.colonized) [field, label] = ["colonized", "Fully colonized on"];
  else if (S.ds.isSpawn(dg)) { toast("Spawn grows don't pin. Start the bulk grow and pick this one under “Spawned from grow”."); return; }
  else if (!g.pinned) [field, label] = ["pinned", "First pins on"];
  else { toast("Colonization and pins are logged: log a harvest next."); return; }
  openForm({
    title: `${g.label}: ${label.toLowerCase()}`,
    fields: [{ name: field, label, type: "date", required: true, value: isoToday() }],
    submit: (v) => {
      const msg = datesProblem({ ...g, ...v });
      if (msg) return msg;
      change(`${g.label}: ${field === "colonized" ? "colonized" : "pins"} ${v[field]}`, () => S.db.update("grows", gid, v));
    },
  });
}
export function datesProblem(d) {
  const order = [["inoculated", "Inoculated"], ["colonized", "Fully colonized"], ["pinned", "First pins"]];
  const seen = order.filter(([k]) => d[k]).map(([k, l]) => [l, d[k]]);
  for (let i = 1; i < seen.length; i++) if (seen[i][1] < seen[i - 1][1]) return `“${seen[i][0]}” (${seen[i][1]}) is before “${seen[i - 1][0]}” (${seen[i - 1][1]}).`;
  if (d.contam_date && d.inoculated && d.contam_date < d.inoculated) return "“Contamination spotted” is before “Inoculated”.";
  return null;
}

export function harvestForm(gid) {
  const g = S.db.get("grows", gid);
  if (S.ds.isSpawn(S.ds.growById.get(gid))) { toast("This is a spawn grow: harvests are logged on the fruiting grows spawned from it."); return; }
  const n = S.db.nextFlushNumber(gid);
  openForm({
    title: `${g.label}: harvest`,
    fields: [
      { name: "number", label: "Flush number", type: "number", integer: true, min: 1, max: 99, required: true, value: n },
      { name: "harvested", label: "Harvest date", type: "date", required: true, value: isoToday() },
      { name: "wet_g", label: "Wet weight (g)", type: "number", min: 0, max: 1e6 },
      { name: "dry_g", label: "Dry weight (g)", type: "number", min: 0, max: 1e6 },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
    submit: (v) => {
      if (g.inoculated && v.harvested < g.inoculated) return "The harvest date is before the grow was inoculated.";
      change(`${g.label}: flush ${v.number}${v.wet_g ? ` · ${v.wet_g} g` : ""}`,
        () => S.db.insert("flushes", { ...v, grow_id: gid, notes: v.notes || "" }));
    },
  });
}

export function outcomeForm(gid) {
  const g = S.db.get("grows", gid);
  openForm({
    title: `${g.label}: outcome`,
    fields: [
      { name: "outcome", label: "Outcome", type: "select", required: true, options: C.OUTCOMES.map((o) => [o, o]), value: g.outcome },
      { name: "contam_type", label: "Contamination type", type: "select", options: C.CONTAM_TYPES.map((x) => [x, x]),
        value: g.contam_type || null, show: (v) => v.outcome === "contaminated" },
      { name: "contam_date", label: "Contamination spotted", type: "date", value: g.contam_date || isoToday(), show: (v) => v.outcome === "contaminated" },
    ],
    submit: (v) => {
      const d = { outcome: v.outcome, contam_type: v.outcome === "contaminated" ? v.contam_type || "" : "",
        contam_date: v.outcome === "contaminated" ? v.contam_date : null };
      const msg = datesProblem({ ...g, ...d });
      if (msg) return msg;
      change(`${g.label}: ${v.outcome}`, () => S.db.update("grows", gid, d));
    },
  });
}

// ------------------------------------------------------------------ conditions
export function tempForm(gid = null) {
  const ds = S.ds, unit = ds.tempUnit;
  const active = ds.grows.filter((g) => ds.isActive(g)).map((g) => [`${g.label} — ${ds.cultures.get(g.culture_id).name}`, g.id]);
  openForm({
    title: gid ? `${ds.growById.get(gid).label}: temperature` : "Temperature / humidity",
    fields: [
      { name: "grow_id", label: "Grow", type: "select", options: active, value: gid,
        hint: "blank = a general room / incubator reading (used for every grow without its own)" },
      { name: "temp", label: `Temperature (°${unit})`, type: "number", min: unit === "F" ? 14 : -10, max: unit === "F" ? 122 : 50 },
      { name: "rh", label: "Humidity (% RH)", type: "number", min: 0, max: 100 },
      { name: "logged", label: "Date", type: "date", required: true, value: isoToday() },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
    submit: (v) => {
      if (v.temp === null && v.rh === null) return "Enter a temperature or a humidity.";
      const d = { grow_id: v.grow_id, logged: v.logged, temp_c: v.temp === null ? null : C.unitToC(v.temp, unit), rh: v.rh, notes: v.notes || "" };
      change(`Logged ${v.temp !== null ? `${v.temp}°${unit}` : `${v.rh}% RH`}`, () => S.db.insert("env_logs", d));
    },
  });
}

// ------------------------------------------------------------------ notes
export function noteForm(target) {
  const [col, id] = target;
  const name = col === "culture_id" ? S.ds.cultures.get(id).name : col === "grow_id" ? S.ds.growById.get(id).label : S.ds.batches.get(id).label;
  openForm({
    title: `Note on ${name}`,
    fields: [
      { name: "text", label: "Note", type: "textarea", capitalize: "sentences" },
      { name: "photo", label: "Photo", type: "photo", hint: "opens the camera; stored inside the database (about 200 KB)" },
    ],
    submit: (v) => {
      if (!v.text && !v.photo) return "Write something or take a photo.";
      const d = { created: new Date().toISOString().slice(0, 19).replace("T", " "), text: v.text || "", [col]: id, photo: "" };
      if (v.photo) d.photo_data = v.photo;
      change(`Note added to ${name}`, () => S.db.insert("notes", d));
    },
  });
}

// ------------------------------------------------------------------ batches
export function inoculateBatch(bid) {
  const ds = S.ds;
  if (!ds.unitsLeft(bid)) { toast("No units left in this batch.", { bad: true }); return; }
  if (ds.isMediaBatch(bid)) {
    // plates / LC jars are cultures: pick the parent
    const opts = cultureOptions();
    openForm({
      title: `Inoculate ${ds.batches.get(bid).label}`,
      lead: "Agar and LC batches make cultures: pick the culture you're transferring from.",
      fields: [{ name: "parent", label: "From culture", type: "select", required: true, options: opts }],
      submitLabel: "Next",
      submit: (v) => { setTimeout(() => transferForm(v.parent, { batchId: bid }), 0); },
    });
  } else growForm({ batch_id: bid });
}
export function batchFailedForm(bid) {
  const b = S.db.get("batches", bid), left = S.db.unitsLeft(bid);
  openForm({
    title: `${b.label}: units failed before inoculation`,
    lead: "Contaminated out of the cooker, burst bag … These count against the sterilization run.",
    fields: [{ name: "n", label: "How many units failed", type: "number", integer: true, min: 1, max: Math.max(1, left), value: 1, required: true }],
    submit: (v) => {
      if (v.n > left) return `Only ${left} unit(s) are unused.`;
      change(`${b.label}: ${v.n} unit(s) failed`, () => S.db.update("batches", bid, { discarded: (b.discarded || 0) + v.n }));
    },
  });
}
export function batchCloseForm(bid) {
  const b = S.db.get("batches", bid);
  openForm({
    title: b.closed ? `Reopen ${b.label}?` : `Close ${b.label}?`,
    lead: b.closed ? "Its unused units will be offered again." : "Close a batch when its spare units were binned or used elsewhere. Closing isn't counted as a failure.",
    fields: [], submitLabel: b.closed ? "Reopen" : "Close batch",
    submit: () => { change(`${b.label} ${b.closed ? "reopened" : "closed"}`, () => S.db.update("batches", bid, { closed: b.closed ? 0 : 1 })); },
  });
}

// ------------------------------------------------------------------ settings shared with the desktop app
export function sharedSettingsForm() {
  const st = S.db.settings();
  openForm({
    title: "Settings (saved in the database)",
    lead: "These are shared with the desktop app.",
    fields: [
      { name: "temp_unit", label: "Temperature unit", type: "select", required: true, options: [["°F", "F"], ["°C", "C"]], value: (st.temp_unit || "F").toUpperCase() },
      { name: "senescence_t", label: "Senescence warning after transfer", type: "number", integer: true, min: 1, max: 50, required: true, value: parseInt(st.senescence_t || "6") },
      { name: "temp_adjust", label: "Adjust forecasts for temperature (Q10)", type: "check", value: !["0", "", "off", "false"].includes(st.temp_adjust ?? "1") },
    ],
    submit: (v) => {
      change("Settings saved", () => {
        S.db.setSetting("temp_unit", v.temp_unit);
        S.db.setSetting("senescence_t", v.senescence_t);
        S.db.setSetting("temp_adjust", v.temp_adjust ? "1" : "0");
      });
    },
  });
}
export { T, D };
