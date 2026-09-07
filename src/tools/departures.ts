import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NavitiaClient } from "../client.js";
import { formatDepartures, toNavitiaDt } from "../format.js";
import { collectionForId, jsonResult, safe } from "../util.js";

const inputSchema = {
  stop_id: z
    .string()
    .describe("Stop id from search_places: 'stop_area:...' (station) or 'stop_point:...' (platform)."),
  from_datetime: z
    .string()
    .optional()
    .describe("ISO 8601 datetime to start from (local to the region). Defaults to now."),
  count: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
  line_id: z.string().optional().describe("Filter to a single line ('line:...' id)."),
  data_freshness: z
    .enum(["realtime", "base_schedule"])
    .optional()
    .describe("'realtime' (default) includes delays and cancellations; 'base_schedule' is the theoretical timetable."),
};

export function registerDepartureTools(server: McpServer, client: NavitiaClient) {
  const handler = (kind: "departures" | "arrivals") =>
    safe(async (args: any) => {
      const lineSegment = args.line_id ? `/lines/${args.line_id}` : "";
      const path = `/${collectionForId(args.stop_id)}/${args.stop_id}${lineSegment}/${kind}`;
      const data = await client.get(path, {
        from_datetime: toNavitiaDt(args.from_datetime),
        count: args.count,
        data_freshness: args.data_freshness,
      });
      return jsonResult(formatDepartures(data, kind));
    });

  server.registerTool(
    "next_departures",
    {
      title: "Next departures",
      description:
        "List the next departures from a stop (station or platform), with realtime delays when available.",
      inputSchema,
    },
    handler("departures"),
  );

  server.registerTool(
    "next_arrivals",
    {
      title: "Next arrivals",
      description: "List the next arrivals at a stop (station or platform), with realtime delays when available.",
      inputSchema,
    },
    handler("arrivals"),
  );
}
