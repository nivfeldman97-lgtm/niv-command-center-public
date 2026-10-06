import { test, expect, chromium } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'

const USER = '11111111-1111-4111-8111-111111111111'
const GOAL = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-09-15T07:00:00Z')
const AUTH_STORAGE_KEY = 'sb-dashboard-test-auth-token'

async function fixture(page, { missingCache = false, microsoftAuth = false, sharedState, now = NOW } = {}) {
  const state = sharedState || {
    failPatch: false, goalWrites: 0, failures: [], authRequests: [],
    goals: [{ id: GOAL, user_id: USER, title: 'Project Launch', start_date: '2026-09-01', target_date: '2026-11-01', category: 'Personal', progress: 20, status: 'Active', notes: 'Original notes' }],
    milestones: [], planning_blocks: [], dashboard_today_selections: [],
    cached_todo_tasks: [
      { id: 'cache-open', user_id: USER, microsoft_task_id: 'task-open', microsoft_list_id: 'certification', title: 'Complete Certification', list_name: 'Certification', status: 'notStarted', important: true, due_at: '2026-09-15T00:00:00Z' },
      { id: 'cache-done', user_id: USER, microsoft_task_id: 'task-done', microsoft_list_id: 'certification', title: 'COMPLETED MUST NEVER APPEAR', list_name: 'Certification', status: 'completed', important: true, due_at: '2026-09-15T00:00:00Z' },
      { id: 'cache-overdue', user_id: USER, microsoft_task_id: 'task-overdue', microsoft_list_id: 'home', title: 'Buy groceries', list_name: 'Home', status: 'inProgress', important: false, due_at: '2026-09-14T00:00:00Z' },
    ],
    cached_calendar_events: [{ id: 'cache-event', user_id: USER, microsoft_event_id: 'outlook-event', title: 'Outlook meeting', start_at: '2026-09-15T10:00:00Z', end_at: '2026-09-15T11:00:00Z', is_all_day: false }],
    microsoft_sync_state: [{ user_id: USER, synced_at: '2026-09-15T06:00:00Z', calendar_start: '2026-09-01T00:00:00Z', calendar_end: '2026-10-01T00:00:00Z' }],
  }
  page.on('pageerror', (error) => state.failures.push(error.message))
  await page.clock.install({ time: now })
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url())
    if (microsoftAuth && url.origin === 'http://127.0.0.1:5174' && url.pathname === '/src/lib/microsoft.js') {
      // Enable the real application/MSAL code with synthetic configuration only
      // in this test; identity and Graph responses are intercepted below.
      const response = await route.fetch()
      const body = (await response.text())
        .replaceAll('import.meta.env.VITE_MS_CLIENT_ID', JSON.stringify('44444444-4444-4444-8444-444444444444'))
        .replaceAll('import.meta.env.VITE_MS_TENANT_ID', JSON.stringify('common'))
        .replaceAll('import.meta.env.VITE_MS_REDIRECT_URI', JSON.stringify('http://127.0.0.1:5174/redirect.html'))
      return route.fulfill({ response, body })
    }
    if (url.origin === 'http://127.0.0.1:5174') return route.continue()
    if (microsoftAuth && ['login.microsoftonline.com', 'graph.microsoft.com'].includes(url.hostname)) return route.fallback()
    if (url.origin !== 'https://dashboard-test.supabase.invalid') return route.abort()
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.startsWith('/auth/v1/')) {
      state.authRequests.push({ path: url.pathname, grant: url.searchParams.get('grant_type'), scope: url.searchParams.get('scope') })
      if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 })
      const user = { id: USER, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
      if (url.pathname.endsWith('/user')) return json(user)
      const exp = Math.floor(Date.now() / 1000) + 86400 * 10
      const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: USER, exp, role: 'authenticated' })).toString('base64url')}.test-signature`
      return json({ access_token: token, refresh_token: 'fixture-refresh-token', token_type: 'bearer', expires_in: 86400 * 10, expires_at: exp, user })
    }
    const table = url.pathname.split('/').at(-1)
    if (table === 'dashboard_today_selections' && req.method() !== 'GET' && state.failTodaySave) return json({ message: 'Simulated failed save' }, 500)
    if (microsoftAuth && table === 'microsoft_sync_clock') return json(new Date().toISOString())
    if (microsoftAuth && table === 'replace_microsoft_cache') {
      state.cachePayload = req.postDataJSON()
      return json({ accepted: true, synced_at: new Date().toISOString() })
    }
    if (missingCache && ['planning_blocks', 'cached_todo_tasks', 'cached_calendar_events', 'microsoft_sync_state'].includes(table)) return json({ code: '42P01', message: 'Table missing' }, 404)
    if (!Array.isArray(state[table])) return json({ message: `Unexpected test endpoint: ${table}` }, 400)
    let rows = state[table]
    for (const [key, value] of url.searchParams) if (value.startsWith('eq.')) rows = rows.filter((row) => String(row[key]) === value.slice(3))
    if (req.method() === 'POST') {
      const draft = req.postDataJSON()
      const existing = table === 'dashboard_today_selections' && state[table].find((row) =>
        ['user_id', 'local_date', 'microsoft_task_id', 'microsoft_list_id'].every((key) => row[key] === draft[key]))
      rows = [existing || { ...draft, id: randomUUID() }]
      if (!existing) state[table].push(rows[0])
    } else if (req.method() === 'PATCH') {
      if (table === 'goals') {
        state.goalWrites++
        if (state.failPatch) { state.failPatch = false; return json({ message: 'Simulated failed save' }, 500) }
      }
      const draft = req.postDataJSON()
      rows.forEach((row) => Object.assign(row, draft))
    } else if (req.method() === 'DELETE') {
      state[table] = state[table].filter((row) => !rows.includes(row))
      if (table === 'goals') state.milestones = state.milestones.filter((row) => !rows.some((goal) => goal.id === row.goal_id))
    }
    if (req.headers().accept?.includes('application/vnd.pgrst.object+json')) return json(rows[0] || null)
    return json(rows)
  })
  await page.goto('/')
  return state
}
async function login(page) {
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Long-term Gantt' })).toBeVisible()
}
async function drag(page, mode, dx) {
  const bar = page.locator('.bar').first()
  await bar.scrollIntoViewIfNeeded()
  const rect = await bar.boundingBox()
  const x = mode === 'left' ? rect.x + 3 : mode === 'right' ? rect.x + rect.width - 3 : rect.x + rect.width / 2
  await page.mouse.move(x, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(x + dx, rect.y + rect.height / 2, { steps: 8 })
}

test('Dashboard Today persists between devices, supports remove, and ignores stale task selections', async ({ page, browser }) => {
  const state = await fixture(page)
  state.cached_todo_tasks.find((task) => task.microsoft_task_id === 'task-overdue').due_at = null
  state.dashboard_today_selections.push(...[
    ['task-done', 'certification', '2026-09-15'], ['missing-task', 'home', '2026-09-15'], ['task-overdue', 'home', '2026-09-14'],
  ].map(([task, list, date]) => ({ id: randomUUID(), user_id: USER, microsoft_task_id: task, microsoft_list_id: list, local_date: date })))
  await login(page)
  await page.locator('.filters').getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.locator('.task')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add to Today: Complete Certification', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove from Today: Complete Certification', exact: true })).toBeEnabled()
  await expect(page.locator('.task')).toHaveCount(1)
  await page.getByRole('button', { name: 'Remove from Today: Complete Certification', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add to Today: Complete Certification', exact: true })).toBeEnabled()
  await expect(page.locator('.task')).toHaveCount(1)
  await page.locator('.filters').getByRole('button', { name: 'All', exact: true }).click()
  await page.getByRole('button', { name: 'Add to Today: Buy groceries', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true })).toBeEnabled()
  expect(state.dashboard_today_selections.some((row) => row.microsoft_task_id === 'task-overdue' && row.local_date === '2026-09-15')).toBe(true)
  expect(state.cached_todo_tasks.find((task) => task.microsoft_task_id === 'task-overdue').due_at).toBeNull()
  await expect(page.locator('.metric').nth(2)).toContainText('2 tasks in Dashboard Today')

  const device = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', timezoneId: 'Etc/GMT-3', viewport: { width: 390, height: 844 } })
  try {
    const phone = await device.newPage()
    await fixture(phone, { sharedState: state })
    await login(phone)
    await phone.locator('.filters').getByRole('button', { name: 'Today', exact: true }).click()
    await expect(phone.locator('.task')).toHaveCount(2)
    await expect(phone.getByText('Microsoft not connected', { exact: true })).toBeVisible()
    await expect(phone.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true })).toBeEnabled()
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await phone.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true }).click()
    await expect(phone.locator('.task')).toHaveCount(1)
    await page.locator('.filters').getByRole('button', { name: 'Today', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh cache', exact: true }).click()
    await expect(page.locator('.task')).toHaveCount(1)
    await page.locator('.filters').getByRole('button', { name: 'All', exact: true }).click()
    await page.getByRole('button', { name: 'Add to Today: Buy groceries', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true })).toBeEnabled()
    await phone.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(phone.locator('.task')).toHaveCount(2)
    state.cached_todo_tasks = state.cached_todo_tasks.filter((task) => task.microsoft_task_id !== 'task-overdue')
    await phone.getByRole('button', { name: 'Refresh cache', exact: true }).click()
    await expect(phone.locator('.task')).toHaveCount(1)
    await phone.reload()
    await expect(phone.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    await expect(phone.getByText('Buy groceries', { exact: true })).toHaveCount(0)
  } finally { await device.close() }
  expect(state.failures).toEqual([])
})

test.describe('device-local date', () => {
  test.use({ timezoneId: 'Etc/GMT-3' })
  test('Dashboard Today expires at local midnight and refreshes on resume before the next timer', async ({ page }) => {
    const state = await fixture(page, { now: new Date('2026-09-15T20:59:50Z') })
    state.cached_todo_tasks.find((task) => task.microsoft_task_id === 'task-overdue').due_at = null
    await login(page)
    await page.getByRole('button', { name: 'Add to Today: Buy groceries', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true })).toBeEnabled()
    await page.locator('.filters').getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.locator('.task')).toHaveCount(2)
    await page.clock.fastForward(31000)
    await expect(page.locator('.task')).toHaveCount(0)
    await page.locator('.filters').getByRole('button', { name: 'All', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add to Today: Buy groceries', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Add to Today: Buy groceries', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true })).toBeEnabled()
    expect(state.dashboard_today_selections.map((row) => row.local_date)).toEqual(['2026-09-15', '2026-09-16'])
    await page.locator('.filters').getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.locator('.task')).toHaveCount(1)
    await page.clock.setSystemTime(new Date('2026-09-16T21:01:00Z'))
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.locator('.task')).toHaveCount(0)
    expect(state.failures).toEqual([])
  })

})

test('failed Dashboard Today saves preserve confirmed choices and can be retried', async ({ page }) => {
  const state = await fixture(page)
  await login(page)
  state.failTodaySave = true
  await page.getByRole('button', { name: 'Add to Today: Buy groceries', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save Dashboard Today selection')
  expect(state.dashboard_today_selections).toHaveLength(0)
  state.failTodaySave = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.getByRole('button', { name: 'Add to Today: Buy groceries', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true })).toBeEnabled()
  state.failTodaySave = true
  await page.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save Dashboard Today selection')
  await expect(page.getByRole('button', { name: 'Remove from Today: Buy groceries', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(state.dashboard_today_selections).toHaveLength(1)
})

test('private login, cloud cache, active-only cards and filters, responsive layout, logout', async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText('Project Launch')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Week calendar' })).toHaveCount(0)
  await login(page)
  await expect(page.getByText('COMPLETED MUST NEVER APPEAR')).toHaveCount(0)
  await expect(page.locator('.metric')).toHaveCount(4)
  await expect(page.locator('.metric').first().locator('img')).toHaveAttribute('src', '/focus.svg')
  await expect(page.locator('.metric').nth(1)).toContainText('Outlook meeting')
  await expect(page.locator('.metric').nth(2)).toContainText('1 task in Dashboard Today')
  await expect(page.locator('.metric').nth(3)).toContainText('1 course task')
  await expect(page.getByText('Microsoft not connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset demo' })).toHaveCount(0)
  for (const filter of ['Today', 'Important', 'Courses']) {
    await page.locator('.filters').getByRole('button', { name: filter, exact: true }).click()
    await expect(page.locator('.task')).toHaveCount(1)
    await expect(page.locator('.task')).toContainText('Complete Certification')
  }
  await page.getByRole('button', { name: 'Overdue', exact: true }).click()
  await expect(page.locator('.task')).toContainText('Buy groceries')
  await page.getByRole('button', { name: 'All', exact: true }).click()
  for (const width of [1440, 1024, 621, 620, 430, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `Page overflow at ${width}px`).toBeLessThanOrEqual(width)
    const cards = await page.locator('.metric').evaluateAll((elements) => elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }))
    if (width > 620) {
      expect(cards[0].x).toBeLessThan(cards[1].x)
      expect(cards[0].y).toBe(cards[1].y)
      expect(cards[0].height).toBe(cards[1].height)
    }
    if (width <= 620) {
      expect(cards[0].y + cards[0].height).toBeLessThan(cards[1].y)
      expect(cards[0].width / cards[0].height).toBeCloseTo(4 / 5, 2)
      expect(cards[0].height).toBeGreaterThan(cards[1].height)
    }
    await expect(page.locator('.summary-image img')).toHaveCSS('object-fit', 'contain')
    expect(await page.locator('.summary-image img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true)
    if ([1440, 390].includes(width)) await page.locator('.summary').screenshot({ path: `test-results/summary-${width}.png` })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByText('Complete Certification')).toHaveCount(0)
  await expect(page.getByText('Project Launch')).toHaveCount(0)
  expect(state.failures).toEqual([])
})

test('login form supports password managers and submits autofilled DOM values', async ({ page, context }) => {
  const state = await fixture(page)
  const email = page.getByLabel('Email', { exact: true })
  const password = page.getByLabel('Password', { exact: true })
  await expect(email).toHaveAttribute('type', 'email')
  await expect(email).toHaveAttribute('name', 'email')
  await expect(email).toHaveAttribute('autocomplete', 'username')
  await expect(password).toHaveAttribute('type', 'password')
  await expect(password).toHaveAttribute('name', 'password')
  await expect(password).toHaveAttribute('autocomplete', 'current-password')
  await expect(page.locator('form')).toHaveAttribute('method', 'post')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveAttribute('type', 'submit')
  // Some autofill engines set the input value without dispatching React events.
  await page.evaluate(() => {
    document.querySelector('[name="email"]').value = 'fixture@example.test'
    document.querySelector('[name="password"]').value = 'fixture-password'
  })
  const request = page.waitForRequest((req) => req.url().includes('/auth/v1/token?grant_type=password'))
  await password.press('Enter')
  expect((await request).postDataJSON()).toMatchObject({ email: 'fixture@example.test', password: 'fixture-password' })
  await expect(page.getByRole('heading', { name: 'Long-term Gantt' })).toBeVisible()
  const persisted = await context.storageState({ indexedDB: true })
  expect(JSON.stringify(persisted)).not.toContain('fixture-password')
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('fixture-password')
  expect(state.failures).toEqual([])
})

test('Supabase session survives refresh and refreshes an expired access token on startup', async ({ page }) => {
  const state = await fixture(page)
  await login(page)
  const session = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), AUTH_STORAGE_KEY)
  expect(session.refresh_token).toBe('fixture-refresh-token')
  expect(session.user.id).toBe(USER)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Long-term Gantt' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)
  expect(state.authRequests.filter((req) => req.grant === 'password')).toHaveLength(1)
  await page.evaluate(({ key, now }) => {
    const session = JSON.parse(localStorage.getItem(key))
    session.expires_at = Math.floor(now / 1000) - 60
    localStorage.setItem(key, JSON.stringify(session))
  }, { key: AUTH_STORAGE_KEY, now: NOW.getTime() })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Long-term Gantt' })).toBeVisible()
  expect(state.authRequests.some((req) => req.grant === 'refresh_token')).toBe(true)
  expect(state.authRequests.filter((req) => req.grant === 'password')).toHaveLength(1)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).expires_at, AUTH_STORAGE_KEY)).toBeGreaterThan(NOW.getTime() / 1000)
  expect(state.failures).toEqual([])
})

test('disk-backed browser profile restores login after restart and preserves logout across another restart', async ({}, testInfo) => {
  test.setTimeout(60000)
  // An isolated test-only Chromium profile: no user browser or real account data.
  const profile = testInfo.outputPath('session-profile')
  let context
  async function reopen() {
    context = await chromium.launchPersistentContext(profile, { headless: true, timezoneId: 'UTC' })
    const page = context.pages()[0]
    const state = await fixture(page)
    return { page, state }
  }
  try {
    const first = await reopen()
    await login(first.page)
    await first.page.evaluate(() => localStorage.setItem('unrelated-test-preference', 'keep'))
    expect(await first.page.evaluate((key) => !!localStorage.getItem(key), AUTH_STORAGE_KEY)).toBe(true)
    await context.close()

    const second = await reopen()
    await expect(second.page.getByRole('heading', { name: 'Long-term Gantt' })).toBeVisible()
    expect(second.state.authRequests.some((req) => req.grant === 'password')).toBe(false)
    await second.page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(second.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    expect(second.state.authRequests.find((req) => req.path.endsWith('/logout'))?.scope).toBe('local')
    expect(await second.page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull()
    expect(await second.page.evaluate(() => localStorage.getItem('unrelated-test-preference'))).toBe('keep')
    await context.close()

    const third = await reopen()
    await expect(third.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(third.page.getByRole('heading', { name: 'Long-term Gantt' })).toHaveCount(0)
    expect(await third.page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull()
    expect(third.state.authRequests.some((req) => req.grant === 'refresh_token')).toBe(false)
    expect(await third.page.evaluate(() => localStorage.getItem('unrelated-test-preference'))).toBe('keep')
    for (const state of [first.state, second.state, third.state]) expect(state.failures).toEqual([])
  } finally { await context?.close() }
})

test('goals and milestones save, survive reload, edit and cascade delete', async ({ page }) => {
  const state = await fixture(page)
  await login(page)
  await page.getByRole('button', { name: '+ New goal', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('New direction')
  await page.getByLabel('Start', { exact: true }).fill('2026-09-15')
  await page.getByLabel('Target', { exact: true }).fill('2027-03-15')
  await page.getByLabel('Progress %').fill('45')
  await page.getByLabel('Status', { exact: true }).selectOption('Paused')
  await page.getByLabel('Notes').fill('Persist these notes')
  await page.getByRole('button', { name: 'Save goal', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit goal' })).toBeVisible()
  await page.getByRole('button', { name: '+ Milestone', exact: true }).click()
  await page.getByLabel('Milestone title').fill('First checkpoint')
  await page.getByLabel('Milestone date').fill('2026-10-15')
  await page.getByLabel('Milestone status').selectOption('Active')
  await page.getByRole('button', { name: 'Save milestone', exact: true }).click()
  await expect(page.locator('.milestone-item')).toContainText('First checkpoint')
  await page.getByRole('button', { name: 'Close drawer' }).click()
  await page.reload()
  await expect(page.locator('.milestone')).toHaveCount(1)
  await page.locator('.g-label').filter({ hasText: 'New direction' }).click()
  await expect(page.getByLabel('Notes')).toHaveValue('Persist these notes')
  await expect(page.getByLabel('Progress %')).toHaveValue('45')
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Paused')
  await page.locator('.milestone-item').click()
  await page.getByLabel('Milestone title').fill('Revised checkpoint')
  await page.getByLabel('Milestone date').fill('2026-11-15')
  await page.getByLabel('Milestone status').selectOption('Done')
  await page.getByRole('button', { name: 'Save milestone', exact: true }).click()
  await expect(page.locator('.milestone-item')).toContainText('Done')
  await page.locator('.milestone-item').click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete milestone', exact: true }).click()
  await expect(page.locator('.milestone-item')).toHaveCount(0)
  await page.getByRole('button', { name: '+ Milestone', exact: true }).click()
  await page.getByLabel('Milestone title').fill('Cascade child')
  await page.getByRole('button', { name: 'Save milestone', exact: true }).click()
  await expect(page.locator('.milestone-item')).toHaveCount(1)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete goal', exact: true }).click()
  await expect(page.locator('.g-label').filter({ hasText: 'New direction' })).toHaveCount(0)
  expect(state.milestones).toHaveLength(0)
  expect(state.failures).toEqual([])
})

test('Gantt drag and both edges write once on release; failed saves restore confirmed dates', async ({ page }) => {
  const state = await fixture(page)
  await login(page)
  for (const mode of ['move', 'left', 'right']) {
    const before = state.goalWrites
    const start = state.goals[0].start_date, end = state.goals[0].target_date
    await drag(page, mode, mode === 'left' ? -18 : 18)
    expect(state.goalWrites).toBe(before)
    await page.mouse.up()
    await expect.poll(() => state.goalWrites).toBe(before + 1)
    if (mode !== 'right') await expect.poll(() => state.goals[0].start_date).not.toBe(start)
    if (mode !== 'left') await expect.poll(() => state.goals[0].target_date).not.toBe(end)
    await page.waitForTimeout(100)
  }
  const confirmed = { ...state.goals[0] }
  state.failPatch = true
  await drag(page, 'move', 25)
  await page.mouse.up()
  await expect(page.getByRole('alert')).toContainText('Could not save goals')
  expect(state.goals[0]).toEqual(confirmed)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.locator('.g-label').click()
  await expect(page.getByLabel('Start', { exact: true })).toHaveValue(confirmed.start_date)
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue(confirmed.target_date)
  await page.getByRole('button', { name: 'Close drawer' }).click()
  await page.getByRole('button', { name: 'Next year', exact: true }).click()
  await expect(page.locator('.gantt-tools')).toContainText(['2027'])
  await page.getByRole('button', { name: 'Previous year', exact: true }).click()
  await page.reload()
  await expect(page.locator('.bar')).toHaveCount(1)
  expect(state.failures).toEqual([])
})

test('task planning creates separate time blocks and supports editing, reload, deletion', async ({ page }) => {
  const state = await fixture(page)
  await login(page)
  const due = state.cached_todo_tasks[0].due_at
  await page.locator('.task').filter({ hasText: 'Complete Certification' }).getByRole('button', { name: 'Plan time' }).click()
  await page.getByLabel('Start time', { exact: true }).fill('2026-09-16T18:00')
  await page.getByLabel('End time', { exact: true }).fill('2026-09-16T20:00')
  await page.getByRole('button', { name: 'Save block', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.planning_blocks[0].microsoft_task_id).toBe('task-open')
  expect(state.cached_todo_tasks[0].due_at).toBe(due)
  await page.reload()
  await expect(page.locator('.event.plan')).toHaveCount(1)
  await page.locator('.event.plan').click()
  await page.getByLabel('Title', { exact: true }).fill('Certification review')
  await page.getByLabel('End time', { exact: true }).fill('2026-09-16T21:00')
  await page.getByRole('button', { name: 'Save block', exact: true }).click()
  await expect(page.locator('.event.plan')).toContainText('Certification review')
  await page.locator('.event.plan').click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete block', exact: true }).click()
  await expect(page.locator('.event.plan')).toHaveCount(0)
  await page.getByRole('button', { name: 'Next week', exact: true }).click()
  await expect(page.locator('.cal-head > div').nth(1)).toHaveText(/Sun.*20|20.*Sun/)
  await page.locator('.calendar-tools').getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.locator('.cal-head > div').nth(1)).toHaveText(/Sun.*13|13.*Sun/)
  expect(state.failures).toEqual([])
})

test.describe('Sunday-first calendar in a local time zone', () => {
  test.use({ timezoneId: 'Asia/Jerusalem' })

  for (const [label, instant, first, last, today] of [
    ['Sunday while UTC is Saturday', '2026-09-12T21:30:00Z', /Sun.*13|13.*Sun/, /Sat.*19|19.*Sat/, /Sun/],
    ['Saturday before midnight', '2026-09-19T20:59:00Z', /Sun.*13|13.*Sun/, /Sat.*19|19.*Sat/, /Sat/],
    ['month boundary', '2026-09-01T09:00:00Z', /Sun.*30|30.*Sun/, /Sat.*5|5.*Sat/, /Tue/],
    ['year boundary', '2027-01-01T10:00:00Z', /Sun.*27|27.*Sun/, /Sat.*2|2.*Sat/, /Fri/],
  ]) {
    test(`current calendar week uses local Sunday-Saturday boundaries: ${label}`, async ({ page }) => {
      await fixture(page, { now: new Date(instant) })
      await login(page)
      const headers = page.locator('.cal-head > div')
      await expect(headers.nth(1)).toHaveText(first)
      await expect(headers.nth(7)).toHaveText(last)
      await expect(page.locator('.cal-head .today')).toHaveText(today)
      await page.getByRole('button', { name: 'Next week', exact: true }).click()
      await expect(page.locator('.cal-head .today')).toHaveCount(0)
      await page.locator('.calendar-tools').getByRole('button', { name: 'Today', exact: true }).click()
      await expect(headers.nth(1)).toHaveText(first)
      await expect(headers.nth(7)).toHaveText(last)
    })
  }

  test('Sunday and Saturday events, all-day spans, overlaps and planning survive navigation and responsive layouts', async ({ page }) => {
    const state = await fixture(page)
    const event = (id, start, end, allDay = false) => ({ id, user_id: USER, microsoft_event_id: id, title: id, start_at: start, end_at: end, is_all_day: allDay })
    state.cached_calendar_events = [
      event('Sunday meeting', '2026-09-13T09:00:00+03:00', '2026-09-13T11:00:00+03:00'),
      event('Saturday meeting', '2026-09-19T09:00:00+03:00', '2026-09-19T11:00:00+03:00'),
      event('Sunday all day', '2026-09-13T00:00:00+03:00', '2026-09-14T00:00:00+03:00', true),
      event('Saturday all day', '2026-09-19T00:00:00+03:00', '2026-09-20T00:00:00+03:00', true),
      event('Across Sunday midnight', '2026-09-12T23:00:00+03:00', '2026-09-13T01:00:00+03:00'),
      event('Across Saturday midnight', '2026-09-19T23:00:00+03:00', '2026-09-20T01:00:00+03:00'),
      event('Boundary all day', '2026-09-19T00:00:00+03:00', '2026-09-21T00:00:00+03:00', true),
      event('Previous Saturday only', '2026-09-12T23:00:00+03:00', '2026-09-13T00:00:00+03:00'),
      event('Next Sunday only', '2026-09-20T00:00:00+03:00', '2026-09-20T01:00:00+03:00'),
    ]
    state.planning_blocks.push({ id: 'weekend-plan', user_id: USER, title: 'Sunday planning', start_at: '2026-09-13T10:00:00+03:00', end_at: '2026-09-13T12:00:00+03:00' })
    await login(page)
    const headers = page.locator('.cal-head > div')
    const columns = page.locator('.daycol')
    for (const width of [1440, 1024, 768, 430, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(headers).toHaveCount(8)
      for (const [index, day] of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].entries()) {
        await expect(headers.nth(index + 1)).toContainText(day)
      }
      await expect(columns.first()).toContainText('Sunday meeting')
      await expect(columns.last()).toContainText('Saturday meeting')
      await expect(columns.first()).toContainText('Across Sunday midnight')
      await expect(columns.last()).toContainText('Across Saturday midnight')
      await expect(page.locator('.all-day').first()).toHaveText('Sunday all day')
      await expect(page.locator('.all-day').last()).toContainText('Saturday all day')
      await expect(page.locator('.all-day').last()).toContainText('Boundary all day')
      await expect(page.locator('.all-day > div')).toHaveCount(3)
      await expect(page.locator('.calendar')).not.toContainText('Previous Saturday only')
      await expect(page.locator('.calendar')).not.toContainText('Next Sunday only')
      const meeting = await columns.first().locator('.event').filter({ hasText: 'Sunday meeting' }).boundingBox()
      const planning = await columns.first().locator('.event.plan').boundingBox()
      expect(meeting.x + meeting.width).toBeLessThanOrEqual(planning.x)
      expect(planning.y).toBeLessThan(meeting.y + meeting.height)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.locator('.calendar-wrap').scrollIntoViewIfNeeded()
      await page.locator('.calendar-wrap').evaluate((element) => { element.scrollTop = 0; element.scrollLeft = element.scrollWidth })
      await expect(headers.last()).toBeInViewport()
      await page.locator('.calendar-wrap').evaluate((element) => { element.scrollLeft = 0 })
    }
    await page.getByRole('button', { name: 'Previous week', exact: true }).click()
    await expect(headers.nth(1)).toHaveText(/Sun.*6|6.*Sun/)
    await expect(columns.last()).toContainText('Previous Saturday only')
    await page.getByRole('button', { name: 'Next week', exact: true }).click()
    await expect(headers.nth(1)).toHaveText(/Sun.*13|13.*Sun/)
    await page.getByRole('button', { name: 'Next week', exact: true }).click()
    await expect(headers.nth(1)).toHaveText(/Sun.*20|20.*Sun/)
    await expect(headers.nth(7)).toHaveText(/Sat.*26|26.*Sat/)
    await expect(columns.first()).toContainText('Next Sunday only')
    await expect(columns.first()).toContainText('Across Saturday midnight')
    await expect(page.locator('.all-day').first()).toHaveText('Boundary all day')
    await expect(page.locator('.all-day > div')).toHaveCount(1)
    await page.getByRole('button', { name: '+ Planning block', exact: true }).click()
    await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('2026-09-20T09:00')
    await page.getByRole('button', { name: 'Close drawer' }).click()
    await page.locator('.calendar-tools').getByRole('button', { name: 'Today', exact: true }).click()
    await expect(headers.nth(1)).toHaveText(/Sun.*13|13.*Sun/)
    await expect(columns.first()).toContainText('Sunday planning')
    expect(state.failures).toEqual([])
  })

})

test('missing optional schema and Microsoft config do not block goals', async ({ page }) => {
  const state = await fixture(page, { missingCache: true })
  await login(page)
  await expect(page.getByText('Microsoft cache unavailable.', { exact: false })).toBeVisible()
  await expect(page.locator('.g-label')).toContainText('Project Launch')
  await expect(page.getByRole('button', { name: 'Connect Microsoft' })).toHaveCount(0)
  await page.locator('.g-label').click()
  await page.getByLabel('Title', { exact: true }).fill('Still editable')
  await page.getByRole('button', { name: 'Save goal', exact: true }).click()
  await expect(page.locator('.g-label')).toContainText('Still editable')
  expect(state.failures).toEqual([])
})

test('cached Outlook colors and readable text render without Microsoft across desktop, iPad and iPhone widths', async ({ page }) => {
  const state = await fixture(page)
  const legacy = state.cached_calendar_events[0]
  state.cached_calendar_events.push(
    { ...legacy, id: 'dark', microsoft_event_id: 'dark', title: 'Dark Outlook event', color_hex: '#004e8c' },
    { ...legacy, id: 'light', microsoft_event_id: 'light', title: 'Light Outlook event', color_hex: '#ffeb3b' },
    { ...legacy, id: 'null', microsoft_event_id: 'null', title: 'Null color event', color_hex: null },
    { ...legacy, id: 'all-day', microsoft_event_id: 'all-day', title: 'Colored all day', color_hex: '#ffeb3b', is_all_day: true, start_at: '2026-09-15T00:00:00Z', end_at: '2026-09-16T00:00:00Z' },
    { ...legacy, id: 'legacy-all-day', microsoft_event_id: 'legacy-all-day', title: 'Legacy all day', is_all_day: true, start_at: '2026-09-15T00:00:00Z', end_at: '2026-09-16T00:00:00Z' },
  )
  state.planning_blocks.push({ id: 'plan', user_id: USER, title: 'Planning unchanged', start_at: legacy.start_at, end_at: legacy.end_at })
  const microsoftRequests = []
  page.on('request', (request) => {
    if (/graph\.microsoft\.com|login\.microsoftonline\.com/.test(request.url())) microsoftRequests.push(request.url())
  })
  await login(page)
  const event = (title) => page.locator('.event.outlook').filter({ hasText: title })
  for (const width of [1440, 1024, 768, 430, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByText('Microsoft not connected', { exact: true })).toBeVisible()
    await expect(event('Dark Outlook event')).toHaveCSS('background-color', 'rgb(0, 78, 140)')
    await expect(event('Dark Outlook event')).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(event('Light Outlook event')).toHaveCSS('background-color', 'rgb(255, 235, 59)')
    await expect(event('Light Outlook event')).toHaveCSS('color', 'rgb(0, 0, 0)')
    for (const title of ['Outlook meeting', 'Null color event']) {
      await expect(event(title)).toHaveCSS('background-color', 'rgb(37, 99, 235)')
      await expect(event(title)).toHaveCSS('color', 'rgb(255, 255, 255)')
    }
    await expect(page.locator('.all-day > div').filter({ hasText: 'Colored all day' })).toHaveCSS('background-color', 'rgb(255, 235, 59)')
    await expect(page.locator('.all-day > div').filter({ hasText: 'Colored all day' })).toHaveCSS('color', 'rgb(0, 0, 0)')
    await expect(page.locator('.all-day > div').filter({ hasText: 'Legacy all day' })).toHaveCSS('background-color', 'rgb(239, 246, 255)')
    expect(await page.locator('.event.plan').evaluate((element) => element.style.backgroundColor)).toBe('')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.reload()
  await expect(event('Dark Outlook event')).toHaveCSS('background-color', 'rgb(0, 78, 140)')
  state.cached_calendar_events.find((row) => row.id === 'dark').color_hex = '#ffeb3b'
  await page.getByRole('button', { name: 'Refresh cache', exact: true }).click()
  await expect(event('Dark Outlook event')).toHaveCSS('background-color', 'rgb(255, 235, 59)')
  await expect(event('Dark Outlook event')).toHaveCSS('color', 'rgb(0, 0, 0)')
  expect(microsoftRequests).toEqual([])
  expect(state.failures).toEqual([])
})

for (const scenario of ['normal', 'failed consent then retry', 'closed popup then retry', 'reload after abandoned popup', 'repeated clicks', 'blocked popup then retry']) {
test(`Connect Microsoft: ${scenario}; common, read scopes, PKCE, redirect bridge and token isolation`, async ({ page, context }) => {
  const clientId = '44444444-4444-4444-8444-444444444444'
  const tenantId = '55555555-5555-4555-8555-555555555555'
  const accountId = '66666666-6666-4666-8666-666666666666'
  let authorization, tokenRequest, authorizationCount = 0
  const graphRequests = []
  await context.route('https://login.microsoftonline.com/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/authorize')) {
      authorizationCount++
      authorization = url
      return route.fulfill({ contentType: 'text/html', body: '<h1>Microsoft login fixture</h1>' })
    }
    if (url.pathname.endsWith('/token')) {
      tokenRequest = new URLSearchParams(route.request().postData())
      const exp = Math.floor(NOW.getTime() / 1000) + 3600
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const idToken = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ aud: clientId, iss: `https://login.microsoftonline.com/${tenantId}/v2.0`, tid: tenantId, oid: accountId, sub: accountId, nonce: authorization.searchParams.get('nonce'), preferred_username: 'fixture@example.test', iat: exp - 3600, exp })}.fixture-signature`
      return route.fulfill({ json: { token_type: 'Bearer', scope: 'User.Read Calendars.Read Tasks.Read MailboxSettings.Read', expires_in: 3600, access_token: 'fixture-microsoft-access-token', refresh_token: 'fixture-microsoft-refresh-token', id_token: idToken, client_info: encode({ uid: accountId, utid: tenantId }) } })
    }
    throw new Error(`Unexpected Microsoft auth request: ${url.pathname}`)
  })
  await context.route('https://graph.microsoft.com/**', async (route) => {
    graphRequests.push({ url: route.request().url(), method: route.request().method(), authorization: route.request().headers().authorization })
    await route.fulfill({ json: { value: [] } })
  })
  const state = await fixture(page, { microsoftAuth: true })
  await login(page)
  async function connect() {
    const popupPromise = page.waitForEvent('popup')
    const button = page.getByRole('button', { name: 'Connect Microsoft', exact: true })
    if (scenario === 'repeated clicks') await button.evaluate((button) => { button.click(); button.click(); button.click() })
    else await button.click()
    const popup = await popupPromise
    await expect(popup.getByRole('heading', { name: 'Microsoft login fixture' })).toBeVisible()
    return popup
  }
  const interaction = () => page.evaluate(() => sessionStorage.getItem('msal.interaction.status'))
  if (scenario === 'blocked popup then retry') {
    await page.evaluate(() => {
      const open = window.open
      window.open = (...args) => { window.open = open; return null }
    })
    await page.getByRole('button', { name: 'Connect Microsoft', exact: true }).click()
    await expect(page.getByText('Microsoft sign-in was cancelled or the popup was blocked.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect Microsoft', exact: true })).toBeEnabled()
    expect(await interaction()).toBeNull()
    expect(authorizationCount).toBe(0)
  }
  let popup = await connect()
  expect(JSON.parse(await interaction()).clientId).toBe(clientId)
  if (scenario === 'failed consent then retry') {
    const denied = new URL(authorization.searchParams.get('redirect_uri'))
    denied.hash = new URLSearchParams({ error: 'access_denied', error_description: 'Sign-in cancelled', state: authorization.searchParams.get('state') }).toString()
    await popup.goto(denied.href, { waitUntil: 'commit' }).catch((error) => { if (!popup.isClosed()) throw error })
    await expect(page.getByRole('button', { name: 'Connect Microsoft', exact: true })).toBeEnabled()
    await expect(page.getByText('Microsoft sign-in was cancelled or access was denied.', { exact: false })).toBeVisible()
    expect(await interaction()).toBeNull()
    expect(tokenRequest).toBeUndefined()
    popup = await connect()
  } else if (scenario === 'closed popup then retry') {
    await popup.close()
    // MSAL v5 uses BroadcastChannel, not window.closed polling. Let its
    // documented 60-second bridge timeout settle the request before retrying.
    await page.clock.fastForward(61000)
    await expect(page.getByRole('button', { name: 'Connect Microsoft', exact: true })).toBeEnabled()
    await expect(page.getByText('Microsoft sign-in did not finish.', { exact: false })).toBeVisible()
    expect(await interaction()).toBeNull()
    expect(tokenRequest).toBeUndefined()
    popup = await connect()
  } else if (scenario === 'reload after abandoned popup') {
    await popup.close()
    // Reload destroys the pending JS promise before MSAL's finally can run,
    // but its sessionStorage interaction flag survives even with memoryStorage.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Connect Microsoft', exact: true })).toBeEnabled()
    expect(JSON.parse(await interaction()).clientId).toBe(clientId)
    popup = await connect()
  } else if (scenario === 'repeated clicks') {
    const busy = page.getByRole('button', { name: 'Syncing', exact: false })
    await expect(busy).toBeDisabled()
    const recordedInteraction = await interaction()
    await busy.evaluate((button) => { button.click(); button.click(); button.click() })
    // Even a second connection instance cannot clear the first one's MSAL flag.
    const conflict = await page.evaluate(async () => {
      const { createMicrosoftConnection } = await import('/src/lib/microsoft.js')
      const other = await createMicrosoftConnection()
      try { await other.token(true); return 'unexpected success' }
      catch (error) { return error.errorCode }
    })
    expect(conflict).toBe('interaction_in_progress')
    expect(authorizationCount).toBe(1)
    expect(context.pages()).toHaveLength(2)
    expect(await interaction()).toBe(recordedInteraction)
  }
  await expect(popup.getByRole('heading', { name: 'Microsoft login fixture' })).toBeVisible()
  expect(authorization.origin + authorization.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
  const params = authorization.searchParams
  expect(params.get('client_id')).toBe(clientId)
  expect(params.get('redirect_uri')).toBe('http://127.0.0.1:5174/redirect.html')
  expect(params.get('response_type')).toBe('code')
  expect(params.get('code_challenge_method')).toBe('S256')
  expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/)
  expect(params.get('prompt')).toBe('select_account')
  expect(params.get('scope').split(' ').sort()).toEqual(['User.Read', 'Tasks.Read', 'Calendars.Read', 'MailboxSettings.Read', 'openid', 'profile', 'offline_access'].sort())
  const callback = new URL(params.get('redirect_uri'))
  callback.hash = new URLSearchParams({ code: 'fixture-authorization-code', state: params.get('state') }).toString()
  // The real redirect.html bridge broadcasts the response and closes the popup.
  // Navigation can reject when window.close() runs before Playwright observes load.
  await popup.goto(callback.href, { waitUntil: 'commit' }).catch((error) => {
    if (!popup.isClosed()) throw error
  })
  await expect(page.getByText('Microsoft connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled()
  expect(await interaction()).toBeNull()
  expect(authorizationCount).toBe(['normal', 'repeated clicks', 'blocked popup then retry'].includes(scenario) ? 1 : 2)
  await expect.poll(() => popup.isClosed()).toBe(true)
  expect(tokenRequest.get('grant_type')).toBe('authorization_code')
  expect(tokenRequest.get('code')).toBe('fixture-authorization-code')
  expect(tokenRequest.get('redirect_uri')).toBe(params.get('redirect_uri'))
  expect(tokenRequest.has('client_secret')).toBe(false)
  expect(createHash('sha256').update(tokenRequest.get('code_verifier')).digest('base64url')).toBe(params.get('code_challenge'))
  expect(graphRequests.length).toBeGreaterThan(0)
  expect(graphRequests.every((req) => req.method === 'GET' && req.authorization === 'Bearer fixture-microsoft-access-token')).toBe(true)
  expect(state.cachePayload).toBeDefined()
  const calendarRange = () => {
    const query = new URL(graphRequests.filter((req) => new URL(req.url).pathname.endsWith('/calendarView')).at(-1).url).searchParams
    return [query.get('startDateTime'), query.get('endDateTime')]
  }
  // The public browser suite uses UTC; both query boundaries are Sunday midnight.
  expect(calendarRange()).toEqual(['2026-08-30T00:00:00.000Z', '2026-10-25T00:00:00.000Z'])
  if (scenario === 'normal') {
    // Browsing beyond either end extends the existing sync window to cover the
    // entire displayed week. Separate date tests cover DST in local time zones.
    for (let index = 0; index < 7; index++) await page.getByRole('button', { name: 'Next week', exact: true }).click()
    await page.getByRole('button', { name: 'Sync now', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled()
    expect(calendarRange()).toEqual(['2026-08-30T00:00:00.000Z', '2026-11-08T00:00:00.000Z'])
    await expect(page.getByText('No Microsoft snapshot for this week yet.', { exact: false })).toHaveCount(0)
    await page.locator('.calendar-tools').getByRole('button', { name: 'Today', exact: true }).click()
    for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'Previous week', exact: true }).click()
    await page.getByRole('button', { name: 'Sync now', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled()
    expect(calendarRange()).toEqual(['2026-08-23T00:00:00.000Z', '2026-10-25T00:00:00.000Z'])
    await expect(page.getByText('No Microsoft snapshot for this week yet.', { exact: false })).toHaveCount(0)
  }
  expect(JSON.stringify(state.cachePayload)).not.toContain('token')
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(stored).not.toContain('fixture-microsoft-access-token')
  expect(stored).not.toContain('fixture-microsoft-refresh-token')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connect Microsoft', exact: true })).toBeEnabled()
  expect(state.failures).toEqual([])
})
}
