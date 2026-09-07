const MAX_RESULT_CHARS = 50_000;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function jsonResult(data: unknown): ToolResult {
  let text = JSON.stringify(data, null, 1);
  if (text.length > MAX_RESULT_CHARS) {
    text =
      text.slice(0, MAX_RESULT_CHARS) +
      "\n... (result truncated — use 'count' or narrower filters to reduce the response)";
  }
  return { content: [{ type: "text", text }] };
}

/** Wrap a tool handler so API failures come back as readable tool errors. */
export function safe<A extends any[]>(
  fn: (...args: A) => Promise<ToolResult>,
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  };
}

/**
 * Map a Navitia object id prefix to its REST collection, e.g.
 * "stop_area:SNCF:87686006" -> "stop_areas".
 */
export function collectionForId(id: string): string {
  const prefix = id.split(":")[0];
  const collections: Record<string, string> = {
    stop_area: "stop_areas",
    stop_point: "stop_points",
    line: "lines",
    route: "routes",
    network: "networks",
    commercial_mode: "commercial_modes",
  };
  const collection = collections[prefix];
  if (!collection) {
    throw new Error(
      `Cannot infer object type from id "${id}". Expected an id starting with ` +
        "stop_area:, stop_point:, line:, route:, network: or commercial_mode: " +
        "(use search_places to find valid ids).",
    );
  }
  return collection;
}
