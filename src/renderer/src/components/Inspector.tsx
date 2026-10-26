import { useState } from 'react'
import {
  AlertTriangle,
  Copy,
  Gauge,
  RefreshCw,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import type {
  ComputedNode,
  ExactRecipeSearchRequest,
  ExactRecipeSearchResponse,
  GraphNode,
  MachineRef,
  RecipeDetail,
  RecipeSearchResponse,
  SolveResult
} from '../../../shared/types'
import { formatPower } from '../lib/project'
import { AtlasIcon } from './AtlasIcon'
import { RecipeFinder } from './RecipeFinder'

interface InspectorProps {
  node?: GraphNode
  edge?: {
    id: string
    priority: number
    enabled: boolean
  }
  detail?: RecipeDetail
  preview?: ComputedNode | null
  computed?: SolveResult['nodes'][string]
  invalidReasons?: string[]
  searchGoods: (query: string) => Promise<RecipeSearchResponse>
  searchRecipes: (
    request: ExactRecipeSearchRequest
  ) => Promise<ExactRecipeSearchResponse>
  onChooseRecipe: (machine: MachineRef, recipeId: string) => void
  onChangeMachine: (machine: MachineRef) => void
  onUpdateNode: (patch: Partial<GraphNode>) => void
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
  preview,
  computed,
  invalidReasons,
  searchGoods,
  searchRecipes,
  onChooseRecipe,
  onChangeMachine,
  onUpdateNode,
  onUpdateChoice,
  onUpdateEdge,
  onDelete,
  onDuplicate
}: InspectorProps): React.JSX.Element {
  const [choosingRecipe, setChoosingRecipe] = useState(false)

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
          <p>选择机器节点或连线后可编辑详细参数。</p>
        </div>
      </aside>
    )
  }

  const machineChoices = preview?.machineInfo?.choices ?? []
  const fixedVoltage = preview?.machineInfo?.fixedVoltageTier
  const warnings = invalidReasons?.length
    ? invalidReasons
    : preview?.warnings ?? []

  return (
    <aside className="inspector">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Machine Node</span>
          <h2>{node.machine.displayName}</h2>
        </div>
        <div className="inspector-title-actions">
          <span className={`machine-kind ${node.machine.multiblock ? 'multi' : 'single'}`}>
            {node.machine.multiblock ? '多' : '单'}
          </span>
          <button className="icon-button" title="复制节点" onClick={onDuplicate}>
            <Copy size={15} />
          </button>
        </div>
      </div>

      {warnings.map((warning) => (
        <div className="warning-banner" key={warning}>
          <AlertTriangle size={15} />
          <span>{warning}</span>
        </div>
      ))}

      <section className="inspector-section">
        <div className="section-heading-row">
          <h3>机器配方</h3>
          <button
            className="compact-action"
            onClick={() => setChoosingRecipe((value) => !value)}
          >
            <RefreshCw size={13} />
            {choosingRecipe ? '收起' : node.recipeId ? '更换配方' : '选择配方'}
          </button>
        </div>
        {detail && !choosingRecipe ? (
          <div className="selected-recipe-card">
            {detail.outputs[0] && (
              <AtlasIcon
                iconId={detail.outputs[0].goods.iconId}
                size={28}
                title={detail.outputs[0].goods.name}
              />
            )}
            <span>
              <strong>
                {detail.outputs.slice(0, 2).map((port) => port.goods.name).join(' · ') ||
                  '无主产物'}
              </strong>
              <small>{node.recipeId}</small>
            </span>
          </div>
        ) : node.recipeId && !choosingRecipe ? (
          <div className="error-banner">当前数据版本中缺少该配方，可重新选择。</div>
        ) : null}
        {choosingRecipe && (
          <div className="inspector-finder">
            <RecipeFinder
              compact
              machineId={node.machine.id}
              fixedMachine={node.machine}
              searchGoods={searchGoods}
              searchRecipes={searchRecipes}
              onChoose={(machine, recipeId) => {
                onChooseRecipe(machine, recipeId)
                setChoosingRecipe(false)
              }}
            />
          </div>
        )}
      </section>

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
            <span>理论等效机器数</span>
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
              支持小数；建议建造 {preview?.recommendedMachineCount ?? '—'} 台。
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
        {preview && (
          <div className="metric-grid">
            <div>
              <span>配方次数</span>
              <strong>{preview.recipesPerMinute.toFixed(4)}/min</strong>
            </div>
            <div>
              <span>建议建造</span>
              <strong>{preview.recommendedMachineCount} 台</strong>
            </div>
            <div>
              <span>负载率</span>
              <strong>{(preview.utilization * 100).toFixed(1)}%</strong>
            </div>
            <div>
              <span>理论功率</span>
              <strong>{formatPower(preview.euPerTick)} EU/t</strong>
            </div>
          </div>
        )}
        {computed && (
          <div className="actual-summary">
            整线实际：{computed.recipesPerMinute.toFixed(3)} 次/min ·{' '}
            {formatPower(computed.euPerTick)} EU/t
          </div>
        )}
      </section>

      <section className="inspector-section">
        <h3>机器与超频</h3>
        <label className="field">
          <span>具体机器</span>
          <select
            value={node.machine.id}
            disabled={!detail}
            onChange={(event) => {
              const machine = detail?.availableCrafters.find(
                (entry) => entry.id === event.target.value
              )
              if (machine) onChangeMachine(machine)
            }}
          >
            {!detail && <option value={node.machine.id}>{node.machine.displayName}</option>}
            {detail?.availableCrafters.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.displayName}
              </option>
            ))}
          </select>
          <small>更换机器会断开当前节点的全部连线。</small>
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
        {preview && (
          <div className="calculation-note">
            <Gauge size={15} />
            <span>
              {preview.overclockName} · 并行 {preview.parallels} ·{' '}
              {preview.durationTicks} ticks
            </span>
          </div>
        )}
      </section>

      {machineChoices.length > 0 && (
        <section className="inspector-section">
          <h3>{preview?.machineInfo?.coilAvailable ? '线圈与机器参数' : '机器参数'}</h3>
          {machineChoices.map((choice) => {
            const value = node.choices[choice.key] ?? choice.min
            const coilChoice = choice.key === 'coilTier' || choice.key === 'coils'
            return (
              <label className={`field ${coilChoice ? 'highlight-field' : ''}`} key={choice.key}>
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
        {preview?.machineInfo?.parallelCapable && (
          <label className="field">
            <span>并行数覆写</span>
            <input
              type="number"
              min="1"
              step="1"
              value={node.overrides.parallels ?? ''}
              placeholder={`自动 ${preview.parallels}`}
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
        )}
      </section>

      <button className="danger row-button delete-node" onClick={onDelete}>
        <Trash2 size={16} />
        删除节点
      </button>
    </aside>
  )
}
