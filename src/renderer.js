const api = window.controlPanel;

const els = {
  list: document.getElementById('projectList'),
  runningSummary: document.getElementById('runningSummary'),
  healthIndicator: document.getElementById('healthIndicator'),
  healthSummary: document.getElementById('healthSummary'),
  runningMetric: document.getElementById('runningMetric'),
  autoStartMetric: document.getElementById('autoStartMetric'),
  attentionMetric: document.getElementById('attentionMetric'),
  refreshIndicator: document.getElementById('refreshIndicator'),
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
  addRootBtn: document.getElementById('addRootBtn'),
  rootList: document.getElementById('rootList'),
  template: document.getElementById('projectTemplate'),
};

for (const id of ['sidebarCloseBtn', 'appLayout', 'navToggleBtn', 'navAllBtn', 'navRunningBtn', 'navFavoritesBtn', 'allNavCount', 'runningNavCount', 'favoriteNavCount', 'groupNav', 'tagNav', 'backendStatus', 'backendUptime', 'viewTitle', 'viewDescription', 'visibleCount', 'selectionBar', 'startVisibleBtn', 'groupFilter', 'tagFilter', 'favoriteFilter', 'selectVisible', 'selectionCount', 'batchStartBtn', 'batchGroupBtn', 'clearSelectionBtn', 'batchResult', 'organizationModal', 'organizationForm', 'organizationHint', 'organizationTitle', 'organizationError', 'closeOrganizationBtn', 'saveOrganizationBtn', 'groupOptions', 'tagsField', 'favoriteField', 'scanDepth', 'scanIssues']) els[id] = document.getElementById(id);
els.projectNav = document.getElementById('projectNav');
const { buildProjectTree, matchingProjects } = window.projectTree;
const collapsedBranches = new Set();
let hierarchyFilterSignature = '';
const selectedProjects = new Set();
let visibleProjects = [];
let openProjectMenus = new Set();
let expandedProjectKeys = new Set();
let organizationKeys = [];
let groupFilter = 'all';
let tagFilter = 'all';
let batchInFlight = false;
let latestPayload = null;
let projectSearchQuery = '';
let statusFilter = 'all';
let projectSort = 'status';
let refreshInFlight = false;
let editingProject = null;
let modalReturnFocus = null;

function rememberModalFocus() {
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function restoreModalFocus() {
  const target = modalReturnFocus;
  modalReturnFocus = null;
  if (target && target.isConnected) {
    target.focus();
  }
}

function trapModalFocus(event, modal) {
  const focusable = [...modal.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.getClientRects().length > 0);
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return '-';
  }

  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
}

function formatUptime(lastStartedAt, status) {
  if (status !== 'running' || !lastStartedAt) {
    return '运行时长 —';
  }

  const startedAt = new Date(lastStartedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return '运行时长 —';
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

  const haystack = [project.name, project.notes, project.root, project.projectDir, project.workingDirectory, project.group, ...(project.tags || []), ...(project.ancestors || []).map((item) => item.name), project.relationship?.role, project.relationship?.notes]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function sortProjects(projects) {
  const statusOrder = { running: 0, starting: 1, stopping: 2, error: 3, stopped: 4 };
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
  rememberModalFocus();
  els.settingsModal.classList.remove('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'false');
  els.closeSettingsBtn.focus();
}

function closeSettings() {
  els.settingsModal.classList.add('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'true');
  restoreModalFocus();
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
  rememberModalFocus();
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
  restoreModalFocus();
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
  subtitle.textContent = '发现入口配置，并继续读取 children 声明的子项目';

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
  const uptime = fragment.querySelector('.project-uptime');
  const uptimeDetail = fragment.querySelector('.project-uptime-detail');
  const pid = fragment.querySelector('.project-pid');
  const pidDetail = fragment.querySelector('.project-pid-detail');
  const port = fragment.querySelector('.project-port');
  const source = fragment.querySelector('.project-source');
  const root = fragment.querySelector('.project-root');
  const dir = fragment.querySelector('.project-dir');
  const output = fragment.querySelector('.project-output');
  const outputDetail = fragment.querySelector('.project-output-detail');
  const primaryAction = fragment.querySelector('.primary-action');
  const restartBtn = fragment.querySelector('.restart-btn');
  const homepageBtn = fragment.querySelector('.homepage-btn');
  const repositoryBtn = fragment.querySelector('.repository-btn');
  const folderBtn = fragment.querySelector('.folder-btn');
  const projectConfigBtn = fragment.querySelector('.project-config-btn');
  const projectMenu = fragment.querySelector('.project-menu');
  const panelStartBtn = fragment.querySelector('.panel-start-btn');
  const panelStart = fragment.querySelector('.project-panel-start');
  const projectIconButton = fragment.querySelector('.project-icon-button');
  const projectIconImage = fragment.querySelector('.project-icon-image');
  const projectIconFallback = fragment.querySelector('.project-icon-fallback');
  const projectIconBtn = fragment.querySelector('.project-icon-btn');
  const resetProjectIconBtn = fragment.querySelector('.reset-project-icon-btn');
  const projectIconSource = fragment.querySelector('.project-icon-source');

  const checkbox = fragment.querySelector('.project-checkbox');
  checkbox.checked = selectedProjects.has(project.key);
  checkbox.setAttribute('aria-label', `选择 ${project.name}`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedProjects.add(project.key); else selectedProjects.delete(project.key);
    updateSelection();
  });
  const labels = fragment.querySelector('.project-labels');
  for (const label of [project.favorite ? '★ 星标' : '', project.localGroup, project.relationship?.role, ...(project.tags || [])].filter(Boolean)) {
    const badge = document.createElement('span');
    badge.textContent = label;
    labels.appendChild(badge);
  }
  const organizationBtn = fragment.querySelector('.organization-btn');
  organizationBtn.addEventListener('click', () => { projectMenu.open = false; openOrganization([project.key]); });
  const favoriteBtn = fragment.querySelector('.favorite-btn');
  favoriteBtn.textContent = project.favorite ? '取消星标' : '添加星标';
  favoriteBtn.addEventListener('click', async () => {
    try { await api.saveProjectOrganization([project.key], { favorite: !project.favorite }); await refresh(); }
    catch (error) { showBatchMessage(`保存失败：${error.message}`); }
  });
  const outputText = project.details || project.lastOutput || '';
  name.textContent = project.name;
  notes.textContent = project.notes || project.techStack || '未填写说明';
  output.textContent = statusSummary(project, outputText);
  outputDetail.textContent = outputText || '-';
  output.hidden = !output.textContent;
  status.textContent = statusLabel(project.status);
  status.dataset.status = project.status;
  status.title = `当前状态：${statusLabel(project.status)}`;
  status.setAttribute('aria-label', statusLabel(project.status));
  usage.textContent = String(project.usageCount || 0);
  lastStarted.textContent = project.lastStartedAt ? formatTimestamp(project.lastStartedAt) : '-';
  uptime.textContent = formatUptime(project.lastStartedAt, project.status);
  uptimeDetail.textContent = formatUptime(project.lastStartedAt, project.status);
  pid.textContent = project.pid ? `PID ${project.pid}` : 'PID —';
  pidDetail.textContent = project.pid ? String(project.pid) : '-';
  try {
    const parsedUrl = new URL(project.frontendUrl || '');
    port.textContent = parsedUrl.port ? `端口 ${parsedUrl.port}` : '端口 —';
  } catch (error) {
    port.textContent = '端口 —';
  }
  source.textContent = project.source === 'auto' ? `自动发现 · ${project.root}` : '来源：手动配置';
  panelStart.textContent = project.startOnPanelLaunch ? '已启用' : '未启用';
  root.textContent = [...(project.ancestors || []).map((item) => item.name), project.relationship?.notes].filter(Boolean).join(' / ') || project.root || '未配置';
  dir.textContent = project.projectDir || project.workingDirectory || '未配置';
  const iconSourceLabels = { user: '用户自定义', project: '项目 manifest', fallback: '自动生成' };
  projectIconSource.textContent = iconSourceLabels[project.iconSource] || '自动生成';
  if (project.iconDataUrl) {
    projectIconImage.src = project.iconDataUrl;
    projectIconImage.hidden = false;
    projectIconFallback.hidden = true;
  } else {
    projectIconImage.hidden = true;
    projectIconFallback.hidden = false;
    projectIconFallback.innerHTML = fallbackIconSvg(project.surfaceType);
  }
  details.hidden = !project.pid && !outputText && !project.root && !(project.projectDir || project.workingDirectory);
  detailToggle.hidden = details.hidden;

  detailToggle.addEventListener('click', () => {
    const expanded = !details.classList.contains('hidden');
    details.classList.toggle('hidden', expanded);
    detailToggle.textContent = expanded ? '查看详情' : '收起详情';
    detailToggle.classList.toggle('is-active', !expanded);
    projectMenu.open = false;
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
  primaryAction.textContent = isRunning ? '停止' : isTransitioning ? statusLabel(project.status) : '启动';
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
    if (project.isPanel) await restartPanel();
    else { await api.restartProject(project.key); await refresh(); }
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

  const chooseIcon = async () => {
    try {
      const changed = await api.chooseProjectIcon(project.key);
      if (changed) {
        await refresh();
      }
    } catch (error) {
      els.runningSummary.textContent = `设置项目图标失败：${String(error?.message || error)}`;
    }
  };
  projectIconButton.addEventListener('click', chooseIcon);
  projectIconBtn.addEventListener('click', chooseIcon);
  resetProjectIconBtn.hidden = project.iconSource !== 'user';
  resetProjectIconBtn.addEventListener('click', async () => {
    await api.resetProjectIcon(project.key);
    await refresh();
  });

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

  card.dataset.key = project.key;
  card.dataset.startedAt = project.lastStartedAt || '';
  card.dataset.status = project.status;
  projectMenu.open = openProjectMenus.has(project.key);
  if (expandedProjectKeys.has(project.key)) { details.classList.remove('hidden'); detailToggle.textContent = '收起详情'; }
  if (project.isPanel) { primaryAction.disabled = true; restartBtn.disabled = panelRestartInFlight; restartBtn.title = '重启控制面板后端，页面会自动重新连接'; primaryAction.title = '后端自身请通过 scripts/stop.sh 管理'; }
  return fragment;
}

function fallbackIconSvg(surfaceType) {
  const shared = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  if (surfaceType === 'web') {
    return `<svg ${shared}><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.4 2.2 3.5 4.9 3.5 8s-1.1 5.8-3.5 8c-2.4-2.2-3.5-4.9-3.5-8S9.6 6.2 12 4Z"/></svg>`;
  }
  if (surfaceType === 'service') {
    return `<svg ${shared}><path d="M7 8h10M7 12h10M7 16h10"/><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="7" cy="8" r=".6" fill="currentColor" stroke="none"/></svg>`;
  }
  if (surfaceType === 'desktop') {
    return `<svg ${shared}><rect x="3.5" y="4" width="17" height="13" rx="2"/><path d="M8.5 20h7M12 17v3"/></svg>`;
  }
  return `<svg ${shared}><path d="m12 3 7.5 4.3v9.4L12 21l-7.5-4.3V7.3L12 3Z"/><path d="m4.8 7.5 7.2 4.2 7.2-4.2M12 11.7V21"/></svg>`;
}

function renderProjectNode(node, depth = 0) {
  const section = document.createElement('section');
  section.className = `project-node${node.children.length ? ' project-branch' : ''}`;
  section.dataset.nodeKey = node.key;
  if (node.children.length || node.collection) {
    const header = document.createElement('header'); header.className = 'branch-header';
    const button = document.createElement('button'); button.className = 'branch-toggle';
    const collapsed = collapsedBranches.has(node.key);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? '展开' : '收起'} ${node.name} 的子项目`);
    const arrow = document.createElement('span'); arrow.className = 'branch-chevron'; arrow.textContent = collapsed ? '▸' : '▾'; arrow.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.textContent = `${node.name} · ${node.collection ? '项目集合' : '父项目'}`;
    button.append(arrow, title);
    const descendants = matchingProjects(node);
    const summary = document.createElement('span'); summary.className = 'branch-summary';
    summary.textContent = `${descendants.length} 个服务 · ${descendants.filter((project) => project.status === 'running').length} 个运行中`;
    const launch = document.createElement('button'); launch.className = 'group-start'; launch.textContent = '启动整个项目';
    launch.disabled = batchInFlight || !descendants.some((project) => project.canBatchStart && project.status !== 'running');
    launch.addEventListener('click', () => runBatch(descendants.map((project) => project.key), node.name));
    header.append(button, summary, launch); section.appendChild(header);
    const body = document.createElement('div'); body.className = 'branch-body'; body.hidden = collapsed;
    button.addEventListener('click', () => {
      const next = !body.hidden; body.hidden = next;
      if (next) collapsedBranches.add(node.key); else collapsedBranches.delete(node.key);
      button.setAttribute('aria-expanded', String(!next));
      button.setAttribute('aria-label', `${next ? '展开' : '收起'} ${node.name} 的子项目`); arrow.textContent = next ? '▸' : '▾';
    });
    appendNodeContents(section, { ...node, children: [] }, depth);
    appendNodeContents(body, { ...node, project: null }, depth); section.appendChild(body);
  } else appendNodeContents(section, node, depth);
  return section;
}

function appendNodeContents(container, node, depth) {
  if (node.project && node.matches) container.appendChild(renderProject(node.project));
  else if (node.project) {
    const context = document.createElement('div'); context.className = 'parent-context';
    const title = document.createElement('strong'); title.textContent = node.name;
    const note = document.createElement('span'); note.textContent = '所属父项目 · 未匹配当前筛选';
    context.append(title, note); container.appendChild(context);
  }
  if (node.children.length) {
    const children = document.createElement('div'); children.className = 'project-children';
    children.setAttribute('aria-label', `${node.name} 的子项目`);
    for (const child of sortNodes(node.children)) {
      const item = renderProjectNode(child, depth + 1);
      if (child.project?.relationship?.notes) item.title = child.project.relationship.notes;
      children.appendChild(item);
    }
    container.appendChild(children);
  }
}

function nodeStatus(node) {
  const statuses = new Set(matchingProjects(node).map((project) => project.status));
  return ['running', 'starting', 'stopping', 'error', 'stopped'].find((status) => statuses.has(status)) || 'stopped';
}

function sortNodes(nodes) {
  const ordered = sortProjects(nodes.map((node) => ({ ...(node.project || { key: node.key, name: node.name }), ...(projectSort === 'status' ? { status: nodeStatus(node) } : {}) })));
  const positions = new Map(ordered.map((item, index) => [item.key, index]));
  return [...nodes].sort((a, b) => positions.get(a.key) - positions.get(b.key));
}

function appendProjectGroup(title, nodes) {
  const group = document.createElement('section'); group.className = 'project-group';
  const projects = nodes.flatMap(matchingProjects);
  const header = document.createElement('header'); header.className = 'project-group-header';
  const heading = document.createElement('h2'); heading.textContent = title;
  const count = document.createElement('span'); count.textContent = `${projects.length} 个服务`;
  const launch = document.createElement('button'); launch.className = 'group-start'; launch.textContent = '启动本组';
  launch.disabled = batchInFlight || !projects.some((project) => project.canBatchStart && project.status !== 'running');
  launch.addEventListener('click', () => runBatch(projects.map((project) => project.key), title));
  header.append(heading, count, launch);
  const rows = document.createElement('div'); rows.className = 'project-group-rows';
  for (const node of sortNodes(nodes)) rows.appendChild(renderProjectNode(node));
  group.append(header, rows); els.list.appendChild(group);
}

function renderDashboard(data) {
  openProjectMenus = new Set([...els.list.querySelectorAll('.card')].filter((card) => card.querySelector('.project-menu')?.open).map((card) => card.dataset.key));
  expandedProjectKeys = new Set([...els.list.querySelectorAll('.card')].filter((card) => !card.querySelector('.project-details')?.classList.contains('hidden')).map((card) => card.dataset.key));
  latestPayload = data;
  const allProjects = data.projects || [];
  const query = projectSearchQuery.trim().toLocaleLowerCase();
  const projects = sortProjects(allProjects.filter((project) => (
    (statusFilter === 'all' || project.status === statusFilter) && projectMatchesSearch(project, query) &&
    (groupFilter === 'all' || (groupFilter === 'ungrouped' ? !project.localGroup : groupFilter.startsWith('project:') ? project.key === groupFilter.slice(8) || (project.ancestors || []).some((item) => item.key === groupFilter.slice(8)) : project.localGroup === groupFilter.slice(6))) &&
    (tagFilter === 'all' || (project.tags || []).includes(tagFilter.slice(4))) &&
    (!els.favoriteFilter.checked || project.favorite)
  )));
  const filterSignature = JSON.stringify([query, statusFilter, groupFilter, tagFilter, els.favoriteFilter.checked]);
  if (filterSignature !== hierarchyFilterSignature && (query || statusFilter !== 'all' || groupFilter !== 'all' || tagFilter !== 'all' || els.favoriteFilter.checked)) {
    for (const project of projects) for (const ancestor of project.ancestors || []) collapsedBranches.delete(ancestor.key);
  }
  hierarchyFilterSignature = filterSignature;
  visibleProjects = projects;
  const existingKeys = new Set(allProjects.map((project) => project.key));
  for (const key of selectedProjects) if (!existingKeys.has(key)) selectedProjects.delete(key);
  renderOrganizationFilters(allProjects, data.scanReport?.collections || []);
  els.list.innerHTML = '';

  const runningCount = allProjects.filter((project) => project.status === 'running').length;
  const attentionCount = allProjects.filter((project) => project.status === 'error').length;
  const autoStartCount = allProjects.filter((project) => project.startOnPanelLaunch).length;
  els.runningSummary.textContent = `${allProjects.length} 个服务 · ${runningCount} 个运行中`;
  renderNavigation(allProjects, data.scanReport?.collections || []);
  els.backendStatus.textContent = '本机后端已连接';
  els.backendUptime.textContent = formatUptime(data.backendStartedAt, 'running').replace('运行', '后端已运行');
  els.visibleCount.textContent = `当前显示 ${projects.length} 个服务`;
  els.runningMetric.textContent = String(runningCount);
  els.autoStartMetric.textContent = String(autoStartCount);
  els.attentionMetric.textContent = String(attentionCount);
  els.healthSummary.textContent = attentionCount > 0 ? '需要关注' : allProjects.length > 0 ? '良好' : '等待项目';
  els.healthIndicator.dataset.state = attentionCount > 0 ? 'attention' : allProjects.length > 0 ? 'healthy' : 'idle';
  els.configPath.textContent = data.configPath || '-';
  els.statePath.textContent = data.statePath || '-';
  els.updatedAt.textContent = formatTimestamp(data.updatedAt);
  setRefreshIndicator(true);
  els.loginToggle.checked = Boolean(data.openAtLogin);
  const loginItemStatus = data.loginItemStatus || {};
  if (loginItemStatus.status === 'enabled') {
    els.loginItemStatus.textContent = '已启用：登录后启动本机后端服务';
  } else if (loginItemStatus.status === 'stale' || loginItemStatus.status === 'error') {
    els.loginItemStatus.textContent = loginItemStatus.detail || '登录项状态异常';
  } else {
    els.loginItemStatus.textContent = '未启用：登录后不自动启动后端';
  }
  if (projects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'project-empty-state';
    empty.textContent = allProjects.length === 0
      ? '尚未发现项目。先添加扫描目录，再为项目放入 control-panel.json。'
      : '没有符合当前搜索或筛选条件的项目。';
    els.list.appendChild(empty);
  } else {
    const grouped = new Map();
    for (const project of buildProjectTree(allProjects, data.scanReport?.collections || [], projects.map((project) => project.key))) {
      const groupName = project.project?.localGroup || (project.children.length || project.collection ? '项目与子服务' : '独立服务');
      const title = projectSort === 'status' ? `${statusLabel(nodeStatus(project))} · ${groupName}` : groupName;
      if (!grouped.has(title)) grouped.set(title, []);
      grouped.get(title).push(project);
    }
    const ranks = ['运行中', '启动中', '停止中', '错误', '已停止'];
    const groups = [...grouped].sort(([a], [b]) => {
      if (projectSort === 'status') {
        const difference = ranks.indexOf(a.split(' · ')[0]) - ranks.indexOf(b.split(' · ')[0]);
        if (difference) return difference;
      }
      return a.localeCompare(b, 'zh-Hans-CN');
    });
    for (const [title, items] of groups) appendProjectGroup(title, items);
  }

  els.scanDepth.value = String(data.config?.scan?.maxDepth ?? 1);
  els.scanIssues.replaceChildren();
  for (const issue of data.scanReport?.issues || []) {
    const line = document.createElement('p'); line.className = 'form-error';
    line.textContent = `${issue.path}：${issue.detail}`; els.scanIssues.appendChild(line);
  }
  updateSelection();
  renderRoots(data.config);
  updateRepositoryIndicators();
}

function setRefreshIndicator(healthy, detail = '') {
  const label = healthy ? '状态更新正常' : `状态更新失败${detail ? `：${detail}` : ''}`;
  els.refreshIndicator.dataset.state = healthy ? 'healthy' : 'error';
  els.refreshIndicator.setAttribute('aria-label', label);
  els.refreshIndicator.title = label;
}

let panelRestartInFlight = false;
async function restartPanel() {
  if (panelRestartInFlight) return;
  panelRestartInFlight = true;
  showBatchMessage('控制面板正在重启，页面将自动重新连接…');
  try {
    const { pid } = await api.restartPanel();
    els.refreshIndicator.dataset.state = 'pending';
    els.refreshIndicator.title = '控制面板正在重启';
    els.refreshIndicator.setAttribute('aria-label', '控制面板正在重启');
    await api.waitForPanelRestart(pid);
    panelRestartInFlight = false;
    await refresh();
    await readRepositorySync();
    showBatchMessage('控制面板已重启，连接已恢复。');
  } catch (error) {
    panelRestartInFlight = false;
    if (latestPayload) renderDashboard(latestPayload);
    setRefreshIndicator(false, error.message);
    showBatchMessage(`控制面板重启失败：${error.message}`);
  } finally { panelRestartInFlight = false; }
}

async function refresh() {
  if (panelRestartInFlight) return;
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const data = await api.getDashboardData();
    if (!latestPayload || (latestPayload.snapshotId || latestPayload.updatedAt) !== (data.snapshotId || data.updatedAt) || els.backendStatus.textContent !== '本机后端已连接') renderDashboard(data);
    else updateRuntimeDisplays();
    setRefreshIndicator(true);
  } catch (error) {
    const message = String(error?.message || error || '未知错误');
    els.runningSummary.textContent = `刷新失败：${message}`;
    els.backendStatus.textContent = '后端连接失败';
    setRefreshIndicator(false, message);
  } finally {
    refreshInFlight = false;
  }
}

els.refreshBtn.addEventListener('click', async () => {
  els.refreshBtn.disabled = true;
  try { await api.refreshProjects(); await refresh(); }
  catch (error) { setRefreshIndicator(false, error.message); showBatchMessage(`刷新失败：${error.message}`); }
  finally { els.refreshBtn.disabled = false; }
});
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
  const activeModal = !document.getElementById('repositorySyncModal').classList.contains('hidden') ? document.getElementById('repositorySyncModal') : !els.organizationModal.classList.contains('hidden') ? els.organizationModal : !els.projectEditorModal.classList.contains('hidden')
    ? els.projectEditorModal
    : !els.settingsModal.classList.contains('hidden')
      ? els.settingsModal
      : null;
  if (event.key === 'Tab' && activeModal) {
    trapModalFocus(event, activeModal);
    return;
  }
  if (event.key === 'Escape') {
    if (!document.getElementById('repositorySyncModal').classList.contains('hidden')) { closeRepositorySync(); }
    else if (!els.organizationModal.classList.contains('hidden')) { closeOrganization(); }
    else if (!els.projectEditorModal.classList.contains('hidden')) {
      closeProjectEditor();
    } else if (!els.settingsModal.classList.contains('hidden')) {
      closeSettings();
    } else { closeMobileNavigation(); }
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

refresh().catch((error) => {
  els.runningSummary.textContent = `加载失败：${String(error.message || error)}`;
});

function renderOrganizationFilters(projects, collections) {
  const groups = [...new Set(projects.map((project) => project.localGroup).filter(Boolean))].sort();
  const tags = [...new Set(projects.flatMap((project) => project.tags || []))].sort();
  const fill = (select, options, value) => { select.replaceChildren(...options.map(([key, title]) => new Option(title, key))); select.value = value; };
  fill(els.groupFilter, [['all', '全部分组'], ['ungrouped', '未分组'], ...groups.map((group) => [`group:${group}`, group]), ...buildProjectTree(projects, collections).filter((node) => node.children.length || node.collection).map((node) => [`project:${node.key}`, `项目：${node.name}（含子项目）`])], groupFilter);
  fill(els.tagFilter, [['all', '全部标签'], ...tags.map((tag) => [`tag:${tag}`, tag])], tagFilter);
  if (!els.groupFilter.value) { els.groupFilter.add(new Option('当前分组（暂无服务）', groupFilter)); els.groupFilter.value = groupFilter; }
  if (!els.tagFilter.value) { els.tagFilter.add(new Option('当前标签（暂无服务）', tagFilter)); els.tagFilter.value = tagFilter; }
  els.groupOptions.replaceChildren(...groups.map((group) => new Option(group, group)));
}
function updateSelection() {
  els.selectionBar.classList.toggle('hidden', !selectedProjects.size);
  els.selectionCount.textContent = `已选 ${selectedProjects.size} 项`;
  els.startVisibleBtn.disabled = batchInFlight || !visibleProjects.some((project) => project.canBatchStart && project.status !== 'running');
  els.batchStartBtn.disabled = batchInFlight || !selectedProjects.size;
  els.batchGroupBtn.disabled = batchInFlight || !selectedProjects.size;
  els.clearSelectionBtn.disabled = !selectedProjects.size;
  const selectedVisible = visibleProjects.filter((project) => selectedProjects.has(project.key)).length;
  els.selectVisible.checked = visibleProjects.length > 0 && selectedVisible === visibleProjects.length;
  els.selectVisible.indeterminate = selectedVisible > 0 && selectedVisible < visibleProjects.length;
  els.selectVisible.disabled = !visibleProjects.length;
}
function showBatchMessage(message) {
  els.batchResult.classList.remove('hidden');
  els.batchResult.textContent = message;
}
async function runBatch(keys, title) {
  if (batchInFlight) return;
  batchInFlight = true;
  renderDashboard(latestPayload);
  showBatchMessage(`正在启动 ${title}，共 ${keys.length} 项…`);
  try {
    const results = await api.startProjects(keys);
    const count = (outcome) => results.filter((item) => item.outcome === outcome).length;
    showBatchMessage(`启动命令已执行 ${count('started')} 项 · 跳过 ${count('skipped')} 项 · 失败 ${count('failed')} 项。运行状态会自动刷新。`);
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '逐项结果'; details.appendChild(summary);
    const labels = { started: '已执行', skipped: '跳过', failed: '失败' };
    for (const item of results) {
      const line = document.createElement('p'); line.textContent = `${item.name} · ${labels[item.outcome]}：${item.detail}`; details.appendChild(line);
    }
    els.batchResult.appendChild(details);
  } catch (error) { showBatchMessage(`批量启动失败：${error.message}`); }
  finally { batchInFlight = false; await refresh(); }
}
function openOrganization(keys) {
  rememberModalFocus(); organizationKeys = [...keys];
  const project = latestPayload.projects.find((item) => item.key === keys[0]);
  const batch = keys.length > 1;
  els.organizationTitle.textContent = batch ? '批量归组' : '服务标记与分组';
  els.organizationHint.textContent = batch ? `为所选 ${keys.length} 个服务设置同一个分组` : project.name;
  els.organizationForm.elements.group.value = batch ? '' : project.localGroup || '';
  els.organizationForm.elements.tags.value = batch ? '' : (project.tags || []).join(', ');
  els.organizationForm.elements.favorite.checked = project.favorite;
  els.tagsField.hidden = batch; els.favoriteField.hidden = batch;
  els.organizationError.classList.add('hidden');
  els.organizationModal.classList.remove('hidden'); els.organizationModal.setAttribute('aria-hidden', 'false');
  els.organizationForm.elements.group.focus();
}
function closeOrganization() {
  els.organizationModal.classList.add('hidden'); els.organizationModal.setAttribute('aria-hidden', 'true'); restoreModalFocus();
}
els.organizationForm.addEventListener('submit', async (event) => {
  event.preventDefault(); els.saveOrganizationBtn.disabled = true;
  const form = els.organizationForm.elements;
  const input = { group: form.group.value };
  if (organizationKeys.length === 1) { input.tags = form.tags.value.split(/[,，]/); input.favorite = form.favorite.checked; }
  try { await api.saveProjectOrganization(organizationKeys, input); closeOrganization(); await refresh(); }
  catch (error) { els.organizationError.textContent = error.message; els.organizationError.classList.remove('hidden'); }
  finally { els.saveOrganizationBtn.disabled = false; }
});
els.closeOrganizationBtn.addEventListener('click', closeOrganization);
els.organizationModal.addEventListener('click', (event) => { if (event.target === els.organizationModal) closeOrganization(); });
els.startVisibleBtn.addEventListener('click', () => runBatch(visibleProjects.map((project) => project.key), '当前列表'));
els.batchStartBtn.addEventListener('click', () => runBatch([...selectedProjects], '所选服务'));
els.batchGroupBtn.addEventListener('click', () => openOrganization([...selectedProjects]));
els.clearSelectionBtn.addEventListener('click', () => { selectedProjects.clear(); renderDashboard(latestPayload); });
els.selectVisible.addEventListener('change', () => {
  for (const project of visibleProjects) { if (els.selectVisible.checked) selectedProjects.add(project.key); else selectedProjects.delete(project.key); }
  renderDashboard(latestPayload);
});
els.groupFilter.addEventListener('change', () => { groupFilter = els.groupFilter.value; renderDashboard(latestPayload); });
els.tagFilter.addEventListener('change', () => { tagFilter = els.tagFilter.value; renderDashboard(latestPayload); });
els.favoriteFilter.addEventListener('change', () => renderDashboard(latestPayload));
els.scanDepth.addEventListener('change', async () => {
  try { await api.setScanDepth(Number(els.scanDepth.value)); await refresh(); }
  catch (error) { els.scanIssues.textContent = error.message; }
});
window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
window.setInterval(updateRuntimeDisplays, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateRuntimeDisplays(); refresh(); } });

function updateRuntimeDisplays() {
  if (!latestPayload) return;
  els.backendUptime.textContent = formatUptime(latestPayload.backendStartedAt, 'running').replace('运行', '后端已运行');
  for (const card of els.list.querySelectorAll('.card')) {
    const text = formatUptime(card.dataset.startedAt, card.dataset.status);
    card.querySelector('.project-uptime').textContent = text;
    card.querySelector('.project-uptime-detail').textContent = text;
  }
}

window.addEventListener('unhandledrejection', (event) => { showBatchMessage(`操作失败：${String(event.reason?.message || event.reason)}`); event.preventDefault(); });

function renderNavigation(projects, collections) {
  els.allNavCount.textContent = projects.length;
  els.runningNavCount.textContent = projects.filter((project) => project.status === 'running').length;
  els.favoriteNavCount.textContent = projects.filter((project) => project.favorite).length;
  const allScope = groupFilter === 'all' && tagFilter === 'all';
  for (const [button, active] of [[els.navAllBtn, allScope && statusFilter === 'all' && !els.favoriteFilter.checked], [els.navRunningBtn, allScope && statusFilter === 'running' && !els.favoriteFilter.checked], [els.navFavoritesBtn, allScope && els.favoriteFilter.checked]]) {
    button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
  }
  els.groupNav.replaceChildren();
  const scopeButton = (value, name, count, target = els.groupNav, depth = 0) => {
    const button = document.createElement('button'); button.className = 'nav-item';
    button.classList.toggle('is-active', groupFilter === value); button.setAttribute('aria-pressed', String(groupFilter === value));
    const label = document.createElement('span'); label.textContent = name;
    const badge = document.createElement('span'); badge.className = 'nav-count'; badge.textContent = count;
    button.style.setProperty('--nav-depth', Math.min(depth, 6));
    button.append(label, badge); button.addEventListener('click', () => {
      groupFilter = groupFilter === value ? 'all' : value; tagFilter = 'all'; statusFilter = 'all'; els.statusFilter.value = 'all'; els.favoriteFilter.checked = false;
      renderDashboard(latestPayload); closeMobileNavigation();
    }); target.appendChild(button);
  };
  els.projectNav.replaceChildren();
  const navigateNode = (node, depth = 0) => {
    scopeButton(`project:${node.key}`, node.name, matchingProjects(node).length, els.projectNav, depth);
    for (const child of sortNodes(node.children)) navigateNode(child, depth + 1);
  };
  const families = sortNodes(buildProjectTree(projects, collections).filter((node) => node.children.length || node.collection));
  families.forEach((node) => navigateNode(node));
  if (!families.length) {
    const note = document.createElement('p'); note.className = 'nav-empty'; note.textContent = '项目声明子服务后，在这里显示从属层级。'; els.projectNav.appendChild(note);
  }
  const groups = [...new Set(projects.map((project) => project.localGroup).filter(Boolean))].sort();
  for (const group of groups) scopeButton(`group:${group}`, group, projects.filter((project) => project.localGroup === group).length);
  const ungrouped = projects.filter((project) => !project.localGroup).length;
  if (ungrouped) scopeButton('ungrouped', '未分组', ungrouped);
  els.tagNav.replaceChildren();
  const tags = [...new Set(projects.flatMap((project) => project.tags || []))].sort();
  for (const tag of tags) {
    const button = document.createElement('button'); button.textContent = tag; button.classList.toggle('is-active', tagFilter === `tag:${tag}`); button.setAttribute('aria-pressed', String(tagFilter === `tag:${tag}`));
    button.addEventListener('click', () => { tagFilter = tagFilter === `tag:${tag}` ? 'all' : `tag:${tag}`; renderDashboard(latestPayload); closeMobileNavigation(); }); els.tagNav.appendChild(button);
  }
  if (!tags.length) { const note = document.createElement('p'); note.className = 'nav-empty'; note.textContent = '为服务加上标签，快速组合不同工作环境。'; els.tagNav.appendChild(note); }
  const selectedCollection = [...collections, ...projects].find((project) => groupFilter === `project:${project.key}`);
  els.viewTitle.textContent = selectedCollection?.name || (groupFilter.startsWith('group:') ? groupFilter.slice(6) : groupFilter === 'ungrouped' ? '未分组服务' : els.favoriteFilter.checked ? '星标服务' : statusFilter === 'running' ? '运行中的服务' : '全部服务');
  if (tagFilter !== 'all') els.viewTitle.textContent += ` · ${tagFilter.slice(4)}`;
  els.viewDescription.textContent = selectedCollection ? selectedCollection.notes || '按外层配置声明的归属关系，管理工作区内的所有服务。' : '把分散的服务组织起来，随时启动你需要的工作环境。';
}
function closeMobileNavigation() { els.appLayout.classList.remove('sidebar-open'); els.navToggleBtn.setAttribute('aria-expanded', 'false'); }
function selectView(view) {
  groupFilter = 'all'; tagFilter = 'all'; statusFilter = view === 'running' ? 'running' : 'all';
  els.statusFilter.value = statusFilter; els.favoriteFilter.checked = view === 'favorites';
  projectSearchQuery = ''; els.projectSearch.value = '';
  renderDashboard(latestPayload); closeMobileNavigation();
}
els.navAllBtn.addEventListener('click', () => selectView('all'));
els.navRunningBtn.addEventListener('click', () => selectView('running'));
els.navFavoritesBtn.addEventListener('click', () => selectView('favorites'));
els.sidebarCloseBtn.addEventListener('click', closeMobileNavigation);
els.navToggleBtn.addEventListener('click', () => { const open = els.appLayout.classList.toggle('sidebar-open'); els.navToggleBtn.setAttribute('aria-expanded', String(open)); });


const repoEls = Object.fromEntries(['repositorySyncModal', 'repositorySyncNav', 'repositoryPendingCount', 'checkRepositoriesBtn', 'closeRepositorySyncBtn', 'checkAllRepositoriesBtn', 'pullAllRepositoriesBtn', 'pushAllRepositoriesBtn', 'repositorySyncStatus', 'repositorySchedule', 'repositoryList', 'repositoryResults', 'repositoryAttentionBtn', 'repositoryAllBtn', 'repositoryPullBtn', 'repositoryPushBtn', 'repositoryActionSummary', 'syncAllRepositoriesBtn'].map((id) => [id, document.getElementById(id)]));
let repositoryPayload = null;
let repositoryView = 'attention';
let repositoryPoll = null;
let repositoryReadInFlight = false;
function openRepositorySync(view = 'attention') {
  repositoryView = view;
  if (repositoryPayload) renderRepositorySync(repositoryPayload);
  rememberModalFocus(); repoEls.repositorySyncModal.classList.remove('hidden'); repoEls.repositorySyncModal.setAttribute('aria-hidden', 'false');
  repoEls.closeRepositorySyncBtn.focus(); readRepositorySync();
}
function closeRepositorySync() {
  repoEls.repositorySyncModal.classList.add('hidden'); repoEls.repositorySyncModal.setAttribute('aria-hidden', 'true'); restoreModalFocus();
}
const repositoryLabels = { unchecked: '尚未检查', synced: '已同步', ahead: '待推送', behind: '待拉取', diverged: '已分叉', untracked: '无跟踪分支', detached: '游离分支', error: '检查失败' };
function renderRepositorySync(payload) {
  repositoryPayload = payload;
  updateRepositoryIndicators();
  const repositories = payload.repositories || [];
  const pending = repositories.filter(repositoryNeedsAttention).length;
  const pulls = repositories.filter((repo) => repo.behind && !repo.ahead);
  const pushes = repositories.filter((repo) => repo.ahead && !repo.behind);
  const readyPulls = pulls.filter((repo) => repositoryCanSync(repo, 'pull')).length;
  const readyPushes = pushes.filter((repo) => repositoryCanSync(repo, 'push')).length;
  const manual = repositories.filter((repo) => repositoryNeedsAttention(repo) && !repositoryCanSync(repo, 'pull') && !repositoryCanSync(repo, 'push')).length;
  repoEls.repositoryActionSummary.textContent = `待拉取 ${pulls.length} 个（可处理 ${readyPulls}） · 待推送 ${pushes.length} 个（可处理 ${readyPushes}） · 需人工处理 ${manual} 个`;

  repoEls.repositoryPendingCount.textContent = String(pending);
  repoEls.repositorySyncNav.classList.toggle('needs-attention', pending > 0);
  for (const id of ['checkRepositoriesBtn', 'checkAllRepositoriesBtn', 'pullAllRepositoriesBtn', 'pushAllRepositoriesBtn', 'syncAllRepositoriesBtn']) repoEls[id].disabled = payload.busy;
  repoEls.pullAllRepositoriesBtn.textContent = `拉取全部 ${readyPulls}`;
  repoEls.pushAllRepositoriesBtn.textContent = `推送全部 ${readyPushes}`;
  repoEls.syncAllRepositoriesBtn.textContent = `处理全部 ${readyPulls + readyPushes}`;
  repoEls.pullAllRepositoriesBtn.disabled = payload.busy || !readyPulls;
  repoEls.pushAllRepositoriesBtn.disabled = payload.busy || !readyPushes;
  repoEls.syncAllRepositoriesBtn.disabled = payload.busy || !(readyPulls + readyPushes);
  repoEls.syncAllRepositoriesBtn.title = '逐项重新检查并拉取或推送，需人工处理的仓库会跳过并列出原因';
  repoEls.checkRepositoriesBtn.textContent = payload.busy ? '仓库处理中…' : '检查仓库同步';
  repoEls.repositorySyncStatus.textContent = payload.error || (payload.busy ? `正在${payload.operation === 'push' ? '推送' : payload.operation === 'pull' ? '拉取' : payload.operation === 'sync' ? '同步' : '检查'}${payload.currentRepository ? `：${payload.currentRepository}` : '仓库…'}` : `${repositories.length} 个仓库 · ${pending} 个需要处理 · 最近完成：${formatTimestamp(payload.lastFinishedAt)}`);
  repoEls.repositorySchedule.textContent = `下次计划：${formatTimestamp(payload.nextCheckAt)}（本机时区） · 检查失败 15 分钟后重试 · 同一仓库只检查一次`;
  repoEls.repositoryAttentionBtn.textContent = `需要处理 ${pending}`;
  repoEls.repositoryPullBtn.textContent = `待拉取 ${pulls.length}`;
  repoEls.repositoryPushBtn.textContent = `待推送 ${pushes.length}`;
  repoEls.repositoryPullBtn.setAttribute('aria-pressed', String(repositoryView === 'pull'));
  repoEls.repositoryPushBtn.setAttribute('aria-pressed', String(repositoryView === 'push'));
  repoEls.repositoryAllBtn.textContent = `全部仓库 ${repositories.length}`;
  repoEls.repositoryAttentionBtn.setAttribute('aria-pressed', String(repositoryView === 'attention'));
  repoEls.repositoryAllBtn.setAttribute('aria-pressed', String(repositoryView === 'all'));
  repoEls.repositoryList.replaceChildren();
  const byService = new Map(repositories.flatMap((repo) => repo.services.map((service) => [service.key, repo.key])));
  const parentKeys = new Map(repositories.map((repo) => [repo.key, repo.services.flatMap((service) => service.ancestors || []).map((ancestor) => byService.get(ancestor.key)).reverse().find((key) => key && key !== repo.key)]));
  const renderRepo = (repo, depth = 0) => {
    const row = document.createElement('section'); row.className = 'repository-row'; row.dataset.repoKey = repo.key;
    row.style.setProperty('--repository-depth', Math.min(depth, 5));
    const info = document.createElement('div'); info.className = 'repository-info';
    const name = document.createElement('h3'); name.textContent = repo.name;
    const branch = document.createElement('span'); branch.className = 'repository-branch'; branch.textContent = repo.branch ? `${repo.branch} → ${repo.upstream || '未配置跟踪分支'}` : '等待检查分支';
    const directory = document.createElement('p'); directory.className = 'repository-directory'; directory.textContent = repo.directory;
    const status = document.createElement('p'); status.className = `repository-state state-${repo.status}`;
    status.classList.toggle('needs-attention', repositoryNeedsAttention(repo));
    status.textContent = repositoryStatusText(repo);
    const checked = document.createElement('p'); checked.className = 'field-help'; checked.textContent = `最后检查：${formatTimestamp(repo.checkedAt)}`;
    info.append(name, branch, directory, status);
    if (repositoryNeedsAttention(repo)) {
      const guidance = document.createElement('p'); guidance.className = 'repository-guidance'; guidance.textContent = repositoryActionGuidance(repo); info.appendChild(guidance);
    }
    info.appendChild(checked);
    if (repo.error) { const error = document.createElement('p'); error.className = 'form-error'; error.textContent = repo.error; info.appendChild(error); }
    const buttons = document.createElement('div'); buttons.className = 'repository-actions';
    for (const [kind, label] of [['check', '检查'], ['pull', '拉取'], ['push', '推送']]) {
      const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = label;
      button.disabled = payload.busy || (kind !== 'check' && !repositoryCanSync(repo, kind));
      button.addEventListener('click', () => runRepositoryAction(kind, [repo.key])); buttons.appendChild(button);
    }
    row.append(info, buttons); repoEls.repositoryList.appendChild(row);
    if (repositoryView === 'all') for (const child of repositories.filter((candidate) => parentKeys.get(candidate.key) === repo.key)) renderRepo(child, depth + 1);
  };
  const displayed = repositoryView === 'attention' ? repositories.filter(repositoryNeedsAttention) : repositoryView === 'pull' ? pulls : repositoryView === 'push' ? pushes : repositories.filter((repo) => !parentKeys.get(repo.key));
  displayed.forEach((repo) => renderRepo(repo));
  if (repositories.length && !displayed.length) { const empty = document.createElement('p'); empty.className = 'repository-empty'; empty.textContent = repositoryView === 'pull' ? '目前没有待拉取的仓库。' : repositoryView === 'push' ? '目前没有待推送的仓库。' : '目前没有需要处理的仓库。'; repoEls.repositoryList.appendChild(empty); }
  if (!repositories.length) { const empty = document.createElement('p'); empty.className = 'field-help'; empty.textContent = '当前项目中没有可识别的 Git 仓库。'; repoEls.repositoryList.appendChild(empty); }
  repoEls.repositoryResults.replaceChildren();
  for (const result of payload.results || []) {
    const line = document.createElement('p'); line.className = result.outcome === 'failed' ? 'form-error' : 'field-help';
    line.textContent = `${result.name} · ${{ checked: '已检查', success: '成功', skipped: '跳过', failed: '失败' }[result.outcome]}：${result.detail}`; repoEls.repositoryResults.appendChild(line);
  }
}
async function readRepositorySync() {
  if (repositoryReadInFlight || panelRestartInFlight || document.hidden) return;
  repositoryReadInFlight = true;
  try { renderRepositorySync(await api.getRepositorySync()); }
  catch (error) { repoEls.repositorySyncStatus.textContent = error.message; }
  finally { repositoryReadInFlight = false; clearTimeout(repositoryPoll); repositoryPoll = setTimeout(readRepositorySync, repositoryPayload?.busy ? 2000 : 15000); }
}
async function runRepositoryAction(kind, keys) {
  if (repositoryPayload?.busy) return;
  for (const id of ['checkRepositoriesBtn', 'checkAllRepositoriesBtn', 'pullAllRepositoriesBtn', 'pushAllRepositoriesBtn', 'syncAllRepositoriesBtn']) repoEls[id].disabled = true;
  try { renderRepositorySync(kind === 'check' ? await api.checkRepositories(keys) : await api.syncRepositories(kind, keys)); }
  catch (error) { repoEls.repositorySyncStatus.textContent = error.message; for (const id of ['checkRepositoriesBtn', 'checkAllRepositoriesBtn', 'pullAllRepositoriesBtn', 'pushAllRepositoriesBtn', 'syncAllRepositoriesBtn']) repoEls[id].disabled = false; }
  clearTimeout(repositoryPoll); repositoryPoll = setTimeout(readRepositorySync, 1000);
}
repoEls.repositorySyncNav.addEventListener('click', () => openRepositorySync());
for (const [button, view] of [[repoEls.repositoryAttentionBtn, 'attention'], [repoEls.repositoryAllBtn, 'all'], [repoEls.repositoryPullBtn, 'pull'], [repoEls.repositoryPushBtn, 'push']]) {
  button.addEventListener('click', () => { repositoryView = view; if (repositoryPayload) renderRepositorySync(repositoryPayload); });
}
repoEls.closeRepositorySyncBtn.addEventListener('click', closeRepositorySync);
repoEls.checkRepositoriesBtn.addEventListener('click', () => { openRepositorySync(); runRepositoryAction('check'); });
repoEls.syncAllRepositoriesBtn.addEventListener('click', () => runRepositoryAction('sync'));
repoEls.checkAllRepositoriesBtn.addEventListener('click', () => runRepositoryAction('check'));
repoEls.pullAllRepositoriesBtn.addEventListener('click', () => runRepositoryAction('pull'));
repoEls.pushAllRepositoriesBtn.addEventListener('click', () => runRepositoryAction('push'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) readRepositorySync(); });
readRepositorySync();

function updateRepositoryIndicators() {
  if (!repositoryPayload) return;
  const repositories = repositoryPayload.repositories || [];
  const lookup = new Map(repositories.flatMap((repo) => repo.services.map((service) => [service.key, repo])));
  for (const card of els.list.querySelectorAll('.card')) {
    card.querySelector('.repository-indicator')?.remove();
    const repo = lookup.get(card.dataset.key);
    if (!repo) continue;
    const badge = document.createElement('button'); badge.className = `repository-indicator state-${repo.status}`;
    badge.classList.toggle('needs-attention', repositoryNeedsAttention(repo));
    badge.textContent = repositoryStatusText(repo);
    badge.setAttribute('aria-label', `查看 ${repo.name} 仓库同步状态`);
    badge.title = `最后检查：${formatTimestamp(repo.checkedAt)}`;
    badge.addEventListener('click', () => { openRepositorySync('all'); repoEls.repositoryList.querySelector(`[data-repo-key="${repo.key}"]`)?.scrollIntoView({ block: 'center' }); });
    card.querySelector('.project-labels').appendChild(badge);
  }
}

function repositoryNeedsAttention(repo) {
  return Boolean(repo.dirty || repo.ahead || repo.behind || repo.inProgress || ['error', 'diverged', 'untracked', 'detached'].includes(repo.status));
}
function repositoryStatusText(repo) {
  const parts = [];
  if (!(repo.status === 'synced' && repo.dirty)) parts.push(`${repositoryLabels[repo.status] || repo.status}${repo.ahead ? ` ↑${repo.ahead}` : ''}${repo.behind ? ` ↓${repo.behind}` : ''}`);
  if (repo.dirty) parts.push(`未提交 ${repo.dirty} 项`);
  if (repo.inProgress) parts.push('Git 操作进行中');
  return `${repositoryNeedsAttention(repo) ? '⚠ ' : ''}${parts.join(' · ')}`;
}

function repositoryActionGuidance(repo) {
  const actions = [];
  if (repo.error || repo.status === 'error') actions.push('检查失败：查看下方原因，处理后重新检查');
  if (repo.inProgress) actions.push('先在项目中完成或取消正在进行的 Git 操作');
  if (repo.dirty) actions.push(`先在项目中检查并提交或暂存 ${repo.dirty} 项改动，再进行同步`);
  if (repo.status === 'detached') actions.push('先切换到需要同步的本地分支');
  else if (repo.status === 'untracked') actions.push('先为当前分支配置远端跟踪分支');
  else if (repo.status === 'diverged' || (repo.ahead && repo.behind)) actions.push(`本地 ${repo.ahead} 个、远端 ${repo.behind} 个提交：先在项目中合并或变基，解决冲突后再推送`);
  else if (repo.behind) actions.push(`远端有 ${repo.behind} 个新提交：${repo.dirty || repo.inProgress || repo.error ? '处理上述问题后再拉取' : '点击「拉取」更新本机代码'}`);
  else if (repo.ahead) actions.push(`本地有 ${repo.ahead} 个未推送提交：${repo.dirty || repo.inProgress || repo.error ? '处理上述问题后再推送' : '点击「推送」上传到远端'}`);
  return actions.join('；');
}

function repositoryCanSync(repo, kind) {
  return Boolean(repo.branch && repo.upstream && repo.remoteUrl && repo.mergeRef?.startsWith('refs/heads/') && !repo.error && !repo.dirty && !repo.inProgress && !['unchecked', 'error', 'diverged', 'detached', 'untracked'].includes(repo.status) && (kind === 'pull' ? repo.behind && !repo.ahead : repo.ahead && !repo.behind));
}
