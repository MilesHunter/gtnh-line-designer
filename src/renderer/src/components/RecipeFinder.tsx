import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Factory,
  Plus,
  Search,
  X
} from 'lucide-react'
import type {
  ExactRecipeSearchRequest,
  ExactRecipeSearchResponse,
  GoodsSummary,
  MachineRef,
  RecipeSearchResponse,
  SearchItemResult,
  SearchRecipeResult
} from '../../../shared/types'
import { AtlasIcon } from './AtlasIcon'

export interface RecipeFinderProps {
  machineId?: string
  fixedMachine?: MachineRef
  compact?: boolean
  searchGoods: (query: string) => Promise<RecipeSearchResponse>
  searchRecipes: (
    request: ExactRecipeSearchRequest
  ) => Promise<ExactRecipeSearchResponse>
  onChoose: (machine: MachineRef, recipeId: string) => void
}

type Slot = 'input' | 'output'

function GoodsPicker({
  label,
  value,
  active,
  onActivate,
  onChange,
  searchGoods
}: {
  label: string
  value?: GoodsSummary
  active: boolean
  onActivate: () => void
  onChange: (value?: GoodsSummary) => void
  searchGoods: (query: string) => Promise<RecipeSearchResponse>
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItemResult[]>([])
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    if (!active || !query.trim()) {
      setResults([])
      return
    }
    const current = ++requestId.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      void searchGoods(query)
        .then((response) => {
          if (requestId.current === current) setResults(response.items.slice(0, 8))
        })
        .catch(() => {
          if (requestId.current === current) setResults([])
        })
        .finally(() => {
          if (requestId.current === current) setLoading(false)
        })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [active, query, searchGoods])

  return (
    <div className={`goods-slot ${active ? 'active' : ''}`}>
      <button className="goods-slot-button" onClick={onActivate}>
        <span className="goods-slot-label">{label}</span>
        <span className="goods-slot-value">
          {value ? (
            <>
              <AtlasIcon iconId={value.iconId} size={22} title={value.name} />
              <strong title={value.name}>{value.name}</strong>
              <X
                size={13}
                className="slot-clear"
                onClick={(event) => {
                  event.stopPropagation()
                  onChange(undefined)
                }}
              />
            </>
          ) : (
            <>
              <Plus size={15} />
              <strong>选择{label}</strong>
            </>
          )}
        </span>
      </button>
      {active && (
        <div className="goods-picker-popover">
          <label className="search-field compact-field">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`搜索${label}名称、模组或矿辞`}
            />
          </label>
          <div className="goods-options">
            {loading && <span className="picker-hint">正在检索…</span>}
            {!loading &&
              results.map((item) => (
                <button
                  key={item.id}
                  className="goods-option"
                  onClick={() => {
                    onChange(item)
                    setQuery('')
                  }}
                >
                  <AtlasIcon iconId={item.iconId} size={22} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.kind === 'fluid'
                        ? '流体'
                        : item.kind === 'ore'
                          ? '矿辞'
                          : '物品'}{' '}
                      · {item.mod || 'unknown'}
                    </small>
                  </span>
                </button>
              ))}
            {!loading && !results.length && query.trim() && (
              <span className="picker-hint">没有匹配项</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RecipeMachineChoices({
  recipe,
  onChoose
}: {
  recipe: SearchRecipeResult
  onChoose: RecipeFinderProps['onChoose']
}): React.JSX.Element {
  return (
    <div className="recipe-machine-choices">
      {recipe.crafters.map((machine) => (
        <button
          key={machine.id}
          className="machine-choice-card"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(
              'application/x-gtnh-machine-recipe',
              JSON.stringify({ machine, recipeId: recipe.id })
            )
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onChoose(machine, recipe.id)}
          title={`使用 ${machine.displayName} 创建节点`}
        >
          <AtlasIcon iconId={machine.iconId} size={24} />
          <span>
            <strong>{machine.displayName}</strong>
            <small>{machine.multiblock ? '多方块' : '单方块'}</small>
          </span>
          <span className={`machine-kind ${machine.multiblock ? 'multi' : 'single'}`}>
            {machine.multiblock ? '多' : '单'}
          </span>
        </button>
      ))}
      {!recipe.crafters.length && <span className="picker-hint">没有兼容机器</span>}
    </div>
  )
}

function RecipeGroup({
  recipeType,
  recipes,
  direction,
  fixedMachine,
  onChoose
}: {
  recipeType: string
  recipes: SearchRecipeResult[]
  direction: string
  fixedMachine?: MachineRef
  onChoose: RecipeFinderProps['onChoose']
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null)
  return (
    <section className={`recipe-group ${open ? 'open' : ''}`}>
      <button className="recipe-group-header" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Factory size={14} />
        <strong>{recipeType}</strong>
        <span>{recipes.length}</span>
      </button>
      {open && (
        <div className="recipe-group-body">
          {recipes.map((recipe) => {
            const shown = direction === 'input' ? recipe.outputs : recipe.inputs
            const primary = shown[0] ?? recipe.outputs[0] ?? recipe.inputs[0]
            const machineCount = recipe.crafters.length
            return (
              <div className="recipe-result" key={recipe.id}>
                <button
                  className="recipe-result-row"
                  onClick={() =>
                    fixedMachine
                      ? onChoose(fixedMachine, recipe.id)
                      : setExpandedRecipe((value) =>
                          value === recipe.id ? null : recipe.id
                        )
                  }
                >
                  {primary ? (
                    <AtlasIcon iconId={primary.iconId} size={24} title={primary.name} />
                  ) : (
                    <Factory size={20} />
                  )}
                  <span className="row-copy">
                    <strong title={primary?.name}>{primary?.name ?? recipe.id}</strong>
                    <small>
                      {direction === 'input' ? '产物' : '需要原料'} ·{' '}
                      {fixedMachine
                        ? `使用 ${fixedMachine.displayName}`
                        : `${machineCount} 台机器可选`}
                    </small>
                  </span>
                  {fixedMachine ? (
                    <ChevronRight size={14} />
                  ) : expandedRecipe === recipe.id ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                {!fixedMachine && expandedRecipe === recipe.id && (
                  <RecipeMachineChoices recipe={recipe} onChoose={onChoose} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function RecipeFinder({
  machineId,
  fixedMachine,
  compact = false,
  searchGoods,
  searchRecipes,
  onChoose
}: RecipeFinderProps): React.JSX.Element {
  const [input, setInput] = useState<GoodsSummary>()
  const [output, setOutput] = useState<GoodsSummary>()
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null)
  const [result, setResult] = useState<ExactRecipeSearchResponse>({
    recipes: [],
    total: 0,
    hasMore: false
  })
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(100)
  const requestId = useRef(0)

  useEffect(() => {
    if (!input && !output) {
      setResult({ recipes: [], total: 0, hasMore: false })
      return
    }
    const current = ++requestId.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      void searchRecipes({
        input,
        output,
        machineId,
        limit,
        offset: 0
      })
        .then((next) => {
          if (requestId.current === current) setResult(next)
        })
        .catch(() => {
          if (requestId.current === current) {
            setResult({ recipes: [], total: 0, hasMore: false })
          }
        })
        .finally(() => {
          if (requestId.current === current) setLoading(false)
        })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [input, output, machineId, limit, searchRecipes])

  const groups = useMemo(() => {
    const grouped = new Map<string, SearchRecipeResult[]>()
    for (const recipe of result.recipes) {
      const entries = grouped.get(recipe.recipeType) ?? []
      entries.push(recipe)
      grouped.set(recipe.recipeType, entries)
    }
    return [...grouped.entries()]
  }, [result.recipes])

  const direction = input && output ? 'both' : input ? 'input' : 'output'

  return (
    <div className={`recipe-finder ${compact ? 'compact' : ''}`}>
      <div className="goods-slots">
        <GoodsPicker
          label="原料"
          value={input}
          active={activeSlot === 'input'}
          onActivate={() => setActiveSlot(activeSlot === 'input' ? null : 'input')}
          onChange={(value) => {
            setInput(value)
            setActiveSlot(null)
          }}
          searchGoods={searchGoods}
        />
        <span className="slot-arrow">→</span>
        <GoodsPicker
          label="产物"
          value={output}
          active={activeSlot === 'output'}
          onActivate={() => setActiveSlot(activeSlot === 'output' ? null : 'output')}
          onChange={(value) => {
            setOutput(value)
            setActiveSlot(null)
          }}
          searchGoods={searchGoods}
        />
      </div>

      <div className="finder-context">
        {input && <span>{input.name} 作为原料</span>}
        {input && output && <span>→</span>}
        {output && <span>{output.name} 作为产物</span>}
        {!input && !output && <span>至少选择原料或产物之一</span>}
        <strong>{loading ? '检索中…' : `${result.total} 条配方`}</strong>
      </div>

      <div className="recipe-groups">
        {groups.map(([recipeType, recipes]) => (
          <RecipeGroup
            key={recipeType}
            recipeType={recipeType}
            recipes={recipes}
            direction={direction}
            fixedMachine={fixedMachine}
            onChoose={onChoose}
          />
        ))}
        {!loading && (input || output) && !result.recipes.length && (
          <div className="empty-state">没有精确匹配的配方</div>
        )}
      </div>

      {result.hasMore && (
        <button className="load-more" onClick={() => setLimit((value) => value + 100)}>
          加载更多（已显示 {result.recipes.length} / {result.total}）
        </button>
      )}
    </div>
  )
}
