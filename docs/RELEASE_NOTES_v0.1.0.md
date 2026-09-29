# GTNH Line Designer 0.1.0

首个公开版本，提供本地节点式 GTNH 产线设计、手动物料求解和 data v7 数据管理。

## 下载

下载 `GTNH-Line-Designer-0.1.0-portable-x64.zip`，解压到可写目录后运行 `GTNH Line Designer.exe`。

SHA-256:

`F98574742C0D50C2A99D03F61272E8B718E6668C03530A9A066FFB62898EDDDE`

## 包含

- 节点式配方编辑器和端口连线
- 按产物搜索和按原料搜索
- 手动点击求解
- 外部原料、外部盈余和功率汇总
- 超频、线圈、并行、融合机和机器专属参数
- `.gtnhgraph` 项目保存、自动保存和 PNG 导出
- GTNH data v7 在线下载
- GTNH 2.9.x 本机 NESQL 导入
- GTNH 2.8.4 本机 NESQL 导入
- 离线数据缓存和版本切换

## 不包含

- GTNH 配方数据包
- `data.bin.gz`
- `atlas.webp`
- NESQL 原始数据库
- 用户世界、存档和项目数据

首次启动需要选择在线数据版本，或使用本机 GTNH 实例执行一次 NESQL 导入。

## 已知限制

- 本机导入不会自动启动游戏。
- NESQL 配方范围受上游 exporter plugin 限制。
- 用户添加额外模组后需要重新导入数据。
- 2.9.0-beta-3 已端到端验证；2.8.4 使用独立构建并通过真实实例导出验收。
