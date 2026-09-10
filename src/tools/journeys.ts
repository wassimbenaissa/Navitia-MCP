import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NavitiaClient } from "../client.js";
import { formatJourneys, toNavitiaDt } from "../format.js";
import { jsonResult, safe } from "../util.js";

const placeDescription =
  "Either 'lon;lat' coordinates (e.g. '2.3522;48.8566') or a Navitia object id " +
  "from search_places (e.g. 'stop_area:SNCF:87686006'). Prefer object ids for stations.";

// Technical parameter identifying the caller to Navitia. Sent on every journey
// call, not exposed as a tool input — it is ours to set, not the caller's.
const FRONTEND = "gormun";

// Experimental Navitia feature flag: `boost_line(<line id>,<factor>)` nudges how
// much a line is used without removing it from the results (which is what
// forbidden_uris does). The factors are the API's own convention: 3 to favour a
// line, 0.4 to show less of it.
const BOOST_FACTOR = { prefer: 10, avoid: 0.1 } as const;

/**
 * Build the `_features_flags[]` values for the requested line preferences, or
 * undefined when there are none — the caller uses that to decide whether the
 * result needs re-ranking.
 */
function boostLineFlags(prefer: string[] = [], avoid: string[] = []): string[] | undefined {
  const wanted = [
    ...prefer.map((id) => [id, BOOST_FACTOR.prefer] as const),
    ...avoid.map((id) => [id, BOOST_FACTOR.avoid] as const),
  ];
  if (wanted.length === 0) return undefined;
  return wanted.map(([id, factor]) => {
    if (!id.startsWith("line:")) {
      throw new Error(
        `prefer_lines and avoid_lines take line ids starting with "line:", got "${id}". ` +
        "Look the line up with search_pt_objects and pass the id it returns — a line " +
        "name or number is not an id.",
      );
    }
    return `boost_line(${id},${factor})`;
  });
}

export function registerJourneyTools(server: McpServer, client: NavitiaClient) {
  server.registerTool(
    "plan_journey",
    {
      title: "Plan a journey",
      description:
        "Compute public-transport journeys between two points (multi-modal door-to-door routing). " +
        "Returns up to 'max_nb_journeys' itineraries with legs, times, transfers and any disruptions. " +
        "To express a taste for or against a line without ruling it out, pass 'prefer_lines' / " +
        "'avoid_lines'; use 'forbidden_uris' to exclude something outright.",
      inputSchema: {
        from: z.string().describe(`Origin. ${placeDescription}`),
        to: z.string().describe(`Destination. ${placeDescription}`),
        datetime: z
          .string()
          .optional()
          .describe("ISO 8601 datetime, local to the region (e.g. 2026-06-11T17:30). Defaults to now."),
        datetime_represents: z
          .enum(["departure", "arrival"])
          .optional()
          .describe("Whether 'datetime' is the departure time (default) or the desired arrival time."),
        max_nb_journeys: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(8)
          .describe("Maximum number of itineraries to return (default 8)."),
        max_nb_transfers: z.number().int().min(0).optional().describe("Maximum number of transfers."),
        wheelchair: z.boolean().optional().describe("Only wheelchair-accessible journeys."),
        forbidden_uris: z
          .array(z.string())
          .optional()
          .describe(
            "Object ids to exclude entirely, e.g. a line ('line:...'), network or commercial_mode " +
            "('commercial_mode:Bus'). To merely de-prioritise a line, use 'avoid_lines' instead.",
          ),
        prefer_lines: z
          .array(z.string())
          .optional()
          .describe(
            "EXPERIMENTAL. Line ids ('line:...', from search_pt_objects) the traveller would rather " +
            "use: itineraries taking them are favoured, without discarding the alternatives. " +
            'For "I prefer taking metro 14".',
          ),
        avoid_lines: z
          .array(z.string())
          .optional()
          .describe(
            "EXPERIMENTAL. Line ids ('line:...') the traveller would rather not use: they are " +
            "proposed less but stay in the results, unlike forbidden_uris which removes them. " +
            'For "I would like to avoid metro 14 without ruling it out".',
          ),
      },
    },
    safe(async (args) => {
      const featuresFlags = boostLineFlags(args.prefer_lines, args.avoid_lines);
      const data = await client.get("/journeys", {
        from: args.from,
        to: args.to,
        datetime: toNavitiaDt(args.datetime),
        datetime_represents: args.datetime_represents,
        max_nb_journeys: args.max_nb_journeys,
        max_nb_transfers: args.max_nb_transfers,
        wheelchair: args.wheelchair,
        forbidden_uris: args.forbidden_uris,
        _frontend: FRONTEND,
        _features_flags: featuresFlags,
      });
      // Boosting changes what "best" means, so the API's default order no longer
      // reflects the request: with line preferences on, reliability is the key.
      return jsonResult(formatJourneys(data, { rankBy: featuresFlags ? "reliability" : undefined }));
    }),
  );
}
