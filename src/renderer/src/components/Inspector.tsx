import { AlertTriangle, Copy, Gauge, SlidersHorizontal, Trash2 } from 'lucide-react'
import type {
  GraphNodeV1,
  RecipeDetail,
  SolveResult
} from '../../../shared/types'
import { formatPower } from '../lib/project'
import { AtlasIcon } from './AtlasIcon'

interface InspectorProps {
  node?: GraphNodeV1
  edge?: {
    id: string
    priority: number
    enabled: boolean
  }
  detail?: RecipeDetail
  computed?: SolveResult['nodes'][string]
  onUpdateNode: (patch: Partial<GraphNodeV1>) => void
  onUpdateChoice: (key: string, value: number) => void
  onUpdateEdge: (patch: { priority?: number; enabled?: boolean }) => void
  onDelete: () => void
  onDuplicate?: () => void
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

export function Inspector({
  node,
  edge,
  detail,
  computed,
  onUpdateNode,
  onUpdateChoice,
  onUpdateEdge,
  onDelete,
  onDuplicate
}: InspectorProps): React.JSX.Element {
  if (edge) {
    return (
      <aside className="inspector">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Connection</span>
            <h2>连线设置</h2>
          </div>
        </div>
        <section className="inspector-section">
          <label className="field">
            <span>分配优先级</span>
            <input
              type="number"
              value={edge.priority}
              onChange={(event) =>
                onUpdateEdge({ priority: Number(event.target.value) })
              }
            />
            <small>数值越高，供应不足时越优先获得流量。</small>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={edge.enabled}
              onChange={(event) => onUpdateEdge({ enabled: event.target.checked })}
            />
            <span>参与求解</span>
          </label>
          <button className="danger row-button" onClick={onDelete}>
            <Trash2 size={16} />
            删除连线
          </button>
        </section>
      </aside>
    )
  }

  if (!node) {
    return (
      <aside className="inspector">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Inspector</span>
            <h2>属性检查器</h2>
          </div>
        </div>
        <div className="empty-state inspector-empty">
          <SlidersHorizontal size={28} />
          <p>选择节点或连线后可编辑详细参数。</p>
        </div>
      </aside>
    )
  }

  const machineChoices = computed?.machineInfo?.choices ?? []
  const fixedVoltage = computed?.machineInfo?.fixedVoltageTier

  return (
    <aside className="inspector">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Recipe Node</span>
          <h2>{detail?.recipeType ?? '缺失配方'}</h2>
        </div>
        <button
          className="icon-button"
          title="复制节点"
          onClick={onDuplicate}
        >
          <Copy size={15} />
        </button>
      </div>

      {computed?.warnings.map((warning) => (
        <div className="warning-banner" key={warning}>
          <AlertTriangle size={15} />
          <span>{warning}</span>
        </div>
      ))}

      <section className="inspector-section">
        <h3>生产速率</h3>
        <div className="segmented full">
          <button
            className={node.rateMode === 'machines' ? 'active' : ''}
            onClick={() => onUpdateNode({ rateMode: 'machines' })}
          >
            等效机器数
          </button>
          <button
            className={node.rateMode === 'target' ? 'active' : ''}
            onClick={() => onUpdateNode({ rateMode: 'target' })}
          >
            目标输出
          </button>
        </div>
        {node.rateMode === 'machines' ? (
          <label className="field">
            <span>机器数量</span>
            <input
              type="number"
              min="0.0001"
              step="0.1"
              value={node.machineCount}
              onChange={(event) =>
                onUpdateNode({ machineCount: Number(event.target.value) })
              }
            />
            <small>
              支持理论小数；建议建造 {computed?.recommendedMachineCount ?? '—'} 台。
            </small>
          </label>
        ) : (
          <>
            <label className="field">
              <span>目标输出端口</span>
              <select
                value={node.targetPortKey ?? ''}
                onChange={(event) =>
                  onUpdateNode({ targetPortKey: event.target.value })
                }
              >
                {detail?.outputs.map((port) => (
                  <option key={port.key} value={port.key}>
                    {port.goods.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>目标速率 / 分钟</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={node.targetRate}
                onChange={(event) =>
                  onUpdateNode({ targetRate: Number(event.target.value) })
                }
              />
            </label>
          </>
        )}
        {computed && (
          <div className="metric-grid">
            <div>
              <span>配方次数</span>
              <strong>{computed.recipesPerMinute.toFixed(4)}/min</strong>
            </div>
            <div>
              <span>建议建造</span>
              <strong>{computed.recommendedMachineCount} 台</strong>
            </div>
            <div>
              <span>负载率</span>
              <strong>{(computed.utilization * 100).toFixed(1)}%</strong>
            </div>
            <div>
              <span>平均功率</span>
              <strong>{formatPower(computed.euPerTick)} EU/t</strong>
            </div>
          </div>
        )}
      </section>

      <section className="inspector-section">
        <h3>机器与超频</h3>
        <label className="field">
          <span>机器</span>
          <select
            value={node.crafterId ?? ''}
            onChange={(event) =>
              onUpdateNode({ crafterId: event.target.value || undefined })
            }
          >
            <option value="">自动选择</option>
            {detail?.availableCrafters.map((crafter) => (
              <option key={crafter.id} value={crafter.id}>
                {crafter.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>电压等级</span>
          <select
            value={fixedVoltage ?? node.voltageTier}
            disabled={fixedVoltage !== undefined}
            onChange={(event) =>
              onUpdateNode({ voltageTier: Number(event.target.value) })
            }
          >
            {VOLTAGE_NAMES.map((name, index) => (
              <option value={index} key={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {computed && (
          <div className="calculation-note">
            <Gauge size={15} />
            <span>
              {computed.overclockName} · 并行 {computed.parallels} ·
              {' '}{computed.durationTicks} ticks
            </span>
          </div>
        )}
      </section>

      {machineChoices.length > 0 && (
        <section className="inspector-section">
          <h3>机器参数</h3>
          {machineChoices.map((choice) => {
            const value = node.choices[choice.key] ?? choice.min
            const defaultChoice = choice.key === 'coilTier' || choice.key === 'coils'
            return (
              <label className={`field ${defaultChoice ? 'highlight-field' : ''}`} key={choice.key}>
                <span>{choice.label}</span>
                {choice.options ? (
                  <select
                    value={value}
                    onChange={(event) =>
                      onUpdateChoice(choice.key, Number(event.target.value))
                    }
                  >
                    {choice.options.map((option, index) => (
                      <option value={index} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={choice.min}
                    max={choice.max}
                    value={value}
                    onChange={(event) =>
                      onUpdateChoice(choice.key, Number(event.target.value))
                    }
                  />
                )}
              </label>
            )
          })}
        </section>
      )}

      <section className="inspector-section">
        <h3>高级覆写</h3>
        <label className="field">
          <span>速度倍率</span>
          <input
            type="number"
            min="0.0001"
            step="0.05"
            value={node.overrides.speedMultiplier}
            onChange={(event) =>
              onUpdateNode({
                overrides: {
                  ...node.overrides,
                  speedMultiplier: Number(event.target.value)
                }
              })
            }
          />
        </label>
        <label className="field">
          <span>功率倍率</span>
          <input
            type="number"
            min="0"
            step="0.05"
            value={node.overrides.powerMultiplier}
            onChange={(event) =>
              onUpdateNode({
                overrides: {
                  ...node.overrides,
                  powerMultiplier: Number(event.target.value)
                }
              })
            }
          />
        </label>
        <label className="field">
          <span>并行数覆写</span>
          <input
            type="number"
            min="0"
            step="1"
            value={node.overrides.parallels ?? ''}
            placeholder="自动"
            onChange={(event) =>
              onUpdateNode({
                overrides: {
                  ...node.overrides,
                  parallels: event.target.value
                    ? Number(event.target.value)
                    : undefined
                }
              })
            }
          />
        </label>
      </section>

      {detail && (
        <details className="recipe-summary">
          <summary>查看配方基础数据</summary>
          <div className="recipe-io-grid">
            {[...detail.inputs, ...detail.outputs].map((port) => (
              <div className="recipe-io-item" key={`${port.direction}-${port.key}`}>
                <AtlasIcon iconId={port.goods.iconId} size={24} />
                <span>
                  <strong>{port.goods.name}</strong>
                  <small>
                    {port.direction === 'input' ? '输入' : '输出'} · {port.amount} ×{' '}
                    {(port.probability * 100).toFixed(1)}%
                  </small>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <button className="danger row-button delete-node" onClick={onDelete}>
        <Trash2 size={16} />
        删除节点
      </button>
    </aside>
  )
}
