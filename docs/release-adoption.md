# 版本化生命周期接入与验证

日期：2026-10-22。当前登记的 29 个运行服务均已补齐项目自有适配器和 7 个 release-* 脚本。

代码在各仓库的 codex/versioned-lifecycle 分支开发；提交推送与在线切换分开。原运行目录、原数据及用户页面保持使用。

## 协议与消费者

- Project Tooling 1.11：只读版本查询、隔离准备不可变产物、切换、实际进程版本核验。
- 面板兼容旧项目；接入项目使用新流程，并显示代码、产物和运行版本。
- 面板自重启保留原 PID/启动器检查，由独立助手完成准备和切换。
- 子服务独立操作，父服务不联动 tunnel。

## 项目清单

| 服务 | 构建/准备入口 | 数据目录 | 验证 |
| --- | --- | --- | --- |
| OctoScope | corepack pnpm install --frozen-lockfile；corepack pnpm build；corepack pnpm --dir apps/web install --frozen-lockfile；corepack pnpm build:web；corepack pnpm --dir apps/chrome-extension install --frozen-lockfile；corepack pnpm build:chrome-extension | data | 隔离构建通过；保留原未运行状态 |
| Agent Docs MCP | corepack pnpm install --frozen-lockfile；corepack pnpm --dir web install --frozen-lockfile；corepack pnpm build；corepack pnpm web:build | 既有系统目录或无本地数据目录 | 已上线；源码/构建/运行版本一致 |
| PDF Tool | npm ci；npm run build | 既有系统目录或无本地数据目录 | 隔离构建通过；保留原未运行状态 |
| Browser Reader | npm ci；npm run build | data | 已上线；源码/构建/运行版本一致 |
| Mac 工具箱 | ./scripts/install.sh | 既有系统目录或无本地数据目录 | 已上线；源码/构建/运行版本一致 |
| Cutter | ./scripts/build-app.sh | 既有系统目录或无本地数据目录 | 已上线；源码/构建/运行版本一致 |
| cookie-vault | npm ci | .runtime | 已上线；源码/构建/运行版本一致 |
| common-mcp | npm ci | .runtime | 已上线；源码/构建/运行版本一致 |
| 知键 · Rime Studio | npm ci | .data | 隔离构建通过；保留原未运行状态 |
| Gnosmancer | corepack pnpm install --frozen-lockfile；corepack pnpm -r build | apps/api/uploads、apps/api/backups | 已上线；源码/构建/运行版本一致 |
| media-library | npm ci | .runtime | 已上线；源码/构建/运行版本一致 |
| market-data | npm ci | .runtime | 已上线；源码/构建/运行版本一致 |
| Knots | bash -c mkdir -p .control-panel/bin && go build -o .control-panel/bin/knots-backend ./backend | data | 隔离构建通过；保留原未运行状态 |
| Chrome 主页书签管理 | corepack pnpm install --frozen-lockfile；corepack pnpm build | data | 隔离构建通过；保留原未运行状态 |
| 字符串处理工具 | npm ci；npm run build:client；npm run build | data | 隔离构建通过；保留原未运行状态 |
| 控制面板 | 源码快照 | 既有系统目录或无本地数据目录 | 已上线；源码/构建/运行版本一致 |
| 诗歌研究 | python3 -m venv --copies backend/.venv；backend/.venv/bin/pip install ./backend；bash -c cd frontend && npm ci && npm run build | backend/data | 隔离构建通过；保留原未运行状态 |
| 时间线工具库 | npm ci；npm run build | 既有系统目录或无本地数据目录 | 隔离构建通过；保留原未运行状态 |
| 时序 · Reminder | npm ci；npm run build | data | 隔离构建通过；保留原未运行状态 |
| Agent Docs Tunnel | 既有 tunnel-client 二进制快照 | 既有系统目录或无本地数据目录 | 已上线；源码/构建/运行版本一致 |
| ASCII Diagram Renderer | npm ci；npm run build | 既有系统目录或无本地数据目录 | 隔离构建通过；保留原未运行状态 |
| common-mcp Tunnel | 既有 tunnel-client 二进制快照 | 既有系统目录或无本地数据目录 | 已上线；源码/构建/运行版本一致 |
| Gnosmancer Tunnel | 既有 tunnel-client 二进制快照 | 既有系统目录或无本地数据目录 | 已上线；源码/构建/运行版本一致 |
| Image Processor | npm ci；npm run build | db | 隔离构建通过；保留原未运行状态 |
| Nautilus Pompilius | npm ci；npm run build | 既有系统目录或无本地数据目录 | 隔离构建通过；保留原未运行状态 |
| OCR | corepack pnpm install --frozen-lockfile；corepack pnpm --dir web install；corepack pnpm --dir web build | data | 隔离构建通过；保留原未运行状态 |
| Pearl | npm ci；npm run build | data | 隔离构建通过；保留原未运行状态 |
| ThinkSchema | corepack pnpm install --frozen-lockfile；corepack pnpm build | data | 隔离构建通过；保留原未运行状态 |
| web-fetch | npm ci | .runtime | 已上线；源码/构建/运行版本一致 |

## 验证边界

- 所有项目均在独立 Git worktree 开发，依赖、产物、缓存及测试数据与在线目录隔离。
- 29 个版本查询均能返回结构化结果，旧进程来源未知时保持 null。
- 面板测试覆盖准备失败保留旧服务、源码变化、停止失败、并发、健康但旧版本等情况。
- 适配器测试覆盖快照、复用、损坏产物、数据连接时机、进程身份、路径越界和公共构建环境。
- common-mcp 与四个子服务的原有 npm test 在额外的完整独立副本和临时 HOME 中执行。
- 面板自身在临时数据、独立回环端口完成真实自重启，回读新 PID 及运行版本。
- 桌面浏览器检查 1440 和 1000 像素宽度、长标签、焦点与禁用状态；未测试移动端。
- tunnel 已使用独立客户端产物切换，三个 LaunchAgent 本地就绪通过。远端调用单独复核，不以本地就绪代替端到端结论。
- 用户授权合并上线后，运行中的 14 个服务完成切换并回读版本一致；另外 15 个保持原未运行状态。Cutter 新进程路径、二进制 SHA-256 与 codesign --verify --deep --strict 均已核对。
- Agent Docs 同期身份迁移由其原聊天完成；本次接入保留 cluster-active.json 和私有配置指针。

## 上线顺序

本次已先将控制面板合入 main 并上线新后端，再交付其他项目的 release 配置。旧消费者的通用重启会先停止再启动，不能提前启用这些 manifest；CLI 可直接使用新 release-restart.sh 完整流程。

## 接入后的操作

面板或命令行 scripts/release-restart.sh 会先准备，再停止、激活并核验。scripts/release-version.sh 可只读检查。
原 scripts/start.sh 等脚本保留兼容；直接从旧入口或 IDE 启动的进程不会自动获得新协议的运行版本记录。
原有私有配置和数据只在显式激活时连接，不纳入源码指纹或提交。

## 提交与推送清单

分支统一为 `codex/versioned-lifecycle`。以下项目提交已回读远端验证；面板提交以本文件所在分支为准。

| 仓库 | 提交 |
| --- | --- |
| OctoScope | [8ebdda62ec](https://github.com/codepiano/OctoScope/commit/8ebdda62ecd354027ce978d8b40046ee8ca05ecd) |
| Agent Docs MCP | [b6a9481921](https://github.com/codepiano/agent-docs/commit/b6a948192194aa2b95e782d664d47c5c887c78f2) |
| PDF Tool | [1635fe8b9d](https://github.com/codepiano/pdf-tool/commit/1635fe8b9d02d083a44769e6a795e32995f2d001) |
| Browser Reader | [f415140d32](https://github.com/codepiano/browser-reader/commit/f415140d32baa3b49580ca83d6aef0ddba3263a7) |
| Mac 工具箱 | [bec3379157](https://github.com/codepiano/mac-tool/commit/bec33791576a6c8948fc69004fcd305843cdc147) |
| Cutter | [577e443d2c](https://github.com/codepiano/cutter/commit/577e443d2c2651cba03b05cf359658e8819555d8) |
| cookie-vault | [1810fe147a](https://github.com/codepiano/cookie-vault/commit/1810fe147aee7bcc6375c5422605520624a33446) |
| 知键 · Rime Studio | [1fc2ddb64f](https://github.com/codepiano/rime-studio/commit/1fc2ddb64f264d10f65e60bde44636b4cffedc19) |
| Gnosmancer | [6228a7fbf1](https://github.com/codepiano/Gnosmancer/commit/6228a7fbf18fa0d08e68f2d9175623ee968ad8f2) |
| media-library | [bb134977c8](https://github.com/codepiano/media-library/commit/bb134977c8d390d8f6f7b6871577f5f6d6edf647) |
| market-data | [4226fed574](https://github.com/codepiano/market-data/commit/4226fed5743c94d1f141f88e5e36bdcb41566532) |
| Knots | [42ccf2e960](https://github.com/codepiano/knots/commit/42ccf2e9602a3e3869cad0b2499047d4821a9ebc) |
| Chrome 主页书签管理 | [b279f56103](https://github.com/codepiano/chrome-homepage-bookmark-manager/commit/b279f5610377245bc474d56d1debdd4c7cc930c1) |
| 字符串处理工具 | [24d81da934](https://github.com/codepiano/StringFlow/commit/24d81da9343d3d81c96259f625c4fd5ec5b99023) |
| 诗歌研究 | [eaadd226b3](https://github.com/codepiano/shijian-poetry/commit/eaadd226b3ab95c453cda92198800a5bbacd9561) |
| 时间线工具库 | [001e5ee0d7](https://github.com/codepiano/timeline-toolkit/commit/001e5ee0d7e6f9e17b5db530a44fbb81e5d9dae4) |
| 时序 · Reminder | [6a5bf5a8dc](https://github.com/codepiano/reminder/commit/6a5bf5a8dc479fd06da9d9f003af48fc2fc76c3e) |
| ASCII Diagram Renderer | [912fbd4e81](https://github.com/codepiano/ascii-diagram-renderer/commit/912fbd4e8155bfd3d54285ef46910ec482cfc7c9) |
| Image Processor | [8890d158bf](https://github.com/codepiano/image-processor/commit/8890d158bf24c653ed84940fa3b730c1318f9571) |
| Nautilus Pompilius | [f61354167c](https://github.com/codepiano/nautilus-pompilius/commit/f61354167cb0d4882c13d866941764e61e95ffd0) |
| OCR | [c785921892](https://github.com/codepiano/dianping-ocr/commit/c785921892071a1d6f13832eb65730bb03e71dca) |
| Pearl | [519992c124](https://github.com/codepiano/PearlLoom/commit/519992c124f1e0667b1fc76c6c3e7905fb6f3471) |
| ThinkSchema | [e26334bd68](https://github.com/codepiano/think-schema/commit/e26334bd688ef68d497381f1a98c59ec473b9b98) |
| web-fetch | [6742fcc1c5](https://github.com/codepiano/web-fetch/commit/6742fcc1c51957235e7d39555b4c16682e78e447) |
| Project Tooling Spec | [b96c0376cd](https://github.com/codepiano/control-panel-spec/commit/b96c0376cdecbd9fa622f795f6a69d3fc60e1e93) |
| common-mcp | [063013b2aa](https://github.com/codepiano/common-mcp/commit/063013b2aa304b5a99517ecb2f2cfe7b720465cb) |

## 2026-10-22 合并与上线记录

- 27 个仓库的本次改动已进入远端 main，本机项目目录已更新；原有未提交文档保留。
- 时间线工具库以 c33dc75 将本次接入单独合入 main，保留原开发分支的其他功能提交。
- 上线复核修正：Agent Docs 的含空格入口路径与原目录私有配置读取（1c8e5f9）；三个 tunnel 的启动等待预算（Agent Docs d22f5ca、common-mcp ec5d214、Gnosmancer 4eb3bb4）；Gnosmancer 运行日志移出不可变产物（4429aa6）。
- 含空格隔离目录的 Agent Docs 配对生命周期测试 2 项通过，配置来源回归测试 2 项通过；launchd 测试 13 项通过。
- CLI 批次结束后复核过实际进程；Browser Reader 与 Gnosmancer 使用独立会话重新启动，避免部署命令会话退出影响 nohup 子进程。
- media-library 首次 npm 下载超时保留旧服务，重试成功后才切换。
- 端到端复核：Gnosmancer 远端 knowledge_usage_guide 成功；common-mcp 与 Agent Docs 新客户端的文稿文件夹访问被 macOS TCC 授权请求阻塞，须由用户处理系统授权后重新验证。进程运行、版本一致和本地就绪不代表这两个远端调用已经可用。
