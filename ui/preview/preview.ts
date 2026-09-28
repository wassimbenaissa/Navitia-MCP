// A minimal MCP Apps host for working on the views without Claude: it mounts a
// view in a sandboxed iframe, like a real host, and sends it the tool input and
// result of the chosen fixture. Built by `npm run preview:ui`.
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

interface Fixture {
  label: string;
  arguments?: Record<string, unknown>;
  /** Omitted to show the view waiting for its result. */
  result?: Parameters<AppBridge["sendToolResult"]>[0];
}

type Views = Record<string, { html: string; fixtures: Fixture[] }>;

const views: Views = JSON.parse(document.getElementById("views")!.textContent!);
const stage = document.getElementById("stage")!;
const viewSelect = document.getElementById("view") as HTMLSelectElement;
const fixtureSelect = document.getElementById("fixture") as HTMLSelectElement;
const themeSelect = document.getElementById("theme") as HTMLSelectElement;
const widthSelect = document.getElementById("width") as HTMLSelectElement;

let bridge: AppBridge | undefined;

function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function fillFixtures() {
  const fixtures = views[viewSelect.value].fixtures;
  fixtureSelect.replaceChildren(...fixtures.map((f, i) => option(String(i), f.label)));
}

async function mount() {
  await bridge?.close();
  const view = views[viewSelect.value];
  const fixture = view.fixtures[Number(fixtureSelect.value)];
  const theme = themeSelect.value as "light" | "dark";
  document.documentElement.dataset.theme = theme;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.title = `Vue ${viewSelect.value}`;
  iframe.style.width = `${widthSelect.value}px`;
  stage.replaceChildren(iframe);

  bridge = new AppBridge(null, { name: "Navitia preview", version: "0.0.0" }, {}, {
    hostContext: { theme, displayMode: "inline", locale: "fr-FR", platform: "desktop" },
  });
  bridge.onsizechange = ({ height }) => {
    if (height) iframe.style.height = `${Math.ceil(height)}px`;
  };
  bridge.oninitialized = async () => {
    await bridge!.sendToolInput({ arguments: fixture.arguments ?? {} });
    if (fixture.result) await bridge!.sendToolResult(fixture.result);
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  iframe.srcdoc = view.html;
}

viewSelect.replaceChildren(...Object.keys(views).map((name) => option(name, name)));
fillFixtures();
viewSelect.addEventListener("change", () => {
  fillFixtures();
  void mount();
});
for (const select of [fixtureSelect, themeSelect, widthSelect]) select.addEventListener("change", () => void mount());
void mount();
