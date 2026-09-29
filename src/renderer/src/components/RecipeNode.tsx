import { memo } from 'react'
import {
  Handle,
  Position,
  type NodeProps,
  type Node as FlowNode
} from '@xyflow/react'
import { AlertTriangle, Factory, Settings2 } from 'lucide-react'
import type {
  ComputedNode,
  GraphNodeV1,
  PortDirection,
  RecipeDetail,
  RecipePort
} from '../../../shared/types'
import { formatPower, formatRate } from '../lib/project'
import { AtlasIcon } from './AtlasIcon'

export interface RecipeNodeData extends Record<string, unknown> {
  graphNode: GraphNodeV1
  detail: RecipeDetail
  computed?: ComputedNode
  timeUnit: 'hour' | 'min' | 'sec' | 'tick'
  onUpdate: (patch: Partial<GraphNodeV1>) => void
  onSelect: () => void
}

export type RecipeFlowNode = FlowNode<RecipeNodeData, 'recipe'>

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

function PortRow({
  port,
  direction,
  rate,
  timeUnit
}: {
  port: RecipePort
  direction: PortDirection
  rate: number
  timeUnit: RecipeNodeData['timeUnit']
}): React.JSX.Element {
  return (
    <div className={`port-row ${direction}`}>
      {direction === 'input' && (
        <Handle
          id={port.key}
          type="target"
          position={Position.Left}
          className="port-handle"
          title={`${port.goods.name} · 输入端口`}
        />
      )}
      {direction === 'output' && (
        <Handle
          id={port.key}
          type="source"
          position={Position.Right}
          className="port-handle"
          title={`${port.goods.name} · 输出端口`}
        />
      )}
      <AtlasIcon
        iconId={port.goods.iconId}
        size={24}
        title={`${port.goods.name}\n${port.amount} × ${(port.probability * 100).toFixed(1)}%`}
      />
      <span className="port-copy">
        <strong title={port.goods.name}>{port.goods.name}</strong>
        <small>
          {port.amount}
          {port.probability < 0.9999
            ? ` × ${(port.probability * 100).toFixed(1)}%`
            : ''}
          {direction === 'input' ? ' →' : ' ←'}
        </small>
      </span>
      <span className="port-rate">
        {formatRate(rate, timeUnit)}
        <small>/{timeUnit === 'tick' ? 't' : timeUnit === 'sec' ? 's' : timeUnit === 'hour' ? 'h' : 'm'}</small>
      </span>
    </div>
  )
}

export const RecipeNode = memo(function RecipeNode({
  data,
  selected
}: NodeProps<RecipeFlowNode>): React.JSX.Element {
  const { graphNode, detail, computed, timeUnit, onUpdate, onSelect } = data
  const invalid = computed?.valid === false
  const overclocked = (computed?.overclockTiers ?? 0) > 0

  return (
    <article
      className={`recipe-node ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`}
      onClick={onSelect}
    >
      <header className="node-header">
        <div className="node-kind-icon">
          <Factory size={17} />
        </div>
        <div className="node-title">
          <strong title={graphNode.label ?? detail.recipeType}>
            {graphNode.label ?? detail.recipeType}
          </strong>
          <small>
            {detail.category} · {(computed?.recipesPerMinute ?? 0).toFixed(3)} 次/min
          </small>
        </div>
        {overclocked && <span className="oc-badge">{computed?.overclockName}</span>}
        {invalid && <AlertTriangle className="warning-icon" size={16} />}
      </header>

      <div className="node-ports">
        {detail.inputs.map((port) => {
          const current = computed?.ports.find((entry) => entry.key === port.key)
          return (
            <PortRow
              key={port.key}
              port={port}
              direction="input"
              rate={current?.ratePerMinute ?? 0}
              timeUnit={timeUnit}
            />
          )
        })}
        {detail.outputs.map((port) => {
          const current = computed?.ports.find((entry) => entry.key === port.key)
          return (
            <PortRow
              key={port.key}
              port={port}
              direction="output"
              rate={current?.ratePerMinute ?? 0}
              timeUnit={timeUnit}
            />
          )
        })}
      </div>

      <footer className="node-footer">
        <label className="node-control">
          <span>机器</span>
          <select
            value={graphNode.crafterId ?? ''}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              onUpdate({ crafterId: event.target.value || undefined })
            }
          >
            <option value="">自动选择</option>
            {detail.availableCrafters.map((crafter) => (
              <option key={crafter.id} value={crafter.id}>
                {crafter.name}
              </option>
            ))}
          </select>
        </label>
        <label className="node-control compact">
          <span>电压</span>
          <select
            value={graphNode.voltageTier}
            disabled={computed?.machineInfo?.fixedVoltageTier !== undefined}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              onUpdate({ voltageTier: Number(event.target.value) })
            }
          >
            {VOLTAGE_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="machine-count">
          <span>{graphNode.rateMode === 'target' ? '目标' : '台数'}</span>
          <strong>
            {graphNode.rateMode === 'target'
              ? graphNode.targetRate
              : graphNode.machineCount}
          </strong>
        </div>
        <button
          className="icon-button node-settings"
          title="打开完整配置"
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
        >
          <Settings2 size={15} />
        </button>
      </footer>

      {computed && (
        <div className="node-metrics">
          <span>等效 {computed.machineCount.toFixed(3)} 台</span>
          <span>建造 {computed.recommendedMachineCount} 台</span>
          <span>负载 {(computed.utilization * 100).toFixed(1)}%</span>
          <span>{formatPower(computed.euPerTick)} EU/t</span>
        </div>
      )}
    </article>
  )
})
