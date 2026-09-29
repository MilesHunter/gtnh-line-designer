import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Zap } from 'lucide-react'
import type { SolveResult } from '../../../shared/types'
import { AtlasIcon } from './AtlasIcon'
import { formatPower, formatRate } from '../lib/project'

interface AnalysisPanelProps {
  result: SolveResult | null
  timeUnit: 'hour' | 'min' | 'sec' | 'tick'
}

const VOLTAGE_NAMES = [
  'LV',
  'MV',
  'HV',
  'EV',
  'IV',
  'LuV',
  'ZPM',
  'UV',
  'UHV',
  'UEV',
  'UIV',
  'UMV',
  'UXV',
  'MAX'
]

export function AnalysisPanel({
  result,
  timeUnit
}: AnalysisPanelProps): React.JSX.Element {
  return (
    <section className="analysis-panel">
      <div className="analysis-group">
        <header>
          <ArrowDownToLine size={15} />
          <strong>外部原料</strong>
          <span>{result ? result.externalInputs.length : '—'}</span>
        </header>
        <div className="analysis-items">
          {result?.externalInputs.slice(0, 8).map((flow) => (
            <div className="analysis-item" key={`${flow.port.nodeId}-${flow.port.portKey}`}>
              <AtlasIcon iconId={flow.goods.iconId} size={20} />
              <span title={flow.goods.name}>{flow.goods.name}</span>
              <code>{formatRate(flow.amountPerMinute, timeUnit)}</code>
            </div>
          ))}
          {!result?.externalInputs.length && <span className="muted">暂无</span>}
        </div>
      </div>

      <div className="analysis-group">
        <header>
          <ArrowUpFromLine size={15} />
          <strong>外部盈余</strong>
          <span>{result ? result.externalOutputs.length : '—'}</span>
        </header>
        <div className="analysis-items">
          {result?.externalOutputs.slice(0, 8).map((flow) => (
            <div className="analysis-item" key={`${flow.port.nodeId}-${flow.port.portKey}`}>
              <AtlasIcon iconId={flow.goods.iconId} size={20} />
              <span title={flow.goods.name}>{flow.goods.name}</span>
              <code>{formatRate(flow.amountPerMinute, timeUnit)}</code>
            </div>
          ))}
          {!result?.externalOutputs.length && <span className="muted">暂无</span>}
        </div>
      </div>

      <div className="analysis-group power-group">
        <header>
          <Zap size={15} />
          <strong>功率需求</strong>
          <code>
            {result ? `${formatPower(result.totalPower)} EU/t` : '—'}
          </code>
        </header>
        <div className="power-bars">
          {Object.entries(result?.powerByTier ?? {}).map(([tier, power]) => (
            <div className="power-row" key={tier}>
              <span>{VOLTAGE_NAMES[Number(tier)] ?? `T${tier}`}</span>
              <div>
                <i
                  style={{
                    width: `${Math.max(
                      3,
                      (power / Math.max(1, result?.totalPower ?? 1)) * 100
                    )}%`
                  }}
                />
              </div>
              <code>{formatPower(power)}</code>
            </div>
          ))}
          {!Object.keys(result?.powerByTier ?? {}).length && (
            <span className="muted">暂无功率节点</span>
          )}
        </div>
      </div>

      <div className="analysis-group warning-group">
        <header>
          <AlertTriangle size={15} />
          <strong>求解状态</strong>
          <span>{result?.status ?? '未计算'}</span>
        </header>
        <div className="analysis-message">
          {!result && <p>尚未计算。</p>}
          {result?.error && <p>{result.error}</p>}
          {result &&
            (result.cycles.length ? (
              <p>检测到 {result.cycles.length} 个回收环，已纳入物料平衡。</p>
            ) : (
              <p>未检测到闭环。</p>
            ))}
          {result?.warnings.slice(0, 2).map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      </div>
    </section>
  )
}
