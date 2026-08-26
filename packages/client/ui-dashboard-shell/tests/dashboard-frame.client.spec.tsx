// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { DashboardFrameComponentProps } from '../src/client/contract/slots.ts'
import { DashboardFrame } from '../src/client/DashboardFrame.tsx'
import { en } from '../src/client/locales.ts'

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name; `{param}` templates interpolate.
const t: DashboardFrameComponentProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

afterEach(() => {
  cleanup()
})

function summary(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: `title-${id}`,
    running: false,
    blank: false,
    updatedAt: 0,
    ...over,
  }
}

function workspace(id: string, sessionIds: string[]): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path: `H:/work/${id}`,
    title: `ws-${id}`,
    sessionIds: sessionIds as WorkspaceView['sessionIds'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function buildSessions(): SessionListState {
  return {
    ids: ['s1', 's2', 's3'] as SessionListState['ids'],
    byId: {
      s1: summary('s1', { cwd: 'H:/work/w1' }),
      s2: summary('s2', { running: true, cwd: 'H:/work/w1' }),
      s3: summary('s3', { cwd: 'H:/work/w2' }),
    } as SessionListState['byId'],
    current: 's1' as SessionId,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function buildWorkspaces(): WorkspaceListState {
  return {
    items: [workspace('w1', ['s1', 's2']), workspace('w2', ['s3'])],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: 'w1' as WorkspaceId,
  }
}

function mount(roster: string[] = ['coder', 'btender', 'invest', 'video']) {
  const state = { sessions: buildSessions(), workspaces: buildWorkspaces() }
  const openSession = vi.fn()
  const startSession = vi.fn()
  const resolveAgentPresets = vi.fn().mockResolvedValue(new Set(roster))
  const renderedSlots: string[] = []
  const useSessions = ((sel: (s: SessionListState) => unknown) => sel(state.sessions)) as unknown as DashboardFrameComponentProps['useSessions']
  const useWorkspaces = ((sel: (s: WorkspaceListState) => unknown) => sel(state.workspaces)) as unknown as DashboardFrameComponentProps['useWorkspaces']
  const renderSlot = ((key: string, _owner: unknown, opts?: { fallback?: ReactNode }) => {
    renderedSlots.push(key)
    return opts?.fallback ?? null
  }) as unknown as DashboardFrameComponentProps['renderSlot']
  // 'details' is a declared session-scope seat (ui-conversation's panel); the
  // standard-kit SessionProvider is injected by the framework, stubbed here.
  const SessionProvider = (() => null) as unknown as DashboardFrameComponentProps['SessionProvider']
  const props = {
    useSessions,
    useWorkspaces,
    openSession,
    startSession,
    resolveAgentPresets,
    SessionProvider,
    t,
    renderSlot,
  }
  const view = render(<DashboardFrame {...props} />)
  return {
    state,
    openSession,
    startSession,
    resolveAgentPresets,
    renderedSlots,
    /** The shell root element (`data-dsh-shell="dashboard"`), for class-state checks. */
    frame() {
      return view.container.querySelector<HTMLElement>('[data-dsh-shell="dashboard"]')!
    },
    rerender() {
      view.rerender(<DashboardFrame {...props} />)
    },
  }
}

describe('DashboardFrame product shell', () => {
  it('renders the Agent nav and the selected Agent dashboard, and hosts the conversation seat', () => {
    const b = mount()
    expect(b.renderedSlots).toEqual(['dashboard.sidebar', 'dashboard.main', 'conversation'])
    expect(screen.getByRole('navigation', { name: 'Agents' })).toBeTruthy()
    for (const name of ['Coder Agent', 'Bid Agent', 'Invest Agent', 'Video Agent']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Coder Agent' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Coder Agent' })).toBeTruthy()
    expect(screen.getByText('coder')).toBeTruthy()
  })

  it('switches the dashboard when another Agent is selected', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Invest Agent' }))
    expect(screen.getByRole('heading', { name: 'Invest Agent' })).toBeTruthy()
    expect(screen.getByText('invest')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Invest Agent' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Coder Agent' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows read-only stat cards over the runtime snapshots', () => {
    mount()
    expect(screen.getByText('Workspaces').closest('div')!.textContent).toContain('2')
    expect(screen.getByText('Sessions').closest('div')!.textContent).toContain('3')
    expect(screen.getByText('Running').closest('div')!.textContent).toContain('1')
  })

  it('groups sessions by Workspace and opens a session on click', () => {
    const b = mount()
    // Two workspace groups in host order; no ungrouped bucket.
    expect(screen.getByText('ws-w1')).toBeTruthy()
    expect(screen.getByText('ws-w2')).toBeTruthy()
    expect(screen.queryByText('Ungrouped')).toBeNull()
    // The current session carries the badge; running rows draw the dot state.
    expect(screen.getByText('Current')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open session: title-s2' }))
    expect(b.openSession).toHaveBeenCalledWith('s2')
    fireEvent.click(screen.getByRole('button', { name: 'Open session: title-s3' }))
    expect(b.openSession).toHaveBeenLastCalledWith('s3')
  })

  it('starts a New Session with the selected Agent preset globally and per Workspace', () => {
    const b = mount()
    // Nav foot + dashboard header + one per workspace group.
    expect(screen.getAllByRole('button', { name: 'New session' })).toHaveLength(4)
    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[0]!)
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'coder')
    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[1]!)
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'coder')
    const groupW1 = screen.getByText('ws-w1').closest('section')!
    fireEvent.click(within(groupW1).getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenLastCalledWith('w1', 'coder')
    const groupW2 = screen.getByText('ws-w2').closest('section')!
    fireEvent.click(within(groupW2).getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenLastCalledWith('w2', 'coder')
    // After switching Agent the mapped preset follows the selection.
    fireEvent.click(screen.getByRole('button', { name: 'Invest Agent' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[1]!)
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'invest')
  })

  it('loads the preset roster once and notices an Agent whose preset is not installed', async () => {
    // 'video' is missing from the installed roster.
    const b = mount(['coder', 'btender', 'invest'])
    expect(b.resolveAgentPresets).toHaveBeenCalledTimes(1)
    // The selected coder Agent's preset is installed → no notice.
    expect(screen.queryByText(/Preset "coder" is not installed/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Video Agent' }))
    expect(await screen.findByText('Preset "video" is not installed; the default composition will be used')).toBeTruthy()
    // The missing preset is not passed to the workspaces action either.
    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[1]!)
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, undefined)
  })

  it('shows ungrouped sessions and the loading line before baselines are ready', () => {
    const b = mount()
    // Drop the workspace accounting so every session lands in the bucket.
    b.state.workspaces = { ...b.state.workspaces, items: [] }
    b.rerender()
    expect(screen.getByText('Ungrouped')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open session: title-s1' })).toBeTruthy()
    // Baselines pending: the dashboard keeps its shell and reports loading.
    b.state.workspaces = { ...b.state.workspaces, items: [workspace('w1', ['s1', 's2'])], baselinesReady: false }
    b.rerender()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('opens the mobile sidebar from the menu button', () => {
    const b = mount()
    const menu = screen.getByRole('button', { name: 'Open Agent navigation' })
    // Closed: only the rail's own close control is present — the scrim is not rendered.
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getAllByRole('button', { name: 'Close Agent navigation' })).toHaveLength(1)
    expect(b.frame().className).not.toContain('frameSidebarOpen')
    fireEvent.click(menu)
    // Open: the scrim joins the rail close control and the frame enters the mobile state.
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('button', { name: 'Close Agent navigation' })).toHaveLength(2)
    expect(b.frame().className).toContain('frameSidebarOpen')
  })

  it('closes the mobile sidebar from the scrim overlay', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent navigation' }))
    expect(screen.getAllByRole('button', { name: 'Close Agent navigation' })).toHaveLength(2)
    // The scrim renders before the aside, so it leads the close-named buttons.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close Agent navigation' })[0]!)
    expect(screen.getAllByRole('button', { name: 'Close Agent navigation' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Open Agent navigation' }).getAttribute('aria-expanded')).toBe('false')
    expect(b.frame().className).not.toContain('frameSidebarOpen')
  })

  it('auto-closes the mobile sidebar when an Agent is selected', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent navigation' }))
    expect(screen.getAllByRole('button', { name: 'Close Agent navigation' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Invest Agent' }))
    // The selection landed and the sidebar collapsed back to the closed state.
    expect(screen.getByRole('heading', { name: 'Invest Agent' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Close Agent navigation' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Open Agent navigation' }).getAttribute('aria-expanded')).toBe('false')
    expect(b.frame().className).not.toContain('frameSidebarOpen')
  })
})
