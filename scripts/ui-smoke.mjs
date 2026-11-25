import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const root = process.cwd()
const outputDir = path.join(root, 'artifacts')
await mkdir(outputDir, { recursive: true })
const runtimeFiles = [
  path.join(root, 'data', 'selected.json'),
  path.join(root, 'workspace', 'autosave.gtnhgraph')
]
const backups = new Map()
for (const file of runtimeFiles) {
  try {
    backups.set(file, await readFile(file))
  } catch {
    backups.set(file, null)
  }
}

const app = await electron.launch({
  args: ['.'],
  cwd: root
})

const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.waitForSelector('.app-shell, .version-dialog', { timeout: 30000 })
  const useCached = page.getByRole('button', { name: '使用缓存' }).first()
  if (await useCached.count()) {
    await useCached.click()
  }
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  await page.waitForTimeout(1200)
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '机器搜索' }).click()
  await page.locator('.search-field input').fill('大型化学反应釜')
  await page.waitForSelector('.machine-row', { timeout: 10000 })
  await page.locator('.machine-row').first().click()
  await page.waitForSelector('.recipe-node', { timeout: 10000 })
  const emptyNodeRendered = await page.locator('.recipe-node').count()
  await page.keyboard.press('Delete')
  await page.getByRole('button', { name: '原料 / 产物' }).click()
  await page.locator('.goods-slot-button').first().click()
  await page.locator('.goods-picker-popover input').fill('Iron Plate')
  await page.waitForSelector('.goods-option', { timeout: 10000 })
  await page.locator('.goods-option').first().click()
  await page.waitForSelector('.recipe-group-header', { timeout: 10000 })
  await page.locator('.recipe-group-header').first().click()
  await page.locator('.recipe-result-row').first().click()
  await page.waitForSelector('.machine-choice-card', { timeout: 10000 })
  const machineChoiceNames = await page
    .locator('.machine-choice-card strong')
    .allTextContents()
  await page.locator('.machine-choice-card').first().click()
  await page.waitForTimeout(300)
  const machineChoicesCollapsed =
    (await page.locator('.recipe-machine-choices').count()) === 0
  const selectedMachineSummary = await page
    .locator('.selected-machine-card')
    .count()
  await page.getByRole('button', { name: '更换机器' }).click()
  const changeMachineSelectVisible =
    (await page.locator('.inspector select').count()) > 0
  await page.getByRole('button', { name: '取消', exact: true }).click()
  const currentRecipeOutput = (
    await page.locator('.selected-recipe-card strong').first().textContent()
  )
    ?.split(' · ')[0]
    .trim()
  if (!currentRecipeOutput) {
    throw new Error('无法读取当前配方产物')
  }
  await page.getByRole('button', { name: '更换配方' }).click()
  await page.waitForSelector('.inspector-finder', { timeout: 10000 })
  const outputPicker = page
    .locator('.inspector-finder .goods-slot.output .goods-slot-button')
    .first()
  await outputPicker.click()
  await page
    .locator('.inspector-finder .goods-slot.output .goods-picker-popover input')
    .fill(currentRecipeOutput)
  await page.waitForSelector(
    '.inspector-finder .goods-slot.output .goods-option',
    { timeout: 10000 }
  )
  const inspectorLayout = await page.evaluate(() => {
    const inspector = document.querySelector('.inspector')
    const popover = document.querySelector(
      '.inspector-finder .goods-slot.output .goods-picker-popover'
    )
    const finder = document.querySelector('.inspector-finder')
    const recipeGroups = finder?.querySelector('.recipe-groups')
    if (!inspector || !popover || !finder || !recipeGroups) return null
    const inspectorRect = inspector.getBoundingClientRect()
    const popoverRect = popover.getBoundingClientRect()
    const finderRect = finder.getBoundingClientRect()
    const groupsRect = recipeGroups.getBoundingClientRect()
    return {
      inspectorHorizontalOverflow: inspector.scrollWidth - inspector.clientWidth,
      popoverRightOverflow: popoverRect.right - inspectorRect.right,
      groupsBottomOverflow: groupsRect.bottom - finderRect.bottom
    }
  })
  await page.locator('.inspector-finder .goods-option').first().click()
  await page.waitForSelector('.inspector-finder .recipe-group-header', {
    timeout: 10000
  })
  for (const header of await page
    .locator('.inspector-finder .recipe-group-header')
    .all()) {
    if ((await header.getAttribute('aria-expanded')) !== 'true') {
      await header.click()
    }
  }
  await page.evaluate(() => {
    const groupBody = document.querySelector(
      '.inspector-finder .recipe-group-body'
    )
    const result = groupBody?.querySelector('.recipe-result')
    if (!groupBody || !result) return
    for (let index = 0; index < 20; index += 1) {
      groupBody.append(result.cloneNode(true))
    }
  })
  const recipeListLayout = await page.evaluate(() => {
    const inspector = document.querySelector('.inspector')
    const finder = document.querySelector('.inspector-finder')
    const recipeGroups = finder?.querySelector('.recipe-groups')
    if (!inspector || !finder || !recipeGroups) return null
    const inspectorRect = inspector.getBoundingClientRect()
    const finderRect = finder.getBoundingClientRect()
    const groupsRect = recipeGroups.getBoundingClientRect()
    return {
      inspectorHorizontalOverflow: inspector.scrollWidth - inspector.clientWidth,
      finderBottom: finderRect.bottom,
      groupsBottom: groupsRect.bottom,
      groupsScrollable: recipeGroups.scrollHeight > recipeGroups.clientHeight
    }
  })
  if (
    !inspectorLayout ||
    !recipeListLayout ||
    inspectorLayout.inspectorHorizontalOverflow > 1 ||
    inspectorLayout.popoverRightOverflow > 1 ||
    inspectorLayout.groupsBottomOverflow > 1 ||
    recipeListLayout.inspectorHorizontalOverflow > 1 ||
    recipeListLayout.groupsBottom > recipeListLayout.finderBottom + 1
  ) {
    throw new Error(
      `检查器布局溢出: ${JSON.stringify({ inspectorLayout, recipeListLayout })}`
    )
  }
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await page.locator('.goods-slot').first().locator('.slot-clear').click()
  await page.locator('.goods-slot-button').first().click()
  await page.locator('.goods-picker-popover input').fill('Iron Ingot')
  await page.waitForSelector('.goods-option')
  await page.locator('.goods-option').first().click()
  await page.waitForSelector('.recipe-group-header')
  await page.locator('.recipe-group-header').first().click()
  await page.locator('.recipe-result-row').first().click()
  await page.waitForSelector('.machine-choice-card')
  await page.locator('.machine-choice-card').first().click()
  await page.waitForTimeout(700)
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 300 } })
  await page.keyboard.press('f')
  await page.waitForTimeout(500)
  const configuredNodeRendered = await page.locator('.recipe-node').count()
  const firstNode = page.locator('.recipe-node').first()
  const secondNode = page.locator('.recipe-node').nth(1)
  const sourceHandle = firstNode
    .locator('.node-port-column.output .port-handle')
    .first()
  const targetHandle = secondNode
    .locator('.node-port-column.input .port-handle[title^="Iron Ingot"]')
    .first()
  await page.screenshot({
    path: path.join(outputDir, 'ui-before-drag.png'),
    fullPage: true
  })
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Unable to locate connection handles')
  }
  await sourceHandle.dragTo(targetHandle, { force: true })
  await page.waitForTimeout(500)
  const edgeRendered = await page.locator('.react-flow__edge').count()
  await page.getByRole('button', { name: '自动排版' }).click()
  await page.waitForTimeout(500)
  const autoLayoutNodeCount = await page.locator('.recipe-node').count()
  const modalWait = page
    .locator('.calculation-modal')
    .waitFor({ state: 'visible', timeout: 5000 })
  await page.locator('.calculate-button').click()
  const calculationModalSeen = await modalWait.then(
    () => true,
    () => false
  )
  await page.locator('.calculation-modal').waitFor({
    state: 'hidden',
    timeout: 30000
  })

  await page.getByRole('button', { name: '机器搜索' }).click()
  await page.locator('.search-field input').fill('大型化学反应釜')
  await page.waitForSelector('.machine-row')
  await page.locator('.machine-row').first().click()
  await page.locator('.calculate-button').click()
  await page.waitForTimeout(500)
  const invalidNodeHighlighted = await page.locator('.recipe-node.invalid').count()
  const invalidBlockedModal = (await page.locator('.calculation-modal').count()) === 0
  await page.locator('.recipe-node.invalid').first().click()
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 300 } })
  await page.keyboard.press('f')
  await page.waitForTimeout(300)
  if (await page.locator('.toast').count()) await page.locator('.toast').click()
  await page.locator('.calculate-button').click()
  await page.locator('.calculation-modal').waitFor({
    state: 'hidden',
    timeout: 30000
  })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '机器搜索' }).click()
  await page.locator('.search-field input').fill('离心机')
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.machine-row .row-copy strong')].some(
        (element) => element.textContent === '离心机'
      ),
    { timeout: 10000 }
  )
  const centrifugeMachineNames = await page
    .locator('.machine-row .row-copy strong')
    .allTextContents()
  if (
    new Set(centrifugeMachineNames).size !== centrifugeMachineNames.length ||
    !centrifugeMachineNames.includes('离心机') ||
    !centrifugeMachineNames.includes('工业离心机') ||
    centrifugeMachineNames.some((name) =>
      /^(?:基础|进阶|精英)离心机/.test(name)
    )
  ) {
    throw new Error(`离心机机器族合并失败: ${centrifugeMachineNames.join(', ')}`)
  }
  if (new Set(machineChoiceNames).size !== machineChoiceNames.length) {
    throw new Error(`配方机器候选存在重复: ${machineChoiceNames.join(', ')}`)
  }
  await page.screenshot({
    path: path.join(outputDir, 'ui-smoke.png'),
    fullPage: true
  })
  console.log(
    JSON.stringify({
      title: await page.title(),
      appShell: await page.locator('.app-shell').count(),
      versionDialog: await page.locator('.version-dialog').count(),
      machineRows: await page.locator('.machine-row').count(),
      recipeRows: await page.locator('.recipe-result-row').count(),
      emptyNodeRendered,
      configuredNodeRendered,
      edgeRendered,
      autoLayoutNodeCount,
      machineChoiceNames,
      centrifugeMachineNames,
      machineChoicesCollapsed,
      selectedMachineSummary,
      changeMachineSelectVisible,
      inspectorLayout,
      recipeListLayout,
      calculationModalSeen,
      invalidNodeHighlighted,
      invalidBlockedModal,
      solveStatus: await page.locator('.warning-group header span').textContent(),
      errors
    })
  )
} finally {
  await app.close()
  for (const [file, contents] of backups) {
    if (contents === null) {
      await rm(file, { force: true })
    } else {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, contents)
    }
  }
}
