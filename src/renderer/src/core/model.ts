import type {
  Item,
  Recipe,
  RecipeInOut
} from './vendor/repository'

export type OverclockResult = {
  overclockSpeed: number
  overclockPower: number
  perfectOverclocks?: number
  overclockName?: string
}

export interface Choice {
  description: string
  choices?: string[]
  min?: number
  max?: number
}

export interface MachineLike {
  choices?: Record<string, Choice>
  enforceChoiceConstraints?: (
    recipe: RecipeModel,
    choices: Record<string, number>
  ) => void
}

export class RecipeModel {
  recipeId = ''
  recipe?: Recipe
  voltageTier = 0
  crafter?: string
  choices: Record<string, number> = {}
  fixedCrafterCount?: number
  selectedOreDicts: Record<string, Item> = {}
  recipeItems: RecipeInOut[] = []

  recipesPerMinute = 0
  crafterCount = 0
  overclockFactor = 1
  powerFactor = 1
  parallels = 1
  overclockName?: string
  overclockTiers = 0
  machineInfo?: unknown
  warnings: string[] = []

  constructor(recipe?: Recipe) {
    if (recipe) {
      this.recipe = recipe
      this.recipeId = recipe.id
    }
  }

  getInputCount(): number {
    return this.recipeItems.filter(
      (entry) =>
        entry.type === 0 || entry.type === 1 || entry.type === 2
    ).length
  }

  getOutputCount(): number {
    return this.recipeItems.filter(
      (entry) => entry.type === 3 || entry.type === 4
    ).length
  }

  getItemInputCount(): number {
    return this.recipeItems.filter(
      (entry) => entry.type === 0 || entry.type === 1
    ).length
  }

  ValidateChoices(machineInfo: MachineLike): void {
    if (!machineInfo.choices) {
      this.choices = {}
      return
    }

    const validated: Record<string, number> = {}
    for (const [key, choice] of Object.entries(machineInfo.choices)) {
      const min = choice.min ?? 0
      const max = choice.choices
        ? choice.choices.length - 1
        : (choice.max ?? Number.POSITIVE_INFINITY)
      validated[key] = Math.min(Math.max(this.choices[key] ?? min, min), max)
    }
    machineInfo.enforceChoiceConstraints?.(this, validated)
    this.choices = validated
  }
}
