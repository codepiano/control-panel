import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
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
  assert.equal(lock.packages["node_modules/" + name].version, selected);
  const copies = Object.keys(lock.packages).filter((path) =>
    path.endsWith("node_modules/" + name),
  );
  assert.equal(
    copies.length,
    1,
    `Multiple copies of ${name}: ${copies.join(", ")}`,
  );
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
