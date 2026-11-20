// Two modes:
//  - Default (GitHub Pages, no server): read the generated JSON files in /data and do the same
//    lookups the Python API does.
//  - If VITE_API_URL is set at build time: call the live FastAPI server instead.

const REMOTE = import.meta.env.VITE_API_URL || "";
const LEVELS = ["Low", "Watch", "High", "Unknown"];

async function getRemote(path) {
  const res = await fetch(`${REMOTE}${path}`);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

const files = {};
function load(name) {
  if (!files[name]) {
    files[name] = fetch(`${import.meta.env.BASE_URL}data/${name}`).then((res) => {
      if (!res.ok) throw new Error(`${name} could not be loaded (${res.status})`);
      return res.json();
    });
    files[name].catch(() => { delete files[name]; });
  }
  return files[name];
}

let dailyIndex = null;
async function daily() {
  const d = await load("daily_risk.json");
  if (!dailyIndex) dailyIndex = new Map(d.dates.map((x, i) => [x, i]));
  return d;
}

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

async function resolve(date) {
  const d = await daily();
  const iso = date || d.dates[d.dates.length - 1];
  if (!dailyIndex.has(iso)) {
    throw new Error(`No data for ${iso}. Range: ${d.dates[0]} to ${d.dates[d.dates.length - 1]}`);
  }
  return { d, i: dailyIndex.get(iso), iso };
}

function zoneDay(d, zid, i, iso) {
  const z = d.zones[zid];
  if (!z) throw new Error(`Unknown zone ${zid}`);
  const nd = z.ndci_date[i];
  const age = nd ? Math.round((dayMs(iso) - dayMs(nd)) / 86400000) : null;
  return {
    date: iso, level: z.level[i], ndci: z.ndci[i], ndci_date: nd, ndci_age_days: age,
    temp_3d: z.temp_3d[i], wind_3d: z.wind_3d[i],
    signals: { algae_high: z.algae_high[i], warm: z.warm[i], calm: z.calm[i] },
    thresholds: d.meta.thresholds[zid] ?? null,
  };
}

const local = {
  async meta() {
    const d = await daily();
    return {
      as_of: d.meta.as_of, first_date: d.dates[0], last_date: d.dates[d.dates.length - 1],
      rule: d.meta.rule, levels: LEVELS, generated_at: d.meta.generated_at,
    };
  },
  async map(date) {
    const { d, i, iso } = await resolve(date);
    const zones = await load("zones.json");
    const features = zones.features.map((f) => ({
      ...f, properties: { ...f.properties, ...zoneDay(d, f.properties.zone_id, i, iso) },
    }));
    return { type: "FeatureCollection", date: iso, as_of: d.meta.as_of, features };
  },
  async zone(id, date) {
    const { d, i, iso } = await resolve(date);
    const zones = await load("zones.json");
    const info = zones.features.find((f) => f.properties.zone_id === id)?.properties;
    if (!info) throw new Error(`Unknown zone ${id}`);
    return { ...info, ...zoneDay(d, id, i, iso) };
  },
  async series(id) {
    const d = await daily();
    const z = d.zones[id];
    if (!z) throw new Error(`Unknown zone ${id}`);
    const ndci_observations = [];
    const levels = [];
    d.dates.forEach((date, k) => {
      if (z.ndci_date[k] === date) ndci_observations.push({ date, ndci: z.ndci[k] });
      levels.push({ date, level: z.level[k] });
    });
    let all = [];
    try { all = await load("events.json"); } catch { /* chart simply has no fish-kill markers */ }
    const events = all.filter((e) => e.zone_id === id && e.date);
    return {
      zone_id: id, ndci_observations, levels, events,
      ndci_threshold: d.meta.thresholds[id]?.ndci_p80 ?? null,
    };
  },
  events: () => load("events.json"),
  backtest: () => load("backtest.json"),
  forecast: () => load("forecast.json"),
  cards: () => load("response_cards.json"),
};

const remote = {
  meta: () => getRemote("/api/meta"),
  map: (date) => getRemote(`/api/map${date ? `?date=${date}` : ""}`),
  zone: (id, date) => getRemote(`/api/zones/${id}?date=${date}`),
  series: (id) => getRemote(`/api/zones/${id}/series`),
  events: () => getRemote("/api/events"),
  backtest: () => getRemote("/api/backtest"),
  forecast: () => getRemote("/api/forecast"),
  cards: () => getRemote("/api/response-cards"),
};

export const api = REMOTE ? remote : local;
