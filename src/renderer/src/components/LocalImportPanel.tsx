import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Clipboard,
  FolderOpen,
  FolderSearch,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Wrench
} from 'lucide-react'
import type {
  CachedDataVersion,
  DataStatus,
  ExportSession,
  LocalImportProgress
} from '../../../shared/types'

interface LocalImportPanelProps {
  status: DataStatus
  progress: LocalImportProgress | null
  onStatusChanged: (status: DataStatus) => void
  onImported: (version: CachedDataVersion) => void
}

const STATE_LABELS: Record<ExportSession['state'], string> = {
  preparing: '正在准备',
  'waiting-game': '等待手动启动游戏',
  exporting: '正在导出',
  ready: '导出完成',
  converting: '正在转换',
  imported: '已生成配方',
  restoring: '正在恢复',
  restored: '已恢复游戏环境',
  error: '发生错误'
}

function formatBytes(value: number): string {
  if (value > 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`
  if (value > 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  if (value > 1_000) return `${(value / 1_000).toFixed(0)} KB`
  return `${value} B`
}

export function LocalImportPanel({
  status,
  progress,
  onStatusChanged,
  onImported
}: LocalImportPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const session = status.exportSession

  const command = session ? `/nesql ${session.repoName}` : ''
  const logLines = useMemo(() => {
    const combined = [
      ...(session?.lastLogLines ?? []),
      ...(progress?.logTail ?? [])
    ]
    return combined.slice(-14)
  }, [progress?.logTail, session?.lastLogLines])

  useEffect(() => {
    if (
      !session ||
      !['waiting-game', 'exporting', 'error'].includes(session.state) ||
      busy
    ) {
      return
    }
    const timer = window.setInterval(() => {
      void window.gtnh.refreshExportSession().then((result) => {
        onStatusChanged(result.status)
      })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [busy, onStatusChanged, session])

  const run = async <T,>(
    operation: () => Promise<T>,
    onSuccess: (result: T) => void | Promise<void>
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      await onSuccess(result)
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : String(operationError)
      )
    } finally {
      setBusy(false)
    }
  }

  const chooseInstance = async (): Promise<void> => {
    await run(
      () => window.gtnh.chooseGameInstance(),
      async (binding) => {
        if (!binding) return
        onStatusChanged(await window.gtnh.getDataStatus())
      }
    )
  }

  const refresh = async (): Promise<void> => {
    await run(
      () => window.gtnh.refreshExportSession(),
      (result) => {
        if (result) onStatusChanged(result.status)
      }
    )
  }

  const prepare = async (): Promise<void> => {
    await run(
      () => window.gtnh.prepareNesqlExport(),
      async () => onStatusChanged(await window.gtnh.getDataStatus())
    )
  }

  const restore = async (): Promise<void> => {
    await run(
      () => window.gtnh.restoreGameInstance(),
      (nextStatus) => {
        if (nextStatus) onStatusChanged(nextStatus)
      }
    )
  }

  const convert = async (): Promise<void> => {
    await run(
      () => window.gtnh.convertLocalExport(),
      async (result) => {
        if (!result) return
        onStatusChanged(result.status)
        onImported(result.version)
      }
    )
  }

  const cleanup = async (): Promise<void> => {
    if (!window.confirm('确定删除本次约 600 MB 的 NESQL 原始导出吗？')) return
    await run(
      () => window.gtnh.cleanupLocalExport(),
      (nextStatus) => {
        if (nextStatus) onStatusChanged(nextStatus)
      }
    )
  }

  const binding = status.boundInstance
  const canPrepare =
    binding && binding.hasNei && (!session || session.state === 'restored')
  const canRestore =
    session &&
    !['restoring', 'restored'].includes(session.state) &&
    session.movedFiles.length + session.installedJars.filter((jar) => jar.copied).length >
      0
  const canConvert = session?.state === 'ready' || session?.state === 'imported'
  const canCleanup = session?.convertedCommit && session.repoName

  return (
    <section className="local-import-panel">
      <div className="local-instance-card">
        <div className="instance-icon">
          <HardDrive size={24} />
        </div>
        {binding ? (
          <div className="instance-copy">
            <strong>{binding.displayName}</strong>
            <code title={binding.gameDir}>{binding.gameDir}</code>
            <div className="instance-capabilities">
              <span className={binding.hasNei ? 'ok' : 'bad'}>
                NEI {binding.hasNei ? '已检测' : '缺失'}
              </span>
              <span className={binding.hasNesql ? 'ok' : ''}>
                NESQL {binding.hasNesql ? '已安装' : '未安装'}
              </span>
              <span className="ok">
                适配 {binding.nesqlProfileLabel ?? 'GTNH 2.9.x'}
              </span>
              <span className={binding.bugtorchFiles.length ? 'warn' : 'ok'}>
                BugTorch {binding.bugtorchFiles.length || '无'}
              </span>
            </div>
          </div>
        ) : (
          <div className="instance-copy">
            <strong>尚未绑定游戏实例</strong>
            <span>请选择 GTNH 版本目录，也就是包含 mods 的 gameDir。</span>
          </div>
        )}
        <button className="primary" disabled={busy} onClick={() => void chooseInstance()}>
          <FolderSearch size={15} />
          {binding ? '更换实例' : '选择实例'}
        </button>
      </div>

      {binding && (
        <>
          <div className="local-actions">
            <button
              className="primary"
              disabled={busy || !canPrepare}
              onClick={() => void prepare()}
            >
              <Wrench size={15} />
              准备 NESQL 导出环境
            </button>
            <button
              disabled={busy || !session}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
              刷新导出状态
            </button>
            <button disabled={busy} onClick={() => void window.gtnh.openGameDirectory()}>
              <FolderOpen size={15} />
              打开实例目录
            </button>
          </div>

          {session && (
            <div className={`export-session state-${session.state}`}>
              <div className="session-heading">
                <span className="state-pill">{STATE_LABELS[session.state]}</span>
                <strong>{session.message}</strong>
              </div>
              <div className="session-grid">
                <span>仓库名</span>
                <code>{session.repoName}</code>
                <span>导出位置</span>
                <code title={session.repoPath}>{session.repoPath}</code>
                <span>NESQL 来源</span>
                <code>
                  {session.nesqlVersion ?? '0.5.7-ShadowTheAge'}（JDK 日志桥兼容修复）
                </code>
              </div>

              <ol className="local-steps">
                <li>点击“准备 NESQL 导出环境”，应用会临时移走 BugTorch 并安装内置 NESQL。</li>
                <li>手动启动游戏，进入一个世界，打开背包让 NEI 物品列表加载完成。</li>
                <li>
                  执行
                  <button
                    className="copy-command"
                    onClick={() => {
                      void navigator.clipboard.writeText(command).then(() => {
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1400)
                      })
                    }}
                  >
                    {copied ? <Check size={14} /> : <Clipboard size={14} />}
                    <code>{command}</code>
                  </button>
                </li>
                <li>等待应用显示“导出完成”，再点击“生成本地配方”。</li>
              </ol>

              <div className="log-console">
                {logLines.length ? (
                  logLines.map((line, index) => (
                    <code key={`${index}-${line}`}>{line}</code>
                  ))
                ) : (
                  <span>等待游戏日志和导出文件状态…</span>
                )}
              </div>

              <div className="local-actions">
                <button
                  className="primary"
                  disabled={busy || !canConvert}
                  onClick={() => void convert()}
                >
                  <Wrench size={15} />
                  {session.state === 'imported'
                    ? '重新生成本地配方'
                    : '生成本地配方'}
                </button>
                <button
                  disabled={busy || !canRestore}
                  onClick={() => void restore()}
                >
                  <RotateCcw size={15} />
                  恢复游戏模组
                </button>
                <button
                  className="danger"
                  disabled={busy || !canCleanup}
                  onClick={() => void cleanup()}
                >
                  <Trash2 size={15} />
                  清理原始导出
                </button>
              </div>

              {session.convertedCommit && (
                <div className="local-version-result">
                  <Check size={15} />
                  已生成本地版本
                  <code>{session.convertedCommit.slice(0, 18)}</code>
                </div>
              )}
            </div>
          )}

          <div className="local-notes">
            <p>准备导出环境前请完全退出游戏；应用不会启动游戏或操作存档。</p>
            {binding.nesqlProfile === 'gtnh-2.8.4' && (
              <p>
                已识别 GTNH 2.8.4，将使用 NESQL 0.5.6 和 2.8.4 对应的
                NEI/GregTech 构建，不会安装面向 2.9.x 的 NESQL。
              </p>
            )}
            <p>
              HSQLDB 会在配方全部处理完后才集中提交；导出期间数据库脚本长时间不增长属于正常现象。
            </p>
            <p>成功导入后默认保留 NESQL 原始数据，方便重新生成；可手动清理。</p>
            <p>
              当前实例将使用 NESQL：
              <code>{binding.nesqlProfileVersion ?? '0.5.7-ShadowTheAge'}</code>
            </p>
          </div>
        </>
      )}

      {error && (
        <div className="error-banner">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      {status.localImport?.message && (
        <div className="local-progress-line">
          <span>{status.localImport.message}</span>
          {status.localImport.percent !== undefined && (
            <code>{status.localImport.percent}%</code>
          )}
        </div>
      )}
    </section>
  )
}
