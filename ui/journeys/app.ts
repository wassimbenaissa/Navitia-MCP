import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { buildView, type Badge, type Icon, type JourneysPayload, type Row, type Step, type ToolArgs, type View } from "./view";

// Static, trusted markup only: every piece of API data goes through textContent.
const ICONS: Record<Icon | "arrow" | "chevron" | "alert", string> = {
  train: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8.5 20l1.5-4M15.5 20l-1.5-4"/>',
  metro: '<circle cx="12" cy="12" r="9"/><path d="M8 16V8l4 5 4-5v8"/>',
  tram: '<rect x="6" y="6" width="12" height="11" rx="3"/><path d="M9 3h6M12 3v3M6 12h12M9 20l1-3M15 20l-1-3"/>',
  bus: '<rect x="4" y="3" width="16" height="14" rx="3"/><path d="M4 10h16M7 20v-3M17 20v-3"/>',
  boat: '<path d="M4 15l2 5h12l2-5zM12 3v12M12 4l6 8H12"/>',
  cable: '<path d="M3 5l18-2M12 4v5"/><rect x="7" y="9" width="10" height="9" rx="2"/>',
  transit: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2.2-6.5L10 12l1-4.5 3.5 2.5 2.5 1M11 7.5L8 10v3M12.2 14.5L15 17l1 4"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l2 8h-6"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5zM5 16v3M19 16v3M5 11h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
};

function icon(name: keyof typeof ICONS, className = "icon"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

// --- rendering ---------------------------------------------------------------

function badge(b: Badge): HTMLElement {
  const code = el("span", { class: b.background ? "code" : "code outlined" }, [b.code]);
  if (b.background && b.color) {
    code.style.background = b.background;
    code.style.color = b.color;
  }
  return el("span", { class: "line", role: "img", "aria-label": b.label }, [icon(b.icon), code]);
}

function chain(row: Row): HTMLElement {
  if (row.moveOnly) {
    return el("span", { class: "chain" }, [el("span", { class: "line" }, [icon(row.moveOnly.icon), row.moveOnly.label])]);
  }
  const items: Child[] = [];
  row.badges.forEach((b, i) => {
    if (i > 0) items.push(el("span", { class: "sep", "aria-hidden": "true" }, ["›"]));
    items.push(badge(b));
  });
  return el("span", { class: "chain" }, items);
}

function step(s: Step): HTMLElement {
  const rail = el("span", { class: "rail-line" });
  const dot = el("span", { class: "dot" });
  const body = el("span", { class: "step-body" });
  const item = el("li", { class: `step ${s.kind}` }, [
    el("span", { class: "step-time" }, [s.time]),
    el("span", { class: "rail" }, [rail, dot]),
    body,
  ]);
  if (s.kind === "ride") {
    item.style.setProperty("--rail", s.badge.rail);
    const code = badge(s.badge);
    code.querySelector("svg")?.remove();
    body.append(el("span", { class: "step-title" }, [code, el("span", {}, [s.title])]));
    if (s.direction) body.append(el("span", { class: "step-sub" }, [`dir. ${s.direction}`]));
  } else {
    body.append(el("span", { class: "step-title" }, [s.title]));
  }
  return item;
}

function journeyRow(row: Row, open: boolean, toggle: () => void): HTMLElement {
  const stepsId = `steps-${row.id}`;
  const button = el(
    "button",
    { type: "button", class: "row", "aria-expanded": String(open), "aria-controls": stepsId },
    [
      el("span", { class: "when" }, [
        el("span", { class: "duration" }, [row.duration]),
        el("span", { class: "times" }, [row.times]),
      ]),
      el("span", { class: "what" }, [
        chain(row),
        (row.recommended || row.summary) &&
          el("span", { class: "summary" }, [
            row.recommended && el("span", { class: "tag" }, ["Recommandé"]),
            row.summary && el("span", {}, [row.summary]),
          ]),
      ]),
      icon("chevron", "chevron"),
    ],
  );
  button.addEventListener("click", toggle);
  const steps = el("ol", { class: "steps", id: stepsId }, row.steps.map(step));
  steps.hidden = !open;
  return el("div", { class: "journey" }, [button, steps]);
}

function disruptionsBlock(d: Extract<View, { kind: "journeys" }>["disruptions"], open: boolean, toggle: () => void) {
  const button = el("button", { type: "button", class: "disruptions-toggle", "aria-expanded": String(open), "aria-controls": "disruption-list" }, [
    icon("alert", "icon alert"),
    el("span", { class: "disruptions-label" }, [d.label]),
    el("span", { class: "more" }, [open ? "Masquer" : "Voir"]),
  ]);
  button.addEventListener("click", toggle);
  const list = el(
    "ul",
    { class: "disruption-list", id: "disruption-list" },
    d.groups.map((g) =>
      el("li", { class: g.severe ? "severe" : "" }, [
        el("span", {}, [g.label]),
        g.count > 1 && el("span", { class: "count" }, [`×${g.count}`]),
      ]),
    ),
  );
  list.hidden = !open;
  return el("section", { class: "disruptions", "aria-label": "Perturbations" }, [button, list]);
}

function skeleton(): HTMLElement {
  const bar = (w: string) => el("span", { class: "skeleton", style: `width: ${w}` });
  return el("div", { "aria-busy": "true" }, [
    el("div", { class: "header" }, [bar("55%"), el("span", { class: "subtitle" }, ["Recherche d'itinéraires…"])]),
    ...[0, 1].map(() =>
      el("div", { class: "row placeholder" }, [
        el("span", { class: "when" }, [bar("64px"), bar("88px")]),
        el("span", { class: "what" }, [bar("50%"), bar("35%")]),
      ]),
    ),
  ]);
}

// --- state ---------------------------------------------------------------------

const root = document.getElementById("app")!;
let payload: JourneysPayload | undefined;
let args: ToolArgs = {};
let openRow: string | null | undefined; // undefined: the first row starts open
let showDisruptions = false;

function render() {
  const view = buildView(payload, args);
  let content: Node;
  switch (view.kind) {
    case "loading":
      content = skeleton();
      break;
    case "empty":
      content = el("p", { class: "notice" }, [view.text]);
      break;
    case "error":
      content = el("div", { class: "notice error", role: "alert" }, [icon("alert", "icon alert"), el("span", {}, [view.text])]);
      break;
    case "journeys": {
      const open = openRow === undefined ? view.rows[0]?.id : openRow;
      content = el("div", {}, [
        el("header", { class: "header" }, [
          el("h1", { class: "route" }, [view.from, icon("arrow", "icon route-arrow"), view.to]),
          el("span", { class: "subtitle" }, [view.subtitle]),
        ]),
        ...view.rows.map((row) =>
          journeyRow(row, row.id === open, () => {
            openRow = row.id === open ? null : row.id;
            render();
          }),
        ),
        view.disruptions.total > 0 &&
          disruptionsBlock(view.disruptions, showDisruptions, () => {
            showDisruptions = !showDisruptions;
            render();
          }),
      ].filter((c): c is HTMLElement => !!c));
      break;
    }
  }
  root.replaceChildren(content);
}

/** The tool result as the payload the view reads; a failed call becomes an error. */
function readResult(result: { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }): JourneysPayload {
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) return { error: text.replace(/^Error:\s*/, "") || "La recherche a échoué." };
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as JourneysPayload;
  }
  try {
    return JSON.parse(text) as JourneysPayload;
  } catch {
    return { error: "Réponse illisible." };
  }
}

const app = new App({ name: "navitia-journeys", version: "0.1.0" });

app.ontoolinput = ({ arguments: input }) => {
  args = (input ?? {}) as ToolArgs;
  render();
};
app.ontoolresult = (result) => {
  payload = readResult(result);
  openRow = undefined;
  render();
};
app.ontoolcancelled = () => {
  payload = { error: "Recherche annulée." };
  render();
};
app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
};

render();
await app.connect();
const theme = app.getHostContext()?.theme;
if (theme) applyDocumentTheme(theme);
