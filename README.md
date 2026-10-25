# Control Panel

本机 Web 服务中控。浏览器负责展示与操作，Node.js 后端负责发现项目、保存配置和调用项目生命周期脚本；界面使用 React + Mantine，浏览器资源在本机构建并由 Node.js 提供，不依赖 CDN；运行不需要 Electron。

## 启动

需要 Node.js 22 或更新版本。

```bash
npm ci
npm start
```

打开 [本机控制面板](http://127.0.0.1:4310)。后台运行前先执行 `npm run build`，然后使用：

```bash
./scripts/start.sh
./scripts/status.sh
./scripts/stop.sh
./scripts/restart.sh
./scripts/open-homepage.sh
```

后台启动会输出访问地址、Node 版本、配置/状态/日志路径，等待实际 HTTP 就绪后显示进程 PID、服务数量和发现问题数量；等待期间显示初始化进度，失败会打印日志尾部。

`npm run build` 使用 esbuild 将 `src/ui/app.jsx` 与 Mantine 样式打包到 `dist/`。`npm start` 和 `npm run dev` 会先构建；dev 使用 Node 的 watch 模式，前端修改后需要重新构建。发布准备阶段在独立产物目录中执行 `npm ci` 和 `npm run build`，构建成功后才能切换。

验证必须在独立 checkout 中进行，使用独立依赖、构建输出、缓存与临时数据。`npm test` 运行后端和页面模型测试；`npm run test:ui` 使用 Playwright 启动 `127.0.0.1:19431` 的临时后端，浏览器上下文拦截 API 并使用固定测试数据，大部分写入为模拟调用，另有临时目录中的真实服务启停与配置保存验收，不访问在线项目。首次运行先执行 `npx playwright install chromium`，或用 `PLAYWRIGHT_CHROME_PATH` 指定 Chrome 可执行文件；该方式启动独立浏览器进程和临时浏览器配置，不复用个人标签页。浏览器回归覆盖服务操作重试、批量结果、归组、长名称、桌面紧凑窗口、下拉框键盘、弹窗焦点、仓库同步历史和子服务归属。

## 分组、标记和批量启动

- 服务的更多操作菜单提供“标记与分组”和星标；标签可用中英文逗号分隔。
- 左侧切换工作区、个人分组、标签、运行中和星标视图；搜索也会匹配归属、标签、角色和路径。
- 勾选任意服务后，底部出现“启动所选”和“批量归组”操作栏；也可直接启动当前筛选列表。
- 分组标题提供“启动本组”；项目层级标题提供“启动整个项目”，作用于当前筛选中该项目及其子服务。
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

## 仓库同步

顶部“检查仓库同步”和侧栏“仓库同步”打开仓库状态面板，支持全部或单个仓库检查、拉取和推送。服务行显示最后一次检查的状态；按实际 Git 工作目录去重，独立嵌套仓库分别处理，也包含纯集合自身的仓库。检查执行 fetch，不修改工作文件，未提交修改与待推/待拉状态分别显示。

仓库检查最多同时处理 4 个仓库，完成一项后立即更新结果，并显示正在检查的仓库和完成进度。共享 Git 数据的工作树顺序检查，避免 fetch 锁冲突；拉取和推送仍按顺序执行。

默认按本机时区每天 03:00 检查一次。检查记录保存到数据目录的 `repository-sync.json`，每分钟只判断是否到期，不进行远端轮询；休眠、关机或后端未运行导致错过时，恢复运行或启动后补查最新一次到期任务，不累积补跑。首次启动没有检查记录时会补查一次。全量手动检查成功也计入本次周期；失败保留错误并在 15 分钟后重试。浏览器关闭不影响后端调度。后端未运行时不能执行检查，登录启动后端可确保恢复后的补查。

批量“处理全部”、拉取全部和推送全部只处理上次扫描确认可同步的仓库；已同步、尚未检查、检查失败及需人工处理的仓库不参与，也不重新 fetch。需要发现其它仓库的新变化时使用“检查所有仓库”。推拉操作需要按钮触发，仅对选中的仓库重新 fetch 并检查当前分支。未提交修改、Git 操作进行中、分支分叉、游离 HEAD 或无跟踪分支会跳过；推送使用普通 push，拉取只快进，不自动提交、暂存、重置或解决冲突。一项失败不会阻止其它仓库。使用当前分支配置的远端与跟踪分支，操作结果逐项显示。认证失败不会弹出后台交互提示，请用终端完成 Git 登录后重试。

## 本机端口分配

服务列表上方的“本机端口分配”列出已登记服务和本机 TCP 监听进程，标记重复分配、同端口多进程，以及服务未确认运行但端口被占用的情况。候选空闲端口排除已登记和已监听端口；候选值只是当前快照，不会自动改写项目配置。

本机 `frontendUrl` 和 `metricsUrl` 作为端口分配来源，同一服务的相同端口合并，停止的服务仍保留分配。识别 localhost、IPv4/IPv6 回环及通配监听地址；远程 URL 不参与本机分配。多个服务共用一个反向代理入口时，需要分别配置各自本机服务地址。页面每次后端刷新更新监听表；读取失败会显示原因。

单独启动、批量启动和随面板启动都会先检查重复分配，并通过实际 TCP 绑定检查占用，发现问题会阻止启动。服务脚本仍需处理检查后到启动之间的竞争。编辑访问地址时，新端口也会检查；编辑仅修改展示 URL，实际监听端口需要同步修改服务自身配置。非 Web 服务和额外后端端口可以在 manifest 中声明 `"ports": [8000, 8001]`，与 URL 中的端口合并检查。未声明的额外监听端口只显示进程占用信息，不作为该服务的分配。

## 其它项目通过 Skill 接入

统一使用 [Project Tooling Skill](https://github.com/codepiano/control-panel-spec)。本机已安装为 `$project-tooling`，包含 spec 获取、端口注册帮助程序和按项目事实生成生命周期脚本的流程。

```text
$project-tooling 为当前服务注册端口，获取 spec，并生成或修复生命周期脚本
```

本机注册 API 使用与其它面板操作相同的会话令牌和同源边界：

- `POST /api/get-port-allocations`，JSON `{ "args": [] }`：读取服务分配与监听状态。
- `POST /api/register-project-ports`，JSON `{ "args": [{ "projectDir": "/absolute/project", "count": 2 }] }`：分配并持久化端口。
- 用 `ports: [4323, 4324]` 替代 `count` 可请求指定端口。目标目录须已存在含 `name` 的 `control-panel.json`；集合不可注册。

注册请求在一个后端内串行执行，检查其它已发现 manifest 和实际监听进程，写入项目 `ports`，必要时增加本机发现入口。重复申请相同数量会复用已有端口，指定端口冲突则失败；注册保留其它 manifest 字段。返回的 `status: reserved` 只确认配置分配，实际服务监听配置、URL 和健康状态仍须由 skill 验证。注册不执行启动命令，也不会停止占用端口的其它进程；发现后会按现有机制执行项目状态脚本。

同步面板顶部显示最近一次同步的成功、失败与跳过数量；每个仓库保留上次同步的时间和原因。分叉、未提交修改等导致的跳过会明确展示，后续检查和后端重启不会清除最近一次同步记录。此记录是历史结果，当前仓库状态以最近检查为准。Git 命令失败显示命令名称、退出码及输出，较长输出保留开头和末尾，并隐藏 URL 中的账号密码；面板继续只做快进拉取，不自动选择合并或变基策略。

## 构建版本与运行版本

项目可选择接入 Project Tooling 1.11 的版本化生命周期：

```json
{
  "release": { "protocol": 1, "prepareTimeoutMs": 1800000, "activateTimeoutMs": 60000 },
  "scripts": {
    "version": "./scripts/version.sh",
    "prepare": "./scripts/prepare.sh",
    "activate": "./scripts/activate.sh"
  }
}
```

必须同时提供原有 `statusCommand` 和只管理自身的 `stopCommand`。`version` 只读输出
`{"sourceRevision":"sha256:…","builtRevision":null,"runningRevision":null}`；未知版本必须为
`null`。`prepare` 从环境变量 `PROJECT_TARGET_REVISION` 取得目标版本，在独立目录准备不可变产物，
成功输出 `{"builtRevision":"sha256:…","artifactId":"opaque-id"}`。
`activate` 从 `PROJECT_TARGET_REVISION`、`PROJECT_ARTIFACT_ID` 取得确定的产物，切换并后台启动，
成功输出 `{"runningRevision":"sha256:…"}`。这三个命令的 stdout 只能是一个 JSON 对象，日志写 stderr。

重启先准备产物，成功且源码版本未变化才停止旧服务；停止失败不切换，启动后检查健康及进程实际运行版本。
构建失败保留旧服务，激活失败明确报错，不自动回退。运行版本必须由真实运行进程或经验证的进程身份对应记录提供，
不能每次查询时读取工作区 HEAD。Git 提交号可作附加信息；源码指纹应包含未提交修改、依赖锁文件、构建配置，
排除数据、密钥、依赖安装目录和产物。只有成功的完整产物才能记为构建版本；同版本产物由项目检查完整性后复用。

未接入的项目继续使用原有启动/停止流程。版本未知不会被当成最新。源码方式的项目也应准备独立代码快照，
可以省略编译。项目自行决定依赖、数据路径和外部 supervisor 的切换方式；不能把在线数据复制成测试数据后当作正式数据。
父服务的切换不影响独立 tunnel/子服务。代码同步只更新源码并触发后续状态检查，不自动重启运行服务。

面板自身保留原有 PID 与启动器身份检查，在独立重启助手中执行版本化准备与切换。启用 release 前应按完整协议完成项目适配，
不能给未适配项目仅填入通用 `npm run build`。全部 29 个登记服务已提供项目自有脚本，在线切换仍需单独执行。接入清单见 `docs/release-adoption.md`。
