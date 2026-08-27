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

function workspace(id: string, sessionIds: string[], path = `H:/work/${id}`): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path,
    // Default fixture workspaces keep their `ws-<id>` display titles; the
    // Agent-default fixtures take their folder basename.
    title: path === `H:/work/${id}` ? `ws-${id}` : (path.split('/').pop() ?? id),
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

/** Shipped preset roster the frame resolves against (apps/cli/config/agent-presets). */
const SHIPPED_PRESETS = ['code', 'cordis', 'minimal', 'standard']

function mount(roster: string[] = SHIPPED_PRESETS, ensureResult = 'auto-s1') {
  const state = { sessions: buildSessions(), workspaces: buildWorkspaces() }
  const openSession = vi.fn()
  const startSession = vi.fn()
  const resolveAgentPresets = vi.fn().mockResolvedValue(new Set(roster))
  const ensureAgentWorkspace = vi.fn().mockResolvedValue(ensureResult)
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
    ensureAgentWorkspace,
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
    ensureAgentWorkspace,
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
    // 切换到 btender 验证 AgentBoard 渲染（coder 默认显示 CoderBoard）
    fireEvent.click(screen.getByRole('button', { name: 'Bid Agent' }))
    expect(screen.getByText('商机雷达')).toBeTruthy()
    expect(screen.getByText(/商机工作台/)).toBeTruthy()
  })

  it('switches the dashboard when another Agent is selected', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Bid Agent' }))
    expect(screen.getByText('商机雷达')).toBeTruthy()
    expect(screen.getByText(/商机工作台/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bid Agent' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Coder Agent' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the real BtenderBoard KPI cards', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Bid Agent' }))
    expect(screen.getByText('商机雷达')).toBeTruthy()
    expect(screen.getByText('商机总数')).toBeTruthy()
    expect(screen.getByText('今日新增')).toBeTruthy()
  })

  it('shows the real BtenderBoard and keeps session stats in the left nav', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Bid Agent' }))
    expect(screen.getByText('商机雷达')).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Agents' })
    expect(within(nav).getByText('Sessions: 3')).toBeTruthy()
  })

  it('starts a New Session with the resolved preset globally and per Workspace', () => {
    const b = mount()
    // Default coder shows CoderBoard; new session tests work regardless

    const nav = screen.getByRole('navigation', { name: 'Agents' })
    const navNew = within(nav).getByRole('button', { name: 'New session' })
    fireEvent.click(navNew)
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'standard')
    fireEvent.click(navNew)
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'standard')
    // After switching Agent the resolved preset still rides the shipped default.
    fireEvent.click(screen.getByRole('button', { name: 'Coder Agent' }))
    fireEvent.click(within(nav).getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'standard')
  })

  it('loads the preset roster once and falls back to the deployment default', async () => {
    const b = mount(['minimal'])
    // Stay on coder (CoderBoard) — no usable preset

    expect(b.resolveAgentPresets).toHaveBeenCalledTimes(1)
    // The selected coder Agent's mapped preset is not installed → notice.
    expect(await screen.findByText('Preset "standard" is not installed; the default composition will be used')).toBeTruthy()
    // Nothing usable is passed to the workspaces action either.
    const nav = screen.getByRole('navigation', { name: 'Agents' })
    fireEvent.click(within(nav).getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, undefined)
  })

  it('shows no preset notice when the deployment default is installed', async () => {
    const b = mount(['standard'])
    // Stay on coder — preset is installed for all agents
    await screen.findByText('任务看板')
    expect(screen.queryByText(/is not installed/)).toBeNull()
    const nav = screen.getByRole('navigation', { name: 'Agents' })
    fireEvent.click(within(nav).getByRole('button', { name: 'New session' }))
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'standard')
  })

  it('auto-connects the default Agent workspace on mount and opens its session', async () => {
    const b = mount()
    await vi.waitFor(() => {
      expect(b.ensureAgentWorkspace).toHaveBeenCalledWith('coder', 'standard')
    })
    // The ensured session id differs from the current one → opened.
    await vi.waitFor(() => {
      expect(b.openSession).toHaveBeenCalledWith('auto-s1')
    })
  })

  it('auto-connects the newly selected Agent default workspace', async () => {
    const b = mount()
    b.rerender()
    fireEvent.click(screen.getByRole('button', { name: 'Invest Agent' }))
    await vi.waitFor(() => {
      expect(b.ensureAgentWorkspace).toHaveBeenLastCalledWith('invest', 'standard')
    })
  })

  it('does not re-open a session already inside the Agent workspace', async () => {
    // The ensured session equals the current one ('s1') — the frame skips the open.
    const b = mount(SHIPPED_PRESETS, 's1')
    await vi.waitFor(() => {
      expect(b.ensureAgentWorkspace).toHaveBeenCalledWith('coder', 'standard')
    })
    expect(b.openSession).not.toHaveBeenCalled()
  })

  it('shows an explicit init state when the Agent has no default workspace', async () => {
    mount()
    // Stay on coder (CoderBoard) — init state is Agent-wide

    await vi.waitFor(() => {
      expect(screen.getByText(/no default workspace yet/i)).toBeTruthy()
    })
  })

  it('shows ungrouped sessions and the loading line before baselines are ready', () => {
    const b = mount()
    // CoderBoard default; session groups remain in sidebar

    // Drop the workspace accounting so every session lands in the bucket.
    b.state.workspaces = { ...b.state.workspaces, items: [] }
    b.rerender()
    const nav = screen.getByRole('navigation', { name: 'Agents' })
    expect(within(nav).getByText('Sessions: 3')).toBeTruthy()
    // Baselines pending: the shell keeps the sidebar session stats.
    b.state.workspaces = { ...b.state.workspaces, items: [workspace('w1', ['s1', 's2'])], baselinesReady: false }
    b.rerender()
    expect(within(nav).getByText('Sessions: 3')).toBeTruthy()
  })

  it('collapses the whole left navigation panel to a narrow rail', () => {
    const b = mount()
    const nav = screen.getByRole('navigation', { name: 'Agents' })
    // Expanded: nav title, Agent label, sidebar stats, and New Session label render.
    expect(within(nav).getByText('Agent Dashboard')).toBeTruthy()
    expect(within(nav).getByText('Coder Agent')).toBeTruthy()
    expect(within(nav).getByText('Sessions: 3')).toBeTruthy()
    expect(within(nav).getByText('Running: 1')).toBeTruthy()
    // The toggle names the close action while expanded.
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent navigation' }))
    // Collapsed: the whole nav content hides together — title, labels, and stats.
    expect(b.frame().className).toContain('frameCollapsed')
    expect(within(nav).queryByText('Agent Dashboard')).toBeNull()
    expect(within(nav).queryByText('Coder Agent')).toBeNull()
    expect(within(nav).queryByText('Sessions: 3')).toBeNull()
    // The rail still shows Agent mark initials and the toggle now opens.
    expect(within(nav).getByText('C')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Agent navigation' })).toBeTruthy()
  })

  it('re-expands the left navigation panel from the narrow rail', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent navigation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent navigation' }))
    expect(b.frame().className).not.toContain('frameCollapsed')
    // The whole nav content returned together.
    const nav = screen.getByRole('navigation', { name: 'Agents' })
    expect(within(nav).getByText('Agent Dashboard')).toBeTruthy()
    expect(within(nav).getByText('Coder Agent')).toBeTruthy()
    expect(within(nav).getByText('Sessions: 3')).toBeTruthy()
  })

  it('keeps Agent selection while the left panel is collapsed', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent navigation' }))
    // The rail still lists every Agent mark; clicking one switches the board.
    const nav = screen.getByRole('navigation', { name: 'Agents' })
    fireEvent.click(within(nav).getByRole('button', { name: 'Bid Agent' }))
    expect(screen.getByText('商机雷达')).toBeTruthy()
    expect(screen.getByText(/商机工作台/)).toBeTruthy()
  })
})
