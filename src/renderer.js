const api = window.controlPanel;

const els = {
  list: document.getElementById('projectList'),
  runningSummary: document.getElementById('runningSummary'),
  rootsCount: document.getElementById('rootsCount'),
  configPath: document.getElementById('configPath'),
  statePath: document.getElementById('statePath'),
  updatedAt: document.getElementById('updatedAt'),
  refreshBtn: document.getElementById('refreshBtn'),
  projectSearch: document.getElementById('projectSearch'),
  statusFilter: document.getElementById('statusFilter'),
  sortProjects: document.getElementById('sortProjects'),
  configBtn: document.getElementById('configBtn'),
  configFileBtn: document.getElementById('configFileBtn'),
  loginToggle: document.getElementById('loginToggle'),
  loginItemStatus: document.getElementById('loginItemStatus'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  projectEditorModal: document.getElementById('projectEditorModal'),
  projectEditorForm: document.getElementById('projectEditorForm'),
  projectEditorHint: document.getElementById('projectEditorHint'),
  projectEditorError: document.getElementById('projectEditorError'),
  closeProjectEditorBtn: document.getElementById('closeProjectEditorBtn'),
  cancelProjectEditorBtn: document.getElementById('cancelProjectEditorBtn'),
  saveProjectEditorBtn: document.getElementById('saveProjectEditorBtn'),
  rootInput: document.getElementById('rootInput'),
  browseRootBtn: document.getElementById('browseRootBtn'),
  addRootBtn: document.getElementById('addRootBtn'),
  rootList: document.getElementById('rootList'),
  template: document.getElementById('projectTemplate'),
};

let latestPayload = null;
let projectSearchQuery = '';
let statusFilter = 'all';
let projectSort = 'name';
let refreshInFlight = false;
let editingProject = null;

function formatTimestamp(isoString) {
  if (!isoString) {
    return '-';
  }

  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
}

function statusLabel(status) {
  switch (status) {
    case 'running':
      return '运行中';
    case 'starting':
      return '启动中';
    case 'stopping':
      return '停止中';
    case 'error':
      return '错误';
    default:
      return '已停止';
  }
}

function statusSummary(project, outputText) {
  if (project.status === 'error') {
    return outputText ? `错误：${outputText}` : '错误：请打开详情查看最近状态。';
  }

  if (project.status === 'starting' || project.status === 'stopping') {
    return `${statusLabel(project.status)}：正在执行生命周期命令。`;
  }

  return outputText || '';
}

function projectMatchesSearch(project, query) {
  if (!query) {
    return true;
  }

  const haystack = [project.name, project.notes, project.root, project.projectDir, project.workingDirectory]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function sortProjects(projects) {
  const statusOrder = { error: 0, starting: 1, stopping: 2, running: 3, stopped: 4 };
  return [...projects].sort((left, right) => {
    if (projectSort === 'status') {
      const difference = (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99);
      if (difference) {
        return difference;
      }
    }
    if (projectSort === 'recent') {
      const difference = new Date(right.lastStartedAt || 0) - new Date(left.lastStartedAt || 0);
      if (difference) {
        return difference;
      }
    }
    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
  });
}

function openSettings() {
  els.settingsModal.classList.remove('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  els.settingsModal.classList.add('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'true');
}

function setProjectEditorError(message = '') {
  els.projectEditorError.textContent = message;
  els.projectEditorError.classList.toggle('hidden', !message);
}

function setFormValue(name, value) {
  els.projectEditorForm.elements[name].value = value || '';
}

function splitFrontendUrl(value) {
  if (!value) {
    return { address: '', port: '' };
  }

  try {
    const url = new URL(value);
    const port = url.port;
    url.port = '';
    return { address: url.toString().replace(/\/$/, ''), port };
  } catch (error) {
    return { address: value, port: '' };
  }
}

function openProjectEditor(project) {
  editingProject = project;
  setProjectEditorError();
  const frontend = splitFrontendUrl(project.frontendUrl);
  els.projectEditorHint.textContent = `${project.manifestPath} · 修改会直接保存到项目自身的 control-panel.json。`;
  setFormValue('name', project.name);
  setFormValue('frontendUrl', frontend.address);
  setFormValue('frontendPort', frontend.port);
  setFormValue('notes', project.notes);
  els.projectEditorModal.classList.remove('hidden');
  els.projectEditorModal.setAttribute('aria-hidden', 'false');
  els.projectEditorForm.elements.name.focus();
}

function closeProjectEditor() {
  editingProject = null;
  setProjectEditorError();
  els.projectEditorModal.classList.add('hidden');
  els.projectEditorModal.setAttribute('aria-hidden', 'true');
}

function projectEditorData() {
  const form = els.projectEditorForm.elements;
  return {
    name: form.name.value,
    frontendUrl: form.frontendUrl.value,
    frontendPort: form.frontendPort.value,
    notes: form.notes.value,
  };
}

function renderRootRow(root) {
  const row = document.createElement('div');
  row.className = 'root-row';

  const info = document.createElement('div');
  info.className = 'root-info';

  const title = document.createElement('strong');
  title.textContent = root;

  const subtitle = document.createElement('span');
  subtitle.textContent = '只检查根目录和每个直接子目录中的 control-panel.json';

  const remove = document.createElement('button');
  remove.className = 'ghost';
  remove.textContent = '移除';
  remove.addEventListener('click', async () => {
    const config = latestPayload?.config || { roots: [] };
    const nextRoots = (config.roots || []).filter((item) => item !== root);
    await api.setProjectRoots(nextRoots);
    await refresh();
  });

  info.appendChild(title);
  info.appendChild(subtitle);
  row.appendChild(info);
  row.appendChild(remove);
  return row;
}

function renderRoots(config) {
  const roots = Array.isArray(config?.roots) ? config.roots : [];
  els.rootList.innerHTML = '';
  els.rootsCount.textContent = roots.length ? `${roots.length} 个根目录` : '未配置';

  if (roots.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '还没有扫描目录。添加一个项目根目录开始自动发现。';
    els.rootList.appendChild(empty);
    return;
  }

  roots.forEach((root) => {
    els.rootList.appendChild(renderRootRow(root));
  });
}

function renderProject(project) {
  const fragment = els.template.content.cloneNode(true);
  const card = fragment.querySelector('.card');
  const name = fragment.querySelector('.project-name');
  const notes = fragment.querySelector('.project-notes');
  const details = fragment.querySelector('.project-details');
  const detailToggle = fragment.querySelector('.detail-toggle');
  const status = fragment.querySelector('.status-pill');
  const usage = fragment.querySelector('.project-usage');
  const lastStarted = fragment.querySelector('.project-last-started');
  const pid = fragment.querySelector('.project-pid');
  const source = fragment.querySelector('.project-source');
  const root = fragment.querySelector('.project-root');
  const dir = fragment.querySelector('.project-dir');
  const output = fragment.querySelector('.project-output');
  const primaryAction = fragment.querySelector('.primary-action');
  const restartBtn = fragment.querySelector('.restart-btn');
  const homepageBtn = fragment.querySelector('.homepage-btn');
  const repositoryBtn = fragment.querySelector('.repository-btn');
  const folderBtn = fragment.querySelector('.folder-btn');
  const projectConfigBtn = fragment.querySelector('.project-config-btn');
  const panelStartBtn = fragment.querySelector('.panel-start-btn');
  const panelStart = fragment.querySelector('.project-panel-start');

  const outputText = project.details || project.lastOutput || '';
  name.textContent = project.name;
  notes.textContent = project.notes || '未填写说明';
  output.textContent = statusSummary(project, outputText);
  output.hidden = !output.textContent;
  status.textContent = statusLabel(project.status);
  status.dataset.status = project.status;
  status.title = `当前状态：${statusLabel(project.status)}`;
  status.setAttribute('aria-label', statusLabel(project.status));
  usage.textContent = String(project.usageCount || 0);
  lastStarted.textContent = project.lastStartedAt ? formatTimestamp(project.lastStartedAt) : '-';
  pid.textContent = project.pid ? String(project.pid) : '-';
  source.textContent = project.source === 'auto' ? `自动发现 · ${project.root}` : '来源：手动配置';
  panelStart.textContent = project.startOnPanelLaunch ? '已启用' : '未启用';
  root.textContent = project.root || '未配置';
  dir.textContent = project.projectDir || project.workingDirectory || '未配置';
  details.hidden = !project.pid && !outputText && !project.root && !(project.projectDir || project.workingDirectory);
  detailToggle.hidden = details.hidden;

  detailToggle.addEventListener('click', () => {
    const expanded = !details.classList.contains('hidden');
    details.classList.toggle('hidden', expanded);
    detailToggle.textContent = expanded ? '查看详情' : '收起详情';
    detailToggle.classList.toggle('is-active', !expanded);
  });

  restartBtn.disabled = project.status === 'starting' || project.status === 'stopping';
  homepageBtn.disabled = !(project.frontendUrl || project.homepageUrl || project.openHomepageCommand || project.projectDir);
  repositoryBtn.disabled = !project.projectDir;
  projectConfigBtn.disabled = !project.manifestPath;
  projectConfigBtn.title = project.manifestPath ? '编辑项目展示信息' : '手工项目没有 control-panel.json，不能在此编辑';
  panelStartBtn.disabled = !project.canStartOnPanelLaunch;
  panelStartBtn.textContent = project.startOnPanelLaunch ? '取消随面板启动' : '随面板启动';
  panelStartBtn.title = project.canStartOnPanelLaunch
    ? '设置保存在 Control Panel 自己的配置中'
    : '控制面板自身或没有启动命令的项目不支持此设置';

  const isRunning = project.status === 'running';
  const isTransitioning = project.status === 'starting' || project.status === 'stopping';
  primaryAction.textContent = isRunning ? '停止服务' : isTransitioning ? statusLabel(project.status) : '启动服务';
  primaryAction.dataset.action = isRunning ? 'stop' : 'start';
  primaryAction.disabled = isTransitioning;
  primaryAction.addEventListener('click', async () => {
    primaryAction.disabled = true;
    if (isRunning) {
      await api.stopProject(project.key);
    } else {
      await api.startProject(project.key);
    }
    await refresh();
  });

  restartBtn.addEventListener('click', async () => {
    restartBtn.disabled = true;
    await api.restartProject(project.key);
    await refresh();
  });

  homepageBtn.addEventListener('click', async () => {
    homepageBtn.disabled = true;
    await api.openProjectHomepage(project.key);
    await refresh();
  });

  repositoryBtn.addEventListener('click', async () => {
    repositoryBtn.disabled = true;
    await api.openProjectRepository(project.key);
    await refresh();
  });

  folderBtn.addEventListener('click', async () => {
    await api.openProjectFolder(project.projectDir || project.workingDirectory);
  });

  projectConfigBtn.addEventListener('click', () => openProjectEditor(project));

  panelStartBtn.addEventListener('click', async () => {
    panelStartBtn.disabled = true;
    try {
      await api.setProjectStartOnPanelLaunch(project.key, !project.startOnPanelLaunch);
      await refresh();
    } catch (error) {
      els.runningSummary.textContent = `保存随面板启动设置失败：${String(error?.message || error)}`;
      panelStartBtn.disabled = false;
    }
  });

  card.dataset.status = project.status;
  return fragment;
}

function renderDashboard(data) {
  latestPayload = data;
  const allProjects = data.projects || [];
  const query = projectSearchQuery.trim().toLocaleLowerCase();
  const projects = sortProjects(allProjects.filter((project) => (
    (statusFilter === 'all' || project.status === statusFilter) && projectMatchesSearch(project, query)
  )));
  els.list.innerHTML = '';

  const runningCount = allProjects.filter((project) => project.status === 'running').length;
  els.runningSummary.textContent = `${allProjects.length} 项目 · ${runningCount} 运行中`;
  els.configPath.textContent = data.configPath || '-';
  els.statePath.textContent = data.statePath || '-';
  els.updatedAt.textContent = formatTimestamp(data.updatedAt);
  els.loginToggle.checked = Boolean(data.openAtLogin);
  const loginItemStatus = data.loginItemStatus || {};
  if (loginItemStatus.status === 'enabled') {
    els.loginItemStatus.textContent = '已启用：登录后在菜单栏静默启动';
  } else if (loginItemStatus.status === 'stale' || loginItemStatus.status === 'error') {
    els.loginItemStatus.textContent = loginItemStatus.detail || '登录项状态异常';
  } else {
    els.loginItemStatus.textContent = '未启用：登录后不自动启动';
  }
  if (projects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'project-empty-state';
    empty.textContent = allProjects.length === 0
      ? '尚未发现项目。先添加扫描目录，再为项目放入 control-panel.json。'
      : '没有符合当前搜索或筛选条件的项目。';
    els.list.appendChild(empty);
  } else {
    projects.forEach((project) => {
      els.list.appendChild(renderProject(project));
    });
  }

  renderRoots(data.config);
}

async function refresh() {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  const defaultLabel = '刷新';
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = '刷新中...';

  try {
    const data = await api.getDashboardData();
    renderDashboard(data);
  } catch (error) {
    const message = String(error?.message || error || '未知错误');
    els.runningSummary.textContent = `刷新失败：${message}`;
    els.refreshBtn.textContent = '刷新失败';
    els.refreshBtn.title = message;
    window.setTimeout(() => {
      if (!refreshInFlight) {
        els.refreshBtn.textContent = defaultLabel;
        els.refreshBtn.title = '';
      }
    }, 2500);
  } finally {
    refreshInFlight = false;
    els.refreshBtn.disabled = false;
    if (els.refreshBtn.textContent === '刷新中...') {
      els.refreshBtn.textContent = defaultLabel;
    }
  }
}

els.refreshBtn.addEventListener('click', refresh);
els.projectSearch.addEventListener('input', (event) => {
  projectSearchQuery = event.target.value;
  if (latestPayload) {
    renderDashboard(latestPayload);
  }
});
els.statusFilter.addEventListener('change', (event) => {
  statusFilter = event.target.value;
  if (latestPayload) {
    renderDashboard(latestPayload);
  }
});
els.sortProjects.addEventListener('change', (event) => {
  projectSort = event.target.value;
  if (latestPayload) {
    renderDashboard(latestPayload);
  }
});
els.configBtn.addEventListener('click', openSettings);
els.configFileBtn.addEventListener('click', () => api.openConfigFile());
els.closeSettingsBtn.addEventListener('click', closeSettings);
els.settingsModal.addEventListener('click', (event) => {
  if (event.target === els.settingsModal) {
    closeSettings();
  }
});
els.closeProjectEditorBtn.addEventListener('click', closeProjectEditor);
els.cancelProjectEditorBtn.addEventListener('click', closeProjectEditor);
els.projectEditorModal.addEventListener('click', (event) => {
  if (event.target === els.projectEditorModal) {
    closeProjectEditor();
  }
});
els.projectEditorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editingProject) {
    return;
  }

  setProjectEditorError();
  els.saveProjectEditorBtn.disabled = true;
  try {
    await api.saveProjectPresentation(editingProject.key, projectEditorData());
    closeProjectEditor();
  } catch (error) {
    setProjectEditorError(String(error?.message || error || '保存失败'));
  } finally {
    els.saveProjectEditorBtn.disabled = false;
  }
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!els.projectEditorModal.classList.contains('hidden')) {
      closeProjectEditor();
    } else if (!els.settingsModal.classList.contains('hidden')) {
      closeSettings();
    }
  }
});
els.loginToggle.addEventListener('change', async (event) => {
  els.loginToggle.disabled = true;
  try {
    await api.setOpenAtLogin(event.target.checked);
    await refresh();
  } catch (error) {
    els.loginToggle.checked = !event.target.checked;
    els.loginItemStatus.textContent = String(error?.message || error || '更新登录项失败');
  } finally {
    els.loginToggle.disabled = false;
  }
});
els.browseRootBtn.addEventListener('click', async () => {
  const roots = await api.chooseProjectRoots();
  if (Array.isArray(roots) && roots.length > 0) {
    els.rootInput.value = roots[0];
  }
});
els.addRootBtn.addEventListener('click', async () => {
  const value = els.rootInput.value.trim();
  if (!value) {
    return;
  }

  const config = latestPayload?.config || { roots: [] };
  const nextRoots = [...new Set([...(config.roots || []), value])];
  await api.setProjectRoots(nextRoots);
  els.rootInput.value = '';
  await refresh();
});

api.onProjectsUpdated((payload) => {
  renderDashboard(payload);
});

api.onAppReady((payload) => {
  if (payload && payload.configPath) {
    els.configPath.textContent = payload.configPath;
  }
});

refresh().catch((error) => {
  els.runningSummary.textContent = `加载失败：${String(error.message || error)}`;
});
