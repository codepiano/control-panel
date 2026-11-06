const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  repositoryForProject,
  repositoryGroup,
  repositoryResults,
  repositoryNeedsAttention,
  repositoryCanSync,
  repositoryActionGuidance,
} = require("../src/ui/model.cjs");
test("owned processes share repository identity, independent children keep their badges", () => {
  const repos = [
    {
      key: "parent-repo",
      services: [
        { key: "parent" },
        { key: "process" },
        { key: "deep-process" },
      ],
    },
    { key: "own-repo", services: [{ key: "independent" }] },
  ];
  const ancestor = [{ key: "parent" }];
  assert.equal(
    repositoryForProject({ key: "parent" }, repos, true).key,
    "parent-repo",
  );
  assert.equal(
    repositoryForProject({ key: "process", ancestors: ancestor }, repos, true),
    null,
  );
  assert.equal(
    repositoryForProject(
      { key: "deep-process", ancestors: [...ancestor, { key: "process" }] },
      repos,
      true,
    ),
    null,
  );
  assert.equal(
    repositoryForProject(
      { key: "independent", ancestors: ancestor },
      repos,
      true,
    ).key,
    "own-repo",
  );
  assert.equal(
    repositoryForProject({ key: "process", ancestors: ancestor }, repos).key,
    "parent-repo",
  );
  assert.equal(repositoryForProject({ key: "missing" }, repos), undefined);
});
test("checks preserve previous failed and skipped sync results; project scope survives polling", () => {
  const failed = {
      key: "one",
      outcome: "failed",
      detail: "final rejection reason",
    },
    skipped = { key: "two", outcome: "skipped", detail: "分支已分叉" };
  const payload = {
    operation: "check",
    lastSync: { results: [failed, skipped] },
    results: [{ key: "one", outcome: "checked" }],
  };
  assert.deepEqual(
    repositoryResults(payload).map((g) => g.results),
    [[failed, skipped], payload.results],
  );
  assert.deepEqual(
    repositoryResults(payload, "one").map((g) => g.results),
    [[failed], payload.results],
  );
  assert.deepEqual(repositoryResults(payload, "missing"), []);
  assert.equal(
    repositoryResults({ operation: "pull", results: [failed] })[0].results[0],
    failed,
  );
});
test("pinned submodules need no intervention unless dirty; unsafe repositories cannot sync", () => {
  assert.equal(repositoryNeedsAttention({ status: "pinned" }), false);
  assert.match(repositoryActionGuidance({ status: "pinned" }), /无需操作/);
  assert.equal(repositoryNeedsAttention({ status: "pinned", dirty: 1 }), true);
  assert.equal(repositoryNeedsAttention({ status: "unchecked" }), true);
  const repo = {
    status: "behind",
    behind: 2,
    branch: "main",
    upstream: "origin/main",
    remoteUrl: "https://example.com/repo.git",
    mergeRef: "refs/heads/main",
  };
  assert.equal(repositoryCanSync(repo, "pull"), true);
  for (const bad of [
    { dirty: 1 },
    { inProgress: true },
    { ahead: 1 },
    { status: "unchecked" },
    { error: "fetch failed" },
  ])
    assert.equal(repositoryCanSync({ ...repo, ...bad }, "pull"), false);
});

test("repository check scopes include nested repositories and service descendants only", () => {
  const repos = [
    { key: "root", directory: "/work/app", services: [{ key: "app" }, { key: "worker" }] },
    { key: "child", directory: "/elsewhere/api", services: [{ key: "api", ancestors: [{ key: "app" }] }] },
    { key: "deep", directory: "/elsewhere/api/nested", services: [] },
    { key: "nested", directory: "/work/app/lib", services: [] },
    { key: "sibling", directory: "/work/app-other", services: [{ key: "other" }] },
  ];
  assert.deepEqual(repositoryGroup(repos, "root").map(r => r.key), ["root", "child", "deep", "nested"]);
  assert.deepEqual(repositoryGroup(repos, "child").map(r => r.key), ["child", "deep"]);
  assert.deepEqual(repositoryGroup(repos, "missing"), []);
  const payload = { operation: "check", results: repos.map(r => ({ key: r.key })) };
  assert.deepEqual(repositoryResults(payload, ["root", "child"])[0].results.map(r => r.key), ["root", "child"]);
});
