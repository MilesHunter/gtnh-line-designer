import { memo, useState } from 'react'
import {
  Handle,
  Position,
  type NodeProps,
  type Node as FlowNode
} from '@xyflow/react'
import { AlertTriangle, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import type {
  ComputedNode,
  GraphNode,
  PortDirection,
  RecipeDetail,
  RecipePort
} from '../../../shared/types'
import { formatPower, formatRate } from '../lib/project'
import { AtlasIcon } from './AtlasIcon'

export interface RecipeNodeData extends Record<string, unknown> {
  graphNode: GraphNode
  detail?: RecipeDetail
  preview?: ComputedNode | null
  computed?: ComputedNode
  timeUnit: 'hour' | 'min' | 'sec' | 'tick'
  invalidReasons?: string[]
  onSelect: (nodeId: string) => void
}

export type RecipeFlowNode = FlowNode<RecipeNodeData, 'machine'>

const VISIBLE_PORTS = 6

function PortRow({
  port,
  direction,
  theoreticalRate,
  actualRate,
  timeUnit
}: {
  port: RecipePort
  direction: PortDirection
  theoreticalRate: number
  actualRate?: number
  timeUnit: RecipeNodeData['timeUnit']
}): React.JSX.Element {
  return (
    <div className={`port-row ${direction}`}>
      <Handle
        id={port.key}
        type={direction === 'input' ? 'target' : 'source'}
        position={direction === 'input' ? Position.Left : Position.Right}
        className="port-handle"
        title={`${port.goods.name} · ${direction === 'input' ? '输入' : '输出'}端口`}
      />
      <AtlasIcon
        iconId={port.goods.iconId}
        size={22}
        title={`${port.goods.name}\n${port.amount} × ${(port.probability * 100).toFixed(1)}%`}
      />
      <span className="port-copy">
        <strong title={port.goods.name}>{port.goods.name}</strong>
        <small>
          {port.amount}
          {port.probability < 0.9999
            ? ` × ${(port.probability * 100).toFixed(1)}%`
            : ''}
        </small>
      </span>
      <span className="port-rate" title="理论值；计算后追加实际流量">
        {formatRate(theoreticalRate, timeUnit)}
        {actualRate !== undefined && (
          <small> / {formatRate(actualRate, timeUnit)}</small>
        )}
      </span>
    </div>
  )
}

function PortColumn({
  ports,
  direction,
  preview,
  computed,
  expanded,
  timeUnit
}: {
  ports: RecipePort[]
  direction: PortDirection
  preview?: ComputedNode | null
  computed?: ComputedNode
  expanded: boolean
  timeUnit: RecipeNodeData['timeUnit']
}): React.JSX.Element {
  const visible = expanded ? ports : ports.slice(0, VISIBLE_PORTS)
  return (
    <div className={`node-port-column ${direction}`}>
      <header>{direction === 'input' ? '输入' : '产出'}</header>
      {visible.map((port) => {
        const theoretical = preview?.ports.find((entry) => entry.key === port.key)
        const actual = computed?.ports.find((entry) => entry.key === port.key)
        return (
          <PortRow
            key={port.key}
            port={port}
            direction={direction}
            theoreticalRate={theoretical?.ratePerMinute ?? 0}
            actualRate={computed ? actual?.ratePerMinute ?? 0 : undefined}
            timeUnit={timeUnit}
          />
        )
      })}
      {!ports.length && <div className="port-empty">无</div>}
    </div>
  )
}

export const RecipeNode = memo(function RecipeNode({
  data,
  selected
}: NodeProps<RecipeFlowNode>): React.JSX.Element {
  const { graphNode, detail, preview, computed, timeUnit, invalidReasons, onSelect } = data
  const [expanded, setExpanded] = useState(false)
  const hiddenInputs = Math.max(0, (detail?.inputs.length ?? 0) - VISIBLE_PORTS)
  const hiddenOutputs = Math.max(0, (detail?.outputs.length ?? 0) - VISIBLE_PORTS)
  const overclocked = (preview?.overclockTiers ?? 0) > 0
  const invalid = Boolean(
    invalidReasons?.length ||
    !graphNode.recipeId ||
    !detail ||
    preview?.valid === false
  )
  const outputs = detail?.outputs.slice(0, 2) ?? []

  return (
    <article
      className={`recipe-node ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`}
      onClick={() => onSelect(graphNode.id)}
    >
      <header className="node-header">
        <AtlasIcon
          iconId={graphNode.machine.iconId}
          size={28}
          title={graphNode.machine.displayName}
        />
        <div className="node-title">
          <strong title={graphNode.machine.displayName}>
            {graphNode.machine.displayName}
          </strong>
          <span className="node-output-summary">
            {outputs.length
              ? outputs.map((port) => port.goods.name).join(' · ')
              : graphNode.recipeId
                ? '配方数据缺失'
                : '尚未选择配方'}
            {outputs.length > 0 && detail!.outputs.length > 2
              ? ` +${detail!.outputs.length - 2}`
              : ''}
          </span>
        </div>
        <span className={`machine-kind ${graphNode.machine.multiblock ? 'multi' : 'single'}`}>
          {graphNode.machine.multiblock ? '多' : '单'}
        </span>
        {overclocked && <span className="oc-badge">{preview?.overclockName}</span>}
        {invalid && <AlertTriangle className="warning-icon" size={16} />}
        <button
          className="icon-button node-settings"
          title="打开完整配置"
          onClick={(event) => {
            event.stopPropagation()
            onSelect(graphNode.id)
          }}
        >
          <Settings2 size={15} />
        </button>
      </header>

      {detail ? (
        <>
          <div className="node-port-columns">
            <PortColumn
              ports={detail.inputs}
              direction="input"
              preview={preview}
              computed={computed}
              expanded={expanded}
              timeUnit={timeUnit}
            />
            <PortColumn
              ports={detail.outputs}
              direction="output"
              preview={preview}
              computed={computed}
              expanded={expanded}
              timeUnit={timeUnit}
            />
          </div>
          {(hiddenInputs > 0 || hiddenOutputs > 0) && (
            <button
              className="port-expander"
              onClick={(event) => {
                event.stopPropagation()
                setExpanded((value) => !value)
              }}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {expanded
                ? '收起端口'
                : `展开全部端口 · 输入 +${hiddenInputs} / 输出 +${hiddenOutputs}`}
            </button>
          )}
        </>
      ) : (
        <div className="node-empty-recipe">
          <span>先选择这台机器的配方</span>
          <small>在右侧检查器中按原料或产物检索</small>
        </div>
      )}

      <footer className="node-footer">
        <label className="node-control compact">
          <span>电压</span>
          <strong>{['LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UMV', 'UXV', 'MAX'][graphNode.voltageTier] ?? '—'}</strong>
        </label>
        <div className="machine-count">
          <span>{graphNode.rateMode === 'target' ? '目标' : '等效台数'}</span>
          <strong>
            {graphNode.rateMode === 'target'
              ? graphNode.targetRate
              : graphNode.machineCount}
          </strong>
        </div>
        {preview && (
          <div className="node-metrics inline">
            <span>建造 {preview.recommendedMachineCount} 台</span>
            <span>{(preview.utilization * 100).toFixed(0)}%</span>
            <span>{formatPower(preview.euPerTick)} EU/t</span>
          </div>
        )}
      </footer>
    </article>
  )
})
