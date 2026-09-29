# Data Sources and Third-Party Components

## GTNH Calculator

Repository: <https://github.com/ShadowTheAge/gtnh>

用途：

- data v7 仓库格式和二进制解析思路
- 机器定义、电压等级和选择项
- 超频、并行和机器专属计算参考
- data v7 转换器

许可证：MIT License

转换器固定提交：

`af8c79888ec859913b27543c1381c3c11c24658f`

## GTNH Data

Repository: <https://github.com/ShadowTheAge/gtnh-data>

用途：

- 在线下载的 `data.bin`
- 在线下载的图标图集

该仓库说明：

- 导出文件包含 Minecraft、GTNH 和各模组派生的图标与文本。
- 内容归 Mojang、GTNH 开发团队和相关模组作者所有。
- 仓库没有提供再分发许可证，仅声明用于 GTNH Calculator 的非商业、教育和互操作用途。

本项目不把该数据仓库内容提交到 Git，也不在 Release 中附带配方数据包。

## NESQL Exporter

Repository: <https://github.com/ShadowTheAge/nesql-exporter>

上游项目：<https://github.com/D-Cysteine/nesql-exporter>

许可证：GNU LGPL version 3

本项目包含两个固定构建：

### GTNH 2.9.x

Commit:

`b5b896ebd9bcf4cfe1f4fad19ccdc7de8414ee57`

Version:

`0.5.7-ShadowTheAge`

### GTNH 2.8.4

Commit:

`9f467e16ad40bfa4e7ff042e986579b1d416a9ea`

Version:

`0.5.6-ShadowTheAge`

2.8.4 构建目标：

- Minecraft 1.7.10
- NEI `2.8.44-GTNH`
- GregTech `5.09.51.482`

两个构建均应用了 JDK logging provider 兼容修正，以避免 GTNH 的 Log4j 2 beta 与 Hibernate 的 JBoss Log4j2 bridge 冲突。

源码归档和 LGPLv3 许可证随 Release 内的 NESQL 资源一并提供。

## Minecraft and GTNH Mods

本机导出流程从用户自己安装的 GTNH 实例读取 NEI 和 GregTech 注册数据。

导出的名称、图标、工具提示和配方内容可能来自：

- Mojang
- GT New Horizons 团队
- GregTech 及相关模组作者
- NotEnoughItems 及相关扩展

这些内容不提交到 Git 仓库，也不应默认随项目公开再分发。

## JavaScript and Electron Dependencies

主要依赖：

- Electron
- React
- TypeScript
- React Flow / `@xyflow/react`
- Zustand
- Lucide
- TanStack Virtual
- `javascript-lp-solver`
- `html-to-image`

完整依赖树和版本见 `package.json` 与 `package-lock.json`。各依赖适用其自身许可证。
