import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { createRoot } from "./react-runtime.js";
import {
  ActionIcon,
  Accordion,
  Alert,
  AppShell,
  Avatar,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Loader,
  MantineProvider,
  Menu,
  NavLink,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "./components.jsx";
import {
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconCircleFilled,
  IconCode,
  IconDots,
  IconGitBranch,
  IconLayoutDashboard,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconServer,
  IconSettings,
  IconStar,
} from "@tabler/icons-react";
import { setNonce } from "get-nonce";
import model from "./model.cjs";
import "./mantine-styles.css";
import "./styles.css";
const {
  formatTimestamp: timestamp,
  formatUptime,
  statusLabel,
  statusSummary,
  projectMatchesSearch,
  repositoryNeedsAttention: needsAttention,
  repositoryStatusText: repoText,
  repositoryForProject,
} = model;
import { theme } from "./theme.js";
import { useViewRoute } from "./view-route.js";
import { Empty } from "./shared.jsx";
const Settings = lazy(() => import("./views/Settings.jsx"));
const Editor = lazy(() => import("./views/Editor.jsx"));
const Organization = lazy(() => import("./views/Organization.jsx"));
const Repositories = lazy(() => import("./views/Repositories.jsx"));
const api = window.controlPanel;
const { buildProjectTree, matchingProjects } = window.projectTree;
const colorFor = (status) =>
  status === "running"
    ? "teal"
    : status === "error"
      ? "red"
      : ["starting", "stopping"].includes(status)
        ? "yellow"
        : "gray";
const statusOptions = [
  "all",
  "running",
  "stopped",
  "starting",
  "stopping",
  "error",
].map((value) => ({
  value,
  label: value === "all" ? "全部状态" : statusLabel(value),
}));
const sortOptions = [
  { value: "status", label: "运行中优先" },
  { value: "name", label: "按名称排序" },
  { value: "recent", label: "最近启动" },
];
function useClock() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) tick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);
}
function Uptime({ at, status = "running", backend = false }) {
  useClock();
  return (
    <Text size="xs" c="dimmed">
      {formatUptime(at, status).replace(
        "运行",
        backend ? "后端已运行" : "运行",
      )}
    </Text>
  );
}
function NavigationNode({ node, scope, selectScope, depth = 0 }) {
  return (
    <>
      <NavLink
        component="button"
        type="button"
        label={node.name}
        active={scope === `project:${node.key}`}
        onClick={() => selectScope(`project:${node.key}`)}
        pl={12 + depth * 12}
        rightSection={
          <Text size="xs" c="dimmed">
            {matchingProjects(node).length}
          </Text>
        }
      />
      {node.children.map((child) => (
        <NavigationNode
          key={child.key}
          node={child}
          depth={depth + 1}
          scope={scope}
          selectScope={selectScope}
        />
      ))}
    </>
  );
}

/** @extends {React.Component<{ active: boolean, children: React.ReactNode }>} */
class SurfaceBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.active ? (
      <Alert
        className="surface-loading"
        color="red"
        role="alert"
        title="面板加载失败"
      >
        <Text size="sm">请重新加载页面后再试。</Text>
        <Button size="xs" mt="sm" onClick={() => window.location.reload()}>
          重新加载页面
        </Button>
      </Alert>
    ) : null;
  }
}
function LoadingSurface() {
  return (
    <Paper
      className="surface-loading"
      withBorder
      shadow="md"
      p="md"
      role="status"
    >
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm">正在加载面板…</Text>
      </Group>
    </Paper>
  );
}
function App() {
  const { settings, setSettings, repoModal, setRepoModal } = useViewRoute();
  const [data, setData] = useState(null),
    [repos, setRepos] = useState(
      /** @type {{ repositories: any[], busy?: boolean }} */ ({
        repositories: [],
      }),
    );
  const [connected, setConnected] = useState(false),
    [message, setMessage] = useState(""),
    [results, setResults] = useState([]);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("status"),
    [scope, setScope] = useState("all"),
    [tag, setTag] = useState(null),
    [favorites, setFavorites] = useState(false);
  const [selected, setSelected] = useState(new Set()),
    [busy, setBusy] = useState(new Set());
  const [editor, setEditor] = useState(null),
    [organization, setOrganization] = useState(null);
  const refreshing = useRef(false),
    repoReading = useRef(false),
    locks = useRef(new Set()),
    restarting = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current || restarting.current) return;
    refreshing.current = true;
    try {
      const next = await api.getDashboardData();
      setData(next);
      setConnected(true);
      setSelected(
        (old) =>
          new Set(
            [...old].filter((key) => next.projects.some((p) => p.key === key)),
          ),
      );
    } catch (error) {
      setConnected(false);
      setMessage(`刷新失败：${error.message}`);
    } finally {
      refreshing.current = false;
    }
  }, []);
  const readRepos = useCallback(async () => {
    if (repoReading.current || restarting.current) return;
    repoReading.current = true;
    try {
      setRepos(await api.getRepositorySync());
    } catch (error) {
      setMessage(`仓库状态读取失败：${error.message}`);
    } finally {
      repoReading.current = false;
    }
  }, []);
  useEffect(() => {
    refresh();
    readRepos();
    const dashboardTimer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 5000);
    const wake = () => {
      if (!document.hidden) {
        refresh();
        readRepos();
      }
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(dashboardTimer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh, readRepos]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden) readRepos();
      },
      repos.busy ? 2000 : 15000,
    );
    return () => clearInterval(timer);
  }, [repos.busy, readRepos]);
  const run = async (key, action) => {
    if (locks.current.has(key)) return false;
    locks.current.add(key);
    setBusy(new Set(locks.current));
    try {
      await action();
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    } finally {
      await refresh();
      locks.current.delete(key);
      setBusy(new Set(locks.current));
    }
  };
  const repoAction = async (kind, keys) => {
    if (repos.busy) return;
    await run("repositories", async () =>
      setRepos(
        kind === "check"
          ? await api.checkRepositories(keys)
          : await api.syncRepositories(kind, keys),
      ),
    );
    await readRepos();
  };
  const checkRepo = (project) =>
    run(`repo:${project.key}`, async () => {
      const payload = await api.getRepositorySync();
      setRepos(payload);
      const repo = repositoryForProject(project, payload.repositories);
      if (!repo) throw new Error(`${project.name} 没有可识别的 Git 仓库`);
      setRepoModal({ view: "project", key: repo.key });
      if (!payload.busy) setRepos(await api.checkRepositories([repo.key]));
    });
  const projectAction = (project, action) =>
    run(project.key, async () => {
      if (project.isPanel && action === "restart") {
        restarting.current = true;
        setMessage("控制面板正在重启，页面将自动重新连接…");
        try {
          const { pid } = await api.restartPanel();
          await api.waitForPanelRestart(pid);
          setMessage("控制面板已重启，连接已恢复。");
        } finally {
          restarting.current = false;
        }
        await readRepos();
      } else await api[`${action}Project`](project.key);
    });
  const batchStart = (keys, title) =>
    run("batch", async () => {
      setMessage(`${title}：启动结果`);
      setResults(await api.startProjects(keys));
    });
  const projects = data?.projects || [],
    collections = data?.scanReport?.collections || [];
  const groups = [
    ...new Set(projects.map((p) => p.localGroup).filter(Boolean)),
  ].sort();
  const tags = [...new Set(projects.flatMap((p) => p.tags || []))].sort();
  const visible = projects.filter(
    (p) =>
      (status === "all" || p.status === status) &&
      projectMatchesSearch(p, query.trim().toLocaleLowerCase()) &&
      (!favorites || p.favorite) &&
      (!tag || (p.tags || []).includes(tag)) &&
      (scope === "all" ||
        (scope === "ungrouped"
          ? !p.localGroup
          : scope.startsWith("group:")
            ? p.localGroup === scope.slice(6)
            : p.key === scope.slice(8) ||
              p.ancestors?.some((a) => a.key === scope.slice(8)))),
  );
  const ranks = { running: 0, starting: 1, stopping: 2, error: 3, stopped: 4 };
  const sortNodes = (nodes) =>
    [...nodes].sort((a, b) => {
      if (sort === "status") {
        const rank = (n) =>
          Math.min(...matchingProjects(n).map((p) => ranks[p.status] ?? 5));
        const diff = rank(a) - rank(b);
        if (diff) return diff;
      }
      if (sort === "recent") {
        const diff =
          new Date(b.project?.lastStartedAt || 0).getTime() -
          new Date(a.project?.lastStartedAt || 0).getTime();
        if (diff) return diff;
      }
      return a.name.localeCompare(b.name, "zh-CN");
    });
  const tree = sortNodes(
    buildProjectTree(
      projects,
      collections,
      visible.map((p) => p.key),
    ),
  );
  const projectGroups = new Map();
  for (const node of tree) {
    const groupName =
      node.project?.localGroup ||
      (node.children.length || node.collection ? "项目与子服务" : "独立服务");
    const currentStatus = matchingProjects(node)
      .map((p) => p.status)
      .sort((a, b) => (ranks[a] ?? 5) - (ranks[b] ?? 5))[0];
    const label =
      sort === "status"
        ? `${statusLabel(currentStatus)} · ${groupName}`
        : groupName;
    if (!projectGroups.has(label)) projectGroups.set(label, []);
    projectGroups.get(label).push(node);
  }
  const families = buildProjectTree(projects, collections).filter(
    (n) => n.children.length || n.collection,
  );
  const runningCount = projects.filter((p) => p.status === "running").length,
    attentionCount = projects.filter((p) => p.status === "error").length;
  const toggleSelection = (key, checked) =>
    setSelected((old) => {
      const next = new Set(old);
      checked ? next.add(key) : next.delete(key);
      return next;
    });
  const selectView = (view) => {
    setScope("all");
    setTag(null);
    setStatus(view === "running" ? "running" : "all");
    setFavorites(view === "favorites");
    setQuery("");
  };
  const selectScope = (value) => {
    setScope(scope === value ? "all" : value);
    setStatus("all");
    setTag(null);
    setFavorites(false);
  };
  const scopeName = [...collections, ...projects].find(
    (p) => scope === `project:${p.key}`,
  )?.name;
  const title = `${scopeName || (scope.startsWith("group:") ? scope.slice(6) : scope === "ungrouped" ? "未分组服务" : favorites ? "星标服务" : status === "running" ? "运行中的服务" : "全部服务")}${tag ? ` · ${tag}` : ""}`;
  const selectedVisible = visible.filter((p) => selected.has(p.key)).length;
  const context = {
    busy,
    run,
    projectAction,
    checkRepo,
    batchStart,
    setEditor,
    setOrganization,
    selected,
    toggleSelection,
    repos,
    setRepoModal,
    sortNodes,
    filtering: Boolean(
      query || status !== "all" || scope !== "all" || tag || favorites,
    ),
  };
  const [loaded, setLoaded] = useState({
    settings: false,
    editor: false,
    organization: false,
    repositories: false,
  });
  useEffect(() => {
    const active = {
      settings: Boolean(settings),
      editor: Boolean(editor),
      organization: Boolean(organization),
      repositories: Boolean(repoModal),
    };
    setLoaded((old) =>
      Object.keys(active).some((key) => active[key] && !old[key])
        ? {
            settings: old.settings || active.settings,
            editor: old.editor || active.editor,
            organization: old.organization || active.organization,
            repositories: old.repositories || active.repositories,
          }
        : old,
    );
  }, [settings, editor, organization, repoModal]);
  return (
    <AppShell navbar={{ width: 250, breakpoint: 0 }} padding={0}>
      <AppShell.Navbar p="md" className="sidebar">
        <Group gap="sm" mb="xl" mt="xs">
          <ThemeIcon size={40} radius="md">
            <IconServer size={24} />
          </ThemeIcon>
          <Box>
            <Text fw={750} size="sm">
              Control Panel
            </Text>
            <Text size="xs" c="dimmed">
              本机服务工作台
            </Text>
          </Box>
        </Group>
        <Text
          size="10px"
          fw={700}
          c="dimmed"
          mb="sm"
          tt="uppercase"
          lts="0.14em"
        >
          Local workspace
        </Text>
        <NavLink
          component="button"
          type="button"
          label="仓库同步"
          leftSection={<IconGitBranch size={18} />}
          onClick={() => {
            setRepoModal({ view: "attention" });
            readRepos();
          }}
          rightSection={
            <Badge
              size="sm"
              color={
                repos.repositories.some(needsAttention) ? "orange" : "gray"
              }
            >
              {repos.repositories.filter(needsAttention).length}
            </Badge>
          }
        />
        <Divider my="sm" />
        {[
          ["all", "全部服务", IconLayoutDashboard, projects.length],
          ["running", "运行中", IconPlayerPlay, runningCount],
          [
            "favorites",
            "星标服务",
            IconStar,
            projects.filter((p) => p.favorite).length,
          ],
        ].map(([view, label, Icon, count]) => (
          <NavLink
            component="button"
            type="button"
            key={view}
            label={label}
            leftSection={<Icon size={18} />}
            active={
              scope === "all" &&
              !tag &&
              (view === "all"
                ? status === "all" && !favorites
                : view === "running"
                  ? status === "running" && !favorites
                  : favorites)
            }
            onClick={() => selectView(view)}
            rightSection={
              <Text size="xs" c="dimmed">
                {count}
              </Text>
            }
          />
        ))}
        <ScrollArea className="nav-scroll" mt="lg" type="auto" offsetScrollbars>
          <Text className="nav-heading">项目层级</Text>
          {families.map((node) => (
            <NavigationNode
              key={node.key}
              node={node}
              scope={scope}
              selectScope={selectScope}
            />
          ))}
          {!families.length && (
            <Text size="xs" c="dimmed" p="xs">
              声明子服务后显示从属层级。
            </Text>
          )}
          <Text className="nav-heading" mt="lg">
            个人分组
          </Text>
          {[
            ...groups.map((g) => [`group:${g}`, g]),
            ["ungrouped", "未分组"],
          ].map(([value, name]) => (
            <NavLink
              component="button"
              type="button"
              key={value}
              label={name}
              active={scope === value}
              onClick={() => selectScope(value)}
            />
          ))}
          <Text className="nav-heading" mt="lg">
            标签
          </Text>
          <Group gap={6} p="xs">
            {tags.map((t) => (
              <Badge
                key={t}
                component="button"
                variant={tag === t ? "filled" : "light"}
                onClick={() => setTag(tag === t ? null : t)}
                className="tag-button"
              >
                {t}
              </Badge>
            ))}
          </Group>
          {!tags.length && (
            <Text size="xs" c="dimmed" px="xs">
              为服务加上标签，快速组合工作环境。
            </Text>
          )}
        </ScrollArea>
        <Divider my="md" />
        <Group gap={6}>
          <IconCircleFilled
            size={8}
            color={
              connected
                ? "var(--mantine-color-teal-6)"
                : "var(--mantine-color-red-6)"
            }
          />
          <Text size="xs">{connected ? "本机后端已连接" : "正在连接后端"}</Text>
        </Group>
        <Box mt={5} mb="sm">
          <Uptime at={data?.backendStartedAt} backend />
        </Box>
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconSettings size={16} />}
          onClick={() => setSettings(true)}
          fullWidth
        >
          设置与发现入口
        </Button>
      </AppShell.Navbar>
      <AppShell.Main>
        <header className="workspace-header">
          <Group justify="space-between" gap="sm">
            <Text size="sm" c="dimmed">
              本机 /{" "}
              <Text component="span" c="dark" fw={600}>
                服务管理
              </Text>
            </Text>
            <Group gap="xs">
              <Tooltip label={connected ? "状态更新正常" : "后端连接失败"}>
                <ThemeIcon
                  variant="light"
                  color={connected ? "teal" : "red"}
                  size="sm"
                >
                  {connected ? (
                    <IconCheck size={14} />
                  ) : (
                    <IconRefresh size={14} />
                  )}
                </ThemeIcon>
              </Tooltip>
              <Button
                variant="default"
                leftSection={<IconGitBranch size={16} />}
                loading={busy.has("repositories") || repos.busy}
                onClick={() => {
                  setRepoModal({ view: "attention" });
                  repoAction("check");
                }}
              >
                检查仓库同步
              </Button>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                loading={busy.has("refresh")}
                onClick={() => run("refresh", () => api.refreshProjects())}
              >
                刷新
              </Button>
              <Button
                variant="subtle"
                color="gray"
                onClick={() => run("config", () => api.openConfigFile())}
              >
                配置文件
              </Button>
            </Group>
          </Group>
        </header>
        <Box className="workspace-body">
          <Group justify="space-between" align="center" mb="xl">
            <Box>
              <Text className="eyebrow">YOUR LOCAL SERVICES</Text>
              <Title order={1} size={30} mt={6}>
                {title}
              </Title>
              <Text c="dimmed" size="sm" mt={8}>
                把分散的服务组织起来，随时启动你需要的工作环境。
              </Text>
            </Box>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              disabled={
                !visible.some((p) => p.canBatchStart && p.status !== "running")
              }
              loading={busy.has("batch")}
              onClick={() =>
                batchStart(
                  visible.map((p) => p.key),
                  "当前列表",
                )
              }
            >
              启动当前列表
            </Button>
          </Group>
          <SimpleGrid cols={4} spacing="md" mb="lg">
            {[
              ["服务总览", projects.length, `${runningCount} 个运行中`, "teal"],
              [
                "运行中",
                runningCount,
                attentionCount
                  ? `${attentionCount} 个需要关注`
                  : "服务运行状态良好",
                "teal",
              ],
              [
                "随面板启动",
                projects.filter((p) => p.startOnPanelLaunch).length,
                "自动准备工作环境",
                "blue",
              ],
              [
                "需要关注",
                attentionCount,
                "异常服务等待处理",
                attentionCount ? "red" : "gray",
              ],
            ].map(([label, count, caption, color]) => (
              <Paper key={label} withBorder p="lg">
                <Group justify="space-between">
                  <Text c="dimmed" size="xs" fw={600}>
                    {label}
                  </Text>
                  <IconCircleFilled
                    size={7}
                    color={`var(--mantine-color-${color}-6)`}
                  />
                </Group>
                <Text size="28px" fw={700} mt={8}>
                  {count}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  {caption}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>
          {data?.portReport && <PortPanel report={data.portReport} />}
          <Paper withBorder p="md" mb="lg">
            <div className="list-toolbar">
              <TextInput
                aria-label="搜索服务"
                placeholder="搜索名称、路径、角色或标签…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                leftSection={<IconSearch size={17} />}
                className="search-input"
              />
              <Select
                aria-label="按状态筛选"
                data={statusOptions}
                value={status}
                onChange={(value) => setStatus(String(value ?? "all"))}
                w={148}
              />
              <Select
                aria-label="排序方式"
                data={sortOptions}
                value={sort}
                onChange={(value) => setSort(String(value ?? "status"))}
                w={158}
              />
              <Checkbox
                label="只看星标"
                checked={favorites}
                onChange={(e) => setFavorites(e.currentTarget.checked)}
              />
            </div>
          </Paper>
          {message && (
            <Alert
              color={message.includes("失败") ? "red" : "teal"}
              withCloseButton
              onClose={() => {
                setMessage("");
                setResults([]);
              }}
              mb="lg"
              role="status"
            >
              <Text size="sm">{message}</Text>
              {results.map((result, i) => (
                <Text
                  key={i}
                  size="xs"
                  c={result.outcome === "failed" ? "red" : undefined}
                  mt={5}
                >
                  {`${result.name} · ${{ started: "已启动", skipped: "跳过", failed: "失败" }[result.outcome] || result.outcome}：${result.detail}`}
                </Text>
              ))}
            </Alert>
          )}
          <Group justify="space-between" mb="sm" px="xs">
            <Checkbox
              label="选择当前列表"
              checked={visible.length > 0 && selectedVisible === visible.length}
              indeterminate={
                selectedVisible > 0 && selectedVisible < visible.length
              }
              disabled={!visible.length}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setSelected((old) => {
                  const next = new Set(old);
                  visible.forEach((p) =>
                    checked ? next.add(p.key) : next.delete(p.key),
                  );
                  return next;
                });
              }}
            />
            <Text size="xs" c="dimmed">
              运行状态与时长 / 操作
            </Text>
          </Group>
          {!data ? (
            <Group justify="center" p="xl">
              <Loader size="sm" />
              <Text c="dimmed">正在读取本机服务…</Text>
            </Group>
          ) : !visible.length ? (
            <Paper withBorder>
              <Empty>
                {projects.length
                  ? "没有符合当前搜索或筛选条件的项目。"
                  : "尚未发现项目。先在设置中添加扫描目录。"}
              </Empty>
            </Paper>
          ) : (
            <Stack gap="md">
              {[...projectGroups].map(([label, nodes]) => {
                const members = nodes.flatMap(matchingProjects);
                return (
                  <Stack key={label} gap="xs">
                    <Group justify="space-between" px="xs">
                      <Group gap="xs">
                        <Text size="xs" fw={650} c="dimmed">
                          {label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {members.length} 个服务
                        </Text>
                      </Group>
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={
                          !members.some(
                            (p) => p.canBatchStart && p.status !== "running",
                          )
                        }
                        loading={busy.has("batch")}
                        onClick={() =>
                          batchStart(
                            members.map((p) => p.key),
                            label,
                          )
                        }
                      >
                        启动本组
                      </Button>
                    </Group>
                    {nodes.map((node) => (
                      <ProjectNode
                        key={node.key}
                        node={node}
                        context={context}
                      />
                    ))}
                  </Stack>
                );
              })}
            </Stack>
          )}
          <Group justify="space-between" mt="lg">
            <Text size="xs" c="dimmed">
              当前显示 {visible.length} 个服务
            </Text>
            <Text size="xs" c="dimmed">
              数据与操作均在本机 · 后端每 30 秒检查状态
            </Text>
          </Group>
        </Box>
        {selected.size > 0 && (
          <Paper withBorder shadow="md" className="selection-bar" p="md">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                已选 {selected.size} 项
              </Text>
              <Group gap="xs">
                <Button
                  variant="subtle"
                  color="gray"
                  onClick={() => setSelected(new Set())}
                >
                  清空
                </Button>
                <Button
                  variant="default"
                  disabled={busy.has("batch")}
                  onClick={() =>
                    setOrganization(projects.filter((p) => selected.has(p.key)))
                  }
                >
                  批量归组
                </Button>
                <Button
                  loading={busy.has("batch")}
                  onClick={() => batchStart([...selected], "所选服务")}
                >
                  启动所选
                </Button>
              </Group>
            </Group>
          </Paper>
        )}
      </AppShell.Main>
      <input id="iconUpload" type="file" accept="image/png" hidden />
      {(loaded.settings || settings) && (
        <SurfaceBoundary active={Boolean(settings)}>
          <Suspense fallback={<LoadingSurface />}>
            <Settings
              opened={settings}
              close={() => setSettings(false)}
              data={data}
              run={run}
              busy={busy}
            />
          </Suspense>
        </SurfaceBoundary>
      )}
      {(loaded.editor || editor) && (
        <SurfaceBoundary active={Boolean(editor)}>
          <Suspense fallback={<LoadingSurface />}>
            <Editor
              project={editor}
              close={() => setEditor(null)}
              refresh={refresh}
            />
          </Suspense>
        </SurfaceBoundary>
      )}
      {(loaded.organization || organization) && (
        <SurfaceBoundary active={Boolean(organization)}>
          <Suspense fallback={<LoadingSurface />}>
            <Organization
              projects={organization}
              groups={groups}
              close={() => setOrganization(null)}
              refresh={refresh}
            />
          </Suspense>
        </SurfaceBoundary>
      )}
      {(loaded.repositories || repoModal) && (
        <SurfaceBoundary active={Boolean(repoModal)}>
          <Suspense fallback={<LoadingSurface />}>
            <Repositories
              state={repoModal}
              setState={setRepoModal}
              payload={repos}
              action={repoAction}
              busy={busy.has("repositories")}
            />
          </Suspense>
        </SurfaceBoundary>
      )}
    </AppShell>
  );
}
function ProjectNode({ node, context }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (context.filtering) setCollapsed(false);
  }, [context.filtering]);
  const children = matchingProjects(node),
    branch = node.children.length > 0 || node.collection;
  return (
    <Paper withBorder className="project-node" data-node-key={node.key}>
      {branch && (
        <Group justify="space-between" className="branch-header" p="sm">
          <Group gap="xs" className="branch-heading">
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={
                <IconChevronDown
                  size={15}
                  style={{
                    transform: collapsed ? "rotate(-90deg)" : undefined,
                  }}
                />
              }
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "展开" : "收起"} ${node.name} 的子项目`}
            >
              {node.name} · {node.collection ? "项目集合" : "父项目"}
            </Button>
            <Text size="xs" c="dimmed">
              {children.length} 个服务 ·{" "}
              {children.filter((p) => p.status === "running").length} 个运行中
            </Text>
          </Group>
          <Button
            size="xs"
            variant="subtle"
            disabled={
              !children.some((p) => p.canBatchStart && p.status !== "running")
            }
            loading={context.busy.has("batch")}
            onClick={() =>
              context.batchStart(
                children.map((p) => p.key),
                node.name,
              )
            }
          >
            启动整个项目
          </Button>
        </Group>
      )}
      {node.project &&
        (node.matches ? (
          <Service project={node.project} context={context} />
        ) : (
          <Text size="sm" c="dimmed" p="md">
            {node.name} · 所属父项目，未匹配当前筛选
          </Text>
        ))}
      {node.children.length > 0 && (
        <Collapse expanded={!collapsed}>
          <Stack
            className="project-children"
            gap="xs"
            p="sm"
            pt={node.project ? 0 : "sm"}
          >
            {context.sortNodes(node.children).map((child) => (
              <ProjectNode key={child.key} node={child} context={context} />
            ))}
          </Stack>
        </Collapse>
      )}
    </Paper>
  );
}
function Service({ project: p, context: c }) {
  const [expanded, setExpanded] = useState(false);
  const transitioning = ["starting", "stopping"].includes(p.status),
    busy = c.busy.has(p.key);
  const repo = repositoryForProject(p, c.repos.repositories, true);
  const run = (fn) => c.run(p.key, fn);
  const chooseIcon = () => run(() => api.chooseProjectIcon(p.key));
  let port = "端口 —";
  try {
    port = `端口 ${new URL(p.frontendUrl).port || (new URL(p.frontendUrl).protocol === "https:" ? "443" : "80")}`;
  } catch {}
  const output = [p.details || p.lastOutput || "", ...(p.portWarnings || [])]
    .filter(Boolean)
    .join(" · ");
  const versionLabels = {
    current: "已运行最新代码",
    "needs-build": "代码更新待构建",
    "needs-restart": "新版已构建 · 待重启",
    unknown: "运行版本未知",
  };
  const details = [
    ["启动次数", p.usageCount || 0],
    ["最近启动", timestamp(p.lastStartedAt)],
    ["进程 ID", p.pid || "—"],
    [
      "代码与运行版本",
      p.version
        ? `代码 ${p.version.sourceRevision || "未知"} · 产物 ${p.version.builtRevision || "未知"} · 运行 ${p.version.runningRevision || "未知"}${p.version.error ? ` · ${p.version.error}` : ""}`
        : "—",
    ],
    ["配置来源", p.manifestPath || p.source || "手动配置"],
    [
      "图标来源",
      { user: "用户自定义", project: "项目 manifest", fallback: "自动生成" }[
        p.iconSource
      ] || "自动生成",
    ],
    ["随面板启动", p.startOnPanelLaunch ? "已启用" : "未启用"],
    [
      "所属关系",
      [...(p.ancestors || []).map((a) => a.name), p.relationship?.notes]
        .filter(Boolean)
        .join(" / ") ||
        p.root ||
        "—",
    ],
    ["服务目录", p.projectDir || p.workingDirectory || "—"],
    ["最近输出", output || "—"],
  ];
  return (
    <Box className="service" data-project-key={p.key}>
      <div className="service-row">
        <Checkbox
          aria-label={`选择 ${p.name}`}
          checked={c.selected.has(p.key)}
          onChange={(e) => c.toggleSelection(p.key, e.currentTarget.checked)}
        />
        <Tooltip label="设置项目图标">
          <ActionIcon
            size={42}
            variant="light"
            color="gray"
            onClick={chooseIcon}
            disabled={busy}
            aria-label={`设置 ${p.name} 图标`}
          >
            <Avatar
              src={p.iconDataUrl || null}
              radius="md"
              size={38}
              color="teal"
            >
              {p.surfaceType === "web" ? (
                <IconCode size={22} />
              ) : (
                <IconServer size={22} />
              )}
            </Avatar>
          </ActionIcon>
        </Tooltip>
        <Box className="service-identity">
          <Group gap="xs" wrap="wrap">
            <Text fw={650} size="sm" className="project-name">
              {p.name}
            </Text>
            {p.favorite && (
              <IconStar
                size={14}
                fill="var(--mantine-color-yellow-5)"
                color="var(--mantine-color-yellow-7)"
              />
            )}
          </Group>
          {p.notes && (
            <Text size="xs" c="dimmed" lineClamp={2} mt={3}>
              {p.notes}
            </Text>
          )}
          <Group gap={5} mt={7}>
            {p.relationship?.role && (
              <Badge size="xs" variant="outline" color="gray">
                {p.relationship.role}
              </Badge>
            )}
            {p.localGroup && (
              <Badge size="xs" variant="light">
                {p.localGroup}
              </Badge>
            )}
            {(p.tags || []).map((tag) => (
              <Badge key={tag} size="xs" color="gray" variant="light">
                {tag}
              </Badge>
            ))}
            {p.release && (
              <Badge
                size="xs"
                variant="light"
                color={p.version?.state === "current" ? "teal" : "orange"}
              >
                {versionLabels[p.version?.state] || "运行版本未知"}
              </Badge>
            )}
            {repo && (
              <Button
                size="compact-xs"
                color={needsAttention(repo) ? "orange" : "gray"}
                variant="light"
                onClick={() =>
                  c.setRepoModal({ view: "project", key: repo.key })
                }
                aria-label={`查看 ${repo.name} 仓库同步状态`}
              >
                {repoText(repo)}
              </Button>
            )}
          </Group>
          {statusSummary(p, output) && (
            <Text
              size="xs"
              c={p.status === "error" ? "red" : "dimmed"}
              mt={5}
              lineClamp={2}
            >
              {statusSummary(p, output)}
            </Text>
          )}
        </Box>
        <Stack gap={5} className="service-runtime">
          <Badge
            variant="light"
            color={colorFor(p.status)}
            leftSection={<IconCircleFilled size={6} />}
          >
            {statusLabel(p.status)}
          </Badge>
          <Uptime at={p.lastStartedAt} status={p.status} />
          <Text size="xs" c="dimmed">
            {p.pid ? `PID ${p.pid} · ` : ""}
            {port}
          </Text>
        </Stack>
        <Group gap={6} wrap="nowrap" className="service-actions">
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            disabled={
              busy ||
              !(
                p.frontendUrl ||
                p.homepageUrl ||
                p.openHomepageCommand ||
                p.projectDir
              )
            }
            rightSection={<IconArrowUpRight size={13} />}
            onClick={() => run(() => api.openProjectHomepage(p.key))}
          >
            打开
          </Button>
          <Button
            size="xs"
            variant={p.status === "running" ? "default" : "filled"}
            disabled={p.isPanel || transitioning}
            loading={busy}
            onClick={() =>
              c.projectAction(p, p.status === "running" ? "stop" : "start")
            }
          >
            {transitioning
              ? statusLabel(p.status)
              : p.status === "running"
                ? "停止"
                : "启动"}
          </Button>
          <Menu position="bottom-end" shadow="md" width={220} withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`${p.name} 更多操作`}
              >
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>服务管理</Menu.Label>
              <Menu.Item onClick={() => c.setOrganization([p])}>
                标记与分组
              </Menu.Item>
              <Menu.Item
                onClick={() =>
                  run(() =>
                    api.saveProjectOrganization([p.key], {
                      favorite: !p.favorite,
                    }),
                  )
                }
              >
                {p.favorite ? "取消星标" : "星标"}
              </Menu.Item>
              <Menu.Item onClick={() => setExpanded(!expanded)}>
                {expanded ? "收起详情" : "查看详情"}
              </Menu.Item>
              <Menu.Item
                disabled={busy || transitioning}
                onClick={() => c.projectAction(p, "restart")}
              >
                {p.release ? "构建并运行新版" : "重新启动"}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={() => c.checkRepo(p)}>检查代码更新</Menu.Item>
              <Menu.Item
                disabled={!p.projectDir || busy}
                onClick={() => run(() => api.openProjectRepository(p.key))}
              >
                打开仓库
              </Menu.Item>
              <Menu.Item
                disabled={!(p.projectDir || p.workingDirectory)}
                onClick={() =>
                  run(() =>
                    api.openProjectFolder(p.projectDir || p.workingDirectory),
                  )
                }
              >
                在 Finder 中打开
              </Menu.Item>
              <Menu.Item
                disabled={!p.canStartOnPanelLaunch || busy}
                onClick={() =>
                  run(() =>
                    api.setProjectStartOnPanelLaunch(
                      p.key,
                      !p.startOnPanelLaunch,
                    ),
                  )
                }
              >
                {p.startOnPanelLaunch ? "取消随面板启动" : "随面板启动"}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={chooseIcon}>上传自定义图标</Menu.Item>
              {p.iconSource === "user" && (
                <Menu.Item
                  onClick={() => run(() => api.resetProjectIcon(p.key))}
                >
                  恢复项目图标
                </Menu.Item>
              )}
              <Menu.Item
                disabled={!p.manifestPath}
                onClick={() => c.setEditor(p)}
              >
                编辑展示信息
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </div>
      <Collapse expanded={expanded}>
        <SimpleGrid cols={2} spacing="md" className="service-details" p="lg">
          {details.map(([label, value]) => (
            <Box key={label}>
              <Text size="xs" c="dimmed">
                {label}
              </Text>
              <Text size="xs" className="break-text" mt={4}>
                {value}
              </Text>
            </Box>
          ))}
        </SimpleGrid>
      </Collapse>
    </Box>
  );
}
function PortPanel({ report }) {
  return (
    <Accordion variant="contained" mb="lg">
      <Accordion.Item value="ports">
        <Accordion.Control>
          <Group gap="xs">
            <Text size="sm" fw={600}>
              本机端口分配
            </Text>
            <Badge color={report.conflictCount ? "orange" : "gray"} size="sm">
              {report.conflictCount} 个需关注
            </Badge>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Text size="xs" c="dimmed" mb="sm">
            访问地址与指标地址预留本机端口，停止的服务仍保留分配。修改地址后，请同步修改服务启动配置。
          </Text>
          <Text size="xs" c={report.error ? "red" : "dimmed"} mb="sm">
            {report.error ||
              `候选空闲端口：${report.suggestions.join("、")}（当前快照，使用前会再次检查）`}
          </Text>
          <ScrollArea h={320}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  {["端口", "已分配服务", "监听进程", "检查结果"].map((s) => (
                    <Table.Th key={s}>{s}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {report.rows.map((row) => (
                  <Table.Tr
                    key={row.port}
                    c={row.warnings.length ? "orange" : undefined}
                  >
                    <Table.Td>{row.port}</Table.Td>
                    <Table.Td>
                      {row.owners.map((o) => o.name).join("、") || "未登记"}
                    </Table.Td>
                    <Table.Td>
                      {row.listeners
                        .map(
                          (l) => `${l.command} · PID ${l.pid} · ${l.address}`,
                        )
                        .join("；") || "未监听"}
                    </Table.Td>
                    <Table.Td>
                      {row.warnings.join("；") ||
                        (row.owners.length ? "已分配" : "本机进程占用")}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
const styleNonce = document
  .querySelector('meta[name="style-nonce"]')
  .getAttribute("content");
// Modal scroll locking uses react-style-singleton alongside Mantine styles.
setNonce(styleNonce);

createRoot(document.getElementById("root")).render(
  <MantineProvider
    theme={theme}
    forceColorScheme="light"
    getStyleNonce={() => styleNonce}
  >
    <App />
  </MantineProvider>,
);
