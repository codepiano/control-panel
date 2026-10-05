const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const APP_ROOT = path.resolve(__dirname, '..');
const USER_DATA = process.env.CONTROL_PANEL_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'control-panel');
const BACKEND_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();
const actions = new Map();
const registerAction = (name, handler) => actions.set(name, handler);

function openSystemTarget(target) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    execFile(command, [target], (error) => error ? reject(error) : resolve(''));
  });
}
const { exec, execFile, spawn } = require('child_process');

const CONFIG_ENV = 'CONTROL_PANEL_CONFIG';
const STATUS_COMMAND_TIMEOUT_MS = 8000;
const DEFAULT_SCAN_DEPTH = 1;
let scanReport = {};
const DEFAULT_MANIFEST_NAME = 'control-panel.json';
const PROJECT_ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_PROJECT_ICON_BYTES = 5 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.idea', '.vscode', 'dist', 'build', '.next', '.turbo', 'vendor', 'target', 'coverage', 'venv', '__pycache__']);
const LOGIN_ITEM_SCRIPTS = {
  install: path.join(APP_ROOT, 'scripts', 'install-login-item.sh'),
  uninstall: path.join(APP_ROOT, 'scripts', 'uninstall-login-item.sh'),
  status: path.join(APP_ROOT, 'scripts', 'login-item-status.sh'),
};
let projectsCache = [];
let projectState = {};
let refreshInFlight = null;
let currentConfig = defaultConfig();
const startingProjects = new Set();
const stoppingProjects = new Set();
let batchStartInFlight = false;

function defaultConfig() {
  return {
    roots: [],
    scan: {
      manifestName: DEFAULT_MANIFEST_NAME,
      maxDepth: DEFAULT_SCAN_DEPTH,
    },
    projects: [],
    projectPreferences: {},
  };
}

function getConfigPath() {
  if (process.env[CONFIG_ENV]) {
    return path.resolve(process.env[CONFIG_ENV]);
  }

  return path.join(USER_DATA, 'projects.json');
}

function getStatePath() {
  return path.join(USER_DATA, 'state.json');
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeConfig(config) {
  const base = { ...defaultConfig(), ...(config || {}) };
  const scan = base.scan && typeof base.scan === 'object' ? base.scan : {};
  const rawPreferences = base.projectPreferences && typeof base.projectPreferences === 'object'
    ? base.projectPreferences
    : {};
  const projectPreferences = {};
  for (const [projectKey, preference] of Object.entries(rawPreferences)) {
    if (
      (projectKey.startsWith('manifest:') || projectKey.startsWith('legacy:')) &&
      preference &&
      typeof preference === 'object'
    ) {
      const normalizedPreference = {};
      if (preference.startOnPanelLaunch === true) {
        normalizedPreference.startOnPanelLaunch = true;
      }
      const iconOverride = path.basename(String(preference.iconOverride || ''));
      if (/^[a-f0-9]{64}\.png$/.test(iconOverride)) {
        normalizedPreference.iconOverride = iconOverride;
      }
      if (preference.favorite === true) normalizedPreference.favorite = true;
      const group = typeof preference.group === 'string' ? preference.group.trim().slice(0, 40) : '';
      if (group) normalizedPreference.group = group;
      const tags = normalizeList(Array.isArray(preference.tags) ? preference.tags.filter((tag) => typeof tag === 'string') : [])
        .map((tag) => tag.slice(0, 30)).slice(0, 20);
      if (tags.length) normalizedPreference.tags = normalizeList(tags);
      if (Object.keys(normalizedPreference).length > 0) {
        projectPreferences[projectKey] = normalizedPreference;
      }
    }
  }
  return {
    roots: normalizeList(base.roots),
    scan: {
      manifestName: String(scan.manifestName || DEFAULT_MANIFEST_NAME).trim() || DEFAULT_MANIFEST_NAME,
      maxDepth: Math.min(1, Math.max(0, Number.isFinite(Number(scan.maxDepth)) ? Math.floor(Number(scan.maxDepth)) : DEFAULT_SCAN_DEPTH)),
    },
    projects: Array.isArray(base.projects) ? base.projects : [],
    projectPreferences,
  };
}

function isPanelProject(project) {
  return path.resolve(project.projectDir || project.workingDirectory) === path.resolve(APP_ROOT);
}

function startsWithPanel(config, projectKey) {
  return config.projectPreferences?.[projectKey]?.startOnPanelLaunch === true;
}

function getProjectIconsDir() {
  return path.join(USER_DATA, 'project-icons');
}

function projectIconFilename(projectKey) {
  return `${crypto.createHash('sha256').update(projectKey).digest('hex')}.png`;
}

function safeProjectIconPath(projectDir, iconValue) {
  const value = String(iconValue || '').trim();
  if (!value || path.isAbsolute(value) || !PROJECT_ICON_EXTENSIONS.has(path.extname(value).toLowerCase())) {
    return '';
  }
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, value);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    return '';
  }
  try {
    const canonicalRoot = fs.realpathSync(root);
    const canonicalIcon = fs.realpathSync(resolved);
    if (!canonicalIcon.startsWith(`${canonicalRoot}${path.sep}`)) {
      return '';
    }
    const stat = fs.statSync(canonicalIcon);
    return stat.isFile() && stat.size <= MAX_PROJECT_ICON_BYTES ? canonicalIcon : '';
  } catch (error) {
    return '';
  }
}

function iconDataUrlFromPath(iconPath) {
  if (!iconPath) return '';
  try {
    if (fs.statSync(iconPath).size > MAX_PROJECT_ICON_BYTES) return '';
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(iconPath).toLowerCase()];
    return mime ? `data:${mime};base64,${fs.readFileSync(iconPath).toString('base64')}` : '';
  } catch { return ''; }
}

function resolveProjectIcon(project, config) {
  const overrideName = config.projectPreferences?.[project.key]?.iconOverride || '';
  const overridePath = overrideName ? path.join(getProjectIconsDir(), path.basename(overrideName)) : '';
  const overrideDataUrl = iconDataUrlFromPath(overridePath);
  if (overrideDataUrl) {
    return { iconDataUrl: overrideDataUrl, iconSource: 'user' };
  }
  const manifestIconPath = safeProjectIconPath(project.projectDir, project.icon);
  const manifestDataUrl = iconDataUrlFromPath(manifestIconPath);
  if (manifestDataUrl) {
    return { iconDataUrl: manifestDataUrl, iconSource: 'project' };
  }
  return { iconDataUrl: '', iconSource: 'fallback' };
}

function cleanText(value, maxLength, fieldName, { required = false } = {}) {
  const text = String(value || '').trim();
  if (text.includes('\0') || /[\r\n]/.test(text)) {
    throw new Error(`${fieldName}不能包含换行或空字符`);
  }
  if (required && !text) {
    throw new Error(`${fieldName}不能为空`);
  }
  if (text.length > maxLength) {
    throw new Error(`${fieldName}不能超过 ${maxLength} 个字符`);
  }
  return text;
}

function validateFrontendUrl(value, portValue) {
  const text = cleanText(value, 500, '访问地址');
  const portText = String(portValue || '').trim();
  if (!text && !portText) {
    return '';
  }
  if (!text) {
    throw new Error('填写端口时也需要填写访问地址');
  }

  let url;
  try {
    url = new URL(text);
  } catch (error) {
    throw new Error('访问地址必须是完整的 http 或 https URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('访问地址必须使用 http 或 https，并包含主机名');
  }
  if (portText && (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535)) {
    throw new Error('端口必须介于 1 和 65535 之间');
  }
  if (portText) {
    url.port = portText;
  }
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new Error('端口必须介于 1 和 65535 之间');
  }
  return url.toString().replace(/\/$/, '');
}

function validateProjectPresentation(input) {
  return {
    name: cleanText(input.name, 80, '项目名称', { required: true }),
    frontendUrl: validateFrontendUrl(input.frontendUrl, input.frontendPort),
    notes: cleanText(input.notes, 500, '备注'),
  };
}

function writeProjectManifest(manifestPath, manifest) {
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.renameSync(tempPath, manifestPath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tempPath, filePath);
}

function ensureUserFiles() {
  const userDataDir = USER_DATA;
  fs.mkdirSync(userDataDir, { recursive: true });

  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (!fs.existsSync(configPath)) {
    const examplePath = path.join(APP_ROOT, 'config', 'projects.example.json');
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

    exec(
      command,
      { cwd, shell: '/bin/zsh', env: process.env, timeout: STATUS_COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        resolve(
          normalizeCommandResult({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout,
            stderr: error?.killed
              ? `${stderr || ''}\n命令超时（${STATUS_COMMAND_TIMEOUT_MS / 1000} 秒）`.trim()
              : stderr,
          })
        );
      }
    );
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

function launchDetached(command, cwd, projectKey = '') {
  return new Promise((resolve, reject) => {
    if (!command) { reject(new Error('Missing start command')); return; }
    const logsDir = path.join(USER_DATA, 'service-logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, `${crypto.createHash('sha256').update(projectKey || cwd).digest('hex')}.log`);
    const descriptor = fs.openSync(logPath, 'a');
    let timer;
    let closed = false;
    const closeDescriptor = () => { if (!closed) { fs.closeSync(descriptor); closed = true; } };
    const child = spawn('/bin/zsh', ['-lc', command], { cwd, detached: true, stdio: ['ignore', descriptor, descriptor], env: process.env });
    child.once('error', (error) => { closeDescriptor(); clearTimeout(timer); reject(error); });
    child.once('spawn', () => {
      closeDescriptor();
      child.unref();
      // A short-lived lifecycle wrapper can report failure; long-running commands remain detached.
      timer = setTimeout(() => resolve(child.pid), 1500);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) { resolve(child.pid); return; }
      let detail = '';
      try {
        const fd = fs.openSync(logPath, 'r');
        try {
          const size = fs.fstatSync(fd).size;
          const buffer = Buffer.alloc(Math.min(size, 2000));
          fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
          detail = buffer.toString('utf8').trim();
        } finally { fs.closeSync(fd); }
      } catch { /* Exit status still explains the failure. */ }
      reject(new Error(`启动命令退出：${code ?? signal}${detail ? ` · ${detail}` : ''}`));
    });
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

function resolveFrontendUrl(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return '';
  }

  const frontendUrl =
    manifest.frontendUrl ||
    manifest.appUrl ||
    manifest.localUrl ||
    manifest.siteUrl ||
    manifest.devUrl ||
    '';
  return String(frontendUrl).trim();
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

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return '';
  }
}

function resolvePortFromText(filePath, patterns) {
  const content = readTextFile(filePath);
  if (!content) {
    return 0;
  }

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const port = Number(match[1]);
      if (Number.isFinite(port) && port > 0) {
        return port;
      }
    }
  }

  return 0;
}

function inferFrontendPort(projectDir) {
  const portFiles = [
    {
      files: [
        'vite.config.ts',
        'vite.config.js',
        'vite.config.mjs',
        'vite.config.cjs',
        'web/vite.config.ts',
        'web/vite.config.js',
        'web/vite.config.mjs',
        'web/vite.config.cjs',
        'apps/web/vite.config.ts',
        'apps/web/vite.config.js',
        'apps/web/vite.config.mjs',
        'apps/web/vite.config.cjs',
      ],
      patterns: [/port\s*:\s*(\d{2,5})/],
      fallback: 5173,
    },
    {
      files: ['apps/desktop/src-tauri/tauri.conf.json', 'src-tauri/tauri.conf.json'],
      patterns: [/\"devUrl\"\s*:\s*\"http:\/\/[^:]+:(\d{2,5})\"/],
      fallback: 0,
    },
    {
      files: ['scripts/dev-control.sh'],
      patterns: [/WEB_PORT="\$\{[^:]+:-([0-9]{2,5})\}"/, /WEB_PORT='?\$\{[^:]+:-([0-9]{2,5})\}'?/],
      fallback: 0,
    },
    {
      files: ['next.config.js', 'next.config.mjs', 'next.config.ts', 'web/next.config.js', 'apps/web/next.config.js'],
      patterns: [/port\s*:\s*(\d{2,5})/],
      fallback: 3000,
    },
  ];

  for (const entry of portFiles) {
    for (const relativePath of entry.files) {
      const fullPath = path.join(projectDir, relativePath);
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const resolvedPort = resolvePortFromText(fullPath, entry.patterns);
      if (resolvedPort) {
        return resolvedPort;
      }

      if (entry.fallback) {
        return entry.fallback;
      }
    }
  }

  return 0;
}

function inferFrontendUrl(projectDir) {
  const port = inferFrontendPort(projectDir);
  if (!port) {
    return '';
  }

  return `http://127.0.0.1:${port}`;
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
  const openEntryCommand = String(
    manifest.openEntryCommand ||
      manifest.openHomepageCommand ||
      manifest.openHomepage ||
      scripts.openEntry ||
      scripts.openHomepage ||
      resolveScriptFallback(projectDir, 'open-homepage') ||
      ''
  );
  const homepageUrl = resolveHomepageUrl(manifest);
  const frontendUrl = resolveFrontendUrl(manifest);
  const appLaunchCommand = String(manifest.appLaunchCommand || '');
  const repositoryUrl = resolveRepositoryUrl(manifest);
  const techStack = inferTechStack(projectDir, manifest);

  return {
    key: `manifest:${manifestPath}`,
    id,
    name,
    icon: String(manifest.icon || ''),
    surfaceType: String(manifest.surfaceType || ''),
    workingDirectory,
    startCommand,
    stopCommand,
    statusCommand,
    openEntryCommand,
    openHomepageCommand: openEntryCommand,
    homepageUrl,
    frontendUrl,
    appLaunchCommand,
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
    icon: String(entry.icon || ''),
    surfaceType: String(entry.surfaceType || ''),
    workingDirectory,
    startCommand: String(entry.startCommand || ''),
    stopCommand: String(entry.stopCommand || ''),
    statusCommand: String(entry.statusCommand || ''),
    openHomepageCommand: String(entry.openHomepageCommand || ''),
    homepageUrl: String(entry.homepageUrl || entry.homepage || entry.projectUrl || entry.url || ''),
    frontendUrl: String(entry.frontendUrl || entry.appUrl || entry.localUrl || entry.siteUrl || entry.devUrl || ''),
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

  const candidateDirs = [rootPath];
  if (maxDepth > 0) {
    let entries = [];
    try {
      entries = fs.readdirSync(rootPath, { withFileTypes: true });
    } catch (error) {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      candidateDirs.push(path.join(rootPath, entry.name));
    }
  }

  for (const currentDir of candidateDirs) {
    const manifestPath = path.join(currentDir, manifestName);
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
      results.push(manifestPath);
    }
  }

  return results;
}

function discoverProjects(config) {
  const discovered = [];
  const seenKeys = new Set();
  const seenLocations = new Set();

  const issues = [];
  const collections = [];
  const active = new Set();
  const visit = (manifestPath, root, ancestors = [], relationship = null, boundary = null) => {
    let canonical;
    try { canonical = fs.realpathSync(manifestPath); }
    catch (error) { issues.push({ path: manifestPath, detail: `子项目配置不可读取：${error.code}` }); return; }
    if (boundary && !canonical.startsWith(`${boundary}${path.sep}`)) { issues.push({ path: manifestPath, detail: '子项目配置文件通过符号链接越界' }); return; }
    if (active.has(canonical)) { issues.push({ path: manifestPath, detail: '子项目声明形成循环' }); return; }
    const key = `manifest:${manifestPath}`;
    if (seenKeys.has(key) || seenLocations.has(canonical)) return;
    if (seenKeys.size >= 1000 || ancestors.length >= 32) { issues.push({ path: manifestPath, detail: '子项目数量或层级超过限制' }); return; }
    const manifest = parseManifest(manifestPath);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) { issues.push({ path: manifestPath, detail: '配置不是有效 JSON 对象' }); return; }
    if (manifest.kind && !['project', 'collection'].includes(manifest.kind)) { issues.push({ path: manifestPath, detail: '不支持的 kind' }); return; }
    if (manifest.kind === 'collection' && ['start', 'stop', 'status', 'restart', 'init', 'install', 'uninstall', 'openEntry', 'openHomepage'].some((name) => manifest[name] || manifest[`${name}Command`] || manifest.scripts?.[name])) {
      issues.push({ path: manifestPath, detail: '集合不能声明生命周期命令，请将可控服务设为 project' }); return;
    }
    seenKeys.add(key);
    seenLocations.add(canonical);
    active.add(canonical);
    const name = String(manifest.name || path.basename(path.dirname(manifestPath)));
    if (manifest.kind === 'collection' && (typeof manifest.name !== 'string' || !manifest.name.trim())) {
      issues.push({ path: manifestPath, detail: '集合必须声明 name' }); active.delete(canonical); return;
    }
    if (manifest.kind === 'collection') {
      collections.push({ key, name, manifestPath, notes: String(manifest.notes || ''), ancestors });
    } else {
      const project = buildProjectFromManifest(manifestPath, manifest, root, 'auto');
      discovered.push({ ...project, ancestors, relationship });
    }
    if (manifest.children !== undefined && !Array.isArray(manifest.children)) {
      issues.push({ path: manifestPath, detail: 'children 必须是数组' });
    }
    const parentDir = path.dirname(manifestPath);
    const canonicalParent = path.dirname(canonical);
    for (const child of Array.isArray(manifest.children) ? manifest.children : []) {
      if (!child || typeof child !== 'object' || typeof child.path !== 'string' || !child.path.trim() || path.isAbsolute(child.path)) {
        issues.push({ path: manifestPath, detail: '子项目必须声明相对目录 path' }); continue;
      }
      const childDir = path.resolve(parentDir, child.path);
      let canonicalChild;
      try { canonicalChild = fs.realpathSync(childDir); }
      catch { issues.push({ path: childDir, detail: '声明的子项目目录不存在' }); continue; }
      if (!childDir.startsWith(`${parentDir}${path.sep}`) || !canonicalChild.startsWith(`${canonicalParent}${path.sep}`)) {
        issues.push({ path: childDir, detail: '子项目必须位于父项目目录内，不能通过路径或符号链接越界' }); continue;
      }
      visit(path.join(childDir, config.scan.manifestName), root, [...ancestors, { key, name }], { role: String(child.role || ''), notes: String(child.notes || '') }, canonicalParent);
    }
    active.delete(canonical);
  };
  const seeds = normalizeList(config.roots).flatMap((root) => findProjectManifests(root, config.scan.manifestName, config.scan.maxDepth).map((manifestPath) => ({ manifestPath, root })));
  seeds.sort((a, b) => a.manifestPath.length - b.manifestPath.length);
  for (const { manifestPath, root } of seeds) visit(manifestPath, root);
  scanReport = { issues, collections };

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
  if (isPanelProject(project)) return { status: 'running', pid: process.pid, details: '本机 Web 后端运行中' };
  if (startingProjects.has(project.key) || stoppingProjects.has(project.key)) return { status: state.status, pid: state.pid || null, details: state.lastOutput || '' };

  if (project.statusCommand) {
    const result = await execCommand(project.statusCommand, project.workingDirectory);
    return {
      status: result.code === 0 ? 'running' : state.status === 'error' ? 'error' : 'stopped',
      pid: state.pid || null,
      details: result.stdout.trim() || result.stderr.trim() || (state.status === 'error' ? state.lastOutput || '' : ''),
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
    status: state.status === 'error' ? 'error' : 'stopped',
    pid: state.pid || null,
    details: state.lastOutput || '',
  };
}

async function collectProjectsSnapshot() {
  const config = loadConfig();
  const discovered = discoverProjects(config);
  const snapshot = await Promise.all(
    discovered.map(async (project) => {
      const status = await getProjectStatus(project);
      const state = projectState[project.key] || {};
      const icon = resolveProjectIcon(project, config);
      return {
        ...project,
        ...icon,
        group: config.projectPreferences[project.key]?.group || (project.ancestors || []).map((item) => item.name).join(' / '),
        localGroup: config.projectPreferences[project.key]?.group || '',
        tags: config.projectPreferences[project.key]?.tags || [],
        favorite: config.projectPreferences[project.key]?.favorite === true,
        canBatchStart: Boolean(project.startCommand) && !isPanelProject(project),
        startOnPanelLaunch: startsWithPanel(config, project.key),
        canStartOnPanelLaunch: Boolean(project.startCommand) && !isPanelProject(project),
        usageCount: Number(state.usageCount || 0),
        lastStartedAt: isPanelProject(project) ? BACKEND_STARTED_AT : String(state.lastStartedAt || ''),
        isPanel: isPanelProject(project),
        ...status,
      };
    })
  );

  projectsCache = snapshot;
  return {
    config,
    projects: snapshot,
  };
}

async function refreshAll() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const { config, projects } = await collectProjectsSnapshot();
    const loginItem = await getLoginItemStatus();
    const payload = {
      config,
      projects,
      scanReport,
      backendStartedAt: BACKEND_STARTED_AT,
      backendPid: process.pid,
      configPath: getConfigPath(),
      statePath: getStatePath(),
      updatedAt: new Date().toISOString(),
      openAtLogin: loginItem.enabled,
      loginItemStatus: loginItem,
    };

    return payload;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function findProjectByKey(projectKey) {
  return projectsCache.find((item) => item.key === projectKey);
}

async function startProject(projectKey) {
  if (startingProjects.has(projectKey) || stoppingProjects.has(projectKey)) return { outcome: 'skipped', detail: '正在切换状态' };
  startingProjects.add(projectKey);
  try {
    return await performProjectStart(projectKey);
  } finally {
    startingProjects.delete(projectKey);
  }
}

async function performProjectStart(projectKey) {
  const project = findProjectByKey(projectKey);
  if (!project) throw new Error('项目不存在，请刷新后重试');
  if (isPanelProject(project)) throw new Error('后端自身请通过 scripts/start.sh 管理');

  projectState[project.key] = {
    ...(projectState[project.key] || {}),
    status: 'starting',
    lastOutput: 'Starting',
  };
  persistState();
  await refreshAll();

  try {
    const pid = await launchDetached(project.startCommand, project.workingDirectory, project.key);
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

  const failure = projectState[project.key]?.status === 'error' ? projectState[project.key].lastOutput : '';
  await refreshAll();
  return failure ? { outcome: 'failed', detail: failure } : { outcome: 'started', detail: '已执行启动，请查看运行状态' };
}

async function stopProject(projectKey) {
  if (startingProjects.has(projectKey) || stoppingProjects.has(projectKey)) throw new Error('服务正在切换状态，请稍后重试');
  stoppingProjects.add(projectKey);
  try { return await performProjectStop(projectKey); }
  finally { stoppingProjects.delete(projectKey); }
}

async function performProjectStop(projectKey) {
  const project = findProjectByKey(projectKey);
  if (project && isPanelProject(project)) throw new Error('后端自身请通过 scripts/stop.sh 管理');
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

  if (project.openEntryCommand || project.openHomepageCommand) {
    await execCommand(project.openEntryCommand || project.openHomepageCommand, project.workingDirectory);
    return;
  }

  if (project.frontendUrl) {
    await openSystemTarget(project.frontendUrl);
    return;
  }

  const inferredFrontendUrl = inferFrontendUrl(project.projectDir);
  if (inferredFrontendUrl) {
    await openSystemTarget(inferredFrontendUrl);
    return;
  }

  if (project.appLaunchCommand) {
    await execCommand(project.appLaunchCommand, project.workingDirectory);
    return;
  }

  if (project.homepageUrl) {
    await openSystemTarget(project.homepageUrl);
    return;
  }

  const packageHomepage = resolveHomepageFromPackage(project.projectDir);
  if (packageHomepage) {
    await openSystemTarget(packageHomepage);
    return;
  }

  const gitHomepage = await resolveHomepageFromGit(project.projectDir);
  if (gitHomepage) {
    await openSystemTarget(gitHomepage);
    return;
  }

  throw new Error('无法确定项目入口，请配置 frontendUrl、appUrl 或 openEntryCommand。');
}

async function openProjectRepository(projectKey) {
  const project = findProjectByKey(projectKey);
  if (!project) {
    return;
  }

  if (project.repositoryUrl) {
    await openSystemTarget(project.repositoryUrl);
    return;
  }

  const packageRepository = resolveRepositoryFromPackage(project.projectDir);
  if (packageRepository) {
    await openSystemTarget(packageRepository);
    return;
  }

  const gitRepository = await resolveHomepageFromGit(project.projectDir);
  if (gitRepository) {
    await openSystemTarget(gitRepository);
    return;
  }

  throw new Error('无法确定项目仓库，请配置 repositoryUrl 或 git remote。');
}

function runLoginItemScript(scriptPath) {
  return new Promise((resolve) => {
    execFile(
      '/bin/bash',
      [scriptPath],
      {
        cwd: APP_ROOT,
        env: process.env,
        timeout: STATUS_COMMAND_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        resolve(normalizeCommandResult({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
          stderr: error?.killed
            ? `${stderr || ''}\n命令超时（${STATUS_COMMAND_TIMEOUT_MS / 1000} 秒）`.trim()
            : stderr,
        }));
      }
    );
  });
}

async function getLoginItemStatus() {
  const result = await runLoginItemScript(LOGIN_ITEM_SCRIPTS.status);
  const detail = result.stdout.trim() || result.stderr.trim();
  if (result.code === 0) {
    return { enabled: true, status: 'enabled', detail };
  }
  if (result.code === 1 && detail === 'disabled') {
    return { enabled: false, status: 'disabled', detail };
  }
  if (result.code === 2 && detail === 'stale') {
    return { enabled: false, status: 'stale', detail: '登录项指向了旧的项目路径，请重新启用。' };
  }
  if (result.code === 3 && detail === 'not-loaded') {
    return { enabled: false, status: 'error', detail: '登录项文件已存在，但 launchd 没有加载它，请重新启用。' };
  }
  return { enabled: false, status: 'error', detail: detail || '无法读取登录项状态。' };
}

async function toggleAutoLaunch(enable) {
  const scriptPath = enable ? LOGIN_ITEM_SCRIPTS.install : LOGIN_ITEM_SCRIPTS.uninstall;
  const result = await runLoginItemScript(scriptPath);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || '更新登录项失败。');
  }

  const status = await getLoginItemStatus();
  if (status.enabled !== enable) {
    throw new Error(status.detail || '登录项状态与设置不一致。');
  }
  return status;
}

async function setProjectStartOnPanelLaunch(projectKey, enable) {
  const project = findProjectByKey(projectKey);
  if (!project) {
    throw new Error('项目不存在，请刷新后重试。');
  }
  if (enable && (!project.startCommand || isPanelProject(project))) {
    throw new Error(isPanelProject(project) ? '控制面板不能将自己设为随面板启动。' : '该项目没有可用的启动命令。');
  }

  const config = loadConfig();
  const projectPreferences = { ...config.projectPreferences };
  if (enable) {
    projectPreferences[project.key] = {
      ...(projectPreferences[project.key] || {}),
      startOnPanelLaunch: true,
    };
  } else {
    const nextPreference = { ...(projectPreferences[project.key] || {}) };
    delete nextPreference.startOnPanelLaunch;
    if (Object.keys(nextPreference).length > 0) {
      projectPreferences[project.key] = nextPreference;
    } else {
      delete projectPreferences[project.key];
    }
  }
  saveConfig({ ...config, projectPreferences });
  await refreshAll();
  return true;
}

async function chooseProjectIcon(projectKey, dataUrl) {
  const project = findProjectByKey(projectKey);
  if (!project) throw new Error('项目不存在，请刷新后重试。');
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('请上传 PNG 图标');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length > MAX_PROJECT_ICON_BYTES || buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new Error('图标必须是有效 PNG，且不超过 5 MB');
  }
  const iconFilename = projectIconFilename(project.key);
  fs.mkdirSync(getProjectIconsDir(), { recursive: true });
  const targetPath = path.join(getProjectIconsDir(), iconFilename);
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, targetPath);
  const config = loadConfig();
  saveConfig({ ...config, projectPreferences: { ...config.projectPreferences, [project.key]: { ...(config.projectPreferences[project.key] || {}), iconOverride: iconFilename } } });
  await refreshAll();
  return true;
}

async function resetProjectIcon(projectKey) {
  const project = findProjectByKey(projectKey);
  if (!project) {
    throw new Error('项目不存在，请刷新后重试。');
  }
  const config = loadConfig();
  const projectPreferences = { ...config.projectPreferences };
  const nextPreference = { ...(projectPreferences[project.key] || {}) };
  const iconOverride = nextPreference.iconOverride;
  delete nextPreference.iconOverride;
  if (Object.keys(nextPreference).length > 0) {
    projectPreferences[project.key] = nextPreference;
  } else {
    delete projectPreferences[project.key];
  }
  saveConfig({ ...config, projectPreferences });
  if (iconOverride) {
    try {
      fs.unlinkSync(path.join(getProjectIconsDir(), path.basename(iconOverride)));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  await refreshAll();
  return true;
}

function validateOrganization(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('标记配置无效');
  const result = {};
  if (Object.hasOwn(input, 'group')) {
    if (typeof input.group !== 'string' || input.group.trim().length > 40) throw new Error('分组名称不能超过 40 个字符');
    result.group = input.group.trim();
  }
  if (Object.hasOwn(input, 'tags')) {
    if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string' || tag.trim().length > 30)) {
      throw new Error('每个标签不能超过 30 个字符');
    }
    result.tags = normalizeList(input.tags);
    if (result.tags.length > 20) throw new Error('最多添加 20 个标签');
  }
  if (Object.hasOwn(input, 'favorite')) {
    if (typeof input.favorite !== 'boolean') throw new Error('星标设置无效');
    result.favorite = input.favorite;
  }
  return result;
}

function validateProjectKeys(keys) {
  if (!Array.isArray(keys) || !keys.length || keys.some((key) => typeof key !== 'string')) {
    throw new Error('请选择服务');
  }
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.some((key) => !findProjectByKey(key))) throw new Error('部分服务已不存在，请刷新后重试');
  return uniqueKeys;
}

async function saveProjectOrganization(keys, input) {
  const projectKeys = validateProjectKeys(keys);
  const organization = validateOrganization(input);
  const config = loadConfig();
  const projectPreferences = { ...config.projectPreferences };
  for (const key of projectKeys) {
    projectPreferences[key] = { ...(projectPreferences[key] || {}), ...organization };
  }
  saveConfig({ ...config, projectPreferences });
  await refreshAll();
  return true;
}

async function startProjects(keys) {
  const projectKeys = validateProjectKeys(keys);
  if (batchStartInFlight) throw new Error('已有一批服务正在启动，请等待完成');
  batchStartInFlight = true;
  const results = [];
  try {
    for (const key of projectKeys) {
      const project = findProjectByKey(key);
      const result = { key, name: project?.name || key };
      try {
        if (!project) throw new Error('服务已不存在');
        if (!project.startCommand || isPanelProject(project)) {
          results.push({ ...result, outcome: 'skipped', detail: '不支持批量启动' });
          continue;
        }
        if (startingProjects.has(key) || stoppingProjects.has(key)) {
          results.push({ ...result, outcome: 'skipped', detail: '服务正在切换状态' });
          continue;
        }
        const status = await getProjectStatus(project);
        if (status.status === 'running') {
          results.push({ ...result, outcome: 'skipped', detail: '已经运行' });
          continue;
        }
        results.push({ ...result, ...await startProject(key) });
      } catch (error) {
        results.push({ ...result, outcome: 'failed', detail: String(error.message || error) });
      }
    }
    return results;
  } finally {
    batchStartInFlight = false;
  }
}

async function startConfiguredProjects() {
  const configuredProjects = projectsCache.filter((project) => (
    project.startOnPanelLaunch && project.canStartOnPanelLaunch && project.status !== 'running'
  ));

  for (const project of configuredProjects) {
    await startProject(project.key);
  }
}

function registerActions() {
  registerAction('get-dashboard-data', async () => {
    const payload = await refreshAll();
    return payload;
  });

  registerAction('refresh-projects', async () => {
    await refreshAll();
    return true;
  });

  registerAction('save-project-organization', (keys, input) => saveProjectOrganization(keys, input));
  registerAction('start-projects', (keys) => startProjects(keys));

  registerAction('start-project', async (projectKey) => {
    await startProject(projectKey);
    return true;
  });

  registerAction('stop-project', async (projectKey) => {
    await stopProject(projectKey);
    return true;
  });

  registerAction('restart-project', async (projectKey) => {
    await restartProject(projectKey);
    return true;
  });

  registerAction('open-project-homepage', async (projectKey) => {
    await openProjectHomepage(projectKey);
    return true;
  });

  registerAction('open-project-repository', async (projectKey) => {
    await openProjectRepository(projectKey);
    return true;
  });

  registerAction('open-config-folder', async () => {
    await openSystemTarget(path.dirname(getConfigPath()));
    return true;
  });

  registerAction('open-config-file', async () => {
    await openSystemTarget(getConfigPath());
    return true;
  });

  registerAction('open-project-folder', async (folderPath) => {
    const inputPath = String(folderPath || '').trim();
    if (!inputPath) {
      throw new Error('项目目录未配置。');
    }
    const resolvedPath = path.resolve(inputPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('项目目录不存在。');
    }
    await openSystemTarget(resolvedPath);
    return true;
  });

  registerAction('set-scan-depth', async (depth) => {
    if (!Number.isInteger(depth) || depth < 0 || depth > 1) throw new Error('入口扫描范围应为 0 或 1');
    const config = loadConfig();
    saveConfig({ ...config, scan: { ...config.scan, maxDepth: depth } });
    await refreshAll();
    return true;
  });

  registerAction('set-project-roots', async (roots) => {
    const config = loadConfig();
    saveConfig({
      ...config,
      roots: normalizeList(Array.isArray(roots) ? roots : []),
    });
    await refreshAll();
    return currentConfig;
  });

  registerAction('save-project-presentation', async (projectKey, input) => {
    const project = findProjectByKey(String(projectKey || ''));
    if (!project || !project.manifestPath) {
      throw new Error('项目不存在，请刷新后重试');
    }

    const manifest = parseManifest(project.manifestPath);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('项目配置文件无法读取，请修复 JSON 后重试');
    }

    const presentation = validateProjectPresentation(input || {});
    const nextManifest = { ...manifest, ...presentation };
    if (!presentation.frontendUrl) {
      delete nextManifest.frontendUrl;
    }
    writeProjectManifest(project.manifestPath, nextManifest);
    await refreshAll();
    return true;
  });

  registerAction('set-open-at-login', async (enable) => {
    return toggleAutoLaunch(Boolean(enable));
  });

  registerAction('set-project-start-on-panel-launch', async (projectKey, enable) => {
    return setProjectStartOnPanelLaunch(String(projectKey || ''), Boolean(enable));
  });

  registerAction('choose-project-icon', async (projectKey, dataUrl) => {
    return chooseProjectIcon(String(projectKey || ''), dataUrl);
  });

  registerAction('reset-project-icon', async (projectKey) => {
    return resetProjectIcon(String(projectKey || ''));
  });
}

async function initialize({ autoStart = true } = {}) {
  ensureUserFiles();
  loadConfig();
  loadState();
  registerActions();
  await refreshAll();
  if (autoStart) await startConfiguredProjects();
}

module.exports = {
  initialize,
  invoke: async (action, args = []) => {
    const handler = actions.get(action);
    if (!handler) throw new Error('未知操作');
    return handler(...args);
  },
  normalizeConfig, validateOrganization, discoverProjects, getConfigPath,
};
