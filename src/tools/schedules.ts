import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NavitiaClient } from "../client.js";
import { formatRouteSchedules, formatStopSchedules, toNavitiaDt } from "../format.js";
import { collectionForId, jsonResult, safe } from "../util.js";

const commonSchema = {
  from_datetime: z
    .string()
    .optional()
    .describe("ISO 8601 datetime to start from (local to the region). Defaults to now."),
  items_per_schedule: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max upcoming times per line/direction (default 5 here to keep output small)."),
  data_freshness: z
    .enum(["realtime", "base_schedule"])
    .optional()
    .describe("'realtime' includes delays; 'base_schedule' (default for schedules) is the planned timetable."),
};

export function registerScheduleTools(server: McpServer, client: NavitiaClient) {
  server.registerTool(
    "stop_schedules",
    {
      title: "Stop schedules",
      description:
        "Timetable at a stop, grouped by line and route: for each line/direction serving the stop, the next departure times.",
      inputSchema: {
        stop_id: z
          .string()
          .describe("Stop id from search_places: 'stop_area:...' or 'stop_point:...'."),
        line_id: z.string().optional().describe("Filter to a single line ('line:...' id)."),
        ...commonSchema,
      },
    },
    safe(async (args) => {
      const lineSegment = args.line_id ? `/lines/${args.line_id}` : "";
      const path = `/${collectionForId(args.stop_id)}/${args.stop_id}${lineSegment}/stop_schedules`;
      const data = await client.get(path, {
        from_datetime: toNavitiaDt(args.from_datetime),
        items_per_schedule: args.items_per_schedule ?? 5,
        data_freshness: args.data_freshness,
      });
      return jsonResult(formatStopSchedules(data, "stop_schedules"));
    }),
  );

  server.registerTool(
    "terminus_schedules",
    {
      title: "Terminus schedules",
      description:
        "Departure board for one line at a stop, grouped by final destination (terminus) — what you would see " +
        "on a station display. Both a stop and a line are required: resolve the line id with search_pt_objects first.",
      inputSchema: {
        stop_id: z
          .string()
          .describe("Stop id from search_places: 'stop_area:...' or 'stop_point:...'."),
        line_id: z
          .string()
          .describe("Line id ('line:...') from search_pt_objects, e.g. search 'metro 14' -> its line id. Required."),
        ...commonSchema,
      },
    },
    safe(async (args) => {
      const path = `/${collectionForId(args.stop_id)}/${args.stop_id}/lines/${args.line_id}/terminus_schedules`;
      const data = await client.get(path, {
        from_datetime: toNavitiaDt(args.from_datetime),
        items_per_schedule: args.items_per_schedule ?? 5,
        data_freshness: args.data_freshness,
      });
      return jsonResult(formatStopSchedules(data, "terminus_schedules"));
    }),
  );

  server.registerTool(
    "route_schedules",
    {
      title: "Route schedules",
      description:
        "Full timetable grid for a line or route: every stop along the way with the times of upcoming vehicles. " +
        "Heavier output — prefer stop_schedules when you only care about one stop.",
      inputSchema: {
        id: z.string().describe("A 'line:...' or 'route:...' id (find lines via search_places or stop_schedules)."),
        ...commonSchema,
      },
    },
    safe(async (args) => {
      const path = `/${collectionForId(args.id)}/${args.id}/route_schedules`;
      const data = await client.get(path, {
        from_datetime: toNavitiaDt(args.from_datetime),
        items_per_schedule: args.items_per_schedule ?? 5,
        data_freshness: args.data_freshness,
      });
      return jsonResult(formatRouteSchedules(data));
    }),
  );
}
