import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Box, ChevronRight, Factory, Search, TestTube } from 'lucide-react'
import type {
  RecipeSearchMode,
  RecipeSearchResponse,
  SearchItemResult,
  SearchRecipeResult
} from '../../../shared/types'
import { AtlasIcon } from './AtlasIcon'

interface RecipePaletteProps {
  onAddRecipe: (recipeId: string) => void
  search: (
    query: string,
    mode: RecipeSearchMode
  ) => Promise<RecipeSearchResponse>
}

type PaletteTab = 'items' | 'recipes'

function GoodsRow({
  item,
  mode,
  onClick
}: {
  item: SearchItemResult
  mode: RecipeSearchMode
  onClick: () => void
}): React.JSX.Element {
  const recipeCount =
    mode === 'ingredient' ? item.consumptionRecipes : item.productionRecipes
  return (
    <button className="palette-row" onClick={onClick} title={item.tooltip}>
      <AtlasIcon iconId={item.iconId} title={item.name} />
      <span className="row-copy">
        <strong>{item.name}</strong>
        <small>
          {item.kind === 'fluid' ? '流体' : item.kind === 'ore' ? '矿辞' : '物品'} ·{' '}
          {item.mod || 'unknown'} · {recipeCount}{' '}
          {mode === 'ingredient' ? '条消耗配方' : '条生产配方'}
        </small>
      </span>
      <ChevronRight size={15} />
    </button>
  )
}

function RecipeRow({
  recipe,
  mode,
  query,
  onClick
}: {
  recipe: SearchRecipeResult
  mode: RecipeSearchMode
  query: string
  onClick: () => void
}): React.JSX.Element {
  const candidates =
    mode === 'ingredient' ? recipe.inputs : recipe.outputs
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const primary =
    candidates.find((goods) =>
      goods.name.toLocaleLowerCase().includes(normalizedQuery)
    ) ?? candidates[0]
  return (
    <button
      className="palette-row recipe-row"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-gtnh-recipe', recipe.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onClick}
      title={`添加 ${recipe.recipeType} 配方`}
    >
      {primary ? (
        <AtlasIcon iconId={primary.iconId} title={primary.name} />
      ) : (
        <Factory size={24} />
      )}
      <span className="row-copy">
        <strong>{primary?.name ?? recipe.id}</strong>
        <small>
          {mode === 'ingredient' ? '消耗原料' : '产物配方'} ·{' '}
          {recipe.recipeType}
        </small>
      </span>
      <ChevronRight size={15} />
    </button>
  )
}

export function RecipePalette({
  onAddRecipe,
  search
}: RecipePaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<PaletteTab>('items')
  const [recipeMode, setRecipeMode] =
    useState<RecipeSearchMode>('product')
  const [result, setResult] = useState<RecipeSearchResponse>({
    items: [],
    recipes: [],
    total: 0
  })
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const current = ++requestId.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      void search(query, recipeMode)
        .then((response) => {
          if (requestId.current === current) setResult(response)
        })
        .finally(() => {
          if (requestId.current === current) setLoading(false)
        })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [query, recipeMode, search])

  const rows = tab === 'items' ? result.items : result.recipes
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 8
  })

  const emptyText = useMemo(() => {
    if (loading) return '正在检索本地数据…'
    return query ? '没有匹配结果' : '输入名称、模组或配方类型'
  }, [loading, query])

  const handleItem = async (item: SearchItemResult): Promise<void> => {
    const recipeCount =
      recipeMode === 'ingredient'
        ? item.consumptionRecipes
        : item.productionRecipes
    if (!recipeCount) return
    const response = await search(item.name, recipeMode)
    setResult(response)
    setTab('recipes')
  }

  return (
    <aside className="recipe-palette">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Recipe Browser</span>
          <h2>配方库</h2>
        </div>
        <span className="count-badge">{result.total}</span>
      </div>

      <label className="search-field">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索物品、流体、配方…"
          autoFocus
        />
      </label>

      <div className="segmented">
        <button
          className={tab === 'items' ? 'active' : ''}
          onClick={() => setTab('items')}
        >
          <Box size={15} />
          物品与流体
        </button>
        <button
          className={tab === 'recipes' ? 'active' : ''}
          onClick={() => setTab('recipes')}
        >
          <TestTube size={15} />
          配方搜索
        </button>
      </div>
      <div className="segmented recipe-search-mode">
        <button
          className={recipeMode === 'product' ? 'active' : ''}
          onClick={() => setRecipeMode('product')}
        >
          <Factory size={14} />
          按产物搜索
        </button>
        <button
          className={recipeMode === 'ingredient' ? 'active' : ''}
          onClick={() => setRecipeMode('ingredient')}
        >
          <Box size={14} />
          按原料搜索
        </button>
      </div>

      <div className="palette-scroll" ref={scrollRef}>
        {rows.length === 0 ? (
          <div className="empty-state">{emptyText}</div>
        ) : (
          <div
            className="virtual-list"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              return (
                <div
                  key={row.id ?? virtualRow.key}
                  className="virtual-row"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    height: virtualRow.size
                  }}
                >
                  {tab === 'items' ? (
                    <GoodsRow
                      item={row as SearchItemResult}
                      mode={recipeMode}
                      onClick={() => void handleItem(row as SearchItemResult)}
                    />
                  ) : (
                    <RecipeRow
                      recipe={row as SearchRecipeResult}
                      mode={recipeMode}
                      query={query}
                      onClick={() => onAddRecipe(row.id)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <footer className="palette-footer">
        <span>拖拽或点击配方以添加节点</span>
        <kbd>F</kbd>
      </footer>
    </aside>
  )
}
