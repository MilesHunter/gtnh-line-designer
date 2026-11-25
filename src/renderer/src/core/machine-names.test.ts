import { describe, expect, it } from 'vitest'
import {
  classifyMachine,
  isSingleBlockMachine,
  machineClassLabel,
  machineDisplayName,
  singleBlockFamilyName
} from './machine-names'

describe('machine names', () => {
  it('translates tiered singleblock machine names', () => {
    expect(machineDisplayName('Basic Alloy Smelter')).toBe('基础合金炉')
    expect(machineDisplayName('Advanced Chemical Reactor II')).toBe(
      '进阶化学反应釜 II'
    )
    expect(machineDisplayName('Some Unknown Machine')).toBe('Some Unknown Machine')
  })

  it('collapses voltage-tier singleblock names to one machine family', () => {
    expect(singleBlockFamilyName('Basic Electrolyzer')).toBe('Electrolyzer')
    expect(singleBlockFamilyName('Advanced Electrolyzer')).toBe('Electrolyzer')
    expect(singleBlockFamilyName('Advanced Electrolyzer II')).toBe('Electrolyzer')
    expect(singleBlockFamilyName('Elite Chemical Reactor II')).toBe(
      'Chemical Reactor'
    )
    expect(singleBlockFamilyName('基础电解机')).toBe('电解机')
    expect(singleBlockFamilyName('进阶电解机Ⅱ')).toBe('电解机')
    expect(singleBlockFamilyName('精英离心机 II')).toBe('离心机')
    expect(machineDisplayName(singleBlockFamilyName('Basic Centrifuge'))).toBe(
      '离心机'
    )
    expect(machineDisplayName(singleBlockFamilyName('Turbo Centrifuge'))).toBe(
      '涡轮离心机'
    )
  })

  it('classifies singleblock, multiblock and mega machines', () => {
    expect(
      classifyMachine(
        'Basic Electrolyzer',
        'Voltage IN: 32 (LV)<br>Capacity: 2,048 EU'
      )
    ).toBe('singleblock')
    expect(classifyMachine('Industrial Centrifuge')).toBe('multiblock')
    expect(classifyMachine('Mega Chemical Reactor')).toBe('mega')
    expect(machineClassLabel('singleblock')).toBe('单方块')
    expect(machineClassLabel('multiblock')).toBe('多方块')
    expect(machineClassLabel('mega')).toBe('巨型多方块')
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
