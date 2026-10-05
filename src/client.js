let sessionToken = '';
async function invoke(action, ...args) {
  if (!sessionToken) sessionToken = (await (await fetch('/api/session')).json()).token;
  const response = await fetch(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Control-Panel-Token': sessionToken },
    body: JSON.stringify({ args }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 403) sessionToken = '';
    throw new Error(result.error || '请求失败');
  }
  return result.data;
}
window.controlPanel = {
  getDashboardData: () => invoke('get-dashboard-data'),
  startProject: (key) => invoke('start-project', key),
  stopProject: (key) => invoke('stop-project', key),
  restartProject: (key) => invoke('restart-project', key),
  startProjects: (keys) => invoke('start-projects', keys),
  saveProjectOrganization: (keys, input) => invoke('save-project-organization', keys, input),
  refreshProjects: () => invoke('refresh-projects'),
  setScanDepth: (depth) => invoke('set-scan-depth', depth),
  openProjectHomepage: (key) => invoke('open-project-homepage', key),
  openProjectRepository: (key) => invoke('open-project-repository', key),
  openConfigFile: () => invoke('open-config-file'),
  openConfigFolder: () => invoke('open-config-folder'),
  setProjectRoots: (roots) => invoke('set-project-roots', roots),
  saveProjectPresentation: (key, input) => invoke('save-project-presentation', key, input),
  openProjectFolder: (folder) => invoke('open-project-folder', folder),
  setOpenAtLogin: (enable) => invoke('set-open-at-login', enable),
  setProjectStartOnPanelLaunch: (key, enable) => invoke('set-project-start-on-panel-launch', key, enable),
  resetProjectIcon: (key) => invoke('reset-project-icon', key),
  chooseProjectIcon: (key) => new Promise((resolve, reject) => {
    const input = document.getElementById('iconUpload');
    input.value = '';
    input.oncancel = () => resolve(false);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) { resolve(false); return; }
      if (file.size > 5 * 1024 * 1024 || file.type !== 'image/png') { reject(new Error('请选择 5 MB 以内的 PNG 图标')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => invoke('choose-project-icon', key, reader.result).then(resolve, reject);
      reader.readAsDataURL(file);
    };
    input.click();
  }),
};
