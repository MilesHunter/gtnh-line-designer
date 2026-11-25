# AGENTS.md — GTNH Line Designer 项目理解与协作约定

> 面向在本仓库工作的 AI 代理与工程师。
> 最后同步：2026-11-25 · 版本 `0.3.0` · 工作区状态以 `git status` 为准。
> 若本文与 `git status`、[package.json](package.json) 或源码不一致，以后者为准。
> 阅读顺序：本文件 → [README.md](README.md) → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) → 按任务读源码与专项文档。

## 1. 项目定位

GTNH Line Designer 是面向 GregTech: New Horizons 的**本地可视化产线设计器**。Electron 主进程负责便携目录、数据下载/导入、项目文件与图标协议；React 渲染进程负责节点画布、搜索、检查器和结果展示；Web Worker 负责 data v7 解析、索引、预览、校验与 LP 求解。

核心使用方式：

- 一台**具体机器**节点最多安排一个配方；可以先放置空节点再在检查器里选择该机器支持的配方，也可以从配方搜索直接创建已配置节点。
- 玩家手动建立拓扑，不自动展开上游依赖树；整线流量只在点击“计算”后求解。
- 编辑参数后只更新单节点理论预览；旧求解结果保留并标记“已过期”，不自动重算。
- 配方数据不随应用分发：用户在线下载 data v7，或从本机 GTNH 实例经 NESQL 导出后转换。
- 发布形态是 Windows x64 免安装便携包；核心数据、项目、设置和日志放在程序目录，不写 `%APPDATA%`。

明确不属于本项目的工作：完整电网/自动发电平衡、自动启动游戏、自动展开完整上游依赖树、公开再分发 GTNH 配方数据。这些边界来自 [README.md](README.md) 与 [CHANGELOG.md](CHANGELOG.md)，不要在新功能中悄悄越过。

当前版本：`0.3.0`（2026-11-25 发布）。

## 2. 快速开始与命令

环境：

- Windows x64；Node.js 22 或更新版本（当前开发环境为 v24）；npm。
- 日常开发只需要 Node；只有重建集成资源或打便携包才需要 JDK 17、JDK 8、.NET 8 与网络下载。
- 仓库没有 ESLint/Prettier；TypeScript `strict` 与现有文件风格是主要门禁。

| 命令 | 作用 | 注意 |
| --- | --- | --- |
| `npm install` | 安装依赖 | 使用 `package-lock.json` |
| `npm run dev` | electron-vite 开发模式 | 开发态应用根目录是仓库根，`data/`、`workspace/`、`logs/` 在仓库内 |
| `npm run typecheck` | 分别检查 Node 侧与 Web 侧 | `tsconfig.node.json` + `tsconfig.web.json` |
| `npm test` | Vitest 运行 `src/**/*.test.ts` | Node 环境；真实数据/实例相关测试缺少目标时会跳过 |
| `npm run build` | typecheck + electron-vite 构建 | 输出到 `out/`，不生成便携包 |
| `npm run smoke:ui` | build 后启动 Electron 做 UI 冒烟 | 需要本机已有数据缓存；截图写入 `artifacts/`；会临时备份并恢复 `data/selected.json` 与 `workspace/autosave.gtnhgraph` |
| `npm run integrations:build` | 重建 NESQL 与 data v7 转换器 | 需要 JDK 17、JDK 8、.NET 8；写入被忽略的 `resources/integrations/`；耗时且会下载 Gradle/依赖 |
| `npm run package` | 生成 Windows 便携 ZIP | 包含 build、Electron 二进制、integrations、electron-builder、ZIP 和归档校验，耗时最长 |
| `npm run verify:portable` | 校验便携 ZIP 内容 | 检查是否混入数据、项目、日志、NESQL 数据库或 `.partial` 文件 |

运行目录：`data/`（缓存与设置）、`workspace/`（自动保存）、`logs/`（运行时日志目录）、`artifacts/`（冒烟截图）、`out/`（构建产物）、`release*/`（打包产物）、`resources/integrations/`（集成资源）都被忽略提交。便携版的数据根目录是**程序所在目录**，不回落 `%APPDATA%`。

## 3. 进程与目录地图

```text
Renderer (React Flow + Zustand)
  ├─ preload: window.gtnh (AppApi)
  │     └─ Main: DataManager / LocalExportManager
  └─ Web Worker: GtnhEngine
        └─ fetch gtnh-data://current/data.bin.gz
```

| 路径 | 职责 |
| --- | --- |
| `src/main/index.ts` | 窗口、IPC handler、项目/PNG 对话框、`gtnh-data` 协议 |
| `src/main/data-manager.ts` | 便携目录、在线数据下载、缓存校验、`selected.json`、自动保存 |
| `src/main/local-export-manager.ts` | 本机实例识别、NESQL 事务式准备/恢复、导出检测、转换与本地缓存 |
| `src/main/download-utils.ts` | Range 续传、镜像回退、SHA-256、目录替换重试 |
| `src/preload/index.ts` | 通过 `contextBridge` 暴露 `window.gtnh` |
| `src/shared/types.ts` | `AppApi`、项目/数据/Worker 协议与结果的唯一类型契约 |
| `src/renderer/src/workers/gtnh.worker.ts` | Worker 消息分发 |
| `src/renderer/src/lib/worker-client.ts` | Worker 请求/响应关联与错误传播 |
| `src/renderer/src/core/engine.ts` | 索引、搜索、预览、校验、LP 求解 |
| `src/renderer/src/core/model.ts` | 配方模型与机器 choice 校验 |
| `src/renderer/src/core/vendor/` | 改编自 GTNH Calculator 的 data v7 仓库解析与机器规则 |
| `src/renderer/src/core/machine-names.ts` | 机器中文名、单/多/巨分类、单方块机器族 |
| `src/renderer/src/core/layout.ts` | dagre 自动排版 |
| `src/renderer/src/store/project-store.ts` | 项目、预览、求解结果、选择、增量撤销历史 |
| `src/renderer/src/components/` | 节点、搜索、检查器、分析栏、数据/导入弹窗 |
| `src/renderer/src/App.tsx` | 画布、快捷键、计算流程、自动保存、输入输出编排 |
| `scripts/` | 集成构建、便携打包、归档校验、UI smoke |
| `docs/` | 架构、数据来源、发布流程与发布索引 |
| `.github/workflows/` | CI 与自动发布 |

Electron 安全边界：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。渲染进程只能使用 preload 暴露的 `window.gtnh`；新增能力必须同时改 `AppApi`、preload、main handler 和调用方。

`gtnh-data` 协议只允许 `data.bin.gz` 与 `atlas.webp`，hostname 为 `current` 或具体 commit。预加载构建为 CJS（`index.cjs`），BrowserWindow 的路径与输出名绑定，改动时需同步。

## 4. 领域模型与数据流

- **data v7**：`Repository` 解析 items、fluids、oreDicts、recipeTypes、recipes；`data.bin.gz` 由 Worker 用 `DecompressionStream('gzip')` 解压；`atlas.webp` 按 32px 网格、256 列取图标。
- **数据缓存**：`data/cache/<commit>/{data.bin.gz,atlas.webp,manifest.json}`；`data/selected.json` 指向当前 commit；本机导入状态在 `data/local-source.json`。
- **manifest**：记录 ref、commit、dataVersion、下载时间、大小与 SHA-256；本机导出的 commit 形如 `local-<fingerprint>`，并带实例路径、NESQL profile/版本、转换器版本等来源字段。
- **项目格式**：`ProjectDocument` schema v2。节点含具体 `machine`、可选 `recipeId`、位置、速率模式、机器数、目标端口/速率、电压、choices、overrides；边含源/目标端口、优先级、启用状态；另有视口、时间单位、数据版本信息。
- **`.gtnhgraph`** 只保存配置，不嵌入完整配方或图标数据。旧 v1 项目在打开时通过当前数据解析具体机器并迁移；缺失配方/机器保留并标记，不静默删除。
- **Worker 协议**定义在 `src/shared/types.ts`：`load`、`search`、`goods-search`、`machine-search`、`exact-recipe-search`、`machine`、`recipe`、`preview`、`validate`、`solve`。新增请求必须同步 engine、worker、client 和类型。
- **编辑与预览**：编辑 → store 更新项目 → UI 防抖批量发 `preview`（每批 16 个节点）→ 节点显示理论端口吞吐/功率/建议机器数；预览不参与整线流量分配。
- **计算**：点击“计算” → `validate` → 清理端点不存在的悬空边 → 有错误则高亮并阻止求解 → `solve` → 结果写入 store。修改拓扑或配置后结果标记过期，旧值保留。
- **速率单位**：内部统一“每分钟”；分/秒/小时/tick 只在显示层通过 `src/renderer/src/lib/project.ts` 转换。
- **自动保存**：`dirty` 且 Worker 已加载时每 8 秒写入 `workspace/autosave.gtnhgraph`；启动时只在项目为空且数据 commit 匹配当前选择时恢复。

## 5. 必须保持的产品与计算不变量

1. 一个节点 = 一台具体机器 + 至多一个配方；空节点合法，但计算前必须有配方。
2. 计算只由用户触发；修改拓扑或配置后旧结果保留并标记“已过期”，不自动重算。
3. 先校验再求解：空节点、缺配方、机器不兼容、电压不足、目标无效、连线不兼容都会阻止求解并高亮；悬空边静默清除。
4. 单节点预览与整线求解分离；预览值不参与边流量分配。
5. 电压低于配方原始等级时节点无效；只有高于基础等级才超频。单方块走普通超频；多方块按机器规则叠加并行上限；线圈/外壳只对支持该 choice 的多方块开放；EBF 热量在 `validateHeat` 校验。
6. 概率产出按 `amount × probability × recipesPerMinute` 计入；容器物品拆成“容器流体 + 空容器”两个端口；矿辞输入接受其成员物品。
7. 单方块按机器族合并基础/进阶/精英等电压变体，显示一个代表入口，节点仍保存具体 item id；多方块与 Mega 不按等级合并。
8. 求解使用 LP：目标最小化外部输入/输出（惩罚 1e6），边优先级通过降低边成本影响分配；检出回收环；无可行解时返回错误。
9. 功率是各节点 `EU/t` 的汇总，按电压等级分组，不构成电网潮流或发电平衡。
10. 机器数量允许小数，向上取整只作为建造建议；利用率 = 机器数 / 建议机器数。
11. 删除节点或更换配方会删除相关边；缺失配方/机器不会静默删除节点。
12. 性能验收规模为 500 节点、1,000 条边；画布只渲染可见节点、按对象身份复用节点、拖动只替换被移动节点、撤销历史只记录变化的节点/边。

注意：`engine.ts` 的 `buildRecipeModel` 与 `computeFactor` 各自推导超频/并行/时长修正，修改规则时必须两处同步，或先重构为单一实现。

## 6. 数据获取与本机 NESQL 导入

**在线数据**

- 默认分支/commit 与固定 SHA-256 来自 `src/shared/types.ts` 和 `src/main/data-manager.ts`；只支持 data v7。
- 流程：解析 commit → 下载到 `.part`（超时、重试、Range 续传）→ 默认分支有镜像回退 → 校验 gzip 与 v7 → 校验 SHA-256 → 原子移动 → 更新 `selected.json`。
- 自定义 ref 不走镜像；默认分支解析失败会回退到固定 commit；旧 data 版本会明确拒绝。
- 缓存读取时重新校验两个文件的 SHA-256；校验失败视为无效缓存。

**本机 NESQL 导入**

- 绑定包含 `mods` 的 GTNH `gameDir`；根据版本/模组选择 `modern` 或 `gtnh-2.8.4` profile（对应 NESQL `0.5.7` / `0.5.6-ShadowTheAge`）。
- 准备阶段把 BugTorch 和冲突 NESQL JAR 事务性移动到 `<gameDir>/.gtnh-line-designer/sessions/<id>/disabled`，安装对应 NESQL；要求至少 2 GB 可用空间。
- 游戏由用户手动启动并执行 `/nesql <repo>`；应用只读取 `logs/latest.log`、检查数据库/图片稳定性，不启动游戏、不操作存档。
- 转换器输出 data v7 与 WebP 图集，校验后写入 `data/cache/local-<fingerprint>/`，并更新 `selected.json`。
- 结束后可“恢复游戏模组”：校验哈希后删除复制进去的 JAR；按记录哈希检查冲突并恢复被移动的文件；导出数据和本地缓存仍保留。

**边界**：不提交、不随 Release 分发配方数据；本机数据只适用于对应整合包版本与模组集合；NESQL 为 LGPLv3，转换器与解析逻辑来自 MIT 的 GTNH Calculator。详见 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 7. 修改约定与任务地图

- 用户可见文案一律中文；类型、变量、文件名英文。项目自有代码风格为 2 空格缩进、JS/TS 字符串单引号（JSX 属性按常规双引号）、无分号；`core/vendor/` 保留上游 4 空格/分号/双引号风格，不要整体格式化。
- 文件命名：组件 PascalCase（`RecipeNode.tsx`），模块 kebab-case（`project-store.ts`），函数 camelCase。
- `@renderer` / `@shared` 别名已配置，但现有代码统一使用相对路径；新增代码沿用相对路径，避免混用。
- 提交信息现有风格为英文祈使句、首字母大写；不要自动提交，除非用户明确要求。

| 任务 | 主要改动位置 | 配套 |
| --- | --- | --- |
| 新增/修改机器规则 | `src/renderer/src/core/vendor/machines.ts` → `src/renderer/src/core/engine.ts` | 对应测试，保留第三方来源说明 |
| 新增机器中文名/分类 | `src/renderer/src/core/machine-names.ts` | `src/renderer/src/core/machine-names.test.ts` |
| 新增 Worker 请求 | `src/shared/types.ts` → `src/renderer/src/workers/gtnh.worker.ts` → `src/renderer/src/lib/worker-client.ts` → `src/renderer/src/core/engine.ts` | 调用方与类型检查 |
| 新增 IPC | `src/shared/types.ts` 的 `AppApi` → `src/preload/index.ts` → `src/main/index.ts` | 渲染进程调用方 |
| 新增项目字段 | `src/shared/types.ts` → `src/renderer/src/lib/project.ts`（创建/迁移/克隆）→ store → engine | 破坏兼容时提升 schema 并提供迁移 |
| 新增/调整数据字段 | `src/shared/types.ts` → `src/main/data-manager.ts` / `src/main/local-export-manager.ts` → UI | 缓存与旧数据兼容 |
| UI/交互 | `src/renderer/src/components/`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css` | 同步 `scripts/ui-smoke.mjs` 的选择器 |
| 自动排版 | `src/renderer/src/core/layout.ts` | 节点宽高/可见端口数必须与 `src/renderer/src/components/RecipeNode.tsx` 一致，更新 `src/renderer/src/core/layout.test.ts` |

数据安全：状态文件用临时文件 + rename 原子写入；不静默删除用户项目或缓存；失败时保留可恢复状态。

Worker 侧的 `engine`/`vendor` 不得引入 Electron 或 Node 的 `fs`/`path`；数据只能通过 `fetch` 自定义协议进入。性能护栏：避免修改时整图深拷贝、避免每节点重复请求、保持预览批量和可见区域渲染。

## 8. 测试、验收与发布

| 测试文件 | 覆盖内容 |
| --- | --- |
| `engine.test.ts` | v7 头解析、拒绝非 v7、choice 夹取 |
| `engine.integration.test.ts` | 有本机数据时加载真实仓库并求解；固定断言 items 50,811 / fluids 1,476 / recipeTypes 176 / recipes 221,760；无缓存自动跳过 |
| `machine-names.test.ts` | 中文译名、机器族合并、单/多/巨分类、tooltip 判定 |
| `layout.test.ts` | 左右分层、分支、环/孤立节点、高度估算 |
| `project.test.ts` | 项目创建、时间单位换算、v1→v2 迁移 |
| `project-store.test.ts` | 只替换移动节点、换配方删边、拖动历史、整次自动排版一步撤销、配置更新不复制无关节点 |
| `download-utils.test.ts` | Range 续传、服务端忽略 Range、目录替换重试 |
| `local-export-manager.test.ts` | 实例识别、可逆事务、2.8.4 profile、导出完成判定、失败回滚、真实实例条件测试 |

UI smoke 覆盖：机器搜索、空节点、精确配方、机器选择折叠、检查器布局、连线、自动排版、计算弹窗、无效节点阻止计算、离心机机器族合并；截图在 `artifacts/`。

提交前本地门槛：`npm run typecheck`、`npm test`、`npm run build`；有数据缓存时再跑 `npm run smoke:ui`；只有发布前才跑 `npm run package`。CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 windows-latest 执行 install/typecheck/test/build，不跑 smoke/package。

发布：推送 `v*` tag 触发 [.github/workflows/release.yml](.github/workflows/release.yml)，要求 tag 与 `package.json` 版本一致，执行 typecheck/test/package，上传便携 ZIP 与 `SHA256SUMS.txt`，正文优先读 `docs/RELEASE_NOTES_v<tag>.md`。发布后必须更新 [docs/RELEASES.md](docs/RELEASES.md)；`CHANGELOG.md` 的 Unreleased 不得混入已发布内容；未发布功能不得写成已发布。

## 9. 已知陷阱与当前状态

- UI 的端口兼容检查（`App.tsx` 的 `portsCompatible`）只做粗判：目标为矿辞且源为物品即允许；Worker 的 `areCompatible` 会检查矿辞成员，最终以 `validate` 为准。
- `engine.ts` 的超频/并行逻辑存在 `buildRecipeModel` 与 `computeFactor` 两处推导，必须同步。
- 单方块/多方块分类依赖名称规则与 tooltip（中英文）；数据缺少 tooltip 时可能误判，新增分类规则要补测试。
- `resources/integrations/` 被忽略，首次打包前必须 `npm run integrations:build`；不要手工编辑生成物。
- 数据默认版本与 SHA 是刻意固定的；改 pin 需要重新验证下载、缓存校验与集成测试断言。
- `docs/RELEASES.md` 记录已发布版本；发版后必须回填 Commit、ZIP SHA-256 与状态。
- 0.3.0 包含：机器族合并、单/多/巨分类、自动排版、圆角折线、配方选定后收起机器列表、检查器只读机器摘要、原生截屏 PNG 导出。
- PNG 导出当前只覆盖当前视图和窗口原生分辨率；整图/高分辨率 Canvas 2D 导出见 [docs/ROADMAP.md](docs/ROADMAP.md)。
- LP 数值容差为 `1e-7`；边优先级是次要目标，外部流量惩罚才是主要目标；有警告但可解时状态为 `partial`。
- 功率汇总不是电网平衡；不要把它描述成“供电是否足够”。
- `smoke:ui`、集成测试和本机导入测试依赖本机数据/实例；在 CI 或新机器上会跳过/失败，需先准备数据。本机导入测试中的真实实例绝对路径只存在于测试里，不要复制到文档或提交信息中。

## 10. 维护本文件

| 触发条件 | 更新位置 |
| --- | --- |
| 命令/脚本变化 | 第 2、8 节 |
| 进程边界、IPC、Worker 协议、项目 schema 变化 | 第 3、4、7 节 |
| 计算/超频/并行/功率规则变化 | 第 5、9 节 |
| 数据源、固定 commit/SHA、NESQL profile、转换器变化 | 第 6、9 节 |
| 发布流程或版本状态变化 | 第 8、9 节与开头时效声明 |
| 新增已知陷阱 | 第 9 节，写明触发条件与验证方式 |

同步矩阵：`README.md`（功能列表/使用步骤）、`CHANGELOG.md`（Unreleased）、`docs/ARCHITECTURE.md`（流程/图）、`docs/DATA_SOURCES.md`（来源/许可证）、`docs/RELEASES.md`（仅发布后）、本文件（综合理解/规则/当前状态）。

每次修改本文件：更新开头“最后同步”日期与 HEAD；检查相对链接；删除已失效的“当前状态”；控制在约 240 行内，细节链接到现有文档。不要写入本机绝对路径、用户名、令牌、会快速过期的下载校验值或完整机器/物品清单。

同步记录：

- 2026-11-08：创建本文件，对应 0.2.0 已发布状态与工作区未发布改动。
- 2026-11-25：同步 0.3.0 发布内容、PNG 原生截屏导出与 Canvas 2D 导出规划。
