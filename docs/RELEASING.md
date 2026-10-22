# 发布流程

公开 Release 由 [.github/workflows/release.yml](../.github/workflows/release.yml) 自动构建和上传，不依赖个人 PAT。workflow 使用仓库自带的 `GITHUB_TOKEN`，所需权限仅为 `contents: write`。

## 自动发布

1. 修改 `package.json` 中的 `version`，例如 `0.2.0`。
2. 新建 `docs/RELEASE_NOTES_v0.2.0.md`。如果该文件不存在，workflow 会使用 GitHub 自动生成的 release notes。
3. 在本地验证：

```powershell
npm ci
npm run typecheck
npm test
npm run package
```

4. 提交并推送代码，然后创建并推送同名 tag：

```powershell
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

5. GitHub Actions 会构建 NESQL、转换器和便携包，校验归档内容，生成 `SHA256SUMS.txt`，然后创建或更新该 tag 对应的 Release。

Release 资产固定为：

- `GTNH-Line-Designer-<version>-portable-x64.zip`
- `SHA256SUMS.txt`

## 手动构建与重跑

在 GitHub 仓库的 **Actions → Release → Run workflow** 中：

- `tag` 留空、`publish` 关闭：只构建并上传 Actions artifact，适合验证。
- 填写已存在的 tag、`publish` 打开：重新构建并覆盖该 Release 的资产。

手动发布时，tag 必须与 `package.json` 的版本一致，例如 `v0.2.0` 对应 `0.2.0`。workflow 会在构建前检查这一点。

## 安全边界

- workflow 不使用个人 PAT 或 SSH key，因此不受个人账号 2FA 状态影响。
- `npm run package` 结束后自动执行 `scripts/verify-portable-archive.mjs`。
- 校验脚本会拒绝 `data/`、`workspace/`、`logs/`、`data.bin`、`atlas.webp`、NESQL 数据库、`.gtnhgraph` 项目和 `.partial` 下载文件。
- 公开 Release 不包含任何 GTNH 配方数据包。

如果发布步骤返回 403，请检查仓库的 **Settings → Actions → General → Workflow permissions** 是否允许读写，并把工作流权限设为 **Read and write permissions**。

## 校验下载

```powershell
Get-FileHash .\GTNH-Line-Designer-0.2.0-portable-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

两者中的 SHA-256 应完全一致。
