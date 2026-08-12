# Control Panel

一个面向 macOS 的本地项目中控：把散落在不同目录的开发项目放到同一个菜单栏入口，查看运行状态、启动、停止、重启，并快速打开项目主页、仓库或目录。

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
- 快速打开项目主页、仓库和本地目录
- 统计启动次数、最近启动时间和最近状态输出
- 图形化编辑项目展示名称、访问地址/端口和备注
- 支持开机自启与“只看运行中”筛选

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
| `frontendUrl` | “主页”按钮打开的项目入口，端口属于此 URL |
| `homepageUrl` | 项目主页或仓库地址的备用值 |
| `notes` | 面板中的简短说明 |

`statusCommand` 返回码为 `0` 表示运行中；非 `0` 表示已停止、失败或不可用。

完整的字段、生命周期和进程归属规则请见 [Project Tooling Spec](https://github.com/codepiano/project-tooling/blob/main/spec/PROJECT_TOOLING_SPEC.md)。

## 图形化编辑

自动发现的项目卡片提供“配置”按钮，可编辑：

- 项目名称
- 访问地址和端口（写入 `frontendUrl`）
- 备注

保存时会校验名称、HTTP/HTTPS URL、端口范围（`1`–`65535`）和文本格式，并原子写回该项目的 `control-panel.json`。

启动/停止/状态命令、脚本路径、工作目录、进程模式等生命周期字段没有图形化编辑入口，避免控制面板产生不符合项目规范的配置。

## Control Panel 自身配置

首次启动时，应用会在 Electron 的 `userData` 目录创建 `projects.json`。这个文件只保存扫描根目录和 Control Panel 自身设置，不保存项目字段副本。

如需自定义它的位置：

```bash
CONTROL_PANEL_CONFIG=/path/to/projects.json npm start
```

示例结构见 [config/projects.example.json](./config/projects.example.json)。

## 开发

```bash
npm install
npm run dev
```

这是一个本地 Electron 应用；目前面向 macOS 菜单栏体验设计。

## License

本仓库暂未声明开源许可证。在复用、发布或贡献前，请先与维护者确认许可方式。
