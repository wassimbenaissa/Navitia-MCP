#!/usr/bin/env node
// Builds each MCP Apps view in ui/<name>/ into one self-contained file,
// dist/ui/<name>.html: a host loads a view as a single HTML document, so the
// bundled script is inlined into the page.
//
//   node scripts/build-ui.mjs            views only
//   node scripts/build-ui.mjs --preview  views + .preview/index.html, a local
//                                        host that feeds the views fixtures
//
// Logs go to stderr: stdout belongs to the MCP stdio transport under `npm run dev`.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWS = ["journeys"];

async function bundle(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
    logLevel: "warning",
  });
  // An inline script ends at the first "</script", whatever the JS around it.
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

/** Put `html` into `template` at `marker`, without `$` patterns in it being expanded. */
function inject(template, marker, html, source) {
  if (!template.includes(marker)) throw new Error(`${source} has no ${marker} marker`);
  return template.replace(marker, () => html);
}

async function write(file, html) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  console.error(`built ${file.slice(root.length + 1)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
}

async function buildView(name) {
  const dir = resolve(root, "ui", name);
  const [template, script] = await Promise.all([
    readFile(resolve(dir, "index.html"), "utf8"),
    bundle(resolve(dir, "app.ts")),
  ]);
  const html = inject(template, "<!-- app-script -->", `<script type="module">${script}</script>`, `ui/${name}/index.html`);
  await write(resolve(root, "dist", "ui", `${name}.html`), html);
  return html;
}

// JSON inside <script type="application/json">: escape "<" so no "</script" can end it.
const jsonScript = (id, value) =>
  `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;

async function buildPreview(views) {
  const dir = resolve(root, "ui", "preview");
  const [template, script, ...fixtures] = await Promise.all([
    readFile(resolve(dir, "index.html"), "utf8"),
    bundle(resolve(dir, "preview.ts")),
    ...VIEWS.map((name) => readFile(resolve(dir, "fixtures", `${name}.json`), "utf8").then((text) => JSON.parse(text).fixtures)),
  ]);
  const data = Object.fromEntries(VIEWS.map((name, i) => [name, { html: views[i], fixtures: fixtures[i] }]));
  const html = inject(
    template,
    "<!-- preview-script -->",
    `${jsonScript("views", data)}<script type="module">${script}</script>`,
    "ui/preview/index.html",
  );
  await write(resolve(root, ".preview", "index.html"), html);
}

const views = await Promise.all(VIEWS.map(buildView));
if (process.argv.includes("--preview")) await buildPreview(views);
