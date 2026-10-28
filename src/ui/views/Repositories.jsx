import React, { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
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
import { Empty } from "../shared.jsx";
export default function Repositories({
  state,
  setState,
  payload,
  action,
  busy,
}) {
  const repositories = payload.repositories || [],
    locked = busy || payload.busy;
  const checkingKeys = new Set(
    payload.busy && payload.operation === "check"
      ? payload.activeRepositoryKeys || []
      : [],
  );
  const pending = repositories.filter(needsAttention),
    pulls = repositories.filter((r) => r.behind && !r.ahead),
    pushes = repositories.filter((r) => r.ahead && !r.behind);
  const readyPulls = pulls.filter((r) => canSync(r, "pull")).length,
    readyPushes = pushes.filter((r) => canSync(r, "push")).length;
  const focused = repositories.find((r) => r.key === state?.key),
    view = state?.view || "attention";
  const filterResults = (results) =>
    (results || []).filter((r) => view !== "project" || r.key === state?.key);
  const recent = filterResults(payload.lastSync?.results),
    count = (outcome) => recent.filter((r) => r.outcome === outcome).length;
  const byService = new Map(
    repositories.flatMap((r) => r.services.map((s) => [s.key, r.key])),
  );
  const parents = new Map(
    repositories.map((r) => [
      r.key,
      r.services
        .flatMap((s) => s.ancestors || [])
        .map((a) => byService.get(a.key))
        .reverse()
        .find((key) => key && key !== r.key),
    ]),
  );
  const roots =
    view === "project"
      ? repositories.filter((r) => r.key === state?.key)
      : view === "attention"
        ? pending
        : view === "pull"
          ? pulls
          : view === "push"
            ? pushes
            : repositories.filter((r) => !parents.get(r.key));
  const rows = [];
  function append(repo, depth = 0) {
    rows.push({ repo, depth });
    if (view === "all")
      repositories
        .filter((r) => parents.get(r.key) === repo.key)
        .forEach((r) => append(r, depth + 1));
  }
  roots.forEach((r) => append(r));
  const outcomeLabel = {
    checked: "已检查",
    success: "成功",
    skipped: "跳过",
    failed: "失败",
  };
  const tabs = [
    ...(focused
      ? [{ value: "project", label: `当前项目 · ${focused.name}` }]
      : []),
    { value: "attention", label: `需要处理 ${pending.length}` },
    { value: "pull", label: `待拉取 ${pulls.length}` },
    { value: "push", label: `待推送 ${pushes.length}` },
    { value: "all", label: `全部仓库 ${repositories.length}` },
  ];
  return (
    <Modal
      opened={Boolean(state)}
      onClose={() => setState(null)}
      title={<Text fw={700}>仓库同步</Text>}
      size="min(1100px, 92vw)"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          每天凌晨 03:00 检查，错过后在唤醒或启动时补查。推送与拉取由你执行。
        </Text>
        <Group gap="xs">
          {[
            [
              "sync",
              `处理全部 ${readyPulls + readyPushes}`,
              readyPulls + readyPushes,
            ],
            ["check", "检查所有仓库", 1],
            ["pull", `拉取全部 ${readyPulls}`, readyPulls],
            ["push", `推送全部 ${readyPushes}`, readyPushes],
          ].map(([kind, label, count]) => (
            <Button
              key={kind}
              variant={kind === "sync" ? "filled" : "default"}
              disabled={locked || !count}
              onClick={() => action(kind)}
            >
              {label}
            </Button>
          ))}
        </Group>
        <Alert color="orange">
          <Text size="sm">
            待拉取 {pulls.length} 个（可处理 {readyPulls}） · 待推送{" "}
            {pushes.length} 个（可处理 {readyPushes}） · 需人工处理{" "}
            {
              pending.filter((r) => !canSync(r, "pull") && !canSync(r, "push"))
                .length
            }{" "}
            个
          </Text>
        </Alert>
        {recent.length > 0 && (
          <Text
            size="xs"
            c={count("failed") || count("skipped") ? "red" : "dimmed"}
          >
            最近一次同步：成功 {count("success")} · 失败 {count("failed")} ·
            跳过 {count("skipped")} · {timestamp(payload.lastSync?.finishedAt)}
            。失败和跳过原因见仓库及下方逐项结果。
          </Text>
        )}
        <Text size="xs" c={payload.error ? "red" : "dimmed"} role="status">
          {payload.error ||
            (payload.busy
              ? `正在${{ check: "检查", push: "推送", pull: "拉取", sync: "同步" }[payload.operation] || "处理"}：${payload.currentRepository || "仓库…"}${payload.progress ? ` · 已完成 ${payload.progress.completed}/${payload.progress.total}` : ""}`
              : `${repositories.length} 个仓库 · ${pending.length} 个需要处理 · 最近完成：${timestamp(payload.lastFinishedAt)}`)}
        </Text>
        <Text size="xs" c="dimmed">
          下次计划：{timestamp(payload.nextCheckAt)}（本机时区） · 临时连接失败最多尝试 3 次，间隔 1、2 秒；仍失败时 15
          分钟后补查
        </Text>
        <Group gap="xs" aria-label="仓库筛选">
          {tabs.map((t) => (
            <Button
              key={t.value}
              size="xs"
              variant={view === t.value ? "light" : "subtle"}
              color={view === t.value ? "teal" : "gray"}
              aria-pressed={view === t.value}
              onClick={() => setState((old) => ({ ...old, view: t.value }))}
            >
              {t.label}
            </Button>
          ))}
        </Group>
        <Stack gap="sm">
          {rows.map(({ repo: r, depth }) => (
            <Paper
              key={r.key}
              withBorder
              p="md"
              ml={Math.min(depth, 5) * 16}
              data-repo-key={r.key}
            >
              <Group justify="space-between" align="start" wrap="nowrap">
                <Box className="repo-info">
                  <Group gap="sm">
                    <Text size="sm" fw={650}>
                      {r.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {r.branch
                        ? `${r.branch} → ${r.upstream || "未配置跟踪分支"}`
                        : r.status === "pinned"
                          ? `由父仓库管理 · ${(r.head || "").slice(0, 8)}`
                          : r.checkedAt
                            ? "当前未关联本地分支"
                            : "等待检查分支"}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed" mt={5} className="break-text">
                    {r.directory}
                  </Text>
                  <Badge
                    color={checkingKeys.has(r.key) ? "blue" : needsAttention(r) ? "orange" : "teal"}
                    variant="light"
                    mt="sm"
                  >
                    {checkingKeys.has(r.key) ? "正在重新检查…" : repoText(r)}
                  </Badge>
                  {!checkingKeys.has(r.key) && (needsAttention(r) || r.status === "pinned") && (
                    <Text size="xs" c="orange.9" mt="xs">
                      {repoGuidance(r)}
                    </Text>
                  )}
                  {r.lastSyncResult && (
                    <Text
                      size="xs"
                      c={
                        ["failed", "skipped"].includes(r.lastSyncResult.outcome)
                          ? "red"
                          : "dimmed"
                      }
                      mt="xs"
                    >
                      上次同步（{timestamp(r.lastSyncResult.at)}）·{" "}
                      {outcomeLabel[r.lastSyncResult.outcome]}：
                      {r.lastSyncResult.detail}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed" mt="xs">
                    {checkingKeys.has(r.key) ? "上次检查" : "最后检查"}：{timestamp(r.checkedAt)}
                  </Text>
                  {r.error && !checkingKeys.has(r.key) && (
                    <Text size="xs" c="red" mt="xs">
                      {r.error}
                    </Text>
                  )}
                </Box>
                <Group gap={6} wrap="nowrap">
                  {[
                    ["check", "检查"],
                    ["pull", "拉取"],
                    ["push", "推送"],
                  ].map(([kind, label]) => (
                    <Button
                      key={kind}
                      size="xs"
                      variant="default"
                      loading={kind === "check" && checkingKeys.has(r.key)}
                      disabled={
                        locked || (kind !== "check" && !canSync(r, kind))
                      }
                      onClick={() => action(kind, [r.key])}
                    >
                      {label}
                    </Button>
                  ))}
                </Group>
              </Group>
            </Paper>
          ))}
          {!rows.length && (
            <Empty>
              {repositories.length
                ? "目前没有符合当前筛选的仓库。"
                : "当前项目中没有可识别的 Git 仓库。"}
            </Empty>
          )}
        </Stack>
        {repositoryResults(payload, view === "project" ? state?.key : null).map(
          (group) => (
            <Box key={group.title}>
              <Text fw={650} size="sm" mb="xs">
                {group.title}
              </Text>
              {group.results.map((r, i) => (
                <Text
                  key={i}
                  size="xs"
                  c={
                    ["failed", "skipped"].includes(r.outcome) ? "red" : "dimmed"
                  }
                  mb={5}
                >
                  {r.name} · {outcomeLabel[r.outcome]}：{r.detail}
                </Text>
              ))}
            </Box>
          ),
        )}
      </Stack>
    </Modal>
  );
}
