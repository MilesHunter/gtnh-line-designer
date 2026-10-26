const MACHINE_ALIASES: Record<string, string> = {
  'Advanced Assembly Line': '进阶装配线',
  'Alloy Blast Smelter': '合金高炉',
  'Amazon Warehousing Depot': '亚马逊仓储站',
  'Assembly Line': '装配线',
  'Bacterial Vat': '细菌培养缸',
  'Big Barrel Brewery': '大型酿造桶',
  'Boldarnator': '博尔达纳托',
  'Bricked Blast Furnace': '砖砌高炉',
  'Chemical Reactor': '化学反应釜',
  'Circuit Assembly Line': '电路装配线',
  'Clarifier Purification Unit': '澄清净化单元',
  'COMET - Compact Cyclotron': 'COMET 紧凑回旋加速器',
  'Component Assembly Line': '部件装配线',
  'Cryogenic Freezer': '低温冷冻机',
  'Dangote Distillus': '丹格特蒸馏塔',
  'Density^2': '密度平方',
  'Digester': '消化罐',
  'Dissection Apparatus': '解剖装置',
  'Dissolution Tank': '溶解罐',
  'Distillation Tower': '蒸馏塔',
  'Draconic Evolution Fusion Crafter': '龙之进化聚合合成器',
  'Electric Blast Furnace': '电力高炉',
  'Electric Furnace': '电炉',
  'Electric Implosion Compressor': '电力聚爆压缩机',
  'Electric Mixer': '电动搅拌机',
  'Electrolyzer': '电解机',
  'Elemental Duplicator': '元素复制机',
  'Endothermic Fridge': '吸热冰箱',
  'Exothermic Hearth': '放热炉床',
  'Extreme Heat Exchanger': '极热交换器',
  'ExxonMobil Chemical Plant': '埃克森美孚化工厂',
  'Eye of Harmony': '和谐之眼',
  'Flocculation Purification Unit': '絮凝净化单元',
  'Flotation Cell Regulator': '浮选槽调节器',
  'Fluid Shaper': '流体塑形器',
  'Forge of the Gods': '众神熔炉',
  'Fusion Control Computer Mark I': '聚变控制计算机 MK I',
  'Fusion Control Computer Mark II': '聚变控制计算机 MK II',
  'Fusion Control Computer Mark III': '聚变控制计算机 MK III',
  'FusionTech MK IV': '聚变科技 MK IV',
  'FusionTech MK V': '聚变科技 MK V',
  'High Pressure Steam Compressor': '高压蒸汽压缩机',
  'High Pressure Alloy Smelter': '高压蒸汽合金炉',
  'High Pressure Steam Extractor': '高压蒸汽提取机',
  'High Pressure Steam Furnace': '高压蒸汽熔炉',
  'High Pressure Steam Forge Hammer': '高压蒸汽锻造锤',
  'High Pressure Steam Macerator': '高压蒸汽粉碎机',
  'Hot Isostatic Pressurization Unit': '热等静压装置',
  'Hyper-Intensity Laser Engraver': '超强激光蚀刻机',
  'Implosion Compressor': '聚爆压缩机',
  'Industrial Arc Furnace': '工业电弧炉',
  'Industrial Autoclave': '工业高压釜',
  'Industrial Bending Machine': '工业弯板机',
  'Industrial Centrifuge': '工业离心机',
  'Industrial Chemical Bath': '工业化学浴',
  'Industrial Coke Oven': '工业焦炉',
  'Industrial Cutting Factory': '工业切割厂',
  'Industrial Electrolyzer': '工业电解机',
  'Industrial Extrusion Machine': '工业挤压机',
  'Industrial Forming Press': '工业冲压机',
  'Industrial Maceration Stack': '工业粉碎堆',
  'Industrial Mixing Machine': '工业搅拌机',
  'Industrial Precision Lathe': '工业精密车床',
  'Industrial Sledgehammer': '工业大锤',
  'Industrial Wire Factory': '工业线材厂',
  'IsaMill Grinding Machine': 'IsaMill 研磨机',
  'Large Chemical Reactor': '大型化学反应釜',
  'Large Electric Compressor': '大型电力压缩机',
  'Large Fluid Extractor': '大型流体提取机',
  'Large Scale Auto-Assembler v1.01': '大型自动装配机 v1.01',
  'Large Sifter Control Block': '大型筛选机控制方块',
  'Large Thermal Refinery': '大型热精炼厂',
  'Magnetic Flux Exhibitor': '磁通量展示器',
  'Matter Fabrication CPU': '物质制造 CPU',
  'Mega Alloy Blast Smelter': '巨型合金高炉',
  'Mega Chemical Reactor': '巨型化学反应釜',
  'Mega Distillation Tower': '巨型蒸馏塔',
  'Mega Oil Cracker': '巨型石油裂化机',
  'Molecular Transformer': '分子重组机',
  'Multi Smelter': '多重熔炼炉',
  'Nano Forge': '纳米熔炉',
  'Naquadah Fuel Refinery': '硅岩燃料精炼厂',
  'Neutron Activator': '中子活化器',
  'Neutronium Compressor': '中子素压缩机',
  'Nuclear Reactor': '核反应堆',
  'Nuclear Salt Processing Plant': '核盐处理厂',
  'Oil Cracking Unit': '石油裂化机',
  'Ore Washing Plant': '洗矿厂',
  'Ozonation Purification Unit': '臭氧化净化单元',
  'PCB Factory': 'PCB 工厂',
  'Precise Auto-Assembler MT-3662': '精密自动装配机 MT-3662',
  'Pseudostable Black Hole Containment Field': '准稳定黑洞约束场',
  'Pyrolyse Oven': '热解炉',
  'Quantum Force Transformer': '量子力量转化器',
  'Reactor Fuel Processing Plant': '反应堆燃料处理厂',
  'Research station': '研究站',
  'Residual Decontaminant Degasser Purification Unit': '残余污染物脱气净化单元',
  'Source Chamber': '源室',
  'Space Assembler Module MK-I': '太空装配模块 MK-I',
  'Space Assembler Module MK-II': '太空装配模块 MK-II',
  'Space Assembler Module MK-III': '太空装配模块 MK-III',
  'Sparge Tower Controller': '鼓泡塔控制器',
  'Spinmatron-2737': '旋压机 2737',
  'Steam Compressor': '蒸汽压缩机',
  'Steam Alloy Smelter': '蒸汽合金炉',
  'Steam Extractor': '蒸汽提取机',
  'Steam Furnace': '蒸汽熔炉',
  'Steam Forge Hammer': '蒸汽锻造锤',
  'Steam Macerator': '蒸汽粉碎机',
  'Steam Squasher': '蒸汽压扁机',
  'Steam Separator': '蒸汽分离机',
  'Steam Presser': '蒸汽压制机',
  'Steam Grinder': '蒸汽研磨机',
  'Steam Purifier': '蒸汽净化机',
  'Steam Blender': '蒸汽混合机',
  'Target Chamber': '靶室',
  'Thermic Heating Device': '热力加热装置',
  'Thorium Reactor [LFTR]': '钍反应堆 [LFTR]',
  'Transcendent Plasma Mixer': '超凡等离子混合器',
  'Tree Growth Simulator': '树木生长模拟器',
  'TurboCan Pro': 'TurboCan Pro 涡轮机',
  'Utupu-Tanuri': '乌图普-塔努里',
  'Vacuum Freezer': '真空冷冻机',
  'Volcanus': '沃卡纳斯',
  'Zhuhai - Fishing Port': '珠海渔港',
  'Zyngen': '锌根反应器',
  'Compact Fusion Computer MK-I Prototype': '紧凑聚变计算机 MK-I 原型',
  'Compact Fusion Computer MK-II': '紧凑聚变计算机 MK-II',
  'Compact Fusion Computer MK-III': '紧凑聚变计算机 MK-III',
  'Compact Fusion Computer MK-IV Prototype': '紧凑聚变计算机 MK-IV 原型',
  'Compact Fusion Computer MK-V': '紧凑聚变计算机 MK-V',
  'Absolute Baryonic Perfection Purification Unit': '绝对重子完美净化单元',
  'Extreme Temperature Fluctuation Purification Unit': '极端温度波动净化单元',
  'High Energy Laser Purification Unit': '高能激光净化单元',
  'pH Neutralization Purification Unit': 'pH 中和净化单元'
}

export function machineDisplayName(englishName: string): string {
  const exact = MACHINE_ALIASES[englishName]
  if (exact) return exact

  let translated = englishName
  const prefixes: Array<[string, string]> = [
    ['Grandmaster', '宗师'],
    ['Master', '大师'],
    ['Ultimate', '终极'],
    ['Advanced', '进阶'],
    ['Elite', '精英'],
    ['Basic', '基础'],
    ['Epic', '史诗'],
    ['Novice', '新手'],
    ['Adept', '熟练'],
    ['Simple', '简易'],
    ['Turbo', '涡轮'],
    ['Large', '大型'],
    ['Small', '小型'],
    ['XL', '超大型']
  ]
  for (const [source, target] of prefixes) {
    translated = translated.replace(new RegExp(`\\b${source}\\b`, 'g'), target)
  }

  const parts: Array<[string, string]> = [
    ['Precision Laser Engraver', '精密激光蚀刻机'],
    ['Electromagnetic Separator', '电磁分离机'],
    ['Thermal Centrifuge', '热力离心机'],
    ['Ore Washing Plant', '洗矿厂'],
    ['Circuit Assembling Machine', '电路组装机'],
    ['Circuit Assembler', '电路组装机'],
    ['Fluid Solidifier', '流体固化机'],
    ['Fluid Extractor', '流体提取机'],
    ['Fluid Heater', '流体加热机'],
    ['Chemical Reactor', '化学反应釜'],
    ['Chemical Bath', '化学浴'],
    ['Alloy Smelter', '合金炉'],
    ['Arc Furnace', '电弧炉'],
    ['Electric Furnace', '电炉'],
    ['Electric Oven', '电烤箱'],
    ['Assembling Machine', '组装机'],
    ['Bending Machine', '弯板机'],
    ['Canning Machine', '装罐机'],
    ['Cutting Machine', '切割机'],
    ['Forge Hammer', '锻造锤'],
    ['Forming Press', '冲压机'],
    ['Mass Fabricator', '质量制造机'],
    ['Sifting Machine', '筛选机'],
    ['Seed Generator', '种子生成器'],
    ['Crop Gene Extractor', '作物基因提取机'],
    ['Crop Gene Synthesizer', '作物基因合成机'],
    ['Gas Turbine', '燃气轮机'],
    ['Plasma Turbine', '等离子涡轮机'],
    ['Steam Turbine', '蒸汽涡轮机'],
    ['Combustion Generator', '内燃发电机'],
    ['Semifluid Generator', '半流质发电机'],
    ['Geothermal Engine', '地热引擎'],
    ['Rocket Engine', '火箭引擎'],
    ['Magic Energy Absorber', '魔法能量吸收器'],
    ['Magic Energy Converter', '魔法能量转换器'],
    ['Circuit Assembler', '电路组装机'],
    ['Electrolyzer', '电解机'],
    ['Centrifuge', '离心机'],
    ['Compressor', '压缩机'],
    ['Extractor', '提取机'],
    ['Extruder', '挤压机'],
    ['Fermenter', '发酵机'],
    ['Macerator', '粉碎机'],
    ['Polarizer', '极化机'],
    ['Recycler', '回收机'],
    ['Replicator', '复制机'],
    ['Scanner', '扫描仪'],
    ['Wiremill', '线材轧机'],
    ['Autoclave', '高压釜'],
    ['Brewery', '酿造机'],
    ['Distillery', '蒸馏机'],
    ['Fabricator', '制造机'],
    ['Generator', '发电机'],
    ['Machine', '机器'],
    ['Mixer', '搅拌机'],
    ['Lathe', '车床'],
    ['Washer', '清洗机'],
    ['Furnace', '熔炉']
  ]
  let specificPartMatched = false
  for (const [source, target] of parts) {
    if (
      source !== 'Machine' &&
      new RegExp(`\\b${source}\\b`, 'i').test(translated)
    ) {
      specificPartMatched = true
    }
    translated = translated.replace(new RegExp(`\\b${source}\\b`, 'gi'), target)
  }

  if (!specificPartMatched) return englishName

  return translated
    .replace(/\s+(?=[\u4e00-\u9fff])/g, '')
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
    .trim()
}

export function machineSearchText(englishName: string): string {
  return `${englishName} ${machineDisplayName(englishName)}`.trim()
}

const SIMPLE_STEAM_SINGLEBLOCKS = new Set([
  'Steam Compressor',
  'Steam Alloy Smelter',
  'Steam Extractor',
  'Steam Furnace',
  'Steam Forge Hammer',
  'Steam Macerator',
  'High Pressure Steam Compressor',
  'High Pressure Alloy Smelter',
  'High Pressure Steam Extractor',
  'High Pressure Steam Furnace',
  'High Pressure Steam Forge Hammer',
  'High Pressure Steam Macerator'
])

const SIMPLE_STEAM_SINGLEBLOCKS_ZH = new Set([
  '蒸汽压缩机',
  '蒸汽合金炉',
  '蒸汽提取机',
  '蒸汽熔炉',
  '蒸汽锻造锤',
  '蒸汽粉碎机',
  '高压蒸汽压缩机',
  '高压蒸汽合金炉',
  '高压蒸汽提取机',
  '高压蒸汽熔炉',
  '高压蒸汽锻造锤',
  '高压蒸汽粉碎机'
])

export function isSingleBlockMachine(
  englishName: string,
  tooltip?: string | null
): boolean {
  if (
    SIMPLE_STEAM_SINGLEBLOCKS.has(englishName) ||
    SIMPLE_STEAM_SINGLEBLOCKS_ZH.has(englishName)
  ) {
    return true
  }
  if (!tooltip) return false
  return /Voltage IN:|Capacity:|电压输入\s*[:：]|容量\s*[:：]/i.test(tooltip)
}
