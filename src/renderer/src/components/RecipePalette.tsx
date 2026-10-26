import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Boxes, Factory, Search } from 'lucide-react'
import type {
  ExactRecipeSearchRequest,
  ExactRecipeSearchResponse,
  MachineRef,
  MachineSearchResponse,
  MachineSummary,
  RecipeSearchResponse
} from '../../../shared/types'
import { AtlasIcon } from './AtlasIcon'
import { RecipeFinder } from './RecipeFinder'

interface RecipePaletteProps {
  searchMachines: (query: string) => Promise<MachineSearchResponse>
  searchGoods: (query: string) => Promise<RecipeSearchResponse>
  searchRecipes: (
    request: ExactRecipeSearchRequest
  ) => Promise<ExactRecipeSearchResponse>
  onAddMachine: (machine: MachineRef) => void
  onChooseRecipe: (machine: MachineRef, recipeId: string) => void
}

function MachineRow({
  machine,
  onAdd
}: {
  machine: MachineSummary
  onAdd: (machine: MachineRef) => void
}): React.JSX.Element {
  return (
    <button
      className="machine-row"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(
          'application/x-gtnh-machine',
          JSON.stringify(machine)
        )
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onAdd(machine)}
    >
      <AtlasIcon iconId={machine.iconId} size={28} title={machine.displayName} />
      <span className="row-copy">
        <strong title={machine.displayName}>{machine.displayName}</strong>
        <small>
          {machine.multiblock ? '多方块' : '单方块'} · {machine.recipeTypeCount} 类配方
          {machine.hasModel ? '' : ' · 近似计算'}
        </small>
      </span>
      <span className={`machine-kind ${machine.multiblock ? 'multi' : 'single'}`}>
        {machine.multiblock ? '多' : '单'}
      </span>
    </button>
  )
}

export function RecipePalette({
  searchMachines,
  searchGoods,
  searchRecipes,
  onAddMachine,
  onChooseRecipe
}: RecipePaletteProps): React.JSX.Element {
  const [tab, setTab] = useState<'machines' | 'recipes'>('recipes')
  const [query, setQuery] = useState('')
  const [machines, setMachines] = useState<MachineSearchResponse>({
    machines: [],
    total: 0
  })
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab !== 'machines') return
    const current = ++requestId.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      void searchMachines(query)
        .then((response) => {
          if (requestId.current === current) setMachines(response)
        })
        .catch(() => {
          if (requestId.current === current) {
            setMachines({ machines: [], total: 0 })
          }
        })
        .finally(() => {
          if (requestId.current === current) setLoading(false)
        })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [query, searchMachines, tab])

  const virtualizer = useVirtualizer({
    count: machines.machines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 54,
    overscan: 10
  })

  return (
    <aside className="recipe-palette">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Production Browser</span>
          <h2>机器与配方</h2>
        </div>
        <span className="count-badge">
          {tab === 'machines' ? machines.total : '精确'}
        </span>
      </div>

      <div className="segmented">
        <button
          className={tab === 'machines' ? 'active' : ''}
          onClick={() => setTab('machines')}
        >
          <Factory size={15} />
          机器搜索
        </button>
        <button
          className={tab === 'recipes' ? 'active' : ''}
          onClick={() => setTab('recipes')}
        >
          <Boxes size={15} />
          原料 / 产物
        </button>
      </div>

      {tab === 'machines' ? (
        <>
          <label className="search-field">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索机器中文名、英文名或模组"
              autoFocus
            />
          </label>
          <div className="palette-scroll machine-scroll" ref={scrollRef}>
            {!machines.machines.length ? (
              <div className="empty-state">
                {loading ? '正在检索机器…' : '没有匹配机器'}
              </div>
            ) : (
              <div
                className="virtual-list"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const machine = machines.machines[virtualRow.index]
                  return (
                    <div
                      key={machine.id}
                      className="virtual-row"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                        height: virtualRow.size
                      }}
                    >
                      <MachineRow machine={machine} onAdd={onAddMachine} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <footer className="palette-footer">
            <span>点击或拖入画布创建空机器节点</span>
            <kbd>M</kbd>
          </footer>
        </>
      ) : (
        <RecipeFinder
          searchGoods={searchGoods}
          searchRecipes={searchRecipes}
          onChoose={onChooseRecipe}
        />
      )}
    </aside>
  )
}
