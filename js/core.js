// MycoTrack core logic for the mobile app.
//
// A line-by-line port of the desktop app's mycotrack/stats.py (estimates, F/T generations, transfer
// reminders), taxon.py (species names) and suggest.py (culture codes), so both apps give the same answers
// for the same database. tests/test_mobile_core.py checks this against the Python code.
//
// Dates are handled as day numbers (days since 1970-01-01) so arithmetic is exact and time-zone free.

// ---------------------------------------------------------------- constants (from db.py / stats.py)
export const CULTURE_TYPES = [
  ["Spore Print", "spore print"], ["Spore Swab", "spore swab"], ["Spore Syringe", "spore syringe"],
  ["Liquid Culture", "liquid culture"], ["Agar Plate", "agar plate"], ["Agar Slant", "agar slant"],
  ["Cryo Vial", "cryo vial"],
];
const TYPE_LABEL = Object.fromEntries(CULTURE_TYPES.map(([l, v]) => [v, l]));
export const kindLabel = (k) => TYPE_LABEL[k || ""] || k || "—";
export const SPORE_KINDS = new Set(["spore print", "spore swab", "spore syringe"]);
export const CONTAM_TYPES = ["trichoderma", "cobweb mold", "bacterial (wet spot / sour)", "penicillium",
  "aspergillus", "yeast", "pests (mites / gnats)", "other", "unknown"];
export const STATUSES = ["active", "stored", "used up", "contaminated", "dead"];
export const OUTCOMES = ["active", "finished", "contaminated", "abandoned"];
export const DEFAULT_SPECIES = [
  "Agaricus bisporus", "Agaricus subrufescens", "Auricularia auricula-judae", "Auricularia cornea",
  "Calocybe indica", "Cordyceps militaris", "Coprinus comatus", "Cyclocybe aegerita",
  "Flammulina velutipes", "Ganoderma lucidum", "Ganoderma tsugae", "Grifola frondosa",
  "Hericium americanum", "Hericium coralloides", "Hericium erinaceus", "Hypsizygus tessellatus",
  "Hypsizygus ulmarius", "Laetiporus sulphureus", "Lentinula edodes", "Lepista nuda",
  "Lyophyllum decastes", "Panaeolus cyanescens", "Pholiota adiposa", "Pholiota microspora",
  "Pleurotus citrinopileatus", "Pleurotus columbinus", "Pleurotus cornucopiae", "Pleurotus djamor",
  "Pleurotus eryngii", "Pleurotus ostreatus", "Pleurotus pulmonarius", "Psilocybe cubensis",
  "Sparassis crispa", "Stropharia rugosoannulata", "Trametes versicolor", "Tremella fuciformis",
  "Volvariella volvacea",
];
export const TRANSFER_DAYS = {
  "spore print": 730, "spore swab": 365, "spore syringe": 365, "liquid culture": 120,
  "agar plate": 45, "agar slant": 180, "cryo vial": 1825,
  "grain spawn": 30, "tissue clone": 45, "fruiting body": 7, "other": 90,
};
export const ATTENTION_WINDOW = 7;
const MIN_N = 3, PRIOR_WEIGHT = 3, MIN_COVERAGE = 0.5, TEMP_RANGE_C = [-10, 50];
const SPAWN_RECIPE_KINDS = new Set(["grain spawn", "agar", "liquid culture"]);
export const CULTURE_RECIPE_KINDS = new Set(["agar", "liquid culture"]);
export const growTypeFor = (recipe) => (recipe && SPAWN_RECIPE_KINDS.has(recipe.kind) ? "spawn" : "fruiting");

// ---------------------------------------------------------------- dates
const DAY_MS = 86400000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
/** "2026-11-05..." -> day number, or null (like util.to_date: tolerant of blanks and junk). */
export function toDay(s) {
  if (!s) return null;
  const m = ISO.exec(String(s).slice(0, 10));
  if (!m || String(s).slice(0, 10).length !== 10) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / DAY_MS);
}
export function dayStr(n) {
  if (n === null || n === undefined) return "";
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}
/** Today in the device's own time zone. */
export function today() {
  const d = new Date();
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}
export const fmtDate = (s) => (s ? String(s).slice(0, 10) : "—");

// ---------------------------------------------------------------- python-compatible maths
/** Python's round(): halves go to the even neighbour. */
export function pyRound(x) {
  const f = Math.floor(x), diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), n = s.length, h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
export function stdev(xs) {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
/** Binary search: number of items in sorted `a` that are <= x (bisect_right). */
function bisectRight(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

// ---------------------------------------------------------------- temperatures
export const cToUnit = (c, unit) => (c === null || c === undefined ? null : unit.toUpperCase() === "F" ? c * 9 / 5 + 32 : c);
export const unitToC = (v, unit) => (v === null || v === undefined ? null : unit.toUpperCase() === "F" ? (v - 32) * 5 / 9 : v);
export function fmtTemp(c, unit) {
  const v = cToUnit(c, unit);
  return v === null ? "—" : `${pyRound(v)}°${unit.toUpperCase()}`;
}

// ---------------------------------------------------------------- species names (taxon.py)
const RANKS = { var: "var.", subsp: "subsp.", ssp: "ssp.", f: "f.", forma: "forma", cv: "cv.", cf: "cf.",
  aff: "aff.", sp: "sp.", spp: "spp.", nom: "nom." };
const HYBRID_SIGNS = new Set(["x", "×"]);
export const HYBRID = "×";
const BEFORE_EPITHET = new Set(["var.", "subsp.", "ssp.", "f.", "forma", "cf.", "aff."]);
const ENDS_NAME = new Set(["sp.", "spp."]);
const LATIN = /^[A-Za-z][A-Za-z-]*$/;
const COMMON_WORDS = new Set(("blue pink golden gold yellow white black brown grey gray red king queen pearl oyster " +
  "lion's lions lion mane shiitake reishi enoki maitake chestnut button cremini crimini portobello portabella wine " +
  "turkey chicken hen morel almond nameko beech wood wood-ear cauliflower shaggy elm pioppino phoenix italian " +
  "indian tree summer winter milky bear's bears comb coral snow jelly lobster hedgehog oak the a my unknown wild " +
  "mystery mixed").split(" "));
const KNOWN_EPITHETS = new Set(DEFAULT_SPECIES.map((s) => s.split(" ")[1].toLowerCase()));

function normRank(w) {
  const l = w.toLowerCase();
  return RANKS[l.endsWith(".") ? l.slice(0, -1) : l] || null;
}
const isEpithet = (w) => LATIN.test(w) && w.length >= 2 && !COMMON_WORDS.has(w.toLowerCase())
  && !HYBRID_SIGNS.has(w.toLowerCase()) && normRank(w) === null;
function looksLikeStrain(w) {
  const rest = w.slice(1);
  if (!(w[0] !== w[0].toLowerCase() && rest !== rest.toUpperCase())) return false;
  return !KNOWN_EPITHETS.has(w.toLowerCase());
}
const isGenusAgain = (w, genus) => { const g = genus.toLowerCase(), l = w.toLowerCase(); return l === g || l === g[0] + "."; };
const parseCache = new Map();

/** [[text, italic], ...] with capitalisation corrected; unchanged and not italic if not a scientific name. */
export function parseSpecies(name) {
  name = String(name || "").trim().split(/\s+/).filter(Boolean).join(" ");
  if (parseCache.has(name)) return parseCache.get(name);
  const out = parse_(name);
  if (parseCache.size > 4000) parseCache.clear();
  parseCache.set(name, out);
  return out;
}
function parse_(name) {
  if (!name) return [];
  const words = name.split(" "), genus = words[0];
  if (!LATIN.test(genus) || COMMON_WORDS.has(genus.toLowerCase()) || genus.length < 3 || normRank(genus) !== null)
    return [[name, false]];
  const out = [[genus[0].toUpperCase() + genus.slice(1).toLowerCase(), true]];
  let expect = true, i = 1;
  while (i < words.length) {
    const w = words[i], rank = normRank(w);
    if (rank !== null) {
      out.push([rank, false]);
      if (ENDS_NAME.has(rank)) { i += 1; break; }
      expect = BEFORE_EPITHET.has(rank); i += 1; continue;
    }
    if (expect && isEpithet(w)) { out.push([w.toLowerCase(), true]); expect = false; i += 1; continue; }
    if (HYBRID_SIGNS.has(w.toLowerCase()) && out.length === 2 && out[1][1]) {
      let j = i + 1;
      if (j < words.length && isGenusAgain(words[j], genus)) j += 1;
      if (j < words.length && isEpithet(words[j]) && !looksLikeStrain(words[j])) {
        const second = words[j].toLowerCase();
        if (second !== out[1][0]) out.push([HYBRID, false], [second, true]);
        i = j + 1; continue;
      }
    }
    break;
  }
  if (i < words.length) out.push([words.slice(i).join(" "), false]);
  return out;
}
export const formatSpecies = (name) => parseSpecies(name).map((p) => p[0]).join(" ");
export function groupKey(name) {
  const parts = parseSpecies(name).map((p) => p[0]);
  if (parts.length >= 4 && parts[2] === HYBRID) {
    const [a, b] = [parts[1], parts[3]].sort();
    parts[1] = a; parts[3] = b;
  }
  return parts.join(" ").toLowerCase();
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export { esc as escapeHtml };
/** Species as HTML with the genus and epithets in <i>. */
export function speciesHtml(name) {
  return parseSpecies(name).map(([t, it]) => (it ? `<i>${esc(t)}</i>` : esc(t))).join(" ");
}

// ---------------------------------------------------------------- culture codes (suggest.py)
const SERIES = /^(.*?)(\d+)$/;
const SEPARATORS = "-._ /";
function seriesOf(codes) {
  const out = new Map();
  codes.forEach((code, i) => {
    const m = SERIES.exec(code.trim());
    if (!m) return;
    const key = m[1].toLowerCase(), s = out.get(key);
    if (!s) out.set(key, { prefix: m[1], highest: +m[2], width: m[2].length, last: i });
    else { s.highest = Math.max(s.highest, +m[2]); s.width = Math.max(s.width, m[2].length); s.last = i; }
  });
  return out;
}
const nextCode = (s) => s.prefix + String(s.highest + 1).padStart(s.width, "0");
/** Next free code in the series `typed` belongs to (BNS-H -> BNS-HEAM-03), or null. */
export function suggestCode(typed, codes) {
  if (!typed.trim()) return null;
  const t = typed.toLowerCase(), taken = new Set(codes.map((c) => c.toLowerCase())), series = seriesOf(codes);
  const fits = [...series.values()].filter((s) => nextCode(s).toLowerCase().startsWith(t) && !taken.has(nextCode(s).toLowerCase()));
  if (fits.length) {
    fits.sort((a, b) => a.prefix.length - b.prefix.length || b.last - a.last);
    return nextCode(fits[0]);
  }
  if (SEPARATORS.includes(typed[typed.length - 1])) {
    const width = typed.endsWith(".") ? 1 : widthLike(typed, series);
    const first = typed + "1".padStart(width, "0");
    return taken.has(first.toLowerCase()) ? null : first;
  }
  return null;
}
function widthLike(typed, series) {
  const t = typed.toLowerCase();
  let best = 2, bestLen = 0;
  for (const s of series.values()) {
    const p = s.prefix.toLowerCase();
    let n = 0;
    while (n < Math.min(p.length, t.length) && p[n] === t[n]) n++;
    if (n > bestLen || (n === bestLen && n && s.width > best)) { best = s.width; bestLen = n; }
  }
  return best;
}
/** Next `count` transfer codes under a parent: PE-001.2 -> PE-001.2.3, PE-001.2.4 … */
export function childCodes(parent, existing, count) {
  const taken = new Set(existing.map((c) => c.toLowerCase())), pre = parent + ".";
  const nums = existing.filter((c) => c.toLowerCase().startsWith(pre.toLowerCase()) && /^\d+$/.test(c.slice(pre.length)))
    .map((c) => +c.slice(pre.length));
  let n = Math.max(0, ...nums) + 1;
  const out = [];
  while (out.length < count) { const code = `${pre}${n}`; if (!taken.has(code.toLowerCase())) out.push(code); n++; }
  return out;
}

// ---------------------------------------------------------------- dataset (stats.py)
export class Dataset {
  /** db: { rows(table, where?, params?, order?) -> [{...}], settings() -> {key: value} } */
  constructor(db) {
    this.db = db;
    const st = db.settings();
    this.settings = st;
    this.tempUnit = (st.temp_unit || "F").toUpperCase() === "C" ? "C" : "F";
    this.tempAdjust = !["0", "", "off", "false"].includes(st.temp_adjust ?? "1");
    const num = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
    this.q10 = Math.max(1, num(st.q10 ?? "2.0", 2));
    this.tref = num(st.tref_c ?? "24", 24);
    this.k = Math.log(this.q10) / 10;

    this.cultures = new Map(db.rows("cultures").map((c) => [c.id, c]));
    this.recipes = new Map(db.rows("recipes").map((r) => [r.id, r]));
    this.runs = new Map(db.rows("sterilizations").map((r) => [r.id, r]));
    this.batches = new Map(db.rows("batches").map((b) => [b.id, b]));
    this.grows = db.rows("grows", "", [], "inoculated, id");
    this.used = new Map();
    const bump = (id, n) => this.used.set(id, (this.used.get(id) || 0) + n);
    for (const g of this.grows) if (g.batch_id) bump(g.batch_id, parseInt(g.units_used || 1));
    for (const c of this.cultures.values()) if (c.batch_id) bump(c.batch_id, 1);
    for (const g of this.grows) this._inherit(g);
    this.spawnedIds = new Set(this.grows.filter((g) => g.spawn_grow_id).map((g) => g.spawn_grow_id));
    this.growById = new Map(this.grows.map((g) => [g.id, g]));
    this.flushes = new Map();
    for (const f of db.rows("flushes", "", [], "grow_id, number, harvested")) {
      if (!this.flushes.has(f.grow_id)) this.flushes.set(f.grow_id, []);
      this.flushes.get(f.grow_id).push(f);
    }
    this.env = new Map();          // key: grow id, or "general"
    for (const e of db.rows("env_logs", "", [], "logged, id")) {
      const d = toDay(e.logged);
      if (d !== null && e.temp_c !== null && e.temp_c !== undefined) {
        const key = e.grow_id ?? "general";
        if (!this.env.has(key)) this.env.set(key, []);
        this.env.get(key).push([d, Number(e.temp_c)]);
      }
    }
    this.priors = db.rows("priors", "", [], "length(keyword) DESC");
    this.root = new Map();
    for (const id of this.cultures.keys()) this._resolve(id);
    this.senescenceT = parseInt(num(st.senescence_t || "6", 6));
    this.tgen = new Map(); this.filial = new Map(); this.crossOf = new Map();
    for (const id of this.cultures.keys()) this._gens(id, new Set());
    this.seg = new Map(); this.segt = new Map(); this.sege = new Map();
    for (const g of this.grows) {
      const [s, t, e] = this._segments(g);
      this.seg.set(g.id, s); this.segt.set(g.id, t); this.sege.set(g.id, e);
    }
    this.scopeCache = new Map();
  }

  _inherit(g) {
    const b = this.batches.get(g.batch_id);
    const units = Math.max(1, parseInt(g.units_used || 1));
    if (!b) {
      Object.assign(g, { recipe_id: null, steril_id: null, container: "", substrate_g: null, cost: null,
        recipe_scale: null, gtype: g.kind || "fruiting" });
      return;
    }
    g.gtype = g.kind || growTypeFor(this.recipes.get(b.recipe_id));
    let good = b.units - (b.discarded || 0);
    if (b.closed) good = this.used.get(b.id) || 0;
    const share = good > 0 ? units / good : units / Math.max(1, b.units);
    Object.assign(g, {
      recipe_id: b.recipe_id, steril_id: b.steril_id, container: b.container || "",
      substrate_g: b.unit_g ? units * b.unit_g : null,
      cost: b.cost !== null && b.cost !== undefined ? b.cost * share : null,
      recipe_scale: b.recipe_scale && b.units ? b.recipe_scale * units / b.units : null,
    });
  }
  unitsLeft(batchId) {
    const b = this.batches.get(batchId);
    if (!b || b.closed) return 0;
    return Math.max(0, (b.units || 0) - (b.discarded || 0) - (this.used.get(batchId) || 0));
  }
  culturesFromBatch(batchId) {
    return [...this.cultures.values()].filter((c) => c.batch_id === batchId).sort((a, b) => cmp(a.name, b.name));
  }
  growsFromBatch(batchId) { return this.grows.filter((g) => g.batch_id === batchId); }
  isSpawn(g) { return g.gtype === "spawn"; }
  spawned(g) { return this.spawnedIds.has(g.id); }
  isActive(g) { return g.outcome === "active" && !(this.isSpawn(g) && this.spawned(g)); }
  staleAfter(batchId) {
    const run = this.runs.get((this.batches.get(batchId) || {}).steril_id);
    return run && (run.method || "").includes("pasteur") ? 3 : 14;
  }
  isMediaBatch(batchId) {
    const b = this.batches.get(batchId), r = b && this.recipes.get(b.recipe_id);
    return !!(r && CULTURE_RECIPE_KINDS.has(r.kind));
  }

  // ---- lineage and generations
  _resolve(cid) {
    const seen = new Set();
    let cur = cid;
    for (;;) {
      seen.add(cur);
      const p = this.cultures.get(cur).parent_id;
      if (p === null || p === undefined || !this.cultures.has(p) || seen.has(p)) break;
      cur = p;
    }
    this.root.set(cid, cur);
  }
  isSpores(cid) { return this.cultures.has(cid) && SPORE_KINDS.has(this.cultures.get(cid).kind); }
  mate(cid) {
    const p2 = this.cultures.get(cid).parent2_id;
    return p2 !== null && p2 !== undefined && this.cultures.has(p2) && p2 !== cid ? p2 : null;
  }
  _gens(cid, visiting) {
    if (this.tgen.has(cid)) return;
    const c = this.cultures.get(cid);
    const p1 = c.parent_id !== null && c.parent_id !== undefined && this.cultures.has(c.parent_id) && c.parent_id !== cid ? c.parent_id : null;
    const p2 = this.mate(cid);
    visiting = new Set(visiting); visiting.add(cid);
    for (const p of [p1, p2]) if (p !== null && !visiting.has(p)) this._gens(p, visiting);
    const spores = SPORE_KINDS.has(c.kind);
    const nn = (v) => (v === undefined ? null : v);
    const getT = (p) => (visiting.has(p) ? null : nn(this.tgen.get(p)));
    const getF = (p) => (visiting.has(p) ? null : nn(this.filial.get(p)));
    const getX = (p) => (visiting.has(p) ? null : nn(this.crossOf.get(p)));
    let t;
    if (c.transfer_gen !== null && c.transfer_gen !== undefined) t = parseInt(c.transfer_gen);
    else if (spores) t = null;
    else if (p2 !== null || p1 === null || this.isSpores(p1) || getT(p1) === null) t = 0;
    else t = getT(p1) + 1;
    let f, cross = null;
    if (c.filial !== null && c.filial !== undefined) { f = parseInt(c.filial); cross = cid; }
    else if (p2 !== null && p1 !== null) {
      const f1 = getF(p1), f2 = getF(p2);
      if (f1 !== null && f1 === f2 && getX(p1) !== null && getX(p1) === getX(p2)) { f = f1; cross = getX(p1); }
      else { f = 0; cross = cid; }
      if (spores) f += 1;
    } else if (p1 !== null && getF(p1) !== null) {
      f = getF(p1); cross = getX(p1);
      if (spores && !this.isSpores(p1)) f += 1;
    } else f = null;
    this.tgen.set(cid, t); this.filial.set(cid, f); this.crossOf.set(cid, cross);
  }
  genLabel(cid) {
    const parts = [];
    if (this.filial.get(cid) !== null && this.filial.get(cid) !== undefined) parts.push(`F${this.filial.get(cid)}`);
    if (this.tgen.get(cid) !== null && this.tgen.get(cid) !== undefined) parts.push(`T${this.tgen.get(cid)}`);
    return parts.join(" · ");
  }
  senescent(cid) { const t = this.tgen.get(cid); return t !== null && t !== undefined && t > this.senescenceT; }
  senescence(liveOnly = true) {
    return [...this.cultures.values()]
      .filter((c) => this.senescent(c.id) && (!liveOnly || c.status === "active" || c.status === "stored"))
      .sort((a, b) => this.tgen.get(b.id) - this.tgen.get(a.id) || cmp(a.name, b.name));
  }
  lineageName(cid) { return this.cultures.get(this.root.get(cid)).name; }
  children(cid) { return [...this.cultures.values()].filter((c) => c.parent_id === cid).sort((a, b) => cmp(a.name, b.name)); }

  // ---- temperatures
  static _latest(s, d) {
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid][0] <= d) lo = mid + 1; else hi = mid; }
    return lo ? s[lo - 1] : null;
  }
  tempOn(gid, d) {
    let r = gid !== null && gid !== undefined ? Dataset._latest(this.env.get(gid) || [], d) : null;
    if (r === null) r = Dataset._latest(this.env.get("general") || [], d);
    return r ? [r[1], r[0]] : null;
  }
  windowTemp(gid, start, end) {
    if (start === null || end === null || (!this.env.has(gid) && !this.env.has("general"))) return null;
    const days = Math.max(1, end - start), vals = [];
    for (let n = 0; n < days; n++) { const r = this.tempOn(gid, start + n); if (r !== null) vals.push(r[0]); }
    if (vals.length < MIN_COVERAGE * days || !vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  currentTemp(g, day) { const r = this.tempOn(g.id, day ?? today()); return r ? r : [null, null]; }
  _factor(temp) {
    if (temp === null || temp === undefined || !this.tempAdjust) return 1;
    temp = Math.min(Math.max(temp, TEMP_RANGE_C[0]), TEMP_RANGE_C[1]);
    return Math.exp(-this.k * (temp - this.tref));
  }

  // ---- per-grow segments
  flushesOf(gid) { return this.flushes.get(gid) || []; }
  firstHarvest(gid) {
    const ds = this.flushesOf(gid).map((f) => toDay(f.harvested)).filter((d) => d !== null);
    return ds.length ? Math.min(...ds) : null;
  }
  _segments(g) {
    const s = {}, t = {}, e = {};
    const push = (name, v, tt, end) => { (s[name] ||= []).push(v); (t[name] ||= []).push(tt); (e[name] ||= []).push(end); };
    const inoc = toDay(g.inoculated), col = toDay(g.colonized), pin = toDay(g.pinned), h1 = this.firstHarvest(g.id);
    const add = (name, a, z) => { if (a !== null && z !== null && z >= a) push(name, z - a, this.windowTemp(g.id, a, z), z); };
    add("col", inoc, col); add("pin", col, pin); add("harv", pin, h1); add("fruit", col, h1); add("total", inoc, h1);
    const dates = this.flushesOf(g.id).map((f) => toDay(f.harvested)).filter((d) => d !== null).sort((a, b) => a - b);
    for (let i = 1; i < dates.length; i++) {
      const gap = dates[i] - dates[i - 1], tt = this.windowTemp(g.id, dates[i - 1], dates[i]);
      for (const name of ["gap", `gap:${i}`]) push(name, gap, tt, dates[i]);
    }
    return [s, t, e];
  }

  // ---- priors
  prior(species, seg) {
    const sp = String(species || "").toLowerCase();
    let best = null, bestEnd = -1, bestLen = -1;
    for (const p of this.priors) {
      const m = new RegExp(`\\b${p.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).exec(sp);
      if (m) {
        const end = m.index + m[0].length, len = p.keyword.length;
        if (end > bestEnd || (end === bestEnd && len > bestLen)) { best = p; bestEnd = end; bestLen = len; }
      }
    }
    if (!best) return null;
    const base = seg.split(":")[0];
    const v = { col: best.col, pin: best.pin, harv: best.harv, gap: best.gap, fruit: best.pin + best.harv,
      total: best.col + best.pin + best.harv };
    return base in v ? v[base] : null;
  }

  // ---- grouping
  scopes(g) {
    const key = `${g.culture_id}|${g.recipe_id}|${g.gtype}`;
    if (!this.scopeCache.has(key)) this.scopeCache.set(key, this._scopes(g));
    return this.scopeCache.get(key);
  }
  _scopes(g) {
    const c = this.cultures.get(g.culture_id), root = this.root.get(c.id), sp = groupKey(c.species || "");
    const rid = g.recipe_id, rname = this.recipes.has(rid) ? this.recipes.get(rid).name : null, gtype = g.gtype;
    const grp = (label, pred) => ({ label, ids: this.grows.filter((x) => x.gtype === gtype && pred(x)).map((x) => x.id), vals: new Map() });
    const sameCulture = (x) => x.culture_id === c.id;
    const sameLineage = (x) => this.root.get(x.culture_id) === root;
    const sameSpecies = (x) => !!sp && groupKey(this.cultures.get(x.culture_id).species || "") === sp;
    const sameRecipe = (x) => rid !== null && rid !== undefined && x.recipe_id === rid;
    const hasRecipe = rid !== null && rid !== undefined;
    const rootName = this.cultures.get(root).name, out = [];
    if (hasRecipe) out.push(grp(`${c.name} on ${rname}`, (x) => sameCulture(x) && sameRecipe(x)));
    out.push(grp(`${c.name}`, sameCulture));
    if (hasRecipe) out.push(grp(`lineage ${rootName} on ${rname}`, (x) => sameLineage(x) && sameRecipe(x)));
    out.push(grp(`lineage ${rootName}`, sameLineage));
    if (sp) {
      if (hasRecipe) out.push(grp(`${c.species} on ${rname}`, (x) => sameSpecies(x) && sameRecipe(x)));
      out.push(grp(`${c.species} (all)`, sameSpecies));
    }
    return out;
  }
  _values(group, seg, normalise, asof = null) {
    if (!group.vals.has(seg)) {
      const rows = [];
      for (const gid of group.ids) {
        const s = this.seg.get(gid)[seg] || [], t = this.segt.get(gid)[seg] || [], e = this.sege.get(gid)[seg] || [];
        for (let i = 0; i < s.length; i++) rows.push([e[i], s[i] / this._factor(t[i]), s[i]]);
      }
      rows.sort((a, b) => a[0] - b[0]);
      group.vals.set(seg, [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2])]);
    }
    const [ends, norm, raw] = group.vals.get(seg);
    const k = asof === null ? ends.length : bisectRight(ends, asof);
    return (normalise ? norm : raw).slice(0, k);
  }
  estimate(g, seg, temp = null) {
    const c = this.cultures.get(g.culture_id), prior = this.prior(c.species, seg);
    const names = seg.startsWith("gap:") ? [seg, "gap"] : [seg];
    const normalise = temp !== null && this.tempAdjust;
    const cands = [];
    for (const name of names) for (const grp of this.scopes(g)) {
      const v = this._values(grp, name, normalise);
      if (v.length) cands.push([name === seg ? grp.label : `${grp.label}, all flushes`, v]);
    }
    let chosen = cands.find((cv) => cv[1].length >= MIN_N) || null;
    if (chosen === null && cands.length) chosen = cands.reduce((a, b) => (b[1].length > a[1].length ? b : a));
    const f = this._factor(temp), adjT = temp !== null && this.tempAdjust ? temp : null;
    if (chosen === null) {
      if (prior === null) return null;
      return { mean: prior * f, sd: Math.max(1, prior * 0.25 * f), n: 0, basis: "built-in species default", prior: true, temp: adjT };
    }
    let [label, vals] = chosen;
    const n = vals.length;
    let mean = median(vals), sd = stdev(vals);
    if (sd === null) sd = 0.25 * mean;
    sd = Math.max(sd, 0.1 * mean, 1);
    let priorUsed = false;
    if (n < MIN_N && prior !== null) {
      mean = (n * mean + PRIOR_WEIGHT * prior) / (n + PRIOR_WEIGHT);
      sd = Math.max(sd, 0.2 * mean);
      priorUsed = true;
      label += " + species default";
    }
    return { mean: mean * f, sd: Math.max(1, sd * f), n, basis: label, prior: priorUsed, temp: adjT };
  }
  static confidence(n) { return n >= 8 ? "high" : n >= MIN_N ? "medium" : "low"; }

  // ---- prediction
  predict(g, day = today()) {
    const inoc = toDay(g.inoculated), col = toDay(g.colonized), pin = toDay(g.pinned);
    const fl = this.flushesOf(g.id).map((f) => toDay(f.harvested)).filter((d) => d !== null).sort((a, b) => a - b);
    const out = [];
    const [curT, curD] = this.currentTemp(g, day);
    const fruitT = col !== null && curD !== null && curD >= col ? curT : null, colT = curT;
    const milestone = (name, anchor, segs) => {
      const ests = segs.map(([s, tmp]) => this.estimate(g, s, tmp));
      if (ests.some((e) => e === null)) return;
      const mean = ests.reduce((a, e) => a + e.mean, 0), sd = Math.sqrt(ests.reduce((a, e) => a + e.sd ** 2, 0));
      const n = Math.min(...ests.map((e) => e.n));
      const worst = ests.reduce((a, b) => (b.n < a.n ? b : a));
      const eta = anchor + pyRound(mean);
      const temps = ests.map((e) => e.temp).filter((t) => t !== null);
      out.push({ name, eta, lo: anchor + pyRound(Math.max(0, mean - sd)), hi: anchor + pyRound(mean + sd), n,
        basis: worst.basis, confidence: Dataset.confidence(worst.n), late: Math.max(0, day - eta),
        temp: temps.length ? temps[0] : null });
    };
    if (this.isSpawn(g)) { if (inoc !== null && col === null) milestone("Colonized", inoc, [["col", colT]]); }
    else if (fl.length) milestone(`Flush ${fl.length + 1}`, fl[fl.length - 1], [[`gap:${fl.length}`, fruitT]]);
    else if (pin !== null) milestone("First harvest", pin, [["harv", fruitT]]);
    else if (col !== null) { milestone("Pins", col, [["pin", fruitT]]); milestone("First harvest", col, [["fruit", fruitT]]); }
    else if (inoc !== null) { milestone("Colonized", inoc, [["col", colT]]); milestone("First harvest", inoc, [["col", colT], ["fruit", null]]); }
    return out.map((m, i) => [m, i]).sort((a, b) => a[0].eta - b[0].eta || a[1] - b[1]).map((x) => x[0]);
  }
  stage(g) {
    if (g.outcome === "contaminated") return "contaminated";
    if (g.outcome === "abandoned") return "abandoned";
    if (this.isSpawn(g)) {
      if (this.spawned(g)) return "spawned";
      if (g.outcome === "finished") return "finished";
      if (g.colonized) return "colonized";
      return g.inoculated ? "incubating" : "planned";
    }
    if (g.outcome === "finished") return "finished";
    if (this.flushesOf(g.id).length) return "fruiting";
    if (g.pinned) return "pinning";
    if (g.colonized) return "colonized";
    if (g.inoculated) return "incubating";
    return "planned";
  }
  wetTotal(gid) { return this.flushesOf(gid).reduce((a, f) => a + (f.wet_g || 0), 0); }
  dashboardPredictions(day = today()) {
    const out = [];
    for (const g of this.grows) {
      if (!this.isActive(g)) continue;
      const ms = this.predict(g, day);
      if (ms.length) out.push([g, ms[0]]);
    }
    return out.map((x, i) => [x, i]).sort((a, b) => a[0][1].eta - b[0][1].eta || a[1] - b[1]).map((x) => x[0]);
  }

  // ---- culture upkeep
  lastUsed(cid) {
    const ds = [toDay(this.cultures.get(cid).created)];
    for (const c of this.cultures.values()) if (c.parent_id === cid) ds.push(toDay(c.created));
    for (const g of this.grows) if (g.culture_id === cid) ds.push(toDay(g.inoculated));
    const ok = ds.filter((d) => d !== null);
    return ok.length ? Math.max(...ok) : null;
  }
  transferInterval(c) {
    let v = parseInt(c.transfer_days || TRANSFER_DAYS[c.kind] || 90);
    if (!Number.isFinite(v)) v = TRANSFER_DAYS[c.kind] || 90;
    return Math.min(Math.max(v, 1), 36500);
  }
  attention(day = today(), window = ATTENTION_WINDOW) {
    const out = [];
    for (const c of this.cultures.values()) {
      if (c.status !== "active" && c.status !== "stored") continue;
      const last = this.lastUsed(c.id);
      if (last === null) continue;
      const every = this.transferInterval(c), due = last + every, left = due - day;
      if (left <= window) out.push({ culture: c, last, every, due, left });
    }
    return out.map((x, i) => [x, i]).sort((a, b) => a[0].due - b[0].due || a[1] - b[1]).map((x) => x[0]);
  }
  transferDue(cid, day = today()) {
    const c = this.cultures.get(cid), last = this.lastUsed(cid);
    if (last === null) return null;
    const every = this.transferInterval(c);
    return { last, every, due: last + every, left: last + every - day };
  }

  // ---- species groups (like the desktop Cultures tab)
  speciesGroups() {
    const by = new Map(), spelled = new Map();
    for (const c of [...this.cultures.values()].sort((a, b) => cmp(a.name, b.name))) {
      const sp = (c.species || "").trim(), key = groupKey(sp) || "￿";
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(c);
      if (!spelled.has(key)) spelled.set(key, sp || "(no species)");
    }
    return [...by.keys()].sort(cmp).map((k) => ({ species: spelled.get(k), cultures: by.get(k) }));
  }
  /** Members as a tree: each root, then its transfers beneath it (depth-first, by name). */
  lineageOrder(members) {
    const ids = new Set(members.map((c) => c.id)), kids = new Map(), out = [], seen = new Set();
    for (const c of members) if (ids.has(c.parent_id)) { if (!kids.has(c.parent_id)) kids.set(c.parent_id, []); kids.get(c.parent_id).push(c); }
    const walk = (c, level) => {
      if (seen.has(c.id)) return;
      seen.add(c.id); out.push([c, level]);
      for (const k of (kids.get(c.id) || []).sort((a, b) => cmp(a.name, b.name))) walk(k, level + 1);
    };
    for (const c of members.filter((c) => !ids.has(c.parent_id)).sort((a, b) => cmp(a.name, b.name))) walk(c, 0);
    for (const c of members) walk(c, 0);
    return out;
  }
}

/** Code-point string comparison, like Python's sort. */
export function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
