const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlPanel', {
  getDashboardData: () => ipcRenderer.invoke('get-dashboard-data'),
  startProject: (projectId) => ipcRenderer.invoke('start-project', projectId),
  stopProject: (projectId) => ipcRenderer.invoke('stop-project', projectId),
  restartProject: (projectId) => ipcRenderer.invoke('restart-project', projectId),
  openProjectHomepage: (projectId) => ipcRenderer.invoke('open-project-homepage', projectId),
  openProjectRepository: (projectId) => ipcRenderer.invoke('open-project-repository', projectId),
  refreshProjects: () => ipcRenderer.invoke('refresh-projects'),
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),
  openConfigFile: () => ipcRenderer.invoke('open-config-file'),
  chooseProjectRoots: () => ipcRenderer.invoke('choose-project-roots'),
  setProjectRoots: (roots) => ipcRenderer.invoke('set-project-roots', roots),
  openProjectFolder: (folderPath) => ipcRenderer.invoke('open-project-folder', folderPath),
  setOpenAtLogin: (enable) => ipcRenderer.invoke('set-open-at-login', enable),
  onProjectsUpdated: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('projects-updated', listener);
    return () => ipcRenderer.removeListener('projects-updated', listener);
  },
  onAppReady: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('app-ready', listener);
    return () => ipcRenderer.removeListener('app-ready', listener);
  },
});
