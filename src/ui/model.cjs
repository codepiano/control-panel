function formatTimestamp(isoString) {
  if (!isoString) {
    return "-";
  }

  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
}

function formatUptime(lastStartedAt, status) {
  if (status !== "running" || !lastStartedAt) {
    return "运行时长 —";
  }

  const startedAt = new Date(lastStartedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return "运行时长 —";
  }

  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `运行 ${days}天 ${hours}小时`;
  }
  if (hours > 0) {
    return `运行 ${hours}小时 ${minutes}分`;
  }
  if (minutes > 0) {
    return `运行 ${minutes}分 ${seconds}秒`;
  }
  return `运行 ${seconds}秒`;
}

function statusLabel(status) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopping":
      return "停止中";
    case "error":
      return "错误";
    default:
      return "已停止";
  }
}

function statusSummary(project, outputText) {
  if (project.status === "error") {
    return outputText
      ? `错误：${outputText}`
      : "错误：请打开详情查看最近状态。";
  }

  if (project.status === "starting" || project.status === "stopping") {
    return `${statusLabel(project.status)}：正在执行生命周期命令。`;
  }

  return outputText || "";
}

function projectMatchesSearch(project, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    project.name,
    project.notes,
    project.root,
    project.projectDir,
    project.workingDirectory,
    project.group,
    ...(project.tags || []),
    ...(project.ancestors || []).map((item) => item.name),
    project.relationship?.role,
    project.relationship?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function splitFrontendUrl(value) {
  if (!value) {
    return { address: "", port: "" };
  }

  try {
    const url = new URL(value);
    const port = url.port;
    url.port = "";
    return { address: url.toString().replace(/\/$/, ""), port };
  } catch (error) {
    return { address: value, port: "" };
  }
}

const repositoryLabels = {
  unchecked: "尚未检查",
  synced: "已同步",
  ahead: "待推送",
  behind: "待拉取",
  diverged: "已分叉",
  untracked: "无跟踪分支",
  detached: "未关联本地分支",
  pinned: "子模块版本正常",
  error: "检查失败",
};

function repositoryNeedsAttention(repo) {
  return Boolean(
    repo.dirty ||
    repo.ahead ||
    repo.behind ||
    repo.inProgress ||
    ["unchecked", "error", "diverged", "untracked", "detached"].includes(
      repo.status,
    ),
  );
}
function repositoryStatusText(repo) {
  const parts = [];
  if (!(repo.status === "synced" && repo.dirty))
    parts.push(
      `${repositoryLabels[repo.status] || repo.status}${repo.ahead ? ` ↑${repo.ahead}` : ""}${repo.behind ? ` ↓${repo.behind}` : ""}`,
    );
  if (repo.dirty) parts.push(`未提交 ${repo.dirty} 项`);
  if (repo.inProgress) parts.push("Git 操作进行中");
  return `${repositoryNeedsAttention(repo) ? "⚠ " : ""}${parts.join(" · ")}`;
}

function repositoryActionGuidance(repo) {
  const actions = [];
  if (repo.error || repo.status === "error")
    actions.push("检查失败：查看下方原因，处理后重新检查");
  if (repo.inProgress) actions.push("先在项目中完成或取消正在进行的 Git 操作");
  if (repo.dirty)
    actions.push(`先在项目中检查并提交或暂存 ${repo.dirty} 项改动，再进行同步`);
  if (repo.status === "pinned")
    actions.push("版本与父仓库一致，无需操作；更新由父仓库统一管理");
  if (repo.status === "detached")
    actions.push(
      repo.superproject
        ? "子模块版本与父仓库记录不一致，请检查父仓库的子模块变更"
        : "当前代码未关联本地分支，请先确认需要使用的分支",
    );
  else if (repo.status === "untracked")
    actions.push("先为当前分支配置远端跟踪分支");
  else if (repo.status === "diverged" || (repo.ahead && repo.behind))
    actions.push(
      `本地 ${repo.ahead} 个、远端 ${repo.behind} 个提交：先在项目中合并或变基，解决冲突后再推送`,
    );
  else if (repo.behind)
    actions.push(
      `远端有 ${repo.behind} 个新提交：${repo.dirty || repo.inProgress || repo.error ? "处理上述问题后再拉取" : "点击「拉取」更新本机代码"}`,
    );
  else if (repo.ahead)
    actions.push(
      `本地有 ${repo.ahead} 个未推送提交：${repo.dirty || repo.inProgress || repo.error ? "处理上述问题后再推送" : "点击「推送」上传到远端"}`,
    );
  return actions.join("；");
}

function repositoryCanSync(repo, kind) {
  return Boolean(
    repo.branch &&
    repo.upstream &&
    repo.remoteUrl &&
    repo.mergeRef?.startsWith("refs/heads/") &&
    !repo.error &&
    !repo.dirty &&
    !repo.inProgress &&
    !["unchecked", "error", "diverged", "detached", "untracked"].includes(
      repo.status,
    ) &&
    (kind === "pull" ? repo.behind && !repo.ahead : repo.ahead && !repo.behind),
  );
}

function repositoryForProject(project, repositories, ownOnly = false) {
  const repo = repositories.find((item) =>
    item.services.some((service) => service.key === project.key),
  );
  if (
    ownOnly &&
    project.ancestors?.some((ancestor) =>
      repo?.services.some((service) => service.key === ancestor.key),
    )
  )
    return null;
  return repo;
}
function repositoryResults(payload, focusKey = null) {
  const filter = (results) =>
    (results || []).filter((result) => !focusKey || result.key === focusKey);
  const recent = filter(payload.lastSync?.results);
  return [
    ...(recent.length ? [{ title: "最近一次同步结果", results: recent }] : []),
    ...(payload.operation === "check" || !recent.length
      ? [
          {
            title:
              payload.operation === "check"
                ? "最近一次检查结果"
                : "最近一次操作结果",
            results: filter(payload.results),
          },
        ]
      : []),
  ].filter((group) => group.results.length);
}
module.exports = {
  formatTimestamp,
  formatUptime,
  statusLabel,
  statusSummary,
  projectMatchesSearch,
  splitFrontendUrl,
  repositoryLabels,
  repositoryNeedsAttention,
  repositoryStatusText,
  repositoryActionGuidance,
  repositoryCanSync,
  repositoryForProject,
  repositoryResults,
};
