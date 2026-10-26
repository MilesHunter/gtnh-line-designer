import { describe, expect, it } from 'vitest'
import {
  isSingleBlockMachine,
  machineDisplayName
} from './machine-names'

describe('machine names', () => {
  it('translates tiered singleblock machine names', () => {
    expect(machineDisplayName('Basic Alloy Smelter')).toBe('基础合金炉')
    expect(machineDisplayName('Advanced Chemical Reactor II')).toBe(
      '进阶化学反应釜 II'
    )
    expect(machineDisplayName('Some Unknown Machine')).toBe('Some Unknown Machine')
  })

  it('classifies machines from tooltips and known steam singleblocks', () => {
    expect(isSingleBlockMachine('Steam Alloy Smelter')).toBe(true)
    expect(
      isSingleBlockMachine(
        'Basic Alloy Smelter',
        'Machine Type: Alloy Smelter<br>Voltage IN: 32 (LV)'
      )
    ).toBe(true)
    expect(
      isSingleBlockMachine(
        'Large Chemical Reactor',
        'Machine Type: Chemical Reactor, LCR'
      )
    ).toBe(false)
    expect(
      isSingleBlockMachine(
        '基础压缩机',
        '机器类型：压缩机<br>电压输入：32 (LV)<br>容量：2,048 EU'
      )
    ).toBe(true)
    expect(isSingleBlockMachine('高压蒸汽压缩机')).toBe(true)
    expect(
      isSingleBlockMachine(
        '大型蒸汽压缩机',
        '机器类型：压缩机<br>并行数：8<br>结构作者：PCGMatt'
      )
    ).toBe(false)
  })
})
