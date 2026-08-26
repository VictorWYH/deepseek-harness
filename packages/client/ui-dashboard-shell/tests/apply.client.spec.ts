/** Dashboard shell slot registration and its runtime action forwarding. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-dashboard-shell/client'
import type { DashboardShellInjected } from '@deepseek-ai/dsh-client-ui-dashboard-shell/client'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const sessions = { open: vi.fn(), clear: vi.fn() }
  const workspaces = { startSession: vi.fn() }
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  return { ctx, slots, sessions, workspaces }
}

describe('ui-dashboard-shell apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'locale'])
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
    const injected = (entries[0]!.inject as () => DashboardShellInjected)()
    expect(Object.keys(injected)).toEqual(['openSession', 'startSession'])
    injected.openSession('s1' as never)
    expect(b.sessions.open).toHaveBeenCalledWith('s1')
    injected.startSession('w1' as never)
    expect(b.workspaces.startSession).toHaveBeenCalledWith('w1')
    injected.startSession()
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith(undefined)
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
  })
})
