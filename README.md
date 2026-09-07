# Navitia MCP Server

An [MCP](https://modelcontextprotocol.io) server exposing the [Navitia](https://doc.navitia.io) public-transport API: journey planning, place search, realtime departures and timetables, usable from Claude Desktop, Claude Code, or any MCP client.

**[→ Full usage guide](docs/USAGE.md)** — install, client setup, worked examples, tool reference, response shapes and troubleshooting.

## Tools

| Tool | What it does |
|---|---|
| `search_places` | Geocode / autocomplete stations, addresses, POIs, cities — returns the object ids the other tools need |
| `search_pt_objects` | Find networks, lines, routes and stops by name (e.g. "metro 14" → a `line:` id) for use as a `line_id` filter |
| `places_nearby` | Stops and POIs within a radius of a coordinate |
| `plan_journey` | Door-to-door multi-modal itineraries (with disruptions), with optional per-line preferences |
| `next_departures` / `next_arrivals` | Realtime departure/arrival boards for a stop |
| `stop_schedules` | Timetable at a stop, grouped by line and direction |
| `terminus_schedules` | Station-display board for one line at a stop, grouped by destination (needs a `line_id` from `search_pt_objects`) |
| `route_schedules` | Full timetable grid for a line or route |

The server is scoped to a single coverage region (default **Île-de-France**, `fr-idf`) set via the `NAVITIA_REGION` env var — tools take no region parameter. Set `NAVITIA_REGION=fr-se` for the southeast (Lyon), `sncf` for national rail, etc.

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `NAVITIA_API_KEY` | yes | — | Your Navitia token |
| `NAVITIA_REGION` | no | `fr-idf` | Coverage region id the server is scoped to |
| `NAVITIA_BASE_URL` | no | `https://api.navitia.io/v1` | API root (override for a self-hosted Navitia) |

## Setup

You need a Navitia API token (request one via [navitia.io](https://navitia.io) / Hove). The server reads it from `NAVITIA_API_KEY` only — never commit it. For local runs, copy [`.env.example`](.env.example) to `.env` (gitignored) or export the variable in your shell.

```bash
npm install
npm run build
```

### Claude Code

```bash
claude mcp add navitia --env NAVITIA_API_KEY=your-token --env NAVITIA_REGION=fr-idf -- node /absolute/path/to/dist/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json`:

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

## Line preferences (experimental)

`plan_journey` can express a *taste* for or against a line instead of a hard rule:

| Parameter | Effect | Typical phrasing |
|---|---|---|
| `prefer_lines: ["line:…"]` | Favours the line — itineraries using it rank higher | "I'd rather take metro 14" |
| `avoid_lines: ["line:…"]` | Proposes the line less, without removing it | "I'd like to avoid metro 14, but not rule it out" |
| `forbidden_uris: ["line:…"]` | Excludes the line outright | "never put me on metro 14" |

All three take ids from `search_pt_objects`; `prefer_lines` / `avoid_lines` reject anything that is not a `line:` id rather than sending it on.

Preferences map to Navitia's experimental flag, one per line:

```
_features_flags[]=boost_line({line_id},{boost_factor})
```

with `boost_factor` = `3` for a preferred line and `0.4` for an avoided one.

Because boosting changes what the default ordering means, a response that used line preferences is **re-ordered by the `reliability` rank** in each journey's `criteria_ranker` — rank 1 first — and carries `ordered_by: "reliability"` so the client can explain the order it is showing. Without preferences, the API's own order is left untouched and `ordered_by` is absent.

The flag is experimental and depends on server-side support: an instance that does not implement it may ignore it or return an error, which the tool relays unchanged.

## Usage notes

- **Datetimes** are ISO 8601 in the region's local time (e.g. `2026-06-11T17:30`); responses use the same format.
- **Ids**: find stops/addresses with `search_places` (`stop_area:…`), and lines/networks with `search_pt_objects` (`line:…`), then feed them to the journey/departure/schedule tools.
- **`terminus_schedules` requires a `line_id`** — resolve it with `search_pt_objects` first (e.g. "metro 14").
- `plan_journey` calls always carry the technical parameter `_frontend=gormun`, which identifies this caller to Navitia. It is a constant, not a tool input.
- **Line preferences** (`prefer_lines` / `avoid_lines` on `plan_journey`) nudge the ranking; `forbidden_uris` removes a line entirely. See [Line preferences](#line-preferences-experimental).
- All tools are scoped to the `NAVITIA_REGION` coverage; no per-call `region` parameter. To serve several regions, run one instance per region.
- Responses are deliberately slimmed (no geojson/links) to stay LLM-friendly; large results are truncated at 50 kB.

## Output format

Tools return **slimmed JSON** — Navitia's HATEOAS links, geojson geometries and deep fare/co2 trees are dropped so the payload stays inside a model's context. Presentation is the *client's* job, not the server's.

Time-sensitive responses (`plan_journey`, `next_departures`, `next_arrivals`, `stop_schedules`, `terminus_schedules`, `route_schedules`) carry a top-level `now` — the API's own `context.current_datetime`, in the region's local timezone. Compute countdowns ("dans 3 min") against that field, never against the reader's clock, which may sit in another timezone.

Each journey also carries Navitia's `criteria_ranker` when the API supplies it — that journey's 1-based rank for `asap`, `less_transfers`, `less_walking` and `reliability`, 1 being the best on that criterion. It is what the line-preference re-ordering sorts on, and a client can reuse it to tag itineraries.

[`prompts/agent-system-prompt.md`](prompts/agent-system-prompt.md) is a ready-to-use strict system prompt for an agent driving this server: it specifies the board layouts (departure boards, journey chains, timetables), the anti-fabrication rules, and the id-resolution protocol.

## Development

```bash
NAVITIA_API_KEY=your-token npm run dev          # run from source
npx @modelcontextprotocol/inspector node dist/index.js   # interactive testing
```

See [docs/USAGE.md](docs/USAGE.md) for the full guide, and
[docs/USAGE.md#12-troubleshooting](docs/USAGE.md#12-troubleshooting) when something returns nothing.
