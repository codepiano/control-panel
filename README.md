# Control Panel

一个面向 macOS 的本地项目中控：把散落在不同目录的开发项目放到同一个菜单栏入口，查看运行状态、启动、停止、重启，并快速打开项目主入口、仓库或目录。

它不接管你的代码仓库，也不上传项目数据。每个项目仍通过自身的 `control-panel.json` 声明生命周期命令；Control Panel 只负责发现、展示和调用。

## 适合什么场景

- 本机同时维护多个 Web、桌面应用或本地服务
- 不想记住每个项目的启动、停止和状态检查命令
- 希望从菜单栏快速确认哪些项目正在运行
- 希望用一份可复用的 manifest 约定连接项目与工具

## 功能

- 常驻 macOS 菜单栏，可随时打开主面板
- 按扫描目录自动发现项目，无需逐个手工登记
- 统一查看状态，并一键启动、停止、重启
- 快速打开项目主入口、仓库和本地目录
- 统计启动次数、最近启动时间和最近状态输出
- 图形化编辑项目展示名称、访问地址/端口和备注
- 可将统一规范交给 AI，为已有项目生成安全的生命周期脚本
- 支持登录后静默启动与“只看运行中”筛选
- 可按项目设置“随面板启动”，自动拉起需要常驻的本地服务

## 快速开始

### 1. 安装并启动

需要已安装当前维护中的 Node.js 版本和 npm。

```bash
git clone https://github.com/codepiano/control-panel.git
cd control-panel
npm install
npm start
```

应用启动后会显示主窗口，并在菜单栏保留 `CP` 图标。

### 2. 添加扫描目录

在应用中点击“目录”，选择或输入一个项目集合目录，例如：

```text
/Users/you/Documents/projects
```

Control Panel 会检查该目录本身和它的直接子目录中的 `control-panel.json`，找到后自动纳入面板。

### 3. 给项目添加 manifest

在项目根目录创建 `control-panel.json`：

```json
{
  "id": "my-api",
  "name": "My API",
  "workingDirectory": ".",
  "startCommand": "./scripts/start.sh",
  "stopCommand": "./scripts/stop.sh",
  "statusCommand": "./scripts/status.sh",
  "restartCommand": "./scripts/restart.sh",
  "surfaceType": "web",
  "runtimeMode": "development",
  "processMode": "managed",
  "frontendUrl": "http://127.0.0.1:3000",
  "notes": "本地开发 API"
}
```

刷新面板后，项目就会出现。

## 项目配置约定

`control-panel.json` 是项目的唯一配置来源。它和 `scripts/` 一起由项目维护：

```text
project-root/
  control-panel.json
  scripts/
    start.sh
    stop.sh
    status.sh
    restart.sh        # 可选
```

常用字段：

| 字段 | 用途 |
| --- | --- |
| `name` | 面板中的项目名称 |
| `id` | 稳定标识，建议填写 |
| `workingDirectory` | 执行命令时使用的目录 |
| `startCommand` / `stopCommand` / `statusCommand` / `restartCommand` | 项目生命周期命令 |
| `surfaceType` | 项目主表面：`web`、`desktop`、`hybrid` 或 `service` |
| `runtimeMode` | 运行方式：`development` 或 `packaged`，开发模式不要求打包 DMG |
| `processMode` | 进程责任：`managed`、`external` 或 `observed` |
| `frontendUrl` | Web 前端入口，适用于 `web` 或 `hybrid` 项目 |
| `appUrl` | 桌面应用 URL、深链或其他应用入口 |
| `appLaunchCommand` | 启动或聚焦桌面应用的命令 |
| `openEntryCommand` | 打开、启动或聚焦项目主入口的命令 |
| `homepageUrl` | 主入口不可用时的项目主页或仓库备用地址 |
| `metricsUrl` | 项目自身提供的运行时 metrics JSON 接口 |
| `notes` | 面板中的简短说明 |

`statusCommand` 返回码为 `0` 表示运行中或健康；`1` 表示停止、失败或降级；`2` 表示不支持或配置无效；`3` 表示无法确认外部启动的状态。

`managed` 表示项目脚本负责记录并管理自己的进程；`external` 表示交给 launchd、PM2、Docker 等外部 supervisor；`observed` 表示只观测、不提供可靠的启动和停止能力。禁止通过 `pkill node`、`pkill electron` 等宽泛命令猜测或终止进程。

完整的字段、主入口、生命周期和进程归属规则请见 [Project Tooling Spec](https://github.com/codepiano/control-panel-spec/blob/main/spec/PROJECT_TOOLING_SPEC.md)。

## 让 AI 接入已有项目

`project-tooling` Skill 的存在，就是为了让项目接入这件事可交给 AI 完成，而不是为每个仓库手写一套互不兼容的启动脚本。

把下面的信息一起交给 AI：

1. 项目仓库或项目根目录
2. [Project Tooling Skill](https://github.com/codepiano/control-panel-spec/blob/main/SKILL.md)
3. [Project Tooling Spec](https://github.com/codepiano/control-panel-spec/blob/main/spec/PROJECT_TOOLING_SPEC.md)
4. 已有的 `control-panel.json`（如果存在）、启动说明和项目特有约束

可以直接这样描述任务：

> 请使用 Project Tooling Skill，先阅读规范再检查这个项目。为它生成或修复 `control-panel.json` 以及项目实际需要的生命周期脚本。识别 `surfaceType`、`runtimeMode` 和 `processMode`；Electron 开发模式也必须使用项目专属 PID、进程组或外部 supervisor，不能依赖前台阻塞命令或宽泛进程扫描。保持项目原有的技术栈和命令，并在完成后给出可应用的 diff 和验证结果。

规范要求 AI 优先复用项目已有命令和脚本，明确工作目录与进程归属，并让 `status` 用退出码表达状态。因此，生成结果可以被 Control Panel 自动发现和调用，也能在项目仓库中独立维护与审查。

如果项目有自己的产品或技术规范，可在 manifest 中填写 `specUrl`；AI 应优先遵循该项目规范，再采用通用生命周期约定。

## 图形化编辑

自动发现的项目卡片提供“配置”按钮，可编辑：

- 项目名称
- 访问地址和端口（写入 `frontendUrl`）
- 备注

保存时会校验名称、HTTP/HTTPS URL、端口范围（`1`–`65535`）和文本格式，并原子写回该项目的 `control-panel.json`。

启动/停止/状态命令、脚本路径、工作目录、进程模式等生命周期字段没有图形化编辑入口，避免控制面板产生不符合项目规范的配置。

## Control Panel 自身配置

首次启动时，应用会在 Electron 的 `userData` 目录创建 `projects.json`。这个文件只保存扫描根目录和 Control Panel 自身的使用偏好，不保存项目 manifest 字段的副本。

“随面板启动”属于当前用户在这台 Mac 上的编排偏好，因此保存在 `projects.json` 的 `projectPreferences` 中，不写入项目自身的 `control-panel.json`，也不属于 Project Tooling Spec。面板进程每次启动时，只会拉起已开启该偏好且当前未运行的项目。

如需自定义它的位置：

```bash
CONTROL_PANEL_CONFIG=/path/to/projects.json npm start
```

示例结构见 [config/projects.example.json](./config/projects.example.json)。

### 源码模式的登录时启动

设置页的“登录时启动”会在 `~/Library/LaunchAgents` 安装当前源码目录专用的 LaunchAgent。登录后它会调用 `scripts/start.sh --hidden`，仅在菜单栏启动 Control Panel，不弹出主窗口。

也可在终端中直接管理：

```bash
./scripts/install-login-item.sh
./scripts/login-item-status.sh
./scripts/uninstall-login-item.sh
```

如果移动了项目目录，需要在新目录重新启用一次登录项。

## 开发

```bash
npm install
npm run dev
```

这是一个本地 Electron 应用；目前面向 macOS 菜单栏体验设计。

## License

本仓库暂未声明开源许可证。在复用、发布或贡献前，请先与维护者确认许可方式。
