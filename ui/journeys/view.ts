/**
 * Turns a plan_journey result (the slim JSON built by src/format.ts) into what
 * the journeys view draws. Pure data in, pure data out: no DOM here.
 */

export interface Section {
  mode?: string;
  line?: string;
  network?: string;
  color?: string;
  text_color?: string;
  direction?: string;
  from?: string;
  to?: string;
  stops?: number;
  departure?: string;
  arrival?: string;
  duration?: string;
  realtime?: boolean;
}

export interface Journey {
  departure?: string;
  arrival?: string;
  duration?: string;
  transfers?: number;
  walking?: string;
  type?: string;
  sections?: Section[];
}

export interface Disruption {
  severity?: string;
  cause?: string;
  messages?: string[];
}

export interface JourneysPayload {
  now?: string;
  ordered_by?: string;
  journeys?: Journey[];
  disruptions?: Disruption[];
  message?: string;
  error?: string;
}

/** The plan_journey arguments the view cares about, from the tool-input notification. */
export interface ToolArgs {
  datetime?: string;
  datetime_represents?: "departure" | "arrival";
}

export type Icon = "train" | "metro" | "tram" | "bus" | "boat" | "cable" | "transit" | "walk" | "bike" | "car";

export interface Badge {
  code: string;
  /** Spoken name, e.g. "RER B". */
  label: string;
  icon: Icon;
  /** Line colours; both undefined when the line has none (drawn outlined). */
  background?: string;
  color?: string;
  /** Colour of the leg in the step timeline. */
  rail: string;
}

export type Step =
  | { kind: "ride"; time: string; badge: Badge; title: string; direction?: string }
  | { kind: "move"; time: string; title: string }
  | { kind: "arrival"; time: string; title: string };

export interface Row {
  id: string;
  duration: string;
  times: string;
  badges: Badge[];
  /** Set instead of badges for a journey without public transport. */
  moveOnly?: { icon: Icon; label: string };
  recommended: boolean;
  summary: string;
  steps: Step[];
}

export interface DisruptionGroup {
  label: string;
  count: number;
  severe: boolean;
}

export type View =
  | { kind: "loading" }
  | { kind: "empty"; text: string }
  | { kind: "error"; text: string }
  | {
      kind: "journeys";
      from: string;
      to: string;
      subtitle: string;
      rows: Row[];
      disruptions: { total: number; label: string; groups: DisruptionGroup[] };
    };

// --- formatting -------------------------------------------------------------

/** "Robinson (Sceaux)" -> "Robinson": only the final parenthesised group goes. */
export function cleanName(name = ""): string {
  return name.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/** "35min" -> "35 min", "3h04" -> "3 h 04". */
export function spaceDuration(value = ""): string {
  return value.replace(/^(\d+)h(\d+)$/, "$1 h $2").replace(/^(-?\d+)(min|s)$/, "$1 $2");
}

function isSubMinute(duration?: string): boolean {
  return !duration || /^-?\d+s$/.test(duration);
}

const hhmm = (iso = "") => iso.slice(11, 16);
const dayOf = (iso = "") => iso.slice(0, 10);

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** "HH:MM", suffixed "+1" when it falls on a later day than `refDay`. */
function timeOn(iso: string | undefined, refDay: string): string {
  if (!iso) return "";
  const shift = refDay ? dayNumber(dayOf(iso)) - dayNumber(refDay) : 0;
  return shift > 0 ? `${hhmm(iso)}+${shift}` : hhmm(iso);
}

/** Seconds between two local ISO datetimes of the same region. */
function secondsBetween(from?: string, to?: string): number {
  if (!from || !to) return 0;
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

function frenchDay(iso: string): string {
  const [y, m, d] = dayOf(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

// --- lines --------------------------------------------------------------------

const INK = "#002830";
const WHITE = "#FFFFFF";
const NEUTRAL_RAIL = "#7C7369";

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const isHex = (value?: string): value is string => !!value && /^#[0-9A-F]{6}$/i.test(value);

function iconFor(mode = ""): Icon {
  if (/m[ée]tro|subway/i.test(mode)) return "metro";
  if (/tram/i.test(mode)) return "tram";
  if (/bus|noctilien|autocar|coach/i.test(mode)) return "bus";
  if (/rer|train|transilien|\bter\b|intercit|tgv|rail/i.test(mode)) return "train";
  if (/boat|ferry|bateau|fluvial/i.test(mode)) return "boat";
  if (/funicul|cable|t[ée]l[ée]ph[ée]rique/i.test(mode)) return "cable";
  return "transit";
}

function badgeFor(s: Section): Badge {
  const code = s.line ?? "";
  const label = [s.mode, code].filter(Boolean).join(" ");
  if (!isHex(s.color)) return { code, label, icon: iconFor(s.mode), rail: NEUTRAL_RAIL };
  // Keep the network's text colour unless it is unreadable on the badge.
  let color = isHex(s.text_color) ? s.text_color : undefined;
  if (!color || contrast(s.color, color) < 4.5) {
    color = contrast(s.color, INK) >= contrast(s.color, WHITE) ? INK : WHITE;
  }
  return { code, label, icon: iconFor(s.mode), background: s.color, color, rail: s.color };
}

// --- journeys ---------------------------------------------------------------

const MOVES: Record<string, { icon: Icon; step: string; only: string }> = {
  walking: { icon: "walk", step: "Marche", only: "À pied" },
  bike: { icon: "bike", step: "Vélo", only: "À vélo" },
  bss: { icon: "bike", step: "Vélo en libre-service", only: "Vélo en libre-service" },
  car: { icon: "car", step: "Voiture", only: "En voiture" },
  taxi: { icon: "car", step: "Taxi", only: "En taxi" },
  ridesharing: { icon: "car", step: "Covoiturage", only: "En covoiturage" },
};

const isRide = (s: Section) => !!s.line;
const isMove = (s: Section) => !s.line && Object.hasOwn(MOVES, s.mode ?? "");

/**
 * Legs worth showing: rides and moves of a minute or more. Waiting, transfers
 * and the sub-minute hops Navitia emits between a station and its platforms
 * are left to the connection itself.
 */
function shownSections(j: Journey): Section[] {
  return (j.sections ?? []).filter((s) => (isRide(s) || isMove(s)) && !isSubMinute(s.duration));
}

/** A journey with a leg that ends before it starts is a routing artefact. */
function isCoherent(j: Journey): boolean {
  return (j.sections ?? []).every((s) => secondsBetween(s.departure, s.arrival) >= 0);
}

/**
 * The journeys worth a row. Incoherent ones go; a journey without public
 * transport goes too when it takes more than twice the quickest one that has
 * some (a 3 h walk next to a 35 min metro is noise, a 20 min walk is not).
 */
function keptJourneys(journeys: Journey[]): Journey[] {
  const coherent = journeys.filter(isCoherent);
  const transit = coherent.filter((j) => (j.sections ?? []).some(isRide));
  if (transit.length === 0) return coherent;
  const quickest = Math.min(...transit.map((j) => secondsBetween(j.departure, j.arrival)));
  return coherent.filter(
    (j) => transit.includes(j) || secondsBetween(j.departure, j.arrival) <= 2 * quickest,
  );
}

function summaryOf(j: Journey, rides: Section[]): string {
  if (rides.length === 0) return "";
  const transfers = j.transfers ?? Math.max(rides.length - 1, 0);
  const parts = [transfers === 0 ? "direct" : transfers === 1 ? "1 correspondance" : `${transfers} correspondances`];
  if (!isSubMinute(j.walking)) parts.push(`${spaceDuration(j.walking)} à pied`);
  return parts.join(" · ");
}

function rowOf(j: Journey, index: number, refDay: string): Row {
  const legs = shownSections(j);
  const rides = legs.filter(isRide);
  const last = (j.sections ?? []).at(-1);
  const steps: Step[] = legs.map((s): Step => {
    if (isRide(s)) {
      return {
        kind: "ride",
        time: timeOn(s.departure, refDay),
        badge: badgeFor(s),
        title: `${cleanName(s.from)} → ${cleanName(s.to)}`,
        direction: s.direction ? cleanName(s.direction) : undefined,
      };
    }
    return { kind: "move", time: timeOn(s.departure, refDay), title: `${MOVES[s.mode!].step} ${spaceDuration(s.duration)}` };
  });
  steps.push({ kind: "arrival", time: timeOn(j.arrival, refDay), title: `Arrivée · ${cleanName(last?.to)}` });
  const move = rides.length === 0 ? MOVES[legs[0]?.mode ?? "walking"] ?? MOVES.walking : undefined;
  return {
    id: `j${index}`,
    duration: spaceDuration(j.duration),
    times: `${timeOn(j.departure, refDay)} → ${timeOn(j.arrival, refDay)}`,
    badges: rides.map(badgeFor),
    moveOnly: move && { icon: move.icon, label: move.only },
    recommended: j.type === "best",
    summary: summaryOf(j, rides),
    steps,
  };
}

function subtitleOf(payload: JourneysPayload, args: ToolArgs, kept: Journey[]): string {
  const asked = args.datetime && /T\d{2}:\d{2}/.test(args.datetime) ? args.datetime : undefined;
  const moment = asked ?? payload.now ?? kept[0]?.departure ?? "";
  const verb = asked && args.datetime_represents === "arrival" ? "Arrivée avant" : "Départ";
  const day = payload.now && dayOf(moment) !== dayOf(payload.now) ? `${frenchDay(moment)} · ` : "";
  const live = kept.some((j) => (j.sections ?? []).some((s) => s.realtime));
  const parts = [`${day}${verb} ${hhmm(moment)}`, live ? "temps réel" : "horaires théoriques"];
  if (payload.ordered_by === "reliability") parts.push("classé par fiabilité");
  return parts.join(" · ");
}

function disruptionsOf(list: Disruption[] = []) {
  const groups = new Map<string, DisruptionGroup>();
  for (const d of list) {
    const messages = (d.messages ?? []).filter(Boolean);
    // The shortest message is the headline; the long one is the full notice.
    const label = [...messages].sort((a, b) => a.length - b.length)[0] ?? d.cause ?? "Perturbation";
    const group = groups.get(label) ?? { label, count: 0, severe: false };
    group.count += 1;
    group.severe ||= !/information/i.test(d.severity ?? "");
    groups.set(label, group);
  }
  const sorted = [...groups.values()].sort((a, b) => Number(b.severe) - Number(a.severe) || b.count - a.count);
  const total = list.length;
  const label = total === 1 ? sorted[0].label : `${total} perturbations signalées`;
  return { total, label, groups: sorted };
}

export function buildView(payload: JourneysPayload | undefined, args: ToolArgs = {}): View {
  if (!payload) return { kind: "loading" };
  if (payload.error) return { kind: "error", text: payload.error };
  const kept = keptJourneys(payload.journeys ?? []);
  if (kept.length === 0) return { kind: "empty", text: "Aucun itinéraire trouvé." };
  const refDay = dayOf(payload.now ?? kept[0].departure);
  const first = kept[0].sections ?? [];
  return {
    kind: "journeys",
    from: cleanName(first[0]?.from),
    to: cleanName(first.at(-1)?.to),
    subtitle: subtitleOf(payload, args, kept),
    rows: kept.map((j, i) => rowOf(j, i, refDay)),
    disruptions: disruptionsOf(payload.disruptions),
  };
}
