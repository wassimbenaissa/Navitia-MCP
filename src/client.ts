// The server is scoped to a single coverage region (set via NAVITIA_REGION,
// default Île-de-France). All tool paths are relative to this base, so tools
// never deal with regions.
const DEFAULT_API_ROOT = "https://api.navitia.io/v1";
const DEFAULT_REGION = "fr-idf";

export class NavitiaError extends Error {}

export type Params = Record<string, string | number | boolean | string[] | undefined>;

export class NavitiaClient {
  readonly region: string;
  private baseUrl: string;

  constructor(
    private apiKey: string,
    region: string = process.env.NAVITIA_REGION?.trim() || DEFAULT_REGION,
    apiRoot: string = process.env.NAVITIA_BASE_URL?.trim() || DEFAULT_API_ROOT,
  ) {
    this.region = region;
    this.baseUrl = `${apiRoot.replace(/\/+$/, "")}/coverage/${region}`;
  }

  async get(path: string, params: Params = {}): Promise<any> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(`${key}[]`, item);
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: this.apiKey } });
    } catch (err) {
      throw new NavitiaError(`Could not reach the Navitia API: ${(err as Error).message}`);
    }

    let body: any = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON body; handled below via status code
    }

    if (!response.ok) {
      throw new NavitiaError(this.describeError(response.status, body, path));
    }
    return body;
  }

  private describeError(status: number, body: any, path: string): string {
    const apiMessage: string | undefined = body?.error?.message ?? body?.message;
    switch (status) {
      case 401:
        // Navitia also answers 401 for an unknown coverage, so pass its message
        // through: a mistyped NAVITIA_REGION otherwise looks like a bad token.
        return `Authentication failed (401). Check that NAVITIA_API_KEY is a valid Navitia token and that NAVITIA_REGION is a coverage it can access.${apiMessage ? ` API says: ${apiMessage}` : ""}`;
      case 403:
        return `Access denied (403) for ${path}. Your token does not have access to this region or resource.${apiMessage ? ` API says: ${apiMessage}` : ""}`;
      case 404:
        return `Not found (404) for ${path}.${apiMessage ? ` API says: ${apiMessage}` : ""} If you used an object id, verify it with search_places or search_pt_objects.`;
      case 429:
        return "Rate limit exceeded (429). Wait a moment before retrying.";
      default:
        return `Navitia API error ${status} for ${path}.${apiMessage ? ` API says: ${apiMessage}` : ""}`;
    }
  }
}
