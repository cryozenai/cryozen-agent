import fs from 'node:fs'
import path from 'node:path'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import { startMockServer } from '../../../tests-js/scripts/mock-server'
import { RealSessionBuilder } from './real-session-builder'
import { expect, test } from './test'

// The Bot Mode roster ships locale bundles (en/ja), but a handful of
// row strings stayed English literals after the bundle landed: the bot row's
// right-click Pin/Hide/Groups entries and the group row's "N bots" / "N of M
// available" preview and accessible name. Under display.language=ja a Japanese
// reader saw an English menu inside an otherwise translated pane.

type Page = MockBackendFixture['page']

let fixture: MockBackendFixture | null = null

const SHOTS = process.env.BOTS_I18N_SHOTS || ''

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) {
    return
  }

  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

async function openBots(page: Page): Promise<void> {
  const tab = page
    .getByRole('button', { name: 'Bots', exact: true })
    .or(page.getByRole('tab', { name: 'Bots', exact: true }))
    .first()

  await tab.click()
  // The `+` button's accessible name comes from the ja bundle.
  await expect(page.getByRole('button', { name: '新しいボットまたはグループチャット' })).toBeVisible()
}

async function seedBot(cryozenHome: string, mockUrl: string, name: string): Promise<void> {
  const dir = path.join(cryozenHome, 'profiles', name)
  fs.mkdirSync(dir, { recursive: true })
  writeMockProviderConfig(dir, mockUrl, '  language: ja')
  writeEnvFile(dir)

  const builder = await RealSessionBuilder.start(dir)

  try {
    await builder.createSession({ title: 'Bot Chat', turns: [`Hello ${name}`] })
  } finally {
    await builder.close()
  }
}

test.beforeAll(async () => {
  const mock = await startMockServer()
  const sandbox = createSandbox('bots-i18n')
  writeMockProviderConfig(sandbox.cryozenHome, mock.url, '  language: ja')
  writeEnvFile(sandbox.cryozenHome)
  await seedBot(sandbox.cryozenHome, mock.url, 'alpha')
  await seedBot(sandbox.cryozenHome, mock.url, 'beta')

  const { app, page } = await launchDesktop(buildAppEnv(sandbox))

  fixture = {
    app,
    page,
    mock,
    mockUrl: mock.url,
    sandbox,
    cleanup: async () => {
      await app.close().catch(() => undefined)
      await mock.close()
      sandbox.cleanup()
    }
  }
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('the bot row context menu is in the active language (ja)', async () => {
  test.setTimeout(300_000)
  const page = fixture!.page

  await openBots(page)

  const alphaRow = page.getByRole('button', { name: /^alpha\b/i }).filter({ visible: true }).first()
  await expect(alphaRow).toBeVisible({ timeout: 30_000 })
  await alphaRow.click({ button: 'right' })

  const menu = page.getByRole('menu').filter({ visible: true }).first()
  await expect(menu).toBeVisible({ timeout: 10_000 })
  await expect(menu.getByRole('menuitem', { name: '先頭にピン留め' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: '非表示' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'グループを管理…' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Pin to top' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Hide' })).toHaveCount(0)
  await shot(page, 'bot-row-context-menu-ja')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('a fresh group row previews its member count and availability in ja', async () => {
  test.setTimeout(300_000)
  const page = fixture!.page

  await openBots(page)
  await page.getByRole('button', { name: '新しいボットまたはグループチャット' }).click()
  await page.getByRole('menuitem', { name: '新しいグループチャット' }).click()

  const dialog = page.getByRole('dialog', { name: '新しいグループチャット' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  for (const name of ['Alpha @alpha', 'Beta @beta']) {
    await dialog.getByRole('checkbox', { name }).click()
  }

  await dialog.getByRole('textbox', { name: 'グループ名' }).fill('crew')
  await dialog.getByRole('button', { name: /Create Group/ }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  const groupRow = page.getByRole('button', { name: /^crew, / }).filter({ visible: true }).first()
  await expect(groupRow).toBeVisible({ timeout: 30_000 })
  await expect(groupRow).toHaveAccessibleName('crew, ボット2体, 2体中2体が利用可能')
  await expect(groupRow.getByText('ボット2体', { exact: true })).toBeVisible()
  await expect(page.getByText('2 bots', { exact: true })).toHaveCount(0)
  await shot(page, 'group-row-ja')
})
