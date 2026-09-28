# Using the Navitia MCP server

A practical guide: how to install it, wire it into a client, and drive the nine
tools it exposes. For the shorter overview see the [README](../README.md).

- [1. Prerequisites](#1-prerequisites)
- [2. Install and build](#2-install-and-build)
- [3. Get a Navitia token](#3-get-a-navitia-token)
- [4. Pick a coverage region](#4-pick-a-coverage-region)
- [5. Connect a client](#5-connect-a-client)
- [6. The one workflow rule: resolve ids first](#6-the-one-workflow-rule-resolve-ids-first)
- [7. Worked examples](#7-worked-examples)
- [8. Tool reference](#8-tool-reference)
- [9. Response shapes](#9-response-shapes)
- [10. Line preferences](#10-line-preferences)
- [11. Driving it from an agent](#11-driving-it-from-an-agent)
- [12. Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

- **Node.js 18+** (the server uses the global `fetch`).
- **A Navitia API token** — see [§3](#3-get-a-navitia-token).
- An MCP client: Claude Code, Claude Desktop, or anything that speaks MCP over
  stdio.

## 2. Install and build

```bash
git clone https://github.com/wassimbenaissa/Navitia-MCP.git
cd Navitia-MCP
npm install
npm run build
```

`npm run build` compiles `src/` to `dist/`. The entry point clients launch is
`dist/index.js`, and it needs an **absolute** path in client configs — note it
down now:

```bash
echo "$(pwd)/dist/index.js"
```

| Script | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run straight from `src/` via `tsx`, no build step |
| `npm start` | Run the compiled `dist/index.js` |

## 3. Get a Navitia token

Request one at [navitia.io](https://navitia.io) (the API is run by
[Hove](https://www.hove.com)). The token is a single string passed as the
`Authorization` header on every call.

**Keep it out of the repository.** The server only ever reads it from the
`NAVITIA_API_KEY` environment variable — there is no config file to paste it
into and no default baked into the code. For local work, copy
[`.env.example`](../.env.example) to `.env` (gitignored) or export it in your
shell:

```bash
export NAVITIA_API_KEY=your-token
```

In a client config, put it in that server's `env` block. If you ever paste a
token into a file that is tracked by git, treat it as leaked and rotate it.

## 4. Pick a coverage region

Navitia splits the world into *coverages*. **This server is scoped to exactly
one**, set by `NAVITIA_REGION` at startup — so no tool takes a region argument
and every id you use must belong to that coverage.

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `NAVITIA_API_KEY` | yes | — | Your Navitia token |
| `NAVITIA_REGION` | no | `fr-idf` | Coverage the server is scoped to |
| `NAVITIA_BASE_URL` | no | `https://api.navitia.io/v1` | API root, for a self-hosted Navitia |

Common coverages: `fr-idf` (Île-de-France), `fr-se` (southeast / Lyon),
`fr-nw` (northwest), `sncf` (French national rail). The full list is
`GET /coverage` on the API, and your token decides which ones you may read.

To serve several regions at once, **run one instance per region** and give each
a distinct server name in your client (`navitia-idf`, `navitia-lyon`, …).

## 5. Connect a client

### Claude Code

```bash
claude mcp add navitia --env NAVITIA_API_KEY=your-token --env NAVITIA_REGION=fr-idf -- node /absolute/path/to/dist/index.js
```

Then check it registered:

```bash
claude mcp list
```

### Claude Desktop

Edit `claude_desktop_config.json` — on macOS
`~/Library/Application Support/Claude/claude_desktop_config.json` — and restart
the app:

```json
{
  "mcpServers": {
    "navitia": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "NAVITIA_API_KEY": "your-token",
        "NAVITIA_REGION": "fr-idf"
      }
    }
  }
}
```

### Any other MCP client

The server speaks **MCP over stdio**. Launch `node /absolute/path/to/dist/index.js`
with `NAVITIA_API_KEY` in its environment. On startup it writes one line to
stderr — `Navitia MCP server running on stdio (region: fr-idf)` — which is a
quick way to confirm the region it picked up.

### Test it standalone

Before touching a client config, exercise the tools by hand:

```bash
NAVITIA_API_KEY=your-token npx @modelcontextprotocol/inspector node dist/index.js
```

The inspector lists the nine tools and lets you fill in arguments and read the
raw JSON back — the fastest way to tell a bad token from a bad id.

## 6. The one workflow rule: resolve ids first

Navitia is id-driven. Names are for humans; every tool that reads a stop, line
or route wants an **object id**, and ids come from exactly two tools:

```
search_places      →  stop_area:…  stop_point:…  address:…  poi:…  admin:…
search_pt_objects  →  line:…  route:…  network:…  commercial_mode:…  stop_area:…
```

Which id each tool accepts:

| Tool | Accepts |
|---|---|
| `plan_journey` (`from` / `to`) | `stop_area:` `stop_point:` `address:` `poi:` **or** raw `lon;lat` |
| `next_departures` / `next_arrivals` / `stop_schedules` / `terminus_schedules` (`stop_id`) | `stop_area:` (station) or `stop_point:` (single platform) |
| `route_schedules` (`id`) | `line:` or `route:` |
| any `line_id` parameter | `line:` only |

Two consequences worth internalising:

- **Never hand-write or guess an id.** They are opaque
  (`stop_area:IDFM:71517`) and vary by coverage. Search, then use what came
  back.
- **`terminus_schedules` requires a `line_id`** — resolve the line with
  `search_pt_objects` before calling it.

Passing an id the tool cannot use fails fast and tells you so, rather than
silently returning something else:

```
Cannot infer object type from id "poi:xyz". Expected an id starting with
stop_area:, stop_point:, line:, route:, network: or commercial_mode:
(use search_places to find valid ids).
```

## 7. Worked examples

Responses below are abridged to the fields that matter.

### A. "When is the next metro from Châtelet?"

**1 — resolve the station.** Restrict to `stop_area` so you get the station, not
an address that happens to match:

```json
{ "tool": "search_places", "query": "châtelet", "types": ["stop_area"], "count": 5 }
```

```json
{ "places": [
  { "id": "stop_area:IDFM:71517", "name": "Châtelet", "type": "stop_area", "city": "Paris" }
] }
```

**2 — read the board.**

```json
{ "tool": "next_departures", "stop_id": "stop_area:IDFM:71517", "count": 5 }
```

```json
{
 "now": "2026-09-07T11:42:03",
 "departures": [
  { "line": "1", "mode": "Métro", "direction": "La Défense (Puteaux)",
    "stop": "Châtelet", "time": "2026-09-07T11:44:00", "realtime": true },
  { "line": "4", "mode": "Métro", "direction": "Mairie de Montrouge",
    "stop": "Châtelet", "time": "2026-09-07T11:45:00",
    "scheduled": "2026-09-07T11:43:00", "realtime": true }
 ]
}
```

Read it like this: countdowns are `time − now` (2 min, 3 min). A `scheduled`
field means the vehicle is **off its timetable** — here 2 minutes late. Use
`now`, not your own clock: it is the API's time in the region's timezone.

### B. "Get me from Gare de Lyon to CDG airport by 18:00"

```json
{ "tool": "search_places", "query": "gare de lyon", "types": ["stop_area"] }
{ "tool": "search_places", "query": "charles de gaulle airport", "types": ["stop_area", "poi"] }
```

Then plan backwards from the arrival time:

```json
{
 "tool": "plan_journey",
 "from": "stop_area:IDFM:412996",
 "to": "stop_area:IDFM:63951",
 "datetime": "2026-09-07T18:00",
 "datetime_represents": "arrival",
 "max_nb_journeys": 3
}
```

```json
{
 "now": "2026-09-07T11:42:03",
 "journeys": [
  {
   "departure": "2026-09-07T16:51:00", "arrival": "2026-09-07T17:48:00",
   "duration": "57min", "transfers": 1, "walking": "8min",
   "type": "best", "co2_g": 412,
   "criteria_ranker": { "asap": 1, "less_transfers": 2, "less_walking": 1, "reliability": 1 },
   "sections": [
    { "mode": "walking", "from": "Gare de Lyon", "to": "Gare de Lyon", "duration": "4min" },
    { "mode": "Métro", "line": "14", "direction": "Saint-Denis Pleyel",
      "from": "Gare de Lyon", "to": "Châtelet", "stops": 2,
      "departure": "2026-09-07T16:55:00", "arrival": "2026-09-07T17:00:00", "duration": "5min" },
    { "mode": "RER", "line": "B", "direction": "Aéroport CDG 2 TGV",
      "from": "Châtelet", "to": "Aéroport CDG 2 TGV", "stops": 9,
      "departure": "2026-09-07T17:06:00", "arrival": "2026-09-07T17:44:00", "duration": "38min" }
   ]
  }
 ],
 "disruptions": [
  { "severity": "Perturbation", "cause": "Travaux",
    "messages": ["RER B: service modifié entre Gare du Nord et CDG"] }
 ]
}
```

`datetime_represents: "arrival"` is the difference between "leave at 18:00" and
"be there by 18:00". Always check `disruptions` and each journey's `status`
(e.g. `SIGNIFICANT_DELAYS`) before presenting an itinerary as reliable.

### C. "Metro 14 departures at Bercy, by destination"

`terminus_schedules` is the station-display view — grouped by terminus — and it
needs both a stop and a line:

```json
{ "tool": "search_pt_objects", "query": "metro 14", "types": ["line"] }
```

```json
{ "pt_objects": [
  { "id": "line:IDFM:C01384", "name": "14", "type": "line", "code": "14",
    "network": "RATP", "mode": "Métro" }
] }
```

```json
{
 "tool": "terminus_schedules",
 "stop_id": "stop_area:IDFM:73626",
 "line_id": "line:IDFM:C01384",
 "items_per_schedule": 3
}
```

```json
{
 "now": "2026-09-07T11:42:03",
 "schedules": [
  { "stop": "Bercy", "line": "14", "mode": "Métro", "direction": "Orly",
    "times": ["2026-09-07T11:43:30", "2026-09-07T11:46:00", "2026-09-07T11:48:30"] },
  { "stop": "Bercy", "line": "14", "mode": "Métro", "direction": "Saint-Denis Pleyel",
    "times": ["2026-09-07T11:44:00", "2026-09-07T11:47:00", "2026-09-07T11:50:00"] }
 ]
}
```

Use `stop_schedules` instead when you want **every** line at a stop grouped by
line and direction, and `route_schedules` when you want the whole grid of a
line — all its stops against all its upcoming trips.

### D. "What's near me?"

Coordinates are `lon;lat` — **longitude first**, which is the opposite of the
`lat,lon` order most map apps show:

```json
{ "tool": "places_nearby", "lon": 2.3522, "lat": 48.8566, "distance": 400, "types": ["stop_area"] }
```

```json
{ "places": [
  { "id": "stop_area:IDFM:71517", "name": "Châtelet", "type": "stop_area", "distance": "180m" }
] }
```

`plan_journey` also takes raw coordinates directly as `from` / `to`
(`"2.3522;48.8566"`), which saves a lookup when you already have a GPS fix.

## 8. Tool reference

Defaults in the table are the server's own; where it sends nothing, Navitia's
default applies.

### `search_places` — geocode / autocomplete

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | *required* | Free text: `"gare de lyon"`, `"20 rue de rivoli paris"` |
| `types` | array | all | `stop_area` `stop_point` `address` `poi` `administrative_region` |
| `count` | int 1–50 | 10 | |

### `places_nearby` — what is around a point

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `lon` | number | *required* | Longitude, e.g. `2.3522` |
| `lat` | number | *required* | Latitude, e.g. `48.8566` |
| `distance` | int 1–10000 | 500 | Radius in metres |
| `types` | array | stops + POIs | Same set as `search_places` |
| `count` | int 1–50 | 10 | |

### `search_pt_objects` — resolve lines, networks, routes

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | *required* | `"metro 14"`, `"RER A"`, `"bus 38"` |
| `types` | array | network, commercial_mode, line, route, stop_area | Pass `["line"]` for a line id |
| `count` | int 1–50 | 10 | |

### `plan_journey` — door-to-door itineraries

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `from` | string | *required* | Object id or `lon;lat` |
| `to` | string | *required* | Object id or `lon;lat` |
| `datetime` | ISO 8601 | now | Region-local, e.g. `2026-09-07T17:30` |
| `datetime_represents` | `departure` \| `arrival` | `departure` | `arrival` = "be there by" |
| `max_nb_journeys` | int 1–10 | 8 | |
| `max_nb_transfers` | int ≥ 0 | — | Hard cap on transfers |
| `wheelchair` | boolean | — | Accessible journeys only |
| `forbidden_uris` | array | — | Exclude outright: a `line:`, `network:`, `commercial_mode:` … |
| `prefer_lines` | array of `line:` | — | *Experimental* — favour these lines |
| `avoid_lines` | array of `line:` | — | *Experimental* — propose these less |

See [§10](#10-line-preferences) for the three preference levers.

In a host that supports MCP Apps, the result also renders as the journeys
widget — see the [README](../README.md#journeys-widget-mcp-apps).

### `next_departures` / `next_arrivals` — realtime boards

Identical parameters; one reads departures, the other arrivals.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `stop_id` | string | *required* | `stop_area:` (station) or `stop_point:` (platform) |
| `from_datetime` | ISO 8601 | now | |
| `count` | int 1–50 | 10 | |
| `line_id` | `line:` | — | Restrict to one line |
| `data_freshness` | `realtime` \| `base_schedule` | `realtime` | `base_schedule` = theoretical timetable |

### `stop_schedules` — timetable at a stop, by line

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `stop_id` | string | *required* | `stop_area:` or `stop_point:` |
| `line_id` | `line:` | — | Restrict to one line |
| `from_datetime` | ISO 8601 | now | |
| `items_per_schedule` | int 1–20 | 5 | Times per line/direction |
| `data_freshness` | `realtime` \| `base_schedule` | API default | |

### `terminus_schedules` — station display for one line

Same as `stop_schedules`, except **`line_id` is required** — grouping is by
final destination rather than by line.

### `route_schedules` — full timetable grid

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `id` | string | *required* | A `line:` or `route:` id |
| `from_datetime` | ISO 8601 | now | |
| `items_per_schedule` | int 1–20 | 5 | |
| `data_freshness` | `realtime` \| `base_schedule` | API default | |

Heaviest output of the nine — prefer `stop_schedules` when one stop will do.

## 9. Response shapes

Every response is **slimmed JSON**: Navitia's HATEOAS links, geojson geometries
and deep fare/CO₂ trees are dropped so a model can read the payload, and empty
or null fields are omitted rather than sent as `null`. Presentation is the
client's job — the server never returns prose.

### `now` — the clock to trust

`plan_journey`, `next_departures`, `next_arrivals`, `stop_schedules`,
`terminus_schedules` and `route_schedules` all carry a top-level **`now`**: the
API's `context.current_datetime`, in the coverage's local timezone. Compute
every countdown against it. A client in another timezone that uses its own clock
will be off by hours.

### Fields by tool

| Tool | Top-level | Per-item fields |
|---|---|---|
| `search_places`, `places_nearby` | `places` | `id` `name` `type` `coord` `city` `distance` |
| `search_pt_objects` | `pt_objects` | `id` `name` `type` `code` `network` `mode` `direction` `physical_modes` |
| `plan_journey` | `now` `ordered_by?` `journeys` `disruptions` | see below |
| `next_departures` / `next_arrivals` | `now` `departures` / `arrivals` | `line` `mode` `network` `direction` `stop` `time` `scheduled?` `realtime?` |
| `stop_schedules`, `terminus_schedules` | `now` `schedules` | `stop` `line` `mode` `network` `direction` `times[]` `note?` |
| `route_schedules` | `now` `route_schedules` | `line` `mode` `network` `direction` `trips[]` `stops[{stop, times[]}]` |

A **journey** carries `departure` `arrival` `duration` `transfers` `walking`
`type` (`best`, `rapid`, `comfort`…) `status` (a disruption flag such as
`SIGNIFICANT_DELAYS`) `co2_g` `criteria_ranker` and `sections`. Each **section**
carries `mode` `line` `network` `color` `text_color` `direction` `from` `to`
`stops` `departure` `arrival` `duration` `realtime?`; `mode` falls back to the
section type, so transfers, waits and bike/park legs stay identifiable. `color`
and `text_color` are the line's own badge colours as `#RRGGBB`, and `realtime`
is `true` on a leg timed from live data. Waiting sections under a minute are
dropped as noise. `disruptions` lists each distinct disruption once (Navitia
repeats them per impacted object), with its messages flattened to plain text.

Two conventions worth knowing:

- **`scheduled`** appears on a departure/arrival *only when it differs from
  `time`* — its presence means a delay, and `time − scheduled` is how much.
- In `route_schedules`, a stop a trip skips keeps a **`null`** in `times` rather
  than dropping the entry, so the grid stays column-aligned with `trips`.

### `criteria_ranker`

When Navitia supplies it, each journey carries its 1-based rank on four
criteria — `asap`, `less_transfers`, `less_walking`, `reliability` — where 1 is
the best in the returned set. Handy for tagging itineraries ("fastest",
"fewest changes") without recomputing anything, and it is what line-preference
re-ordering sorts on.

### Size limit

Results are truncated at **50 kB** with a trailing note. If you hit it, narrow
the request — lower `count` / `items_per_schedule`, add a `line_id`, or use
`stop_schedules` instead of `route_schedules`.

## 10. Line preferences

`plan_journey` offers three levers, from a nudge to a ban. Pick by how absolute
the traveller was:

| Parameter | Effect | Typical phrasing |
|---|---|---|
| `prefer_lines` | Favours the line — itineraries using it rank higher | "I'd rather take metro 14" |
| `avoid_lines` | Proposes the line less, but keeps it in the results | "I'd like to avoid metro 14, without ruling it out" |
| `forbidden_uris` | Removes the line entirely | "never put me on metro 14" |

All three take ids from `search_pt_objects`. `prefer_lines` and `avoid_lines`
accept **only** `line:` ids and reject anything else rather than sending it on:

```
prefer_lines and avoid_lines take line ids starting with "line:", got "14".
Look the line up with search_pt_objects and pass the id it returns — a line
name or number is not an id.
```

Under the hood the two soft levers map to Navitia's experimental feature flag,
one entry per line:

```
_features_flags[]=boost_line({line_id},{boost_factor})
```

with `boost_factor` `3` for a preferred line and `0.4` for an avoided one.

**Ordering changes when you use them.** Boosting changes what the default order
means, so a response that used `prefer_lines` or `avoid_lines` is re-sorted by
each journey's `reliability` rank (1 first) and carries
`ordered_by: "reliability"` so a client can explain the order it shows. Without
preferences the API's own order is untouched and `ordered_by` is absent.

The flag is **experimental and server-dependent**: an instance that does not
implement it may ignore it or return an error, which the tool relays unchanged.

## 11. Driving it from an agent

The tools return raw JSON on purpose — turning it into a departure board is the
client's job. [`prompts/agent-system-prompt.md`](../prompts/agent-system-prompt.md)
is a ready-to-use strict system prompt for an agent on top of this server. It
covers:

- **Anti-fabrication rules** — a transit fact may only come from a tool result
  in the current turn; no prior knowledge of a network, no carrying times
  forward between turns.
- **The only two derivations allowed** — countdown (`time − now`) and delay
  (`time − scheduled`). Everything else is copied from a field.
- **The id-resolution protocol** — search first, never guess or recall an id.
- **Board layouts** — how to render departure boards, journey chains and
  timetables.

Paste it as the system prompt of the agent, or read it as a checklist of the
mistakes worth guarding against if you write your own. The rules exist because
people act on these answers in real time: a confident wrong departure time is
worse than no answer.

## 12. Troubleshooting

The server rewrites API failures into actionable messages. What each one means:

| Message | Cause | Fix |
|---|---|---|
| `NAVITIA_API_KEY environment variable is required.` (server exits) | The env var never reached the process | Put it in the client's `env` block, not just your shell — GUI clients don't inherit it |
| `Authentication failed (401)` | Bad token **or** an unknown coverage — Navitia answers 401 for both | Check the token, then check `NAVITIA_REGION` against `GET /coverage` |
| `Access denied (403)` | Token has no access to that region or resource | Verify your coverage entitlements |
| `Not found (404)` | Wrong or foreign id, or wrong path | Re-resolve the id with `search_places` / `search_pt_objects` in the right coverage |
| `Rate limit exceeded (429)` | Too many calls | Back off; batch fewer, narrower calls |
| `Could not reach the Navitia API` | Network, DNS or proxy | Check connectivity and `NAVITIA_BASE_URL` |
| `Cannot infer object type from id "…"` | An id the tool cannot use (e.g. `address:` on a departure board) | See the id table in [§6](#6-the-one-workflow-rule-resolve-ids-first) |
| `Invalid datetime "…". Use ISO 8601` | Unparseable datetime | Use `2026-09-07T17:30` |
| `... (result truncated ...)` | Response over 50 kB | Narrow it: lower `count`, add `line_id` |

Other things that bite:

- **Tools don't show up in the client.** Confirm the path in the config is
  absolute and points at `dist/index.js`, that `npm run build` has been run,
  and restart the client — Claude Desktop only reads its config at startup.
- **Empty results for a place you know exists.** You are almost certainly in
  the wrong coverage. A Lyon stop will not be found under `fr-idf`.
- **Countdowns are hours off.** Something is using the local clock instead of
  the `now` field from the response.
- **Times look stale.** Pass `data_freshness: "realtime"` (the default on
  departure boards, but not on schedules), and remember that realtime data
  exists only where the operator feeds it.

Wrong region is the single most common cause of "it returns nothing". The
startup line on stderr tells you which one the server actually loaded:

```
Navitia MCP server running on stdio (region: fr-idf)
```
