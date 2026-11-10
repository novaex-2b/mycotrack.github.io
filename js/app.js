// MycoTrack mobile: start-up, opening and saving the database file, routing between screens and
// handling taps. Screens are in views.js, forms in forms.js, shared state in state.js.

import * as C from "./core.js";
import { SchemaError, idbGet, idbPut } from "./store.js";
import { S, prefs, openBytes, persistNow, undoLast, toast, esc } from "./state.js";
import * as V from "./views.js";
import * as F from "./forms.js";
import { startScan, stopScan, routeFor } from "./scan.js";

const $ = (sel) => document.querySelector(sel);
let photoUrls = [];

// ------------------------------------------------------------------ start
async function boot() {
  applyTheme(prefs.get("theme", "auto"));
  if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  try {
    S.SQL = await window.initSqlJs({ locateFile: (f) => `vendor/${f}` });
  } catch (e) {
    $("#view").innerHTML = `<h1>Couldn't start</h1><p class="sub">The database engine didn't load (${esc(e.message)}). Check your connection and reload.</p>`;
    return;
  }
  try {
    const saved = await idbGet("current");
    if (saved && saved.bytes) openBytes(saved.bytes, saved.meta || {});   // keeps "unsaved changes" across restarts
  } catch (e) {
    toast("Couldn't reopen the last database: " + e.message, { bad: true });
  }
  S.render = render;
  fileInput().addEventListener("change", () => { const f = fileInput().files[0]; if (f) loadFile(f); });
  window.addEventListener("hashchange", render);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", () => persistNow());
  render();
  window.__mycotrack = { S, C };      // handy for debugging from the browser console
}

// ------------------------------------------------------------------ routing
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  return { name: parts[0] || "", id: parts[1] ? parseInt(parts[1]) : null };
}
function render() {
  const r = route(), main = $("#view");
  if (r.name !== "scan") stopScan();
  for (const u of photoUrls) URL.revokeObjectURL(u);
  photoUrls = [];
  const tab = { "": "dash", cultures: "cultures", culture: "cultures", grows: "grows", grow: "grows", scan: "scan",
    more: "more", batches: "more", batch: "more", conditions: "more" }[r.name] || "dash";
  document.querySelectorAll("nav.tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  updateChip();
  let html;
  if (!S.db && r.name !== "more") html = V.welcome();
  else {
    switch (r.name) {
      case "": html = V.dashboard(); break;
      case "cultures": html = V.cultures(cultureFilter); break;
      case "culture": html = V.culture(r.id); break;
      case "grows": html = V.grows(prefs.get("growsMode", "active")); break;
      case "grow": html = V.grow(r.id); break;
      case "batches": html = V.batches(); break;
      case "batch": html = V.batch(r.id); break;
      case "scan": html = V.scan(); break;
      case "more": html = V.more(); break;
      case "conditions": html = V.conditions(); break;
      default: html = V.dashboard();
    }
  }
  const sameView = main.dataset.route === location.hash;
  const y = window.scrollY;
  main.innerHTML = html;
  main.dataset.route = location.hash;
  if (sameView) window.scrollTo(0, y); else window.scrollTo(0, 0);
  hydrate(r);
}
let cultureFilter = "";

function hydrate(r) {
  // photos stored inside the database
  for (const img of document.querySelectorAll("img[data-photo]")) {
    const row = S.db.one("SELECT photo_data FROM notes WHERE id=?", [+img.dataset.photo]);
    if (row && row.photo_data) {
      const u = URL.createObjectURL(new Blob([row.photo_data], { type: "image/jpeg" }));
      photoUrls.push(u);
      img.src = u;
    }
  }
  const search = $("#culture-search");
  if (search) {
    search.addEventListener("input", () => {
      cultureFilter = search.value;
      const pos = search.selectionStart;
      render();
      const s2 = $("#culture-search");
      s2.focus();
      try { s2.setSelectionRange(pos, pos); } catch { /* type=search on some browsers */ }
    });
  }
  for (const d of document.querySelectorAll("details.species")) {
    d.addEventListener("toggle", () => {
      if (cultureFilter) return;                 // opened by the filter: don't remember
      const open = new Set(prefs.get("open", []));
      if (d.open) open.add(d.dataset.species); else open.delete(d.dataset.species);
      prefs.set("open", [...open]);
    });
  }
  const theme = $("#theme-select");
  if (theme) theme.addEventListener("change", () => { prefs.set("theme", theme.value); applyTheme(theme.value); });
  if (r.name === "scan" && S.db) {
    const video = $("#scan-video"), status = $("#scan-status");
    const onCode = (text) => {
      const to = routeFor(text, S.ds);
      if (to) { stopScan(); location.hash = to; return; }
      status.textContent = `Not in this database: “${text.split("\n")[0]}”. Still looking…`;
      setTimeout(() => { if (route().name === "scan") startScan(video, onCode, (m) => { status.textContent = m; }); }, 1500);
    };
    startScan(video, onCode, (m) => { status.textContent = m; });
    $("#code-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const to = routeFor($("#code-input").value, S.ds);
      if (to) location.hash = to; else toast("No culture, grow or batch with that code.", { bad: true });
    });
  }
}

function updateChip() {
  const chip = $("#file-chip");
  if (!S.db) { chip.textContent = "No database"; chip.classList.remove("dirty"); return; }
  chip.textContent = S.meta.dirty ? `${S.meta.name || "mycotrack.db"}: Save` : S.meta.name || "mycotrack.db";
  chip.classList.toggle("dirty", !!S.meta.dirty);
}

function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) $("#theme-color").setAttribute("content", bg);
  });
}

// ------------------------------------------------------------------ opening and saving the file
const fileInput = () => $("#file-input");

function confirmReplace(then) {
  if (!S.db || !S.meta.dirty) { then(); return; }
  F.openForm({
    title: "Replace the phone's copy?", danger: true, submitLabel: "Replace",
    lead: "The phone has changes that haven't been saved to a file yet. Opening another database discards them. Save first if you want to keep them.",
    fields: [], submit: () => { setTimeout(then, 0); },
  });
}

async function loadFile(file, handle = null) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    openBytes(bytes, { name: file.name || "mycotrack.db", fileModified: file.lastModified || null, handle: !!handle });
    await idbPut("handle", handle || null);
    location.hash = "#/";
    render();
    toast(`Opened ${file.name}`);
  } catch (e) {
    toast(e instanceof SchemaError ? e.message : `Couldn't open that file: ${e.message}`, { bad: true, ms: 9000 });
  }
}

async function openFile() {
  confirmReplace(async () => {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({ multiple: false });
        await loadFile(await h.getFile(), h);
      } catch (e) { if (e.name !== "AbortError") toast(`Couldn't open the file: ${e.message}`, { bad: true }); }
    } else {
      const inp = fileInput();
      inp.value = "";
      inp.click();             // the change listener is set up in boot()
    }
  });
}

async function writeHandle(h, bytes) {
  const opts = { mode: "readwrite" };
  if (h.queryPermission && (await h.queryPermission(opts)) !== "granted" && (await h.requestPermission(opts)) !== "granted") return false;
  const w = await h.createWritable();
  await w.write(bytes);
  await w.close();
  S.meta.fileModified = (await h.getFile()).lastModified;
  return true;
}

async function saveFile() {
  if (!S.db) return;
  const bytes = S.db.export(), name = S.meta.name || "mycotrack.db";
  let how = null;
  try {
    const h = await idbGet("handle");
    if (h && h.createWritable && (await writeHandle(h, bytes))) how = `Saved to ${name}`;
    else if (window.showSaveFilePicker) {
      const nh = await window.showSaveFilePicker({ suggestedName: name });
      if (await writeHandle(nh, bytes)) { await idbPut("handle", nh); S.meta.handle = true; S.meta.name = nh.name; how = `Saved to ${nh.name}`; }
    } else {
      const file = new File([bytes], name, { type: "application/octet-stream" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        how = `Shared ${name}: save it into your sync folder, replacing the old one`;
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        how = `Downloaded ${name}: move it into your sync folder, replacing the old one`;
      }
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    toast(`Couldn't save: ${e.message}`, { bad: true });
    return;
  }
  if (!how) { toast("Saving needs permission to write the file.", { bad: true }); return; }
  S.meta.dirty = false;
  S.meta.savedAt = Date.now();
  await persistNow();
  render();
  toast(how, { ms: 7000 });
}

async function reloadFile() {
  const h = await idbGet("handle");
  if (!h) { openFile(); return; }
  confirmReplace(async () => {
    try {
      if (h.queryPermission && (await h.queryPermission({ mode: "read" })) !== "granted") await h.requestPermission({ mode: "read" });
      await loadFile(await h.getFile(), h);
    } catch (e) { toast(`Couldn't read the file again: ${e.message}`, { bad: true }); }
  });
}

/** Coming back to the app: if the file we opened changed elsewhere (the desktop app saved it), say so. */
async function onVisibility() {
  if (document.visibilityState === "hidden") { persistNow(); stopScan(); return; }
  if (route().name === "scan") render();
  if (!S.db || !S.meta.handle) return;
  try {
    const h = await idbGet("handle");
    if (!h || (h.queryPermission && (await h.queryPermission({ mode: "read" })) !== "granted")) return;
    const f = await h.getFile();
    if (S.meta.fileModified && f.lastModified > S.meta.fileModified) {
      if (S.meta.dirty) toast("The file was also changed on another device. Saving now would overwrite those changes.", { bad: true, ms: 9000 });
      else toast("The file was changed on another device.", { action: "Reload", onAction: () => loadFile(f, h) });
    }
  } catch { /* file moved or permission gone */ }
}

async function fetchDb(path, name) {
  confirmReplace(async () => {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error(r.statusText);
      openBytes(new Uint8Array(await r.arrayBuffer()), { name, handle: false });
      await idbPut("handle", null);
      S.meta.dirty = name !== "mycotrack-demo.db";      // a brand-new database hasn't been saved anywhere yet
      await persistNow();
      location.hash = "#/";
      render();
      toast(name === "mycotrack-demo.db" ? "Sample data loaded. Open your own file from More when you're ready." : "New database started. Save it to keep a file.");
    } catch (e) { toast(`Couldn't load it: ${e.message}`, { bad: true }); }
  });
}

// ------------------------------------------------------------------ taps
const ACTIONS = {
  "open-file": openFile,
  "save-file": saveFile,
  "reload-file": reloadFile,
  "new-db": () => fetchDb("data/empty.db", "mycotrack.db"),
  "demo-db": () => fetchDb("data/demo.db", "mycotrack-demo.db"),
  "file-menu": () => {
    if (!S.db) { location.hash = "#/more"; return; }
    if (S.meta.dirty) saveFile(); else location.hash = "#/more";
  },
  undo: undoLast,
  transfer: (d) => F.transferForm(+d.id),
  cross: (d) => {
    const p = S.ds.cultures.get(+d.id);
    F.cultureForm(null, { parent_id: p.id, species: p.species, kind: "agar plate", source: `Cross of ${p.name} × …` });
  },
  "new-culture": () => F.cultureForm(null),
  "edit-culture": (d) => F.cultureForm(+d.id),
  "culture-status": (d) => F.cultureStatusForm(+d.id),
  "start-grow": (d) => F.growForm(d.culture ? { culture_id: +d.culture } : {}),
  "spawn-to-bulk": (d) => { const g = S.ds.growById.get(+d.id); F.growForm({ culture_id: g.culture_id, spawn_grow_id: g.id }); },
  milestone: (d) => F.milestoneForm(+d.id),
  harvest: (d) => F.harvestForm(+d.id),
  outcome: (d) => F.outcomeForm(+d.id),
  temp: (d) => F.tempForm(d.id ? +d.id : null),
  note: (d) => F.noteForm([d.col, +d.id]),
  inoculate: (d) => F.inoculateBatch(+d.id),
  "batch-failed": (d) => F.batchFailedForm(+d.id),
  "batch-close": (d) => F.batchCloseForm(+d.id),
  "shared-settings": () => F.sharedSettingsForm(),
  "grows-mode": (d) => { prefs.set("growsMode", d.mode); render(); },
};

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) { location.hash = go.dataset.go; return; }
  const a = e.target.closest("[data-action]");
  if (!a || a.disabled) return;
  const fn = ACTIONS[a.dataset.action];
  if (!fn) return;
  e.preventDefault();
  if (!S.db && !["open-file", "new-db", "demo-db", "file-menu"].includes(a.dataset.action)) return;
  try { fn(a.dataset); } catch (ex) { toast(ex.message, { bad: true }); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && F.formOpen()) F.closeForm(); });

boot();
