import { LoaderCircle, X } from 'lucide-react'

const STAGES = ['校验节点与连线', '构建物料平衡', '求解物料流量', '汇总功率结果']

export function CalculationModal({
  open,
  stage,
  elapsedSeconds,
  onCancel
}: {
  open: boolean
  stage: number
  elapsedSeconds: number
  onCancel: () => void
}): React.JSX.Element | null {
  if (!open) return null
  const percent = Math.max(8, Math.min(100, ((stage + 1) / STAGES.length) * 100))
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="calculation-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <span className="eyebrow">Material Balance</span>
            <h2>正在计算整条产线</h2>
          </div>
          <span className="elapsed">{elapsedSeconds.toFixed(1)}s</span>
        </header>

        <div className="progress-track" aria-label="计算进度">
          <i style={{ width: `${percent}%` }} />
        </div>

        <ol className="calculation-stages">
          {STAGES.map((label, index) => (
            <li
              key={label}
              className={
                index < stage ? 'done' : index === stage ? 'active' : 'pending'
              }
            >
              <span>{index + 1}</span>
              <strong>{label}</strong>
              {index === stage && <LoaderCircle size={14} className="spinner" />}
            </li>
          ))}
        </ol>

        <footer>
          <p>求解在后台执行，编辑器状态不会被修改。</p>
          <button className="cancel-calculation" onClick={onCancel}>
            <X size={15} />
            取消计算
          </button>
        </footer>
      </section>
    </div>
  )
}
