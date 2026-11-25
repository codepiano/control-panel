import React, { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Box,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from "../components-overlays.jsx";
import model from "../model.cjs";
const {
  formatTimestamp: timestamp,
} = model;
const api = window.controlPanel;

function StartupSettings({ data, run, busy }) {
  const [selection, setSelection] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const keys = data?.startupProjectKeys || [];
  const projects = data?.projects || [];
  const byKey = new Map(projects.map((project) => [project.key, project]));
  const available = projects
    .filter((project) => project.canStartOnPanelLaunch && !project.startOnPanelLaunch)
    .map((project) => ({ value: project.key, label: project.name }));
  const selected = available.some((option) => option.value === selection) ? selection : null;
  const saving = busy.has("startup");

  const move = async (event, index, offset) => {
    const target = index + offset;
    if (saving || target < 0 || target >= keys.length) return;
    const button = event.currentTarget;
    const next = [...keys];
    [next[index], next[target]] = [next[target], next[index]];
    if (await run("startup", () => api.setStartupOrder(next, keys))) {
      setAnnouncement(`${byKey.get(keys[index]).name}已移至第 ${target + 1} 位`);
      requestAnimationFrame(() => {
        if (button.isConnected && document.activeElement === document.body) button.focus();
      });
    }
  };

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Title order={4} size="sm">
          开机启动
        </Title>
        <Switch
          label="登录时启动控制面板"
          description={data?.loginItemStatus?.status === "error" || data?.loginItemStatus?.status === "stale"
            ? data.loginItemStatus.detail
            : "登录 macOS 后在后台启动控制面板。"}
          checked={Boolean(data?.openAtLogin)}
          disabled={!data || busy.has("login")}
          onChange={(e) =>
            run("login", () => api.setOpenAtLogin(e.currentTarget.checked))
          }
        />
        <Title order={5} size="sm">
          服务启动顺序
        </Title>
        <Text size="xs" c="dimmed">
          控制面板每次启动时从上到下启动服务。已运行的服务会跳过，单项失败时继续下一项。
        </Text>
        {keys.length > 0 ? (
          <Stack component="ol" aria-label="服务启动顺序" gap="xs" m={0} pl="lg">
            {keys.map((key, index) => {
              const { name } = byKey.get(key);
              return (
                <Box component="li" key={key}>
                  <Group wrap="nowrap" justify="space-between" gap="xs">
                    <Text size="sm" className="break-text" miw={0}>{name}</Text>
                    <Group gap={4} wrap="nowrap">
                      {[-1, 1].map((offset) => {
                        const label = offset < 0 ? "上移" : "下移";
                        const disabled = saving || index + offset < 0 || index + offset >= keys.length;
                        return (
                          <Button
                            key={offset}
                            size="compact-xs"
                            variant="default"
                            aria-label={`${label} ${name}`}
                            aria-disabled={disabled}
                            data-disabled={disabled || undefined}
                            onClick={(event) => move(event, index, offset)}
                          >
                            {label}
                          </Button>
                        );
                      })}
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        aria-label={`移除 ${name} 的自动启动`}
                        disabled={saving}
                        onClick={() => run("startup", () => api.setProjectStartOnPanelLaunch(key, false))}
                      >
                        移除
                      </Button>
                    </Group>
                  </Group>
                </Box>
              );
            })}
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">还没有设为自动启动的服务。</Text>
        )}
        <Group align="end" wrap="nowrap" gap="xs">
          <Select
            label="添加自动启动服务"
            placeholder={available.length ? "选择服务" : "没有可添加的服务"}
            data={available}
            searchable
            nothingFoundMessage="找不到匹配的服务"
            value={selected}
            onChange={setSelection}
            disabled={!available.length || saving}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            disabled={!selected || saving}
            onClick={async () => {
              if (await run("startup", () => api.setProjectStartOnPanelLaunch(selected, true))) {
                setSelection(null);
              }
            }}
          >
            添加
          </Button>
        </Group>
        <VisuallyHidden role="status">{announcement}</VisuallyHidden>
      </Stack>
    </Paper>
  );
}

export default function Settings({ opened, close, data, run: perform, busy }) {
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
  }, [opened]);
  const run = (key, action) =>
    perform(key, async () => {
      setError("");
      try {
        await action();
      } catch (error) {
        setError(error.message);
        throw error;
      }
    });
  const [root, setRoot] = useState("");
  const config = data?.config || {},
    roots = config.roots || [];
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={<Text fw={700}>设置与服务发现</Text>}
      size="lg"
    >
      <Stack gap="lg">
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <StartupSettings data={data} run={run} busy={busy} />
        <Paper withBorder p="md">
          <Title order={4} size="sm" mb="xs">
            扫描入口
          </Title>
          <Text size="xs" c="dimmed" mb="md">
            添加项目或项目集合的目录。外层 control-panel.json 用 children
            声明深层子项目。
          </Text>
          <Group align="end" wrap="nowrap">
            <TextInput
              label="扫描入口路径"
              placeholder="/Users/you/projects"
              value={root}
              onChange={(e) => setRoot(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              disabled={!root.trim()}
              loading={busy.has("roots")}
              onClick={async () => {
                if (
                  await run("roots", () =>
                    api.setProjectRoots([...new Set([...roots, root.trim()])], root.trim()),
                  )
                )
                  setRoot("");
              }}
            >
              添加入口
            </Button>
          </Group>
          <Select
            mt="md"
            label="入口扫描范围"
            value={String(config.scan?.maxDepth ?? 1)}
            data={[
              { value: "0", label: "只读入口本身" },
              { value: "1", label: "入口与下一层（默认）" },
            ]}
            disabled={busy.has("depth")}
            onChange={(value) =>
              run("depth", () => api.setScanDepth(Number(value)))
            }
          />
          <Text size="xs" c="dimmed" mt="xs">
            显式声明的 children 会继续向下发现，不受入口扫描范围影响。
          </Text>
          {(data?.scanReport?.issues || []).map((issue, i) => (
            <Alert key={i} color="orange" mt="sm">
              {issue.path}：{issue.detail}
            </Alert>
          ))}
          <Stack gap="xs" mt="md">
            {roots.map((path) => (
              <Group key={path} wrap="nowrap" justify="space-between">
                <Text size="xs" className="break-text">
                  {path}
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  disabled={busy.has("roots")}
                  onClick={() =>
                    run("roots", () =>
                      api.setProjectRoots(roots.filter((r) => r !== path)),
                    )
                  }
                >
                  移除
                </Button>
              </Group>
            ))}
            {!roots.length && (
              <Text size="xs" c="dimmed">
                还没有扫描目录。
              </Text>
            )}
          </Stack>
        </Paper>
        <Accordion variant="contained">
          <Accordion.Item value="info">
            <Accordion.Control>本机配置与扫描信息</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {[
                  ["扫描目录", `${roots.length} 个`],
                  ["配置文件", data?.configPath],
                  ["状态文件", data?.statePath],
                  ["最近刷新", timestamp(data?.updatedAt)],
                ].map(([label, value]) => (
                  <Box key={label}>
                    <Text size="xs" c="dimmed">
                      {label}
                    </Text>
                    <Text size="xs" className="break-text">
                      {value || "—"}
                    </Text>
                  </Box>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="example">
            <Accordion.Control>外层项目声明示例</Accordion.Control>
            <Accordion.Panel>
              <Code block>
                {JSON.stringify(
                  {
                    name: "研究工作区",
                    kind: "collection",
                    children: [
                      { path: "repos/api", role: "api" },
                      { path: "repos/reader/apps/web", role: "frontend" },
                    ],
                  },
                  null,
                  2,
                )}
              </Code>
              <Text size="xs" c="dimmed" mt="sm">
                每个子目录保留自己的
                control-panel.json。纯集合只组织服务，不拥有进程；有独立服务的父项目使用
                kind: project。
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Modal>
  );
}
