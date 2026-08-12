# Control Panel

macOS 菜单栏项目中控。

## 功能

- 常驻系统工具栏
- 统一查看多个项目状态
- 一键启动、停止、重启
- 通过“扫描目录”自动发现项目
- 从本地 JSON 配置文件管理扫描根目录
- 通过图形化表单编辑项目 manifest 中允许调整的展示信息
- 支持手工项目定义，兼容旧配置

## 启动

```bash
npm install
npm start
```

## 配置

首次运行会在 Electron 的 `userData` 目录里生成 `projects.json`，内容会从 `config/projects.example.json` 复制过去。

也可以通过环境变量指定配置文件：

```bash
CONTROL_PANEL_CONFIG=/path/to/projects.json npm start
```

## 扫描模式

在界面里把项目根目录加入扫描列表后，应用只会检查根目录本身，以及每个直接子目录里的 `control-panel.json`。

一个符合规范的项目目录长这样：

```text
project-root/
  control-panel.json
  scripts/
    start.sh
    stop.sh
    status.sh
```

`control-panel.json` 示例：

```json
{
  "name": "API 服务",
  "id": "api",
  "workingDirectory": ".",
  "initCommand": "./scripts/init.sh",
  "installCommand": "./scripts/install.sh",
  "startCommand": "./scripts/start.sh",
  "stopCommand": "./scripts/stop.sh",
  "statusCommand": "./scripts/status.sh",
  "uninstallCommand": "./scripts/uninstall.sh",
  "notes": "后端接口"
}
```

字段说明：

- `name`: 展示名称
- `id`: 唯一标识，可选
- `workingDirectory`: 工作目录，默认是 manifest 所在目录
- `initCommand`: 初始化命令，可选
- `installCommand`: 安装依赖或插件命令，可选
- `startCommand`: 启动命令
- `stopCommand`: 停止命令，可选
- `statusCommand`: 状态检测命令，返回码 `0` 表示运行中，可选
- `uninstallCommand`: 卸载或清理命令，可选
- `notes`: 备注，可选

也支持旧的手工配置项 `projects`，但推荐以后统一切到扫描模式。

### 图形化项目配置

每张自动发现的项目卡片都有“配置”按钮。可在表单中编辑展示名称、访问地址（包括端口）和备注；保存后会原子写回项目自己的 `control-panel.json`，它是项目配置的唯一来源。

生命周期命令、工作目录等规范字段只能由项目维护，控制面板不会提供编辑入口。表单会校验名称、URL/端口和输入长度；`frontendUrl` 中的端口会由项目按其自身配置使用。

## 给外部 AI 的规范

如果你想把这个仓库发给其他 AI 生成项目脚本，可以直接分享这份规范：

- [Project Script Generation Spec](./PROJECT_SCRIPT_GENERATION_SPEC.md)

把这个链接连同对应项目仓库、`control-panel.json` 或 `specUrl` 一起发给对方即可。
