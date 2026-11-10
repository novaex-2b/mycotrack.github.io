// App state shared by the views and forms: the open database, its computed Dataset, undo snapshots,
// keeping the working copy in browser storage, and small display helpers.

import * as C from "./core.js";
import { MDB, idbPut } from "./store.js";

export const S = {
  SQL: null,          // sql.js module
  db: null,           // MDB (open database) or null
  ds: null,           // core.Dataset for the current contents
  meta: null,         // { name, dirty, openedAt, savedAt, fileModified }
  undo: [],           // [{ label, bytes }] newest last
  render: () => {},   // set by app.js
};
export const VERSION = "0.7.0";
const UNDO_MAX = 20;

export const esc = C.escapeHtml;
export const sp = (name) => (name ? C.speciesHtml(name) : '<span class="dim">no species</span>');

// ---- preferences that stay on this phone (not in the database)
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem("mt:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mt:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---- database lifecycle
export function rebuild() {
  S.ds = S.db ? new C.Dataset(S.db) : null;
}
export function openBytes(bytes, meta) {
  const db = new MDB(S.SQL, bytes).check();   // throws SchemaError before anything is replaced
  if (S.db) S.db.close();
  S.db = db;
  S.meta = { dirty: false, openedAt: Date.now(), savedAt: null, ...meta };
  S.undo = [];
  rebuild();
  persistNow();
}

let persistTimer = null;
export function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 400);
}
export async function persistNow() {
  clearTimeout(persistTimer);
  if (!S.db) return;
  try {
    await idbPut("current", { bytes: S.db.export(), meta: S.meta });
  } catch (e) {
    toast("Couldn't keep a copy in this browser's storage: " + e.message, { bad: true });
  }
}

/** Make a change with undo: snapshot, run fn (which writes to S.db), refresh. Returns fn's result.
 *  Throws (without changing anything) if fn throws. */
export function change(label, fn, { quiet = false } = {}) {
  const before = S.db.export();
  let out;
  try {
    out = fn();
  } catch (e) {
    restore(before);
    throw e;
  }
  S.undo.push({ label, bytes: before });
  if (S.undo.length > UNDO_MAX) S.undo.shift();
  S.meta.dirty = true;
  rebuild();
  persistSoon();
  S.render();
  if (!quiet) toast(label, { action: "Undo", onAction: undoLast });
  return out;
}
function restore(bytes) {
  const db = new MDB(S.SQL, bytes);
  S.db.close();
  S.db = db;
  rebuild();
}
export function undoLast() {
  const u = S.undo.pop();
  if (!u) { toast("Nothing to undo."); return; }
  restore(u.bytes);
  S.meta.dirty = true;
  persistSoon();
  S.render();
  toast(`Undid: ${u.label}`);
}

// ---- toast
let toastTimer = null;
export function toast(msg, { bad = false, action = null, onAction = null, ms = 4500 } = {}) {
  const el = document.getElementById("toast");
  el.className = "show" + (bad ? " bad" : "");
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action)}</button>` : "");
  if (action) el.querySelector("button").onclick = () => { el.className = ""; onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, action ? Math.max(ms, 6000) : ms);
}

// ---- display helpers
export const today = () => C.today();
export const D = (n) => (n === null || n === undefined ? "—" : C.dayStr(n));
export function relDays(left) {
  if (left < 0) return `<span class="late">${-left}d late</span>`;
  if (left === 0) return `<span class="soon">today</span>`;
  if (left <= 2) return `<span class="soon">in ${left}d</span>`;
  return `in ${left}d`;
}
export function dueChip(r) {
  if (!r) return "";
  if (r.left < 0) return `<span class="chip bad">overdue ${-r.left}d</span>`;
  if (r.left <= 7) return `<span class="chip warn">${r.left ? `due in ${r.left}d` : "due today"}</span>`;
  return "";
}
export function tChip(cid) {
  const t = S.ds.tgen.get(cid);
  if (t === null || t === undefined) return "";
  if (t > S.ds.senescenceT) return `<span class="chip bad" title="past the senescence limit">T${t} ⚠</span>`;
  if (t === S.ds.senescenceT) return `<span class="chip warn" title="at the senescence limit">T${t}</span>`;
  return `<span class="chip">T${t}</span>`;
}
export function fChip(cid) {
  const f = S.ds.filial.get(cid);
  return f === null || f === undefined ? "" : `<span class="chip info">F${f}</span>`;
}
export const statusClass = (s) => "st-" + String(s || "").split(" ")[0];
export const stars = (n) => (n ? "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n)) : "");
export const T = (c) => C.fmtTemp(c, S.ds ? S.ds.tempUnit : "F");
export function num(v, digits = 0) {
  if (v === null || v === undefined || v === "") return "—";
  const s = Number(v).toFixed(digits);
  return digits ? s.replace(/\.?0+$/, "") : s;
}
export function weight(g) {
  if (g === null || g === undefined) return "—";
  return g >= 1000 ? `${num(g / 1000, 2)} kg` : `${num(g)} g`;
}
