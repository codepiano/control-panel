# Control Panel

本机 Web 服务中控。浏览器负责展示与操作，Node.js 后端负责发现项目、保存配置和调用项目生命周期脚本；运行不需要 Electron，也没有第三方运行依赖。

## 启动

需要 Node.js 22 或更新版本。

```bash
npm start
```

打开 [本机控制面板](http://127.0.0.1:4310)。后台运行可使用：

```bash
./scripts/start.sh
./scripts/status.sh
./scripts/stop.sh
./scripts/restart.sh
./scripts/open-homepage.sh
```

后台启动会输出访问地址、Node 版本、配置/状态/日志路径，等待实际 HTTP 就绪后显示进程 PID、服务数量和发现问题数量；等待期间显示初始化进度，失败会打印日志尾部。

`npm run dev` 使用 Node 的 watch 模式，`npm test` 运行后端集成测试。

## 分组、标记和批量启动

- 服务的更多操作菜单提供“标记与分组”和星标；标签可用中英文逗号分隔。
- 左侧切换工作区、个人分组、标签、运行中和星标视图；搜索也会匹配归属、标签、角色和路径。
- 勾选任意服务后，底部出现“启动所选”和“批量归组”操作栏；也可直接启动当前筛选列表。
- 分组标题提供“启动本组”，作用于该组当前显示的服务。
- 选择“集合：名称（含子项目）”后点击“启动当前列表”，可一键启动整个集合的后代服务；其它筛选条件会同时缩小启动范围。
- “批量归组”只修改分组，保留每个服务的标签、星标、图标和自动启动偏好。
- 批量启动逐项执行，跳过已运行、状态切换中、缺少启动命令的服务，以及控制面板自身。一项失败会继续处理其它服务，结果显示每项的执行、跳过或失败情况。
- 启动命令执行与服务就绪是不同阶段；最终运行情况以项目自己的状态命令为准。

## 显式发现子项目

在“设置”中添加入口目录。默认检查入口本身和直接子目录的 `control-panel.json`，深层项目通过外层配置的 `children` 明确声明，不根据 package.json 猜测可运行服务。

例如一个研究工作区包含多个仓库，以及一个仓库的多个服务：

```json
{
  "id": "research",
  "name": "研究工作区",
  "kind": "collection",
  "notes": "一起使用的研究工具和服务",
  "children": [
    { "path": "repos/knowledge", "role": "knowledge", "notes": "知识库后端" },
    { "path": "repos/reader/apps/web", "role": "frontend", "notes": "阅读前端" },
    { "path": "repos/reader/services/indexer", "role": "worker", "notes": "后台索引" }
  ]
}
```

每个子目录仍须有自己的 `control-panel.json`，并可继续声明 `children`。路径相对外层配置所在目录解析，与其 `workingDirectory` 无关；必须是内部子目录。越界路径、符号链接越界、缺失配置和无效声明会显示在设置中。

`kind: collection` 只有组织作用，不作为服务展示或计数，也不执行命令。有独立进程的父项目可省略 `kind` 或用 `kind: project`，并同时声明子项目；父项目命令只能控制自身进程，避免与独立子服务重复启动。旧单项目配置继续兼容。

服务列表按 manifest 的从属关系展示可折叠父子层级，父项目保留自身操作，子服务缩进展示角色。侧栏“项目层级”可选择父项目及其后代，“启动整个项目”只启动当前筛选匹配的服务。筛选出子服务时保留未匹配父项目作为结构提示，但它不参与选择和批量启动。个人分组独立于项目层级，归组不会拆散父子结构。扫描上限为 1,000 个 manifest、32 层声明关系。声明顺序不表示启动依赖，当前不提供依赖调度或就绪等待。

完整协议：[Project Tooling Spec](https://github.com/codepiano/control-panel-spec/blob/main/spec/PROJECT_TOOLING_SPEC.md)。`children` / `kind` 是本次协议 1.7 的扩展，需配合支持该扩展的消费端使用。

## 单服务配置

```json
{
  "id": "my-api",
  "name": "My API",
  "workingDirectory": ".",
  "startCommand": "./scripts/start.sh",
  "stopCommand": "./scripts/stop.sh",
  "statusCommand": "./scripts/status.sh",
  "restartCommand": "./scripts/restart.sh",
  "surfaceType": "service",
  "runtimeMode": "development",
  "processMode": "managed",
  "frontendUrl": "http://127.0.0.1:3000",
  "notes": "本地 API"
}
```

项目自身维护生命周期命令和进程归属。状态命令 `0` 表示运行中，非 `0` 表示停止或未确认。禁止 `pkill node` / `pkill electron` 等宽泛停止命令。界面可直接编辑项目名称、访问地址/端口和备注，原子写回原 manifest，保留其它字段。

## 配置与迁移

沿用桌面版原有目录 `~/Library/Application Support/control-panel` 中的 `projects.json`、`state.json` 和 `project-icons`，无需重新登记服务。已有启动次数、运行时长、本机图标和自动启动偏好继续保留。

`projectPreferences` 保存本机 `group`、`tags`、`favorite`、`startOnPanelLaunch`、`iconOverride`；它们不写回项目仓库。选择“随面板启动”的服务会在后端启动时拉起。PNG 自定义图标可从浏览器上传。

可选环境变量：

| 变量 | 用途 |
| --- | --- |
| `CONTROL_PANEL_PORT` | HTTP 端口，默认 `4310` |
| `CONTROL_PANEL_CONFIG` | 自定义 `projects.json` 路径 |
| `CONTROL_PANEL_DATA` | 自定义状态和图标目录 |
| `CONTROL_PANEL_NODE` | 后台启动和登录启动使用的 Node 绝对路径 |

macOS 登录启动可在设置中切换，或执行 `./scripts/install-login-item.sh` / `./scripts/uninstall-login-item.sh`。登录项只启动后端，不自动打开浏览器；移动源码目录或更换 Node 路径后应重新启用登录项。

## 状态刷新

后端每 30 秒统一检查服务状态并缓存快照；多个浏览器页面共用同一份快照，不会各自执行状态脚本。页面每 5 秒读取缓存，隐藏页面暂停轮询。服务与后端运行时长在前端每秒更新。

启动、停止、配置保存和手动刷新会立即更新快照；外部启动或停止的服务会在下一次后端检查后显示新状态。

## 访问边界

后端只监听 `127.0.0.1`，所有控制操作需要当前会话令牌，并校验 Host 与 Origin；它不提供跨域接口，也不接受界面传入的任意 shell 命令。HTTP 服务启动时会执行已信任项目的状态脚本与已授权的自动启动偏好。

浏览器无法直接扫描本机目录，因此通过设置输入路径。打开项目目录、入口和配置文件由后端调用 macOS `open` 完成。没有菜单栏和托盘。关闭浏览器不会停止后端或其它服务。

## License

本仓库暂未声明开源许可证。
