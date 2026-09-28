/**
 * Helpers that turn Navitia's verbose responses into compact structures an
 * LLM can read without flooding its context window. Anything not listed here
 * (HATEOAS links, geojson geometries, deep co2/fare details) is dropped on
 * purpose.
 */

/** "2026-06-11T17:58:00+02:00" or "2026-06-11" -> "20260611T175800" */
export function toNavitiaDt(iso?: string): string | undefined {
  if (!iso) return undefined;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    throw new Error(`Invalid datetime "${iso}". Use ISO 8601, e.g. 2026-06-11T17:58:00`);
  }
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
  return `${y}${mo}${d}T${h}${mi}${s}`;
}

/**
 * The API's current time, in the coverage region's local timezone. Emitted as
 * `now` on every time-sensitive response so countdowns ("dans 3 min") are
 * computed against the region's clock rather than the reader's, which may sit
 * in a different timezone.
 */
function contextNow(data: any): string | undefined {
  return fromNavitiaDt(data?.context?.current_datetime);
}

/** "20260611T175800" -> "2026-06-11T17:58:00" */
export function fromNavitiaDt(dt?: string): string | undefined {
  if (!dt || dt.length < 15) return dt;
  return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}`;
}

export function formatDuration(seconds?: number): string | undefined {
  if (seconds === undefined || seconds === null) return undefined;
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
}

/** Drop undefined/null/empty values so the JSON sent to the model stays small. */
export function clean<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Navitia line colour "FFCD00" -> "#FFCD00"; anything else is dropped. */
function hexColor(value?: string): string | undefined {
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toUpperCase()}` : undefined;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function fromCodePoint(code: number): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/**
 * Disruption messages sometimes arrive as HTML (<p>, <br>, <a>, numeric
 * entities). Flatten them to plain text: neither a model nor a UI rendering
 * text should see the markup.
 */
export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => HTML_ENTITIES[name])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function coord(c?: { lon?: string; lat?: string }): string | undefined {
  return c?.lon && c?.lat ? `${c.lon};${c.lat}` : undefined;
}

function cityOf(obj: any): string | undefined {
  const admins = obj?.administrative_regions ?? obj?.stop_area?.administrative_regions;
  const city = admins?.find((a: any) => a.level === 8) ?? admins?.[0];
  return city?.name;
}

// --- places ---------------------------------------------------------------

export function formatPlace(p: any) {
  const inner = p[p.embedded_type] ?? p;
  return clean({
    id: p.id,
    name: p.name,
    type: p.embedded_type,
    coord: coord(inner?.coord),
    city: cityOf(inner),
    distance: p.distance ? `${p.distance}m` : undefined,
  });
}

export function formatPlaces(data: any) {
  const places = data?.places ?? data?.places_nearby ?? [];
  if (places.length === 0) return { message: "No places found." };
  return { places: places.map(formatPlace) };
}

// --- pt_objects (networks / lines / routes / stops by name) ------------------

export function formatPtObjects(data: any) {
  const objects = data?.pt_objects ?? [];
  if (objects.length === 0) return { message: "No public transport objects found." };
  return {
    pt_objects: objects.map((o: any) => {
      const inner = o[o.embedded_type] ?? {};
      return clean({
        id: o.id,
        name: o.name,
        type: o.embedded_type,
        code: inner.code, // e.g. "14" for metro line 14
        network: inner.network?.name,
        mode: inner.commercial_mode?.name,
        direction: inner.direction?.name, // for routes
        physical_modes: (inner.physical_modes ?? []).map((m: any) => m.name),
      });
    }),
  };
}

// --- journeys ---------------------------------------------------------------

function formatSection(s: any) {
  const di = s.display_informations;
  return clean({
    // `mode` is the only field naming what a section is, so it has to cover
    // the kinds Navitia leaves without one: transfer (it carries
    // `transfer_type` instead), waiting, park, bss_rent/bss_put_back. Falling
    // back to the section type keeps every section identifiable.
    mode: s.mode ?? di?.commercial_mode ?? s.type,
    line: di?.code ?? di?.name,
    network: di?.network,
    // The line's own badge colours, for clients that draw it.
    color: hexColor(di?.color),
    text_color: hexColor(di?.text_color),
    direction: di?.direction,
    from: s.from?.name,
    to: s.to?.name,
    stops: s.stop_date_times?.length ? s.stop_date_times.length - 1 : undefined,
    departure: fromNavitiaDt(s.departure_date_time),
    arrival: fromNavitiaDt(s.arrival_date_time),
    duration: formatDuration(s.duration),
    realtime: s.data_freshness === "realtime" ? true : undefined,
  });
}

/**
 * Criteria of the `criteria_ranker` object Navitia attaches to each journey.
 * Each value is that journey's 1-based rank for the criterion — 1 is the best —
 * so re-ordering the list means sorting on one key, never recomputing anything.
 */
export type RankCriterion = "asap" | "less_transfers" | "less_walking" | "reliability";

function rankOf(journey: any, criterion: RankCriterion): number {
  const rank = journey?.criteria_ranker?.[criterion];
  // A journey the API did not rank sorts after every ranked one.
  return typeof rank === "number" ? rank : Number.MAX_SAFE_INTEGER;
}

export function formatJourneys(data: any, opts: { rankBy?: RankCriterion } = {}) {
  if (data?.error) {
    return { error: data.error.message ?? data.error.id };
  }
  const raw: any[] = data?.journeys ?? [];
  // sort() is stable, so journeys tied on the criterion — or missing a ranker
  // entirely — keep the order the API returned them in.
  const ordered = opts.rankBy
    ? [...raw].sort((a, b) => rankOf(a, opts.rankBy!) - rankOf(b, opts.rankBy!))
    : raw;
  const journeys = ordered.map((j: any) =>
    clean({
      departure: fromNavitiaDt(j.departure_date_time),
      arrival: fromNavitiaDt(j.arrival_date_time),
      duration: formatDuration(j.duration),
      transfers: j.nb_transfers,
      walking: formatDuration(j.durations?.walking),
      type: j.type, // best, rapid, comfort...
      status: j.status || undefined, // disruption flag e.g. SIGNIFICANT_DELAYS
      co2_g: j.co2_emission?.value ? Math.round(j.co2_emission.value) : undefined,
      criteria_ranker: j.criteria_ranker, // 1-based rank per criterion, see RankCriterion
      sections: (j.sections ?? [])
        .filter((s: any) => !(s.type === "waiting" && (s.duration ?? 0) < 60))
        .map(formatSection),
    }),
  );
  if (journeys.length === 0) return { message: "No journeys found." };
  // Navitia repeats a disruption once per impacted object, so one request can
  // carry dozens of identical entries: keep each distinct one once.
  const seen = new Set<string>();
  const disruptions = [];
  for (const d of data?.disruptions ?? []) {
    const messages: string[] = (d.messages ?? [])
      .map((m: any) => (m.text ? stripHtml(m.text) : ""))
      .filter(Boolean)
      .slice(0, 2);
    const key = JSON.stringify([d.severity?.name, d.cause, [...messages].sort()]);
    if (seen.has(key)) continue;
    seen.add(key);
    disruptions.push(clean({ severity: d.severity?.name, cause: d.cause, messages }));
  }
  return clean({ now: contextNow(data), ordered_by: opts.rankBy, journeys, disruptions });
}

// --- departures / arrivals ---------------------------------------------------

export function formatDepartures(data: any, kind: "departures" | "arrivals") {
  const rows = data?.[kind] ?? [];
  if (rows.length === 0) return { message: `No ${kind} found.` };
  return {
    now: contextNow(data),
    [kind]: rows.map((d: any) => {
      const di = d.display_informations;
      const sdt = d.stop_date_time;
      const timeKey = kind === "departures" ? "departure_date_time" : "arrival_date_time";
      const time = fromNavitiaDt(sdt?.[timeKey]);
      const base = fromNavitiaDt(sdt?.[`base_${timeKey}`]);
      return clean({
        line: di?.code ?? di?.name,
        mode: di?.commercial_mode,
        network: di?.network,
        direction: di?.direction,
        stop: d.stop_point?.name,
        time,
        scheduled: base !== time ? base : undefined,
        realtime: sdt?.data_freshness === "realtime" ? true : undefined,
      });
    }),
  };
}

// --- schedules ----------------------------------------------------------------

export function formatStopSchedules(data: any, key: "stop_schedules" | "terminus_schedules") {
  const schedules = data?.[key] ?? [];
  if (schedules.length === 0) return { message: "No schedules found." };
  return {
    now: contextNow(data),
    schedules: schedules.map((s: any) => {
      const di = s.display_informations;
      return clean({
        stop: s.stop_point?.name,
        line: di?.code ?? di?.name,
        mode: di?.commercial_mode,
        network: di?.network,
        direction: di?.direction,
        times: (s.date_times ?? []).map((dt: any) => fromNavitiaDt(dt.date_time)),
        note:
          (s.date_times ?? []).length === 0
            ? (s.additional_informations ?? "no upcoming service")
            : undefined,
      });
    }),
  };
}

export function formatRouteSchedules(data: any) {
  const schedules = data?.route_schedules ?? [];
  if (schedules.length === 0) return { message: "No route schedules found." };
  return {
    now: contextNow(data),
    route_schedules: schedules.map((rs: any) => {
      const di = rs.display_informations;
      return clean({
        line: di?.code ?? di?.name,
        mode: di?.commercial_mode,
        network: di?.network,
        direction: di?.direction,
        trips: (rs.table?.headers ?? []).map((h: any) => h.display_informations?.headsign ?? null),
        stops: (rs.table?.rows ?? []).map((row: any) =>
          clean({
            stop: row.stop_point?.name,
            // null (not dropped) for stops this trip skips: the grid is
            // column-aligned, so a missing time must keep its slot.
            times: (row.date_times ?? []).map((dt: any) => fromNavitiaDt(dt.date_time) || null),
          }),
        ),
      });
    }),
  };
}
