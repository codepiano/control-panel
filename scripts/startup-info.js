const path = require('node:path');
const os = require('node:os');
const launcherPid = Number(process.argv[2]);
const port = Number(process.env.CONTROL_PANEL_PORT || 4310);
const data = process.env.CONTROL_PANEL_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'control-panel');
console.log(`  配置文件：${path.resolve(process.env.CONTROL_PANEL_CONFIG || path.join(data, 'projects.json'))}`);
console.log(`  状态文件：${path.resolve(data, 'state.json')}`);
(async () => {
  const started = Date.now();
  let detail = '未收到 HTTP 响应';
  let nextProgressAt = started + 5000;
  while (Date.now() - started < 60000) {
    try { process.kill(launcherPid, 0); } catch { throw new Error('启动进程已退出'); }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (response.ok && health.status === 'running' && health.launcherPid === launcherPid) {
        console.log(`控制面板已就绪 · 检查耗时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
        console.log(`  后端 PID：${health.pid} · 启动进程 PID：${launcherPid} · 运行时间：${health.uptimeSec} 秒`);
        console.log(`  服务：${health.services} 个 · 运行中：${health.running} 个 · 发现问题：${health.issues} 个`);
        console.log('  管理命令：./scripts/status.sh / ./scripts/restart.sh / ./scripts/stop.sh');
        console.log('  跟踪日志：tail -f .control-panel/logs/control-panel.log');
        return;
      }
      detail = '端口响应不属于此启动进程，请检查端口占用';
    } catch (error) { detail = error.message; }
    if (Date.now() >= nextProgressAt) { console.log('  仍在初始化：配置扫描、状态脚本或自动启动尚未完成…'); nextProgressAt = Date.now() + 5000; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待就绪超时：${detail}`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
