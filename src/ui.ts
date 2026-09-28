import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP Apps views. A host that supports the extension (Claude, for one) renders
 * the view a tool points at inline in the conversation and hands it the tool's
 * result; other hosts ignore it and keep showing the text result.
 */
export const JOURNEYS_UI_URI = "ui://navitia/journeys.html";

// Views are single self-contained HTML files built by scripts/build-ui.mjs.
// Resolved from the package root so this works from dist/ and, under
// `npm run dev`, from src/.
const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "ui");

async function readView(file: string): Promise<string> {
  try {
    return await readFile(resolve(UI_DIR, file), "utf8");
  } catch {
    throw new Error(`UI view ${file} is missing from ${UI_DIR}. Run \`npm run build\` to build it.`);
  }
}

export function registerUiResources(server: McpServer) {
  registerAppResource(
    server,
    "Journeys view",
    JOURNEYS_UI_URI,
    { description: "Itinerary list rendered next to plan_journey results." },
    async () => ({
      contents: [
        {
          uri: JOURNEYS_UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readView("journeys.html"),
          _meta: {
            ui: {
              prefersBorder: true,
              // Hove typefaces (Inter, DM Mono) come from Google Fonts.
              csp: { resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] },
            },
          },
        },
      ],
    }),
  );
}
