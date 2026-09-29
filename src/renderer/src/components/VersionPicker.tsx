import { useState } from 'react'
import { Database, Download, HardDrive, RefreshCw, TriangleAlert } from 'lucide-react'
import type {
  CachedDataVersion,
  DataStatus,
  DownloadProgress,
  LocalImportProgress
} from '../../../shared/types'
import { LocalImportPanel } from './LocalImportPanel'

interface VersionPickerProps {
  status: DataStatus
  downloadProgress: DownloadProgress | null
  localProgress: LocalImportProgress | null
  downloading: boolean
  error: string | null
  required?: boolean
  onDownload: (ref: string) => void
  onSelect: (version: CachedDataVersion) => void
  onImported: (version: CachedDataVersion) => void
  onStatusChanged: (status: DataStatus) => void
  onClose?: () => void
}

function formatBytes(value?: number): string {
  if (!value) return '0 B'
  if (value > 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  if (value > 1_000) return `${(value / 1_000).toFixed(0)} KB`
  return `${value} B`
}

export function VersionPicker({
  status,
  downloadProgress,
  localProgress,
  downloading,
  error,
  required = false,
  onDownload,
  onSelect,
  onImported,
  onStatusChanged,
  onClose
}: VersionPickerProps): React.JSX.Element {
  const [customRef, setCustomRef] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [tab, setTab] = useState<'online' | 'local'>('online')
  const progressPercent =
    downloadProgress?.receivedBytes && downloadProgress.totalBytes
      ? Math.min(100, (downloadProgress.receivedBytes / downloadProgress.totalBytes) * 100)
      : null

  if (!status.writable) {
    return (
      <div className="modal-backdrop">
        <section className="version-dialog version-dialog-error">
          <TriangleAlert size={34} />
          <h1>软件目录不可写</h1>
          <p>
            数据必须保存在软件安装目录。请将便携版移动到普通用户可写目录，
            不要放在 <code>Program Files</code> 等受保护位置。
          </p>
          <code>{status.writableError}</code>
          <button
            className="primary"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} />
            重新检测
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="modal-backdrop">
      <section className="version-dialog">
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">GTNH Calculator Data</span>
            <h1>选择生产数据版本</h1>
            <p>
              数据将下载到 <code>{status.dataDirectory}</code>，不会写入
              AppData。下载完成后可完全离线使用。
            </p>
          </div>
          {!required && onClose && (
            <button
              className="icon-button"
              onClick={onClose}
              title="关闭数据管理器"
            >
              ×
            </button>
          )}
        </header>

        <div className="segmented data-source-tabs">
          <button
            className={tab === 'online' ? 'active' : ''}
            onClick={() => setTab('online')}
          >
            <Download size={15} />
            在线数据版本
          </button>
          <button
            className={tab === 'local' ? 'active' : ''}
            onClick={() => setTab('local')}
          >
            <HardDrive size={15} />
            从游戏实例导入
          </button>
        </div>

        {tab === 'online' ? (
          <>
          <div className="version-grid">
          {status.knownVersions.map((version) => {
            const installed = status.installed.find(
              (entry) => entry.ref === version.ref
            )
            return (
              <article
                key={version.ref}
                className={`version-option ${!version.supported ? 'disabled' : ''}`}
              >
                <Database size={22} />
                <div className="version-copy">
                  <strong>{version.label}</strong>
                  <span>
                    {version.ref}
                    {version.date ? ` · ${version.date}` : ''}
                  </span>
                  {!version.supported && <small>{version.reason}</small>}
                </div>
                {installed ? (
                  <button
                    className={status.selected?.commit === installed.commit ? '' : 'primary'}
                    disabled={status.selected?.commit === installed.commit}
                    onClick={() => onSelect(installed)}
                  >
                   <HardDrive size={15} />
                    {status.selected?.commit === installed.commit ? '当前版本' : '使用缓存'}
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={!version.supported || downloading}
                    onClick={() => onDownload(version.ref)}
                  >
                    <Download size={15} />
                    下载
                  </button>
                )}
              </article>
            )
          })}
          </div>

          {status.installed.length > 0 && (
            <div className="installed-list">
            <strong>已安装版本</strong>
            {status.installed.map((entry) => (
              <button
                key={entry.commit}
                className={
                  status.selected?.commit === entry.commit ? 'selected row-button' : 'row-button'
                }
                onClick={() => onSelect(entry)}
              >
                <span>{entry.ref}</span>
                <code>{entry.commit.slice(0, 10)}</code>
                <span>v{entry.dataVersion}</span>
              </button>
            ))}
            </div>
          )}

          <details
            className="custom-version"
            open={customOpen}
            onToggle={(event) =>
              setCustomOpen((event.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary>高级：使用 Git 分支、Tag 或 Commit</summary>
            <p>仅接受解压后 data format v7 的提交。</p>
            <div className="inline-form">
              <input
                value={customRef}
                onChange={(event) => setCustomRef(event.target.value)}
                placeholder="2.9.0-v7 或完整 Commit"
              />
              <button
                className="primary"
                disabled={!customRef.trim() || downloading}
                onClick={() => onDownload(customRef.trim())}
              >
                <Download size={15} />
                拉取
              </button>
            </div>
          </details>
          </>
        ) : (
          <LocalImportPanel
            status={status}
            progress={localProgress ?? status.localImport}
            onStatusChanged={onStatusChanged}
            onImported={onImported}
          />
        )}

        {tab === 'online' && downloading && (
          <div className="download-progress">
            <div className="progress-copy">
              <span>{downloadProgress?.message ?? '正在解析版本…'}</span>
              <span>
                {downloadProgress?.file === 'data' ? 'data.bin' : ''}
                {downloadProgress?.file === 'atlas' ? 'atlas.webp' : ''}
                {downloadProgress?.receivedBytes
                  ? ` ${formatBytes(downloadProgress.receivedBytes)}`
                  : ''}
              </span>
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: `${progressPercent ?? (downloadProgress?.stage === 'resolving' ? 4 : 55)}%`
                }}
              />
            </div>
            <button
              className="cancel-download"
              onClick={() => void window.gtnh.cancelDownload()}
            >
              取消下载
            </button>
          </div>
        )}

        {error && (
          <div className="error-banner">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </div>
        )}
      </section>
    </div>
  )
}
