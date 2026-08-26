// Keyless assembled-browser coverage for the Dashboard Web Shell. The overlay
// (packages/bundle/web-app/dashboard.patch.yml) replaces the shipped native
// chrome with the Agent-first Dashboard shell; this lane asserts the shell's
// stable data-* surface — Agent navigation, selection, the new-session
// affordance, and the re-hosted conversation seat — over the shipped Web
// bundles and the FixtureApiClient wire. No model is called and no replay
// fixture is mounted: this is a pure UI-shell contract.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('../../../packages/bundle/web-app/dashboard.patch.yml', import.meta.url))
const AGENTS = ['coder', 'btender', 'invest', 'video'] as const

describe('web e2e: dashboard shell chrome', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, welcomeNoticePending: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(`${scaffold.baseUrl}?fixture`, { waitUntil: 'load' })
    await page.waitForSelector('[data-dsh-shell="dashboard"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('mounts the dashboard shell and hosts the conversation seat', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-dashboard-shell-mount'))
    expect(await page.locator('[data-dsh-shell="dashboard"]').count()).toBe(1)
    expect(await page.locator('[data-conversation-host]').count()).toBe(1)
    expect(await page.locator('[data-new-session]').first().isVisible()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 30_000)

  it('lists every Agent and selects the first by default', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-dashboard-shell-agents'))
    for (const agent of AGENTS) {
      expect(await page.locator(`[data-agent-id="${agent}"]`).count()).toBe(1)
    }
    // The nav carries the live selection; agent buttons carry their own boolean.
    expect(await page.locator('[data-agent-selected]').first().getAttribute('data-agent-selected')).toBe('coder')
    expect(await page.locator('[data-agent-id="coder"]').getAttribute('data-agent-selected')).toBe('true')
    for (const agent of AGENTS.slice(1)) {
      expect(await page.locator(`[data-agent-id="${agent}"]`).getAttribute('data-agent-selected')).toBe('false')
    }
  }, 30_000)

  it('switches the selected Agent through the nav', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-dashboard-shell-switch'))
    await page.locator('[data-agent-id="btender"]').click()
    expect(await page.locator('[data-agent-selected]').first().getAttribute('data-agent-selected')).toBe('btender')
    expect(await page.locator('[data-agent-id="btender"]').getAttribute('data-agent-selected')).toBe('true')
    expect(await page.locator('[data-agent-id="coder"]').getAttribute('data-agent-selected')).toBe('false')
    expect(tripwire.pageErrors).toEqual([])
  }, 30_000)
})
