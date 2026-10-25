const { test, expect } = require("@playwright/test");
const longName =
  "Agent Docs 文档协作与知识管理工作台（这是一个用于验证长服务名称和箭头留白的完整标题）";
const projects = [
  {
    key: "parent",
    name: "研究工作区",
    status: "running",
    projectDir: "/tmp/research",
    canBatchStart: true,
    canStartOnPanelLaunch: true,
    lastStartedAt: "2026-10-24T00:00:00Z",
    pid: 1234,
    frontendUrl: "http://127.0.0.1:4320",
    ancestors: [],
    release: { protocol: 1 },
    version: {
      state: "needs-build",
      sourceRevision: "source-new",
      runningRevision: "running-old",
    },
    tags: ["常驻"],
    startOnPanelLaunch: true,
  },
  {
    key: "child",
    name: longName,
    status: "stopped",
    projectDir: "/tmp/research/child",
    manifestPath: "/tmp/research/child/control-panel.json",
    canBatchStart: true,
    canStartOnPanelLaunch: true,
    ancestors: [{ key: "parent", name: "研究工作区" }],
    relationship: { role: "api" },
    notes: "长说明文字用于检查布局与实际服务操作。",
    tags: ["文档"],
    localGroup: "工作常驻服务与知识管理工具（长分组名称验证）",
  },
  {
    key: "error",
    name: "异常服务",
    status: "error",
    ancestors: [],
    details: "启动失败：端口已被占用",
    canBatchStart: true,
    tags: [],
  },
  {
    key: "panel",
    name: "控制面板",
    isPanel: true,
    status: "running",
    ancestors: [],
    release: { protocol: 1 },
    version: { state: "current" },
    tags: [],
  },
];
const dashboard = {
  projects,
  config: { roots: ["/tmp/research"], scan: { maxDepth: 1 } },
  backendStartedAt: "2026-10-24T00:00:00Z",
  snapshotId: "unchanged",
  configPath: "/tmp/panel/config.json",
  statePath: "/tmp/panel/state.json",
  scanReport: { collections: [], issues: [] },
  portReport: {
    conflictCount: 1,
    suggestions: [4400, 4401],
    rows: [
      {
        port: 4320,
        owners: [{ name: "研究工作区" }],
        listeners: [{ command: "node", pid: 1234, address: "127.0.0.1:4320" }],
        warnings: ["重复分配测试"],
      },
    ],
  },
};
const repositories = {
  repositories: [
    {
      key: "repo",
      name: "研究工作区",
      status: "behind",
      behind: 2,
      branch: "main",
      upstream: "origin/main",
      remoteUrl: "https://example.com/repo.git",
      mergeRef: "refs/heads/main",
      directory: "/tmp/research",
      services: [
        { key: "parent" },
        { key: "child", ancestors: [{ key: "parent" }] },
      ],
      lastSyncResult: { outcome: "failed", detail: "final rejection reason" },
    },
    {
      key: "pinned",
      name: "子模块",
      status: "pinned",
      head: "abcdef123456",
      services: [],
      directory: "/tmp/submodule",
    },
  ],
  operation: "check",
  results: [
    { key: "repo", name: "研究工作区", outcome: "checked", detail: "检查完成" },
  ],
  lastSync: {
    results: [
      {
        key: "repo",
        name: "研究工作区",
        outcome: "failed",
        detail: "final rejection reason",
      },
      {
        key: "pinned",
        name: "子模块",
        outcome: "skipped",
        detail: "分支已分叉",
      },
    ],
  },
};
let calls;
async function setup(page, fail = "", url = "/") {
  calls = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      action = url.pathname.split("/").pop();
    if (action === "session")
      return route.fulfill({ json: { token: "test-only" } });
    const args = route.request().postDataJSON().args;
    calls.push({ action, args });
    if (action === fail)
      return route.fulfill({
        status: 400,
        json: { error: "测试失败：端口已占用" },
      });
    let data =
      action === "get-dashboard-data"
        ? dashboard
        : [
              "get-repository-sync",
              "check-repositories",
              "sync-repositories",
            ].includes(action)
          ? repositories
          : action === "start-projects"
            ? args[0].map((key) => ({
                name: key,
                outcome: key === "error" ? "failed" : "skipped",
                detail: key === "error" ? "端口占用" : "已运行",
              }))
            : true;
    await route.fulfill({ json: { data } });
  });
  await page.goto(url);
  await expect(page.locator("h1")).toHaveText("全部服务");
  await expect(page.locator('[data-project-key="child"]')).toBeVisible();
}
test("production assets load under CSP; filters, long labels and keyboard navigation work", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await setup(page);
  await page.getByRole("textbox", { name: "搜索服务" }).fill("知识管理");
  await expect(page.locator('[data-project-key="child"]')).toBeVisible();
  await expect(page.locator('[data-project-key="error"]')).toHaveCount(0);
  await page.getByRole("textbox", { name: "搜索服务" }).fill("");
  const status = page.getByRole("combobox", { name: "按状态筛选" });
  await status.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("option", { name: "已停止", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(status).not.toHaveValue("全部状态");
  await status.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await page
    .getByRole("button", { name: "全部服务", exact: false })
    .first()
    .click();
  await expect(page.locator('[data-project-key="parent"]')).toContainText(
    "代码更新待构建",
  );
  await expect(page.locator('[data-project-key="error"]')).toContainText(
    "端口已被占用",
  );
  await expect(
    page
      .locator('[data-project-key="panel"]')
      .getByRole("button", { name: "停止", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/control-panel-optimized-desktop.png",
    fullPage: true,
  });
});
test("service actions remain retryable after unchanged snapshots and errors", async ({
  page,
}) => {
  await setup(page, "start-project");
  const child = page.locator('[data-project-key="child"]'),
    start = child.getByRole("button", { name: "启动", exact: true });
  await start.click();
  await expect(page.getByRole("status")).toContainText("端口已占用");
  await expect(start).toBeEnabled();
  await start.click();
  await expect
    .poll(() => calls.filter((c) => c.action === "start-project").length)
    .toBe(2);
  await child.getByRole("button", { name: "更多操作", exact: false }).click();
  await page.getByRole("menuitem", { name: "检查代码更新" }).click();
  await expect(page.getByRole("dialog")).toContainText("当前项目 · 研究工作区");
  expect(calls.find((c) => c.action === "check-repositories").args).toEqual([
    ["repo"],
  ]);
});
test("batch organization preserves unrelated preferences and batch results remain per item", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("checkbox", { name: "选择当前列表", exact: true })
    .check();
  await page.getByRole("button", { name: "批量归组", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "分组", exact: true })
    .fill("临时分组");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const call = calls.find((c) => c.action === "save-project-organization");
  expect(call.args[1]).toEqual({ group: "临时分组" });
  expect(call.args[0]).toHaveLength(4);
  await page.getByRole("button", { name: "启动所选", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "error · 失败：端口占用",
  );
});
test("Mantine modals trap focus, return focus and expose settings and presentation fields", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  const settings = page.getByRole("button", { name: "设置与发现入口" });
  await settings.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("combobox", { name: "入口扫描范围" }).click();
  await expect(
    page.getByRole("option", { name: "入口与下一层（默认）" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/control-panel-optimized-settings.png",
  });
  let releaseDepth;
  await page.route(
    "**/api/set-scan-depth",
    (route) =>
      new Promise((resolve) => {
        releaseDepth = async () => {
          await route.fulfill({ json: { data: true } });
          resolve();
        };
      }),
  );
  const depth = page.getByRole("combobox", { name: "入口扫描范围" });
  await depth.click();
  await page.getByRole("option", { name: "只读入口本身", exact: true }).click();
  await expect(depth).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/control-panel-optimized-disabled.png",
  });
  await releaseDepth();
  await expect(depth).toBeEnabled();
  await depth.focus();

  await page.keyboard.press("Tab");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(settings).toBeFocused();
  const child = page.locator('[data-project-key="child"]');
  await child.getByRole("button", { name: "更多操作", exact: false }).click();
  await page.getByRole("menuitem", { name: "编辑展示信息" }).click();
  await expect(page.getByRole("textbox", { name: "服务名称" })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: "/tmp/control-panel-optimized-editor.png" });
  await page.getByRole("textbox", { name: "服务名称" }).fill("新名称");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    calls.find((c) => c.action === "save-project-presentation").args[0],
  ).toBe("child");
  expect(errors).toEqual([]);
});
test("repository failures survive checks, safe actions and owned-process badges stay correct", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page
      .locator('[data-project-key="child"]')
      .getByRole("button", { name: "仓库同步状态", exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "仓库同步", exact: false })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("失败 1");
  await expect(dialog).toContainText("final rejection reason");
  await expect(dialog).toContainText("分支已分叉");
  await dialog.getByRole("button", { name: "全部仓库 2" }).click();
  await expect(dialog).toContainText("由父仓库管理 · abcdef12");
  await expect(
    dialog
      .locator('[data-repo-key="pinned"]')
      .getByRole("button", { name: "拉取", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/control-panel-optimized-repositories.png",
  });
});
test("desktop compact window, focused long select and disabled states render without clipping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  await setup(page);
  const sorting = page.getByRole("combobox", { name: "排序方式" });
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="排序方式"]');
    input.value = "按最近启动时间排序（包含全部子服务的长选项）";
    input.focus();
  });
  await expect(sorting).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/control-panel-optimized-compact.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "本机端口分配", exact: false })
    .click();
  await expect(page.getByRole("cell", { name: "重复分配测试" })).toBeVisible();
});

test("real temporary backend discovers a service, starts it, saves organization and edits its manifest", async ({
  page,
}) => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "panel-ui-service-"));
  const marker = path.join(root, "running"),
    manifest = path.join(root, "control-panel.json");
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      name: "隔离验收服务",
      workingDirectory: ".",
      startCommand: `touch '${marker}'`,
      stopCommand: `rm -f '${marker}'`,
      statusCommand: `test -f '${marker}'`,
    }),
  );
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "设置与发现入口" }).click();
    await page.getByLabel("扫描入口路径").fill(root);
    await page.getByRole("button", { name: "添加入口", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(root);
    const scanDepth = page.getByRole("combobox", { name: "入口扫描范围" });
    await scanDepth.click();
    await page
      .getByRole("option", { name: "只读入口本身", exact: true })
      .click();
    await expect(scanDepth).toBeEnabled();
    await expect(scanDepth).toHaveValue("只读入口本身");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "设置与发现入口" }).click();
    await expect(
      page.getByRole("combobox", { name: "入口扫描范围" }),
    ).toHaveValue("只读入口本身");
    await page.keyboard.press("Escape");
    const service = page
      .locator("[data-project-key]")
      .filter({ hasText: "隔离验收服务" });
    await expect(service).toBeVisible();
    await service.getByRole("button", { name: "启动", exact: true }).click();
    await expect(service).toContainText("运行中");
    expect(fs.existsSync(marker)).toBe(true);
    await service
      .getByRole("button", { name: "更多操作", exact: false })
      .click();
    await page.getByRole("menuitem", { name: "标记与分组" }).click();
    await page
      .getByRole("combobox", { name: "分组", exact: true })
      .fill("验收分组");
    await page.getByLabel("标签", { exact: true }).fill("临时, 验证");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(service).toContainText("验收分组");
    await service
      .getByRole("button", { name: "更多操作", exact: false })
      .click();
    await page.getByRole("menuitem", { name: "编辑展示信息" }).click();
    await page.getByLabel("备注").fill("真实临时数据验收");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(manifest, "utf8")).notes).toBe(
      "真实临时数据验收",
    );
    await service
      .getByRole("button", { name: "更多操作", exact: false })
      .click();
    await page.getByRole("menuitem", { name: "编辑展示信息" }).click();
    await expect(page.getByLabel("备注")).toHaveValue("真实临时数据验收");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await service.getByRole("button", { name: "停止", exact: true }).click();
    await expect(service).toContainText("已停止");
    expect(fs.existsSync(marker)).toBe(false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("initial network excludes secondary views; lazy navigation has feedback, direct URLs and history", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/ui/"))
      requests.push(new URL(request.url()).pathname);
  });
  await setup(page);
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync("dist/bundle-report.json", "utf8"));
  await expect
    .poll(() => requests.filter((url) => url.endsWith(".js")).length)
    .toBe(
      report.files.filter(
        (file) =>
          file.initial &&
          file.url.startsWith("/ui/") &&
          file.url.endsWith(".js"),
      ).length,
    );
  expect(
    requests.some((url) =>
      /\/(Settings|Editor|Organization|Repositories)-/.test(url),
    ),
  ).toBe(false);
  let release;
  await page.route(
    "**/ui/chunks/Settings-*.js",
    (route) =>
      new Promise((resolve) => {
        release = async () => {
          await route.continue();
          resolve();
        };
      }),
  );
  await page.getByRole("button", { name: "设置与发现入口" }).click();
  await expect(page.getByRole("status")).toContainText("正在加载面板");
  await expect(
    page.getByRole("heading", { name: "全部服务", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "全部服务", exact: false }).first(),
  ).toBeVisible();
  await release();
  await expect(page.getByRole("dialog")).toContainText("设置与服务发现");
  await expect(page).toHaveURL(/view=settings/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/view=/);
  await page.goBack();
  await expect(page.getByRole("dialog")).toContainText("设置与服务发现");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "仓库同步", exact: false })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("仓库同步");
  await expect(page).toHaveURL(/view=repositories/);
  expect(requests.some((url) => /\/Editor-/.test(url))).toBe(false);
  expect(requests.some((url) => /\/Repositories-/.test(url))).toBe(true);
});

for (const [url, title] of [
  ["/?view=settings", "设置与服务发现"],
  ["/?view=repositories&filter=all", "全部仓库 2"],
]) {
  test(`direct lazy surface ${url}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await setup(page, "", url);
    await expect(page.getByRole("dialog")).toContainText(title);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("searchable group combobox filters long options, selects with keyboard and returns focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  await setup(page);
  const child = page.locator('[data-project-key="child"]');
  await child.getByRole("button", { name: "更多操作", exact: false }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  await page.getByRole("menuitem", { name: "标记与分组" }).click();
  const group = page.getByRole("combobox", { name: "分组", exact: true });
  await group.fill("常驻服务");
  const option = page.getByRole("option", {
    name: projects[1].localGroup,
    exact: true,
  });
  await expect(option).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/control-panel-optimized-search-options.png",
  });
  await group.press("ArrowDown");
  await group.press("Enter");
  await expect(group).toHaveValue(projects[1].localGroup);
  await group.fill("不存在的分组");
  await expect(page.getByRole("option")).toHaveCount(0);
  await group.fill("工作");
  await expect(option).toBeVisible();
  await group.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(group).toBeFocused();
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/control-panel-optimized-search.png",
  });
  await group.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("failed secondary chunk shows a scoped error while the service list stays usable", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/ui/chunks/Settings-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "设置与发现入口" }).click();
  await expect(page.getByRole("alert")).toContainText("面板加载失败");
  await expect(
    page.getByRole("heading", { name: "全部服务", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索服务" }).fill("异常服务");
  await expect(page.locator('[data-project-key="error"]')).toBeVisible();
  await expect(page.locator('[data-project-key="child"]')).toHaveCount(0);
});
