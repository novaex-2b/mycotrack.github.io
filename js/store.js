// The database on the phone: a MycoTrack SQLite file opened with sql.js (SQLite compiled to WebAssembly).
//
// The phone works on its own copy of the file, kept in the browser's storage (IndexedDB) so the app
// opens offline. "Save" hands the file back (share sheet / download) to put in your sync folder, and
// "Open" loads one. The rules for writing rows mirror the desktop app's db.py: ids are never reused
// (hw:<table> counters in settings), species names get their capitalisation corrected.

import { formatSpecies, DEFAULT_SPECIES } from "./core.js";

// Tables and columns the app relies on. A file missing any of them was made by an older desktop
// version: opening it once there upgrades it.
export const REQUIRED = {
  cultures: ["id", "name", "species", "strain", "kind", "parent_id", "parent2_id", "filial", "transfer_gen",
    "source", "created", "status", "storage", "notes", "batch_id", "transfer_days", "rating", "keeper",
    "contam_type", "contam_date"],
  grows: ["id", "label", "culture_id", "batch_id", "units_used", "kind", "spawn_grow_id", "inoculated", "colonized",
    "pinned", "outcome", "contam_type", "contam_date", "notes"],
  batches: ["id", "label", "recipe_id", "steril_id", "prepared", "units", "unit_g", "discarded", "closed"],
  flushes: ["id", "grow_id", "number", "harvested", "wet_g", "dry_g", "notes"],
  env_logs: ["id", "grow_id", "logged", "temp_c", "rh", "notes"],
  notes: ["id", "created", "text", "culture_id", "grow_id", "batch_id", "photo", "photo_data"],
  recipes: ["id", "name", "kind"],
  sterilizations: ["id", "label", "method"],
  priors: ["keyword", "col", "pin", "harv", "gap"],
  settings: ["key", "value"],
  species: ["name"],
};

export class SchemaError extends Error {}

export class MDB {
  constructor(SQL, bytes) {
    this.SQL = SQL;
    this.db = new SQL.Database(bytes ? new Uint8Array(bytes) : undefined);
    this._pragmas();
    this.cols = {};
  }
  _pragmas() { this.db.run("PRAGMA foreign_keys = ON"); }

  check() {
    const missing = [];
    for (const [t, cols] of Object.entries(REQUIRED)) {
      const have = new Set(this.all(`PRAGMA table_info(${t})`).map((r) => r.name));
      if (!have.size) { missing.push(t); continue; }
      for (const c of cols) if (!have.has(c)) missing.push(`${t}.${c}`);
    }
    if (missing.length) {
      throw new SchemaError(this.all("SELECT name FROM sqlite_master WHERE name='cultures'").length
        ? "This database was saved by an older MycoTrack. Open it once in the desktop app (version 0.7 or later) to upgrade it, then try again."
        : "That file isn't a MycoTrack database.");
    }
    return this;
  }

  // ---- reading
  all(sql, params = []) {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  }
  one(sql, params = []) { return this.all(sql, params)[0] || null; }
  rows(table, where = "", params = [], order = "id") {
    return this.all(`SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""}${order ? ` ORDER BY ${order}` : ""}`, params);
  }
  get(table, id) { return id === null || id === undefined ? null : this.one(`SELECT * FROM ${table} WHERE id=?`, [id]); }
  settings() {
    const out = { temp_unit: "F", temp_adjust: "1", q10: "2.0", tref_c: "24", senescence_t: "6" };
    for (const r of this.all("SELECT key, value FROM settings")) out[r.key] = r.value;
    return out;
  }
  columns(table) {
    if (!this.cols[table]) this.cols[table] = this.all(`PRAGMA table_info(${table})`).map((r) => r.name);
    return this.cols[table];
  }

  // ---- writing (all inside one transaction each, like the desktop app)
  tx(fn) {
    this.db.run("BEGIN");
    try { const r = fn(); this.db.run("COMMIT"); return r; }
    catch (e) { this.db.run("ROLLBACK"); throw e; }
  }
  _nextId(table, n = 1) {
    const key = `hw:${table}`;
    const r = this.one("SELECT value FROM settings WHERE key=?", [key]);
    const hw = r ? parseInt(r.value) || 0 : 0;
    const mx = this.one(`SELECT COALESCE(MAX(id),0) AS m FROM ${table}`).m;
    const first = Math.max(hw, mx) + 1;
    this.db.run("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, String(first + n - 1)]);
    return first;
  }
  static _tidy(table, data) {
    if (table === "cultures" && data.species) return { ...data, species: formatSpecies(data.species) };
    return data;
  }
  _insert(table, data) {
    data = MDB._tidy(table, data);
    const cols = Object.keys(data).filter((c) => c !== "id" && this.columns(table).includes(c));
    const id = this._nextId(table);
    this.db.run(`INSERT INTO ${table} (id${cols.map((c) => "," + c).join("")}) VALUES (?${",?".repeat(cols.length)})`,
      [id, ...cols.map((c) => norm(data[c]))]);
    return id;
  }
  insert(table, data) { return this.tx(() => this._insert(table, data)); }
  insertMany(table, rows) { return this.tx(() => rows.map((r) => this._insert(table, r))); }
  update(table, id, data) {
    data = MDB._tidy(table, data);
    const cols = Object.keys(data).filter((c) => c !== "id" && this.columns(table).includes(c));
    if (!cols.length) return;
    this.tx(() => this.db.run(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(",")} WHERE id=?`,
      [...cols.map((c) => norm(data[c])), id]));
  }
  delete(table, id) { this.tx(() => this.db.run(`DELETE FROM ${table} WHERE id=?`, [id])); }
  setSetting(key, value) {
    this.tx(() => this.db.run("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, String(value)]));
  }

  // ---- helpers matching db.py
  speciesList() { return this.all("SELECT name FROM species ORDER BY name").map((r) => r.name); }
  canonicalSpecies(name) {
    name = formatSpecies(name);
    if (!name) return "";
    const r = this.one("SELECT name FROM species WHERE name = ?", [name]);   // NOCASE column
    return r ? r.name : name;
  }
  addSpecies(name) {
    name = this.canonicalSpecies(name);
    if (name) this.tx(() => this.db.run("INSERT OR IGNORE INTO species(name) VALUES (?)", [name]));
  }
  nextLabel(table, prefix) {
    const r = this.one("SELECT value FROM settings WHERE key=?", [`hw:${table}`]);
    const mx = this.one(`SELECT COALESCE(MAX(id),0) AS m FROM ${table}`).m;
    let label = `${prefix}-${String(Math.max(r ? parseInt(r.value) || 0 : 0, mx) + 1).padStart(3, "0")}`;
    while (this.one(`SELECT 1 AS x FROM ${table} WHERE label=?`, [label])) label += "x";
    return label;
  }
  nextFlushNumber(growId) {
    return this.one("SELECT COALESCE(MAX(number),0)+1 AS n FROM flushes WHERE grow_id=?", [growId]).n;
  }
  unitsLeft(batchId, exceptGrow = null, exceptCulture = null) {
    const b = this.get("batches", batchId);
    if (!b || b.closed) return 0;
    const g = this.one("SELECT COALESCE(SUM(units_used),0) AS n FROM grows WHERE batch_id=? AND id IS NOT ?", [batchId, exceptGrow]).n;
    const c = this.one("SELECT COUNT(*) AS n FROM cultures WHERE batch_id=? AND id IS NOT ?", [batchId, exceptCulture]).n;
    return Math.max(0, (b.units || 0) - (b.discarded || 0) - g - c);
  }

  export() {
    const bytes = this.db.export();      // (sql.js closes and reopens the connection to do this)
    this._pragmas();
    return bytes;
  }
  close() { this.db.close(); }
}

const norm = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

/** A new, empty MycoTrack database (same schema the desktop app creates). */
export function emptyDB(SQL, schemaSql) {
  const m = new MDB(SQL);
  m.db.exec(schemaSql);
  m._pragmas();
  m.tx(() => {
    for (const s of DEFAULT_SPECIES) m.db.run("INSERT OR IGNORE INTO species(name) VALUES (?)", [s]);
  });
  return m;
}

// ---- keeping the working copy in the browser (IndexedDB)
const IDB_NAME = "mycotrack", STORE = "files";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => rej(r.error);
  });
}
export async function idbPut(key, value) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
