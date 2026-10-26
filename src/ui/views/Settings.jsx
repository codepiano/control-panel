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
} from "../components-overlays.jsx";
import model from "../model.cjs";
const {
  formatTimestamp: timestamp,
  splitFrontendUrl,
  repositoryNeedsAttention: needsAttention,
  repositoryCanSync: canSync,
  repositoryStatusText: repoText,
  repositoryActionGuidance: repoGuidance,
  repositoryResults,
} = model;
const api = window.controlPanel;
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
        <Text size="sm" c="dimmed">
          声明服务入口，由本机后端读取配置与子项目关系。
        </Text>
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
                    api.setProjectRoots([...new Set([...roots, root.trim()])]),
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
        <Paper withBorder p="md">
          <Switch
            label="登录时启动后端"
            description={
              data?.loginItemStatus?.detail ||
              (data?.openAtLogin
                ? "已启用：登录后启动本机后端服务"
                : "未启用：登录后不自动启动后端")
            }
            checked={Boolean(data?.openAtLogin)}
            disabled={busy.has("login")}
            onChange={(e) =>
              run("login", () => api.setOpenAtLogin(e.currentTarget.checked))
            }
          />
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
