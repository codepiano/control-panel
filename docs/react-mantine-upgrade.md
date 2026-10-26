# React / Mantine 稳定版核对与首屏优化

核对日期：2026-10-25。基线提交：`28a524f`。只提交源码，未部署、未重启或刷新正在使用的服务。

## 稳定版本与兼容性

使用 `npm view <package> dist-tags` 核对执行时的稳定标签，没有采用 `next`、`canary`、`rc` 或 `experimental`。React / React DOM `latest` 均为 **19.3.1**，Mantine Core / Hooks `latest` 均为 **9.7.3**；这些运行依赖在任务开始时已经是最新稳定版，因此保持原版本，没有虚构一次版本升级。新增 React / React DOM 类型包 **19.3.0** 与 TypeScript **7.0.2**，启用前端 JSX / JS 类型检查。项目只有一个应用包，无工作区子包和额外 peerDependencies；安装树与锁文件中的 React、React DOM、Core、Hooks 和类型包均只有一份。

已阅读 [React 19 升级指南](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)、[React 19.3 发布说明](https://react.dev/blog/2026/09/09/react-19-3)、[Mantine 9 迁移指南](https://mantine.dev/guides/8x-to-9x/) 与 [组件 CSS 依赖和导入顺序](https://mantine.dev/styles/css-files-list/)。Mantine 要求 React 19.2+，当前组合满足要求。项目已使用现代 JSX transform 与 `createRoot`，没有旧 render、字符串 ref、forwardRef 或旧 JSX 命名空间需要迁移。保留已适配的 `Collapse.expanded`，修正类型检查发现的 Select 泛型回调值及日期排序计算。

## 首屏与按需加载

- 设置、仓库同步、展示信息编辑、归组面板拆为四个懒加载模块。Suspense 只包围面板，服务列表与导航持续显示；模块加载失败时显示局部重载提示，服务搜索仍可使用。
- 原页面没有次级页面路由；为设置和仓库面板增加查询参数入口与 history 支持，覆盖直接访问、站内打开、关闭和前进后退。
- React DOM 移入带内容哈希的共享分块；哈希分块使用 immutable 缓存，固定入口和 CSS 仍需重新验证。后端只提供构建 manifest 中的资源，不开放任意磁盘路径或构建分析文件。
- 公共 facade 保持 Mantine 公共 API；构建插件依据锁定版本的官方 ESM 导出解析到相同模块，避免公共 barrel 让仅供弹窗使用的 Modal、NumberInput 提前进入首屏。无法解析的导出会使构建失败。没有修改依赖目录。
- 样式按官方顺序保留 baseline、默认变量和 global，再加载 ScrollArea、UnstyledButton、Popover、Input、Combobox、ModalBase、Overlay 等依赖与实际组件样式，最后加载应用样式。构建检查验证所有保留的 Mantine class map 在 CSS 中存在，包含 Checkbox 的附属组件和 Loader 动画。
- 保留 1254×1254 的原始项目图标，只将 HTML favicon 改为原图派生的 32×32 PNG（`sips -z 32 32 assets/app-icon.png --out assets/favicon.png`）；构建与运行无需 sips。

## 测量口径与结果

单位为字节，gzip 为每个文件独立执行 level 9 后相加，未把多个文件拼接压缩。首屏统计包含 HTML 模板、所有静态 JS/CSS 传递依赖、两个原有脚本和 favicon；排除按需模块、sourcemap、API 响应与用户图标。当前服务器没有开启 HTTP gzip，因此 gzip 是压缩潜力比较指标，原始字节量更接近未压缩下载量；HTML 模板中的 nonce 占位符长度与实际响应略有不同。

| 范围                                        | 优化前原始 | 优化后原始 | 优化前逐文件 gzip | 优化后逐文件 gzip |
| ------------------------------------------- | ---------: | ---------: | ----------------: | ----------------: |
| 完整首屏静态依赖                            |  3,258,761 |    680,630 |         2,621,382 |           194,280 |
| 首屏 JS + CSS（含两个原有脚本）             |    862,485 |    677,072 |           224,577 |           190,891 |
| 全部构建 JS + CSS（含按需代码及额外 entry） |    862,485 |    739,060 |           224,577 |           214,570 |

完整首屏原始量减少 79.1%，逐文件 gzip 减少 92.6%，其中大部分来自 favicon。独立排除 favicon 后，首屏 JS/CSS 原始量减少 21.5%，gzip 减少 15.0%。按需拆分减少的是首屏下载，后续打开面板仍需要下载浮层共享代码和对应面板代码；表中全部构建量包含不被页面请求的 `react-runtime.js` 导出包装入口，不能将首屏减少量当作所有页面永远不再下载的代码量。

基线逐文件明细：

| 资源                   |      原始 |      gzip |
| ---------------------- | --------: | --------: |
| `/`                    |       523 |       331 |
| `/ui/app.js`           |   602,542 |   185,643 |
| `/ui/app.css`          |   254,719 |    36,887 |
| `/client.js`           |     3,397 |     1,373 |
| `/project-tree.js`     |     1,827 |       674 |
| `/assets/app-icon.png` | 2,395,753 | 2,396,474 |

优化后全部明细：

| 资源                                  | 加载阶段        |    原始 |   gzip |
| ------------------------------------- | --------------- | ------: | -----: |
| `/`                                   | 首屏            |     530 |    338 |
| `/client.js`                          | 首屏            |   3,397 |  1,373 |
| `/project-tree.js`                    | 首屏            |   1,827 |    674 |
| `/assets/favicon.png`                 | 首屏            |   3,028 |  3,051 |
| `/ui/app.js`                          | 首屏            |  33,491 | 10,960 |
| `/ui/react-runtime.js`                | 按需 / 额外产物 |     195 |    151 |
| `/ui/chunks/chunk-5NVHNXZA.js`        | 首屏            | 209,010 | 65,128 |
| `/ui/chunks/Settings-TWDV6A7C.js`     | 按需 / 额外产物 |   4,776 |  2,029 |
| `/ui/chunks/Editor-UJ3BF3VP.js`       | 按需 / 额外产物 |   2,413 |  1,309 |
| `/ui/chunks/Organization-JWBDD53O.js` | 按需 / 额外产物 |   2,308 |  1,253 |
| `/ui/chunks/Repositories-KT547L7W.js` | 按需 / 额外产物 |   6,446 |  2,638 |
| `/ui/chunks/chunk-5H4NUGR6.js`        | 首屏            |     270 |    224 |
| `/ui/chunks/chunk-4EJXPPV4.js`        | 按需 / 额外产物 |  45,850 | 16,299 |
| `/ui/chunks/chunk-ZZM62Z5U.js`        | 首屏            | 293,000 | 89,441 |
| `/ui/chunks/chunk-E6URHSBL.js`        | 首屏            |  12,393 |  4,395 |
| `/ui/app.css`                         | 首屏            | 123,684 | 18,696 |

基线与结果快照保存在 `docs/bundle-baseline.json`、`docs/bundle-optimized.json`；每次构建重新生成 `dist/bundle-report.json` 与 `build-meta.json`。回归检查限制完整首屏 gzip 小于 205,000 字节，并要求独立的 JS/CSS gzip 比基线至少减少 12%，同时防止懒加载面板、Modal 和 NumberInput 回流首屏。

## Sourcemap 与兼容修复

原构建关闭了 sourcemap；现为所有生成的 JS/CSS 输出 linked map 并包含源内容。此项目使用 esbuild，是纯客户端应用，没有 Rollup，也未复现所述 Mantine `use client` 映射警告，因此没有应用指令替换或任何警告过滤。构建警告必须为空，回归检查以生成代码中的实际字符坐标验证应用标题、Mantine Select 与 Modal 能定位回对应 JSX/上游 TSX 原文行，所有块的 map 均存在。

懒加载弹窗首次挂载为已打开时，Mantine 的 focus-return 钩子不会记录触发按钮。公共 Modal 适配层先建立关闭状态再打开，恢复 Escape/关闭后的触发器焦点。保留 nonce 同时授权 Mantine 样式和 react-style-singleton 的滚动锁定样式。分组选择使用公共 Autocomplete，按 combobox 角色定位，验证过滤、长选项、方向键、Enter、Escape 与焦点，而非只替换测试定位器。

## 隔离验证

开发、依赖、构建输出位于独立 Git worktree；npm 缓存为独立临时目录，包缓存通过完整性校验后复制，没有指向线上依赖的符号链接。前端类型检查、构建、依赖单例检查、包体积/样式/sourcemap 检查通过。57 项后端与模型测试通过，12 项 Playwright 回归通过。

浏览器使用 `127.0.0.1:19431` 的独立 origin、新进程和临时用户目录。后端使用自动创建的临时配置与数据目录，禁用自动启动和仓库定时检查。大部分 API 使用合成数据，另有临时项目目录中的真实服务发现、启停、归组、设置保存后重新打开、展示信息保存后重新打开与磁盘读回。没有真实采集、账号写入或在线项目写入。

视觉检查包括 1440×1000 桌面和 1080×900 较窄桌面：普通与长文本、焦点、禁用 Select/按钮、箭头留白、可搜索分组菜单、浮层边界、设置弹窗、仓库同步以及编辑表单。未额外测试移动端。项目没有 Drawer、确认对话框或浏览器扩展，这些场景不适用。

任务前后核对原服务：监听 `127.0.0.1:4310`，后端 PID `22086`、启动进程 PID `22080`，工作目录为既有独立发布产物，在线依赖与构建资源均在该产物下，数据仍在 `~/Library/Application Support/control-panel/`。没有重新加载原浏览器页面、切换发布版本或重启原进程。仍需用户另行安排部署；本次未做线上验收新构建。
