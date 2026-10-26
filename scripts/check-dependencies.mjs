import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = await readFile("pnpm-lock.yaml", "utf8");
// Package keys are top-level entries in the packages section; peer snapshots
// are excluded so one resolution is counted once.
// pnpm 12 has separate YAML documents for its bootstrap and application graph.
const packages = [...lock.matchAll(/(?:^|\n)packages:\n([\s\S]*?)(?=\nsnapshots:\n|$)/g)]
  .map((match) => match[1]).join("\n");
const keys = [...packages.matchAll(/^  ['"]?(\S[^\n]*?)['"]?:$/gm)].map((match) => match[1]);
for (const name of [
  "react",
  "react-dom",
  "@mantine/core",
  "@mantine/hooks",
  "@types/react",
  "@types/react-dom",
]) {
  const selected = pkg.dependencies[name] || pkg.devDependencies[name];
  assert.match(
    selected,
    /^\d+\.\d+\.\d+$/,
    `${name} must pin a stable release`,
  );
  const copies = keys.filter((key) => key.startsWith(`${name}@`));
  assert.deepEqual(copies, [`${name}@${selected}`],
    `Expected one locked version of ${name}: ${copies.join(", ")}`);
  assert.equal(
    JSON.parse(await readFile("node_modules/" + name + "/package.json", "utf8"))
      .version,
    selected,
    `Installed ${name} differs from lockfile`,
  );
}
assert.equal(pkg.dependencies.react, pkg.dependencies["react-dom"]);
assert.equal(
  pkg.dependencies["@mantine/core"],
  pkg.dependencies["@mantine/hooks"],
);
const peers = JSON.parse(
  await readFile("node_modules/@mantine/core/package.json", "utf8"),
).peerDependencies;
assert.equal(peers.react, "^19.2.0");
const [major, minor] = pkg.dependencies.react.split(".").map(Number);
assert.ok(
  major === 19 && minor >= 2,
  `Review current Mantine React compatibility: ${peers.react}`,
);
console.log(
  "Stable versions, installed dependencies and single React identity verified.",
);
