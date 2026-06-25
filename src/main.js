const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const APP_NAME = 'Control Panel';
const CONFIG_ENV = 'CONTROL_PANEL_CONFIG';
const DEFAULT_REFRESH_MS = 5000;
const DEFAULT_SCAN_DEPTH = 4;
const DEFAULT_MANIFEST_NAME = 'control-panel.json';
const SKIP_DIRS = new Set(['node_modules', '.git', '.idea', '.vscode', 'dist', 'build', '.next', '.turbo']);

let tray = null;
let windowRef = null;
let refreshTimer = null;
let projectsCache = [];
let projectState = {};
let trayMenuBuiltAt = 0;
let refreshInFlight = null;
let lastRefreshAt = null;
let currentConfig = defaultConfig();

function defaultConfig() {
  return {
    roots: [],
    scan: {
      manifestName: DEFAULT_MANIFEST_NAME,
      maxDepth: DEFAULT_SCAN_DEPTH,
    },
    projects: [],
  };
}

function getConfigPath() {
  if (process.env[CONFIG_ENV]) {
    return path.resolve(process.env[CONFIG_ENV]);
  }

  return path.join(app.getPath('userData'), 'projects.json');
}

function getStatePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function normalizeList(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeConfig(config) {
  const base = { ...defaultConfig(), ...(config || {}) };
  const scan = base.scan && typeof base.scan === 'object' ? base.scan : {};
  return {
    roots: normalizeList(base.roots),
    scan: {
      manifestName: String(scan.manifestName || DEFAULT_MANIFEST_NAME).trim() || DEFAULT_MANIFEST_NAME,
      maxDepth: Math.max(0, Number.isFinite(Number(scan.maxDepth)) ? Number(scan.maxDepth) : DEFAULT_SCAN_DEPTH),
    },
    projects: Array.isArray(base.projects) ? base.projects : [],
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function ensureUserFiles() {
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    const examplePath = path.join(app.getAppPath(), 'config', 'projects.example.json');
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, configPath);
    } else {
      writeJson(configPath, defaultConfig());
    }
  }

  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) {
    writeJson(statePath, { projects: {} });
  }
}

function loadConfig() {
  currentConfig = normalizeConfig(readJson(getConfigPath(), defaultConfig()));
  return currentConfig;
}

function saveConfig(config) {
  currentConfig = normalizeConfig(config);
  writeJson(getConfigPath(), currentConfig);
  return currentConfig;
}

function loadState() {
  const data = readJson(getStatePath(), { projects: {} });
  projectState = data.projects && typeof data.projects === 'object' ? data.projects : {};
}

function persistState() {
  writeJson(getStatePath(), { projects: projectState });
}

function getUsageCount(projectKey) {
  return Number(projectState[projectKey]?.usageCount || 0);
}

function getLastStartedAt(projectKey) {
  return String(projectState[projectKey]?.lastStartedAt || '');
}

function normalizeCommandResult(result) {
  return {
    code: typeof result.code === 'number' ? result.code : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function execCommand(command, cwd) {
  return new Promise((resolve) => {
    if (!command) {
      resolve(normalizeCommandResult({ code: 0, stdout: '', stderr: '' }));
      return;
    }

    exec(command, { cwd, shell: '/bin/zsh', env: process.env }, (error, stdout, stderr) => {
      resolve(
        normalizeCommandResult({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
          stderr,
        })
      );
    });
  });
}

function isPidAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function launchDetached(command, cwd) {
  return new Promise((resolve, reject) => {
    if (!command) {
      reject(new Error('Missing start command'));
      return;
    }

    const child = spawn('/bin/zsh', ['-lc', command], {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });

    child.once('error', reject);
    child.unref();
    resolve(child.pid);
  });
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function resolveWorkingDirectory(manifestDir, workingDirectory) {
  const input = String(workingDirectory || '.').trim();
  if (path.isAbsolute(input)) {
    return input;
  }

  return path.resolve(manifestDir, input);
}

function resolveScriptFallback(manifestDir, scriptName) {
  const shellScript = path.join(manifestDir, 'scripts', `${scriptName}.sh`);
  const zshScript = path.join(manifestDir, 'scripts', `${scriptName}.zsh`);
  const jsScript = path.join(manifestDir, 'scripts', `${scriptName}.js`);

  if (fs.existsSync(shellScript)) {
    return `./scripts/${scriptName}.sh`;
  }

  if (fs.existsSync(zshScript)) {
    return `./scripts/${scriptName}.zsh`;
  }

  if (fs.existsSync(jsScript)) {
    return `./scripts/${scriptName}.js`;
  }

  return '';
}

function resolveHomepageUrl(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return '';
  }

  const homepage = manifest.homepageUrl || manifest.homepage || manifest.projectUrl || manifest.url || '';
  return String(homepage).trim();
}

function resolveRepositoryUrl(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return '';
  }

  const repository = manifest.repositoryUrl || manifest.repository || manifest.repoUrl || manifest.repo || '';
  if (typeof repository === 'string') {
    return normalizeGitRemoteUrl(repository);
  }

  if (repository && typeof repository === 'object') {
    return normalizeGitRemoteUrl(repository.url || '');
  }

  return '';
}

function normalizeGitRemoteUrl(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  if (!value) {
    return '';
  }

  if (value.startsWith('git@github.com:')) {
    return `https://github.com/${value.slice('git@github.com:'.length).replace(/\.git$/, '')}`;
  }

  if (value.startsWith('git@gitlab.com:')) {
    return `https://gitlab.com/${value.slice('git@gitlab.com:'.length).replace(/\.git$/, '')}`;
  }

  if (value.startsWith('git@bitbucket.org:')) {
    return `https://bitbucket.org/${value.slice('git@bitbucket.org:'.length).replace(/\.git$/, '')}`;
  }

  return value.replace(/\.git$/, '');
}

function resolveHomepageFromPackage(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return '';
  }

  const pkg = readJson(packagePath, null);
  if (!pkg || typeof pkg !== 'object') {
    return '';
  }

  const homepage = pkg.homepage || pkg.repository?.url || '';
  return normalizeGitRemoteUrl(homepage);
}

function resolveRepositoryFromPackage(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return '';
  }

  const pkg = readJson(packagePath, null);
  if (!pkg || typeof pkg !== 'object') {
    return '';
  }

  if (!pkg.repository) {
    return '';
  }

  if (typeof pkg.repository === 'string') {
    return normalizeGitRemoteUrl(pkg.repository);
  }

  return normalizeGitRemoteUrl(pkg.repository.url || '');
}

function inferTechStack(projectDir, manifest) {
  const explicit = String(manifest?.techStack || manifest?.stack || manifest?.technology || manifest?.runtime || '').trim();
  if (explicit) {
    return explicit;
  }

  const markers = [
    { file: 'package.json', label: 'Node.js' },
    { file: 'pnpm-lock.yaml', label: 'Node.js' },
    { file: 'yarn.lock', label: 'Node.js' },
    { file: 'package-lock.json', label: 'Node.js' },
    { file: 'pyproject.toml', label: 'Python' },
    { file: 'requirements.txt', label: 'Python' },
    { file: 'Pipfile', label: 'Python' },
    { file: 'go.mod', label: 'Go' },
    { file: 'Cargo.toml', label: 'Rust' },
    { file: 'composer.json', label: 'PHP' },
    { file: 'Gemfile', label: 'Ruby' },
    { file: 'pom.xml', label: 'Java' },
    { file: 'build.gradle', label: 'Java' },
    { file: 'build.gradle.kts', label: 'Java' },
    { file: 'Cargo.lock', label: 'Rust' },
    { file: 'Makefile', label: 'Native' },
  ];

  for (const marker of markers) {
    if (fs.existsSync(path.join(projectDir, marker.file))) {
      return marker.label;
    }
  }

  return '未识别';
}

async function resolveHomepageFromGit(projectDir) {
  const result = await execCommand('git remote get-url origin', projectDir);
  if (result.code !== 0) {
    return '';
  }

  return normalizeGitRemoteUrl(result.stdout.trim());
}

function parseManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function buildProjectFromManifest(manifestPath, manifest, root, source = 'auto') {
  const projectDir = path.dirname(manifestPath);
  const scripts = manifest && typeof manifest.scripts === 'object' && manifest.scripts ? manifest.scripts : {};
  const workingDirectory = resolveWorkingDirectory(projectDir, manifest.workingDirectory || '.');
  const name = String(manifest.name || path.basename(projectDir)).trim() || path.basename(projectDir);
  const id = String(manifest.id || slugify(name)).trim() || slugify(projectDir);
  const startCommand = String(
    manifest.startCommand || manifest.start || scripts.start || resolveScriptFallback(projectDir, 'start') || ''
  );
  const stopCommand = String(
    manifest.stopCommand || manifest.stop || scripts.stop || resolveScriptFallback(projectDir, 'stop') || ''
  );
  const statusCommand = String(
    manifest.statusCommand || manifest.status || scripts.status || resolveScriptFallback(projectDir, 'status') || ''
  );
  const openHomepageCommand = String(
    manifest.openHomepageCommand ||
      manifest.openHomepage ||
      scripts.openHomepage ||
      resolveScriptFallback(projectDir, 'open-homepage') ||
      ''
  );
  const homepageUrl = resolveHomepageUrl(manifest);
  const repositoryUrl = resolveRepositoryUrl(manifest);
  const techStack = inferTechStack(projectDir, manifest);

  return {
    key: `manifest:${manifestPath}`,
    id,
    name,
    workingDirectory,
    startCommand,
    stopCommand,
    statusCommand,
    openHomepageCommand,
    homepageUrl,
    repositoryUrl,
    techStack,
    notes: String(manifest.notes || ''),
    source,
    root,
    manifestPath,
    projectDir,
  };
}

function buildProjectFromLegacyEntry(entry) {
  const workingDirectory = String(entry.workingDirectory || '').trim();
  const name = String(entry.name || path.basename(workingDirectory || entry.id || 'project')).trim();
  return {
    key: `legacy:${workingDirectory}:${entry.id || slugify(name)}`,
    id: String(entry.id || slugify(name)),
    name,
    workingDirectory,
    startCommand: String(entry.startCommand || ''),
    stopCommand: String(entry.stopCommand || ''),
    statusCommand: String(entry.statusCommand || ''),
    openHomepageCommand: String(entry.openHomepageCommand || ''),
    homepageUrl: String(entry.homepageUrl || entry.homepage || entry.projectUrl || entry.url || ''),
    repositoryUrl: String(entry.repositoryUrl || entry.repository || entry.repoUrl || entry.repo || ''),
    techStack: String(entry.techStack || entry.stack || entry.technology || entry.runtime || ''),
    notes: String(entry.notes || ''),
    source: 'legacy',
    root: workingDirectory,
    manifestPath: '',
    projectDir: workingDirectory,
  };
}

function findProjectManifests(root, manifestName, maxDepth) {
  const results = [];
  const rootPath = path.resolve(root);

  if (!fs.existsSync(rootPath)) {
    return results;
  }

  function walk(currentDir, depth) {
    if (depth > maxDepth) {
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      return;
    }

    const manifestPath = path.join(currentDir, manifestName);
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
      results.push(manifestPath);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      walk(path.join(currentDir, entry.name), depth + 1);
    }
  }

  walk(rootPath, 0);
  return results;
}

function discoverProjects(config) {
  const discovered = [];
  const seenKeys = new Set();
  const roots = normalizeList(config.roots);
  const manifestName = config.scan.manifestName || DEFAULT_MANIFEST_NAME;
  const maxDepth = Number.isFinite(Number(config.scan.maxDepth)) ? Number(config.scan.maxDepth) : DEFAULT_SCAN_DEPTH;

  for (const root of roots) {
    for (const manifestPath of findProjectManifests(root, manifestName, maxDepth)) {
      const manifest = parseManifest(manifestPath);
      if (!manifest) {
        continue;
      }

      const project = buildProjectFromManifest(manifestPath, manifest, root, 'auto');
      if (seenKeys.has(project.key)) {
        continue;
      }

      seenKeys.add(project.key);
      discovered.push(project);
    }
  }

  const legacyProjects = Array.isArray(config.projects) ? config.projects : [];
  for (const entry of legacyProjects) {
    if (!entry || !entry.id || !entry.name || !entry.workingDirectory) {
      continue;
    }

    const project = buildProjectFromLegacyEntry(entry);
    if (seenKeys.has(project.key)) {
      continue;
    }

    seenKeys.add(project.key);
    discovered.push(project);
  }

  discovered.sort((a, b) => {
    const usageGap = getUsageCount(b.key) - getUsageCount(a.key);
    if (usageGap !== 0) {
      return usageGap;
    }

    const lastStartedA = getLastStartedAt(a.key);
    const lastStartedB = getLastStartedAt(b.key);
    if (lastStartedA !== lastStartedB) {
      return lastStartedB.localeCompare(lastStartedA);
    }

    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  return discovered;
}

async function getProjectStatus(project) {
  const state = projectState[project.key] || {};

  if (project.statusCommand) {
    const result = await execCommand(project.statusCommand, project.workingDirectory);
    return {
      status: result.code === 0 ? 'running' : 'stopped',
      pid: state.pid || null,
      details: result.stdout.trim() || result.stderr.trim() || '',
    };
  }

  if (state.pid && isPidAlive(state.pid)) {
    return {
      status: 'running',
      pid: state.pid,
      details: state.lastOutput || '',
    };
  }

  return {
    status: 'stopped',
    pid: state.pid || null,
    details: state.lastOutput || '',
  };
}

async function collectProjectsSnapshot() {
  const config = loadConfig();
  const discovered = discoverProjects(config);
  const snapshot = [];

  for (const project of discovered) {
    const status = await getProjectStatus(project);
    const state = projectState[project.key] || {};
    snapshot.push({
      ...project,
      usageCount: Number(state.usageCount || 0),
      lastStartedAt: String(state.lastStartedAt || ''),
      ...status,
    });
  }

  projectsCache = snapshot;
  return {
    config,
    projects: snapshot,
  };
}

function iconDataUrl() {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <g fill="#000000">
        <rect x="3" y="5" width="12" height="2.2" rx="1.1"/>
        <rect x="3" y="10" width="12" height="2.2" rx="1.1"/>
        <rect x="3" y="15" width="8" height="2.2" rx="1.1"/>
        <circle cx="17.5" cy="16.1" r="2.2"/>
      </g>
    </svg>`
  ).toString('base64');
  return `data:image/svg+xml;base64,${svg}`;
}

function buildTrayMenu(projects) {
  const statusOrder = { running: 0, starting: 1, error: 2, stopping: 3, stopped: 4 };
  const statusBadge = {
    running: '●',
    starting: '◐',
    stopping: '◑',
    error: '!',
    stopped: '○',
  };
  const orderedProjects = [...projects].sort((a, b) => {
    const statusGap = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (statusGap !== 0) {
      return statusGap;
    }

    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  const runningCount = orderedProjects.filter((project) => project.status === 'running').length;
  const projectItems = orderedProjects.map((project) => ({
    label: `${statusBadge[project.status] || '○'} ${project.name}`,
    submenu: [
      { label: `状态: ${project.status || 'stopped'}`, enabled: false },
      ...(project.notes ? [{ label: project.notes, enabled: false }] : []),
      { type: 'separator' },
      {
        label: '启动',
        enabled: !(project.status === 'running' || project.status === 'starting'),
        click: () => startProject(project.key),
      },
      {
        label: '停止',
        enabled: !(project.status === 'stopped' || project.status === 'stopping'),
        click: () => stopProject(project.key),
      },
      {
        label: '重启',
        enabled: !(project.status === 'starting' || project.status === 'stopping'),
        click: () => restartProject(project.key),
      },
      { type: 'separator' },
      {
        label: '打开主页',
        enabled: Boolean(project.homepageUrl || project.openHomepageCommand || project.projectDir),
        click: () => openProjectHomepage(project.key),
      },
      {
        label: '打开仓库',
        enabled: Boolean(project.repositoryUrl || project.projectDir),
        click: () => openProjectRepository(project.key),
      },
      {
        label: '打开目录',
        enabled: Boolean(project.projectDir || project.workingDirectory),
        click: () => shell.openPath(project.projectDir || project.workingDirectory),
      },
    ],
  }));

  return Menu.buildFromTemplate([
    { label: `${APP_NAME}  ${runningCount}/${orderedProjects.length}`, enabled: false },
    { type: 'separator' },
    {
      label: '打开面板',
      click: showWindow,
    },
    {
      label: '刷新状态',
      click: () => refreshAll().catch(() => {}),
    },
    {
      label: '只看运行中',
      enabled: runningCount > 0,
      submenu:
        runningCount > 0
          ? orderedProjects
              .filter((project) => project.status === 'running')
              .map((project) => ({
                label: project.name,
                click: () => showWindow(),
              }))
          : [{ label: '当前没有运行中的项目', enabled: false }],
    },
    ...(projectItems.length
      ? [
          { type: 'separator' },
          {
            label: `项目 (${projectItems.length})`,
            submenu: projectItems,
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: '打开配置文件',
      click: () => shell.openPath(getConfigPath()),
    },
    {
      label: '打开配置目录',
      click: () => shell.openPath(path.dirname(getConfigPath())),
    },
    {
      label: '添加项目根目录',
      click: async () => {
        const selected = await pickProjectRoots();
        if (selected.length > 0) {
          const config = loadConfig();
          saveConfig({
            ...config,
            roots: normalizeList([...config.roots, ...selected]),
          });
          await refreshAll();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
}

async function refreshAll() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const { config, projects } = await collectProjectsSnapshot();
    const payload = {
      config,
      projects,
      configPath: getConfigPath(),
      statePath: getStatePath(),
      updatedAt: new Date().toISOString(),
      trayUpdatedAt: trayMenuBuiltAt,
      openAtLogin: app.getLoginItemSettings ? app.getLoginItemSettings().openAtLogin : false,
    };

    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.send('projects-updated', payload);
    }

    if (tray) {
      tray.setContextMenu(buildTrayMenu(projects));
      tray.setToolTip(
        `${APP_NAME} - ${projects.filter((project) => project.status === 'running').length}/${projects.length} running`
      );
      trayMenuBuiltAt = Date.now();
    }

    lastRefreshAt = payload.updatedAt;
    return payload;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0b1220',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(app.getAppPath(), 'src', 'index.html'));

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('app-ready', {
      configPath: getConfigPath(),
      projectCount: projectsCache.length,
      config: currentConfig,
    });
  });

  return win;
}

function showWindow() {
  if (!windowRef) {
    windowRef = createWindow();
  }

  windowRef.show();
  windowRef.focus();
  refreshAll().catch(() => {});
}

function findProjectByKey(projectKey) {
  return projectsCache.find((item) => item.key === projectKey);
}

async function startProject(projectKey) {
  const project = findProjectByKey(projectKey);
  if (!project) {
    return;
  }

  projectState[project.key] = {
    ...(projectState[project.key] || {}),
    status: 'starting',
    lastOutput: 'Starting',
  };
  persistState();
  await refreshAll();

  try {
    const pid = await launchDetached(project.startCommand, project.workingDirectory);
    const usageCount = getUsageCount(project.key) + 1;
    const lastStartedAt = new Date().toISOString();
    projectState[project.key] = {
      pid,
      status: 'running',
      lastOutput: `Started at ${new Date().toLocaleString()}`,
      usageCount,
      lastStartedAt,
    };
    persistState();
  } catch (error) {
    projectState[project.key] = {
      ...(projectState[project.key] || {}),
      status: 'error',
      lastOutput: String(error.message || error),
    };
    persistState();
  }

  await refreshAll();
}

async function stopProject(projectKey) {
  const project = findProjectByKey(projectKey);
  if (!project) {
    return;
  }

  projectState[project.key] = {
    ...(projectState[project.key] || {}),
    status: 'stopping',
    lastOutput: 'Stopping',
  };
  persistState();
  await refreshAll();

  try {
    if (project.stopCommand) {
      const result = await execCommand(project.stopCommand, project.workingDirectory);
      projectState[project.key] = {
        ...(projectState[project.key] || {}),
        status: result.code === 0 ? 'stopped' : 'error',
        lastOutput: result.stdout.trim() || result.stderr.trim() || `Stop exited with ${result.code}`,
      };
    } else {
      const currentPid = projectState[project.key]?.pid;
      if (currentPid && isPidAlive(currentPid)) {
        try {
          process.kill(-currentPid, 'SIGTERM');
        } catch (error) {
          try {
            process.kill(currentPid, 'SIGTERM');
          } catch (killError) {
            // Ignore and continue to a forced shutdown check.
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 800));

      if (currentPid && isPidAlive(currentPid)) {
        try {
          process.kill(currentPid, 'SIGKILL');
        } catch (error) {
          // Ignore.
        }
      }

      projectState[project.key] = {
        ...(projectState[project.key] || {}),
        status: 'stopped',
        lastOutput: `Stopped at ${new Date().toLocaleString()}`,
      };
    }

    persistState();
  } catch (error) {
    projectState[project.key] = {
      ...(projectState[project.key] || {}),
      status: 'error',
      lastOutput: String(error.message || error),
    };
    persistState();
  }

  await refreshAll();
}

async function restartProject(projectKey) {
  await stopProject(projectKey);
  await startProject(projectKey);
}

async function openProjectHomepage(projectKey) {
  const project = findProjectByKey(projectKey);
  if (!project) {
    return;
  }

  if (project.homepageUrl) {
    await shell.openExternal(project.homepageUrl);
    return;
  }

  if (project.openHomepageCommand) {
    await execCommand(project.openHomepageCommand, project.workingDirectory);
    return;
  }

  const packageHomepage = resolveHomepageFromPackage(project.projectDir);
  if (packageHomepage) {
    await shell.openExternal(packageHomepage);
    return;
  }

  const gitHomepage = await resolveHomepageFromGit(project.projectDir);
  if (gitHomepage) {
    await shell.openExternal(gitHomepage);
    return;
  }

  await dialog.showMessageBox({
    type: 'info',
    buttons: ['OK'],
    title: APP_NAME,
    message: '无法确定项目主页',
    detail: '请在 control-panel.json 中配置 homepageUrl 或 openHomepageCommand，或者在 package.json / git remote 中提供可推断的主页地址。',
  });
}

async function openProjectRepository(projectKey) {
  const project = findProjectByKey(projectKey);
  if (!project) {
    return;
  }

  if (project.repositoryUrl) {
    await shell.openExternal(project.repositoryUrl);
    return;
  }

  const packageRepository = resolveRepositoryFromPackage(project.projectDir);
  if (packageRepository) {
    await shell.openExternal(packageRepository);
    return;
  }

  const gitRepository = await resolveHomepageFromGit(project.projectDir);
  if (gitRepository) {
    await shell.openExternal(gitRepository);
    return;
  }

  await dialog.showMessageBox({
    type: 'info',
    buttons: ['OK'],
    title: APP_NAME,
    message: '无法确定项目仓库',
    detail: '请在 control-panel.json 中配置 repositoryUrl，或者在 package.json / git remote 中提供可推断的仓库地址。',
  });
}

async function toggleAutoLaunch(enable) {
  if (!app.setLoginItemSettings) {
    return false;
  }

  app.setLoginItemSettings({
    openAtLogin: enable,
    path: app.getPath('exe'),
    args: ['--hidden'],
  });

  return true;
}

async function pickProjectRoots() {
  const result = await dialog.showOpenDialog({
    title: '选择项目根目录',
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  });

  if (result.canceled) {
    return [];
  }

  return normalizeList(result.filePaths);
}

function registerIpc() {
  ipcMain.handle('get-dashboard-data', async () => {
    const payload = await refreshAll();
    return payload;
  });

  ipcMain.handle('refresh-projects', async () => {
    await refreshAll();
    return true;
  });

  ipcMain.handle('start-project', async (_event, projectKey) => {
    await startProject(projectKey);
    return true;
  });

  ipcMain.handle('stop-project', async (_event, projectKey) => {
    await stopProject(projectKey);
    return true;
  });

  ipcMain.handle('restart-project', async (_event, projectKey) => {
    await restartProject(projectKey);
    return true;
  });

  ipcMain.handle('open-project-homepage', async (_event, projectKey) => {
    await openProjectHomepage(projectKey);
    return true;
  });

  ipcMain.handle('open-project-repository', async (_event, projectKey) => {
    await openProjectRepository(projectKey);
    return true;
  });

  ipcMain.handle('open-config-folder', async () => {
    await shell.openPath(path.dirname(getConfigPath()));
    return true;
  });

  ipcMain.handle('open-config-file', async () => {
    await shell.openPath(getConfigPath());
    return true;
  });

  ipcMain.handle('choose-project-roots', async () => {
    return pickProjectRoots();
  });

  ipcMain.handle('set-project-roots', async (_event, roots) => {
    const config = loadConfig();
    saveConfig({
      ...config,
      roots: normalizeList(Array.isArray(roots) ? roots : []),
    });
    await refreshAll();
    return currentConfig;
  });

  ipcMain.handle('set-open-at-login', async (_event, enable) => {
    return toggleAutoLaunch(Boolean(enable));
  });
}

app.whenReady().then(async () => {
  ensureUserFiles();
  loadConfig();
  loadState();
  registerIpc();

  windowRef = createWindow();

  const trayImage = nativeImage
    .createFromDataURL(iconDataUrl())
    .resize({ width: 18, height: 18 });
  trayImage.setTemplateImage(true);
  tray = new Tray(trayImage);
  if (process.platform === 'darwin') {
    tray.setTitle('CP');
  }
  tray.setToolTip(APP_NAME);
  tray.on('click', () => {
    if (windowRef && windowRef.isVisible()) {
      windowRef.hide();
    } else {
      showWindow();
    }
  });

  await refreshAll();
  if (windowRef && !windowRef.isVisible()) {
    windowRef.show();
    windowRef.focus();
  }
  refreshTimer = setInterval(() => {
    refreshAll().catch(() => {});
  }, DEFAULT_REFRESH_MS);
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
