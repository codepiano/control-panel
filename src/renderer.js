const api = window.controlPanel;

const els = {
  list: document.getElementById('projectList'),
  runningSummary: document.getElementById('runningSummary'),
  rootsCount: document.getElementById('rootsCount'),
  configPath: document.getElementById('configPath'),
  statePath: document.getElementById('statePath'),
  updatedAt: document.getElementById('updatedAt'),
  refreshBtn: document.getElementById('refreshBtn'),
  runningOnlyBtn: document.getElementById('runningOnlyBtn'),
  configBtn: document.getElementById('configBtn'),
  configFileBtn: document.getElementById('configFileBtn'),
  loginToggle: document.getElementById('loginToggle'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  rootInput: document.getElementById('rootInput'),
  browseRootBtn: document.getElementById('browseRootBtn'),
  addRootBtn: document.getElementById('addRootBtn'),
  rootList: document.getElementById('rootList'),
  template: document.getElementById('projectTemplate'),
};

let latestPayload = null;
let runningOnly = false;

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

function openSettings() {
  els.settingsModal.classList.remove('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  els.settingsModal.classList.add('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'true');
}

function renderRootRow(root) {
  const row = document.createElement('div');
  row.className = 'root-row';

  const info = document.createElement('div');
  info.className = 'root-info';

  const title = document.createElement('strong');
  title.textContent = root;

  const subtitle = document.createElement('span');
  subtitle.textContent = '加入后会递归扫描其中的 control-panel.json';

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
  const pathNode = fragment.querySelector('.project-path');
  const notes = fragment.querySelector('.project-notes');
  const details = fragment.querySelector('.project-details');
  const status = fragment.querySelector('.status-pill');
  const pid = fragment.querySelector('.project-pid');
  const root = fragment.querySelector('.project-root');
  const dir = fragment.querySelector('.project-dir');
  const output = fragment.querySelector('.project-output');
  const startBtn = fragment.querySelector('.start-btn');
  const stopBtn = fragment.querySelector('.stop-btn');
  const restartBtn = fragment.querySelector('.restart-btn');
  const homepageBtn = fragment.querySelector('.homepage-btn');
  const repositoryBtn = fragment.querySelector('.repository-btn');
  const folderBtn = fragment.querySelector('.folder-btn');

  name.textContent = project.name;
  pathNode.textContent = project.notes || '未填写说明';
  notes.textContent = project.source === 'auto' ? `来源：${project.root}` : '来源：手动配置';
  status.textContent = statusLabel(project.status);
  status.dataset.status = project.status;
  pid.textContent = project.pid ? String(project.pid) : '-';
  root.textContent = project.root || '未配置';
  dir.textContent = project.projectDir || project.workingDirectory || '未配置';
  const outputText = project.details || project.lastOutput || '';
  output.textContent = outputText || '-';
  details.hidden = !project.pid && !outputText && !project.root && !(project.projectDir || project.workingDirectory);

  startBtn.disabled = project.status === 'running' || project.status === 'starting';
  stopBtn.disabled = project.status === 'stopped' || project.status === 'stopping';
  restartBtn.disabled = project.status === 'starting' || project.status === 'stopping';
  homepageBtn.disabled = !(project.homepageUrl || project.openHomepageCommand);
  repositoryBtn.disabled = !project.projectDir;

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    await api.startProject(project.key);
    await refresh();
  });

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    await api.stopProject(project.key);
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

  card.dataset.status = project.status;
  return fragment;
}

function renderDashboard(data) {
  latestPayload = data;
  const allProjects = data.projects || [];
  const projects = runningOnly ? allProjects.filter((project) => project.status === 'running') : allProjects;
  els.list.innerHTML = '';

  const runningCount = allProjects.filter((project) => project.status === 'running').length;
  els.runningSummary.textContent = `${allProjects.length} 项目 · ${runningCount} 运行中`;
  els.configPath.textContent = data.configPath || '-';
  els.statePath.textContent = data.statePath || '-';
  els.updatedAt.textContent = formatTimestamp(data.updatedAt);
  els.loginToggle.checked = Boolean(data.openAtLogin);
  els.runningOnlyBtn.classList.toggle('is-active', runningOnly);
  els.runningOnlyBtn.textContent = runningOnly ? '显示全部' : '只看运行中';

  projects.forEach((project) => {
    els.list.appendChild(renderProject(project));
  });

  renderRoots(data.config);
}

async function refresh() {
  const data = await api.getDashboardData();
  renderDashboard(data);
}

els.refreshBtn.addEventListener('click', refresh);
els.runningOnlyBtn.addEventListener('click', () => {
  runningOnly = !runningOnly;
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
els.loginToggle.addEventListener('change', async (event) => {
  els.loginToggle.disabled = true;
  try {
    await api.setOpenAtLogin(event.target.checked);
    await refresh();
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
