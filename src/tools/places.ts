import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NavitiaClient } from "../client.js";
import { formatPlaces, formatPtObjects } from "../format.js";
import { jsonResult, safe } from "../util.js";

const placeTypes = z.enum(["stop_area", "stop_point", "address", "poi", "administrative_region"]);
const ptObjectTypes = z.enum(["network", "commercial_mode", "line", "route", "stop_area", "stop_point"]);

export function registerPlaceTools(server: McpServer, client: NavitiaClient) {
  server.registerTool(
    "search_places",
    {
      title: "Search places (autocomplete)",
      description:
        "Geocode / autocomplete stations, addresses, POIs and cities by free-text query. " +
        "Returns object ids usable as from/to in plan_journey or as stop_id in departure/schedule tools.",
      inputSchema: {
        query: z.string().describe("Free-text search, e.g. 'gare de lyon' or '20 rue de rivoli paris'."),
        types: z
          .array(placeTypes)
          .optional()
          .describe("Restrict result types. Use ['stop_area'] when looking for a station."),
        count: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
      },
    },
    safe(async (args) => {
      const data = await client.get("/places", {
        q: args.query,
        type: args.types,
        count: args.count,
      });
      return jsonResult(formatPlaces(data));
    }),
  );

  server.registerTool(
    "places_nearby",
    {
      title: "Find places nearby",
      description:
        "List public-transport stops and POIs within a radius of a coordinate. " +
        "Useful to find the nearest station to a location.",
      inputSchema: {
        lon: z.number().describe("Longitude, e.g. 2.3522"),
        lat: z.number().describe("Latitude, e.g. 48.8566"),
        distance: z.number().int().min(1).max(10000).optional().describe("Search radius in meters (default 500)."),
        types: z
          .array(placeTypes)
          .optional()
          .describe("Restrict result types (default stop_areas and POIs)."),
        count: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
      },
    },
    safe(async (args) => {
      const path = `/coords/${args.lon};${args.lat}/places_nearby`;
      const data = await client.get(path, {
        distance: args.distance,
        type: args.types,
        count: args.count,
      });
      return jsonResult(formatPlaces(data));
    }),
  );

  server.registerTool(
    "search_pt_objects",
    {
      title: "Search public-transport objects",
      description:
        "Find public-transport objects (networks, lines, routes, stop_areas, transportation modes) by name and return their ids. " +
        "Use this to resolve a line to its id — e.g. 'metro 14' -> a 'line:...' id — to pass as line_id in " +
        "next_departures/stop_schedules, or to forbid a line, transportation mode or network in plan_journey.",
      inputSchema: {
        query: z.string().describe("Free-text search, e.g. 'metro 14', 'RER A', 'bus 38' or a network name."),
        types: z
          .array(ptObjectTypes)
          .optional()
          .describe(
            "Restrict result types (default: network, commercial_mode, line, route, stop_area). " +
            "Use ['line'] when looking for a line id.",
          ),
        count: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
      },
    },
    safe(async (args) => {
      const data = await client.get("/pt_objects", {
        q: args.query,
        type: args.types,
        count: args.count,
      });
      return jsonResult(formatPtObjects(data));
    }),
  );
}
