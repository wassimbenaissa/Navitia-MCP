#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NavitiaClient } from "./client.js";
import { registerJourneyTools } from "./tools/journeys.js";
import { registerPlaceTools } from "./tools/places.js";
import { registerDepartureTools } from "./tools/departures.js";
import { registerScheduleTools } from "./tools/schedules.js";
import { registerUiResources } from "./ui.js";

const apiKey = process.env.NAVITIA_API_KEY;
if (!apiKey) {
  console.error(
    "NAVITIA_API_KEY environment variable is required.\n" +
      "Get a token from https://navitia.io (via Hove) and set it in your MCP client config, e.g.:\n" +
      '  "env": { "NAVITIA_API_KEY": "your-token" }',
  );
  process.exit(1);
}

const client = new NavitiaClient(apiKey);
const server = new McpServer({ name: "navitia", version: "0.1.0" });

registerPlaceTools(server, client);
registerJourneyTools(server, client);
registerDepartureTools(server, client);
registerScheduleTools(server, client);
registerUiResources(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Navitia MCP server running on stdio (region: ${client.region})`);
