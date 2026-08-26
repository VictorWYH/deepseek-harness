/** Dashboard shell slot registration and its runtime action forwarding. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-dashboard-shell/client'
import type { DashboardShellInjected } from '@deepseek-ai/dsh-client-ui-dashboard-shell/client'

/** Installed roster the bench's connection reports (the shipped preset set). */
const INSTALLED_PRESETS = ['code', 'cordis', 'minimal', 'standard']

/** Host home the bench's connection reports. */
const HOME = 'H:/dsh-home'
/** The default Workspace path for an Agent under that home. */
const agentPath = (agentId: string) => `${HOME}/dashboard/${agentId}`

function workspaceView(id: string, path: string, sessionIds: string[] = []) {
  return {
    workspaceId: id,
    path,
    title: path.split('/').pop()!,
    sessionIds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  let workspaceSnapshot = { items: [] as ReturnType<typeof workspaceView>[], archivedSessionIds: [] as string[], phase: 'ready', baselinesReady: true }
  let sessionSnapshot = { ids: [] as string[], byId: {} as Record<string, { cwd?: string; agentPreset?: string; blank?: boolean }>, current: undefined as string | undefined, phase: 'ready' }
  const sessions = {
    open: vi.fn(),
    clear: vi.fn(),
    list: { getSnapshot: () => sessionSnapshot },
  }
  const workspaces = {
    startSession: vi.fn(),
    create: vi.fn().mockImplementation(async ({ path }: { path: string }) => {
      const view = workspaceView(`ws-${path}`, path)
      workspaceSnapshot = { ...workspaceSnapshot, items: [...workspaceSnapshot.items, view] }
      return view
    }),
    connectWorkspace: vi.fn().mockResolvedValue('s-auto'),
    list: { getSnapshot: () => workspaceSnapshot },
  }
  const agentPresetList = vi.fn().mockResolvedValue({
    result: {
      ok: true,
      value: {
        presets: INSTALLED_PRESETS.map(id => ({ id, trust: 'system', isDefault: false })),
        authorable: false,
        hasDocument: false,
      },
    },
  })
  const hostDescribe = vi.fn().mockResolvedValue({
    result: {
      ok: true,
      value: { version: 'test', cwd: HOME, home: HOME, attachedSessions: 0, canOpenPath: false },
    },
  })
  const createDirectory = vi.fn().mockResolvedValue({ result: { ok: true, value: { path: '' } } })
  ctx.provide('connection', {
    api: {
      agentPresets: { list: agentPresetList },
      host: { describe: hostDescribe, createDirectory },
    },
  } as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  return {
    ctx, slots, sessions, workspaces, agentPresetList, hostDescribe, createDirectory,
    setWorkspaces(next: { items: ReturnType<typeof workspaceView>[] }) {
      workspaceSnapshot = { ...workspaceSnapshot, items: next.items }
    },
    setSessions(next: {
      ids?: string[]
      byId?: Record<string, { cwd?: string; agentPreset?: string; blank?: boolean }>
      current?: string | undefined
    }) {
      sessionSnapshot = {
        ids: next.ids ?? sessionSnapshot.ids,
        byId: next.byId ?? sessionSnapshot.byId,
        current: next.current === undefined ? sessionSnapshot.current : next.current,
        phase: 'ready',
      }
    },
  }
}

async function mount(): Promise<{ bench: Awaited<ReturnType<typeof bench>>; injected: DashboardShellInjected }> {
  const b = await bench()
  await b.ctx.plugin({ inject: [...inject], apply }).await()
  const entries = b.slots.entries('root')
  const injected = (entries[0]!.inject as () => DashboardShellInjected)()
  return { bench: b, injected }
}

describe('ui-dashboard-shell apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'locale', 'connection'])
  })

  it('registers into root at priority -1 and declares its child seats', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = b.slots.entries('root')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.priority).toBe(-1)
    expect(entries[0]!.locale).toBe('dashboard')
    expect(b.slots.spec('dashboard.sidebar')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('dashboard.main')).toEqual({ kind: 'single', scope: 'root' })
    // Re-hosted product seats: the conversation surface and the details panel.
    expect(b.slots.spec('conversation')).toEqual({ kind: 'single', scope: 'session-maybe' })
    expect(b.slots.spec('details')).toEqual({ kind: 'single', scope: 'session' })
    // The sidebar directory-flow gate: declared so the composed directory-picker
    // pair (which mounts into both workspace holes transactionally) activates
    // under a Dashboard composition that disables ui-sidebar. Never rendered.
    expect(b.slots.spec('sidebar.workspaces.directoryFlow')).toEqual({ kind: 'single', scope: 'root' })
    // The hero picker seats are declared by ui-conversation, not by this shell
    // (a duplicate declaration would collide at apply time).
    expect(b.slots.spec('conversation.hero.workspace')).toBeUndefined()
    const injected = (entries[0]!.inject as () => DashboardShellInjected)()
    expect(Object.keys(injected)).toEqual(['openSession', 'startSession', 'resolveAgentPresets', 'ensureAgentWorkspace'])
    injected.openSession('s1' as never)
    expect(b.sessions.open).toHaveBeenCalledWith('s1')
    // No preset requested → forwarded verbatim.
    await injected.startSession('w1' as never)
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith('w1', undefined)
    // An installed preset rides the roster check and reaches the workspaces service.
    await injected.startSession('w1' as never, 'standard')
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith('w1', 'standard')
    await injected.startSession()
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith(undefined, undefined)
  })

  it('drops an uninstalled preset so the create cannot fail on it', async () => {
    const { bench: b, injected } = await mount()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await injected.startSession('w1' as never, 'ghost')
    expect(b.workspaces.startSession).toHaveBeenCalledWith('w1', undefined)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'))
    warn.mockRestore()
  })

  it('resolves the installed preset ids from the live roster', async () => {
    const { injected } = await mount()
    await expect(injected.resolveAgentPresets()).resolves.toEqual(new Set(INSTALLED_PRESETS))
  })

  it('ensures the Agent default workspace and connects its blank session', async () => {
    const { bench: b, injected } = await mount()
    const sessionId = await injected.ensureAgentWorkspace('coder', 'standard')
    expect(sessionId).toBe('s-auto')
    // Home described once; both namespace dirs created; path registered; blank session connected.
    expect(b.hostDescribe).toHaveBeenCalledTimes(1)
    expect(b.createDirectory).toHaveBeenNthCalledWith(1, { path: HOME, name: 'dashboard' })
    expect(b.createDirectory).toHaveBeenNthCalledWith(2, { path: `${HOME}/dashboard`, name: 'coder' })
    expect(b.workspaces.create).toHaveBeenCalledWith({ path: agentPath('coder') })
    expect(b.workspaces.connectWorkspace).toHaveBeenCalledWith(`ws-${agentPath('coder')}`, 'standard')
    // A second call coalesces on the in-flight promise and does not re-create.
    await injected.ensureAgentWorkspace('coder', 'standard')
    expect(b.createDirectory).toHaveBeenCalledTimes(2)
    expect(b.workspaces.create).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing Agent workspace without creating directories or registering', async () => {
    const { bench: b, injected } = await mount()
    b.setWorkspaces({ items: [workspaceView('ws-existing', agentPath('btender'))] })
    const sessionId = await injected.ensureAgentWorkspace('btender', 'standard')
    expect(sessionId).toBe('s-auto')
    expect(b.createDirectory).not.toHaveBeenCalled()
    expect(b.workspaces.create).not.toHaveBeenCalled()
    expect(b.workspaces.connectWorkspace).toHaveBeenCalledWith('ws-existing', 'standard')
  })

  it('returns the current session unchanged when it already lives in the Agent workspace', async () => {
    const { bench: b, injected } = await mount()
    b.setWorkspaces({ items: [workspaceView('ws-invest', agentPath('invest'), ['s-invest'])] })
    b.setSessions({ ids: ['s-invest'], byId: { 's-invest': { id: 's-invest', cwd: agentPath('invest'), blank: true } }, current: 's-invest' })
    const sessionId = await injected.ensureAgentWorkspace('invest', 'standard')
    expect(sessionId).toBe('s-invest')
    expect(b.createDirectory).not.toHaveBeenCalled()
    expect(b.workspaces.create).not.toHaveBeenCalled()
    expect(b.workspaces.connectWorkspace).not.toHaveBeenCalled()
  })

  it('ignores an already-existing directory when creating the Agent workspace', async () => {
    const { bench: b, injected } = await mount()
    b.createDirectory.mockResolvedValueOnce({
      result: { ok: false, error: { code: 'directory-exists', message: 'already there', details: {} } },
    })
    const sessionId = await injected.ensureAgentWorkspace('video', 'standard')
    expect(sessionId).toBe('s-auto')
    expect(b.workspaces.create).toHaveBeenCalledWith({ path: agentPath('video') })
  })

  it('wins the root cell over a default-priority registration (lowest renders)', async () => {
    const b = await bench()
    b.slots.register({ name: 'root', priority: 0 } as never, () => null)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // Both entries coexist on the ledger; the shell's -1 ranks first.
    expect(b.slots.entries('root')).toHaveLength(2)
    const winners = b.slots.entriesOfSlot('root')
    expect(winners).toHaveLength(1)
    expect(winners[0]!.options.priority).toBe(-1)
  })

  it('removes the entry and child declarations on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('root')).toHaveLength(0)
    expect(b.slots.spec('dashboard.sidebar')).toBeUndefined()
    expect(b.slots.spec('dashboard.main')).toBeUndefined()
    expect(b.slots.spec('conversation')).toBeUndefined()
    expect(b.slots.spec('details')).toBeUndefined()
  })
})
