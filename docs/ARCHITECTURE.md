# Architecture

## 进程结构

应用分为三个主要运行区域：

1. Electron 主进程负责便携目录、数据版本、文件选择、项目文件、PNG 导出和本机实例导入。
2. 渲染进程负责 React 界面、节点画布、项目状态和检查器。
3. Web Worker 负责 data v7 二进制解析、物品与配方索引、搜索和求解。

## 数据流程

### 在线数据

1. 数据管理器从 GitHub 解析固定 Commit。
2. `data.bin` 和 `atlas.webp` 下载到持久化 `.part` 文件。
3. 校验 SHA-256。
4. 原子移动到 `data/cache/<commit>/`。
5. 更新 `data/selected.json`。

### 本机 NESQL 导入

1. 用户绑定包含 `mods` 的 GTNH `gameDir`。
2. 应用根据版本和模组文件选择 NESQL 配置。
3. 准备导出环境时，BugTorch 和冲突 JAR 被移动到可恢复 session 目录。
4. 用户手动启动游戏并执行 `/nesql <repo>`。
5. 应用检查日志、数据库和图片文件稳定性。
6. 内置转换器将 HSQLDB 导出转换为 data v7 和 WebP 图集。
7. 成功数据写入独立的 `local-<fingerprint>` 缓存。

## 图和求解

`ProjectDocumentV1` 保存节点、边、位置、视图和求解设置。节点引用配方 ID，不嵌入完整配方和图标数据。

求解完全由用户触发。每次点击“计算”时，Worker 根据节点配置构建物料和功率方程，通过 `javascript-lp-solver` 计算：

- 节点实际速率
- 边流量
- 外部原料
- 外部盈余
- 概率产出
- 回收环
- 各节点和电压等级功率

拓扑、节点配置或连线变化后，旧求解结果立即失效，等待下一次手动计算。

## 便携目录

```text
data/
  cache/<commit>/
  selected.json
  settings.json
  local-source.json
workspace/
logs/
```

应用启动时检查自身目录是否可写。运行时不回退到 `%APPDATA%` 保存配方数据。
