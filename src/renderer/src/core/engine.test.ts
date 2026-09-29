import { describe, expect, it } from 'vitest'
import { GtnhEngine } from './engine'
import { RecipeModel } from './model'

function emptyV7Repository(): ArrayBuffer {
  const values = new Int32Array(15)
  values[0] = 7
  for (let index = 1; index <= 7; index += 1) {
    values[index] = index + 7
  }
  return values.buffer
}

describe('GtnhEngine', () => {
  it('loads the v7 memory-mapped header and empty indexes', () => {
    const engine = new GtnhEngine()
    const result = engine.load(emptyV7Repository())
    expect(result).toEqual({
      dataVersion: 7,
      items: 0,
      fluids: 0,
      recipeTypes: 0,
      recipes: 0
    })
  })

  it('rejects a non-v7 binary format', () => {
    const data = emptyV7Repository()
    new Int32Array(data)[0] = 6
    expect(() => new GtnhEngine().load(data)).toThrow(/Unsupported data version/)
  })
})

describe('RecipeModel choice validation', () => {
  it('clamps numeric and enumerated choices', () => {
    const model = new RecipeModel()
    model.choices = { tier: 9, amount: -4 }
    model.ValidateChoices({
      choices: {
        tier: { description: 'Tier', choices: ['A', 'B', 'C'] },
        amount: { description: 'Amount', min: 0, max: 10 }
      }
    })
    expect(model.choices).toEqual({ tier: 2, amount: 0 })
  })
})
