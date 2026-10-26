import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import { gzipSync } from "node:zlib";
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const meta = await json("dist/build-meta.json");
const report = await json("dist/bundle-report.json");
const manifest = await json("dist/manifest.json");
const baseline = await json("docs/bundle-baseline.json");
const initial = new Set();
const walk = (file) => {
  if (initial.has(file)) return;
  initial.add(file);
  if (meta.outputs[file].cssBundle) walk(meta.outputs[file].cssBundle);
  for (const item of meta.outputs[file].imports)
    if (!item.external && item.kind !== "dynamic-import") walk(item.path);
};
walk("dist/app.js");
assert.deepEqual(report.warnings, [], "Build must not hide warnings");
let sum = { bytes: 0, gzip: 0 };
for (const row of report.files) {
  const bytes = await readFile(row.file);
  assert.equal(row.bytes, bytes.length);
  assert.equal(row.gzip, gzipSync(bytes, { level: 9 }).length);
  assert.equal(
    row.initial,
    !row.file.startsWith("dist/") || initial.has(row.file),
  );
  if (row.initial) {
    sum.bytes += row.bytes;
    sum.gzip += row.gzip;
  }
}
assert.deepEqual(
  sum,
  report.initial,
  "Count every transitive initial asset once",
);
assert.ok(
  report.initial.gzip < 205000,
  `Initial gzip budget exceeded: ${report.initial.gzip}`,
);
const code = report.files.filter(
  (row) => row.initial && /\.(?:js|css)$/.test(row.file),
);
const oldCode = baseline.files.filter((row) => /\.(?:js|css)$/.test(row.url));
assert.ok(
  code.reduce((n, row) => n + row.gzip, 0) <
    oldCode.reduce((n, row) => n + row.gzip, 0) * 0.88,
  "Require >=12% JS/CSS gzip reduction, independently of favicon",
);
const initialInputs = new Set(
  [...initial].flatMap((file) =>
    Object.entries(meta.outputs[file].inputs)
      .filter(([, value]) => value.bytesInOutput > 0)
      .map(([path]) => path),
  ),
);
for (const view of ["Settings", "Editor", "Organization", "Repositories"]) {
  const source = `src/ui/views/${view}.jsx`;
  assert.ok(!initialInputs.has(source), `${view} must stay lazy`);
  assert.ok(
    Object.keys(meta.outputs).some(
      (file) =>
        file.endsWith(".js") &&
        !initial.has(file) &&
        meta.outputs[file].inputs[source]?.bytesInOutput > 0,
    ),
  );
}
for (const name of ["Modal", "NumberInput"])
  assert.ok(
    ![...initialInputs].some((file) => file.endsWith(`/${name}/${name}.mjs`)),
    `${name} must not leak into initial JS`,
  );
assert.ok(
  manifest.files.some((file) => /^chunks\/.*-[A-Z0-9]{8}\.js$/.test(file)),
  "Shared chunks must be content-addressed",
);
const runtime = Object.entries(meta.outputs).find(
  ([file, output]) =>
    file.endsWith(".js") &&
    Object.entries(output.inputs).some(([path, input]) =>
      path.endsWith("/react-dom/cjs/react-dom-client.production.js") && input.bytesInOutput > 0
    ),
);
assert.match(
  runtime[0],
  /chunks\/.*-[A-Z0-9]{8}\.js$/,
  "React DOM must live in a cacheable hashed chunk",
);

// Check real generated coordinates, including upstream Mantine TSX mappings.
for (const [token, sourceSuffix] of [
  ["YOUR LOCAL SERVICES", "/src/ui/app.jsx"],
  ['"@mantine/core/Select"', "/Select/Select.tsx"],
  ['"@mantine/core/Modal"', "/Modal/Modal.tsx"],
]) {
  let found = false;
  for (const file of Object.keys(meta.outputs).filter((file) =>
    file.endsWith(".js"),
  )) {
    const code = await readFile(file, "utf8"),
      index = code.indexOf(token);
    if (index < 0) continue;
    const map = await json(file + ".map");
    const lines = code.slice(0, index).split("\n");
    const entry = new SourceMap(map).findEntry(
      lines.length - 1,
      lines.at(-1).length,
    );
    assert.ok(
      entry.originalSource?.endsWith(sourceSuffix),
      `${token} maps to ${entry.originalSource}`,
    );
    const sourceIndex = map.sources.findIndex((path) =>
      path.endsWith(sourceSuffix),
    );
    assert.ok(
      map.sourcesContent[sourceIndex]
        .split("\n")
        [entry.originalLine].includes(token.replaceAll('"', "")),
      `${token} must locate its actual original source line`,
    );
    found = true;
    break;
  }
  assert.ok(found, `Missing sourcemap probe: ${token}`);
}
for (const file of manifest.files) {
  await readFile("dist/" + file);
  if (/\.(js|css)$/.test(file))
    assert.ok(
      manifest.files.includes(file + ".map"),
      `Missing sourcemap for ${file}`,
    );
}

// Selected CSS must cover every retained Mantine class map, including internal dependencies.
const css = await readFile("dist/app.css", "utf8");
const inputs = new Set(
  Object.values(meta.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, value]) => value.bytesInOutput > 0)
      .map(([file]) => file),
  ),
);
const missing = [];
for (const file of inputs) {
  if (!file.includes("@mantine/core/esm/") || !/\.module\.mjs$/.test(file))
    continue;
  const source = await readFile(file, "utf8");
  for (const [, cls] of source.matchAll(/"(m_[a-z0-9]+)"/g))
    if (!css.includes(cls)) missing.push({ file, cls });
}
assert.deepEqual(missing, [], "Missing selected Mantine dependency styles");
assert.ok(
  (await readFile("assets/favicon.png")).length < 5000,
  "Do not serve the original icon as a favicon",
);
console.log(
  `Bundle regression checks passed: ${report.initial.bytes} bytes / ${report.initial.gzip} gzip bytes initially.`,
);
