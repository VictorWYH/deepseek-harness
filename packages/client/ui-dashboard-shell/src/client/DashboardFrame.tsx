/**
 * DashboardFrame: three-column product shell. Left Agent navigation panel
 * (collapsible to a narrow icon rail), center 6995-style board, right AI chat.
 * The whole left panel collapses/expands together — title, nav, stats, and
 * session count all hide/reveal as one unit, with the center column expanding
 * into the freed space. The right column hosts the re-hosted conversation
 * surface (ui-conversation) so the composer stays active.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentDescriptor, DashboardFrameComponentProps, DashboardMainOwnerProps,
  DashboardSidebarOwnerProps,
} from './contract/slots.ts'
import type { DashboardKey } from './locales.ts'
import { presetForAgent, resolveAgentPreset } from './presets.ts'
import { CoderBoard } from './CoderBoard.tsx'
import { InvestBoard } from './InvestBoard.tsx'
import { VideoBoard } from './VideoBoard.tsx'
import { BtenderBoard } from './BtenderBoard.tsx'
import css from './DashboardFrame.module.css'

/** One stat card's display value and label. */
interface StatValue {
  label: string
  value: number
}

/** One workspace- or ungrouped-grouped session list section. */
export interface SessionGroup {
  key: string
  title: string
  workspaceId?: WorkspaceId
  sessions: readonly SessionSummary[]
}

/** Read-only counts projected from the two runtime snapshots. */
export interface DashboardStats {
  workspaces: number
  sessions: number
  running: number
}

/** Phase-1 static Agent roster. */
interface AgentDef {
  id: string
  labelKey: DashboardKey
}

const AGENTS: readonly AgentDef[] = [
  { id: 'coder', labelKey: 'agent.coder' },
  { id: 'btender', labelKey: 'agent.btender' },
  { id: 'invest', labelKey: 'agent.invest' },
  { id: 'video', labelKey: 'agent.video' },
]

export function groupSessions(
  sessions: SessionListState,
  workspaces: WorkspaceListState,
  ungroupedTitle: string,
): SessionGroup[] {
  const archived = new Set(workspaces.archivedSessionIds)
  const visible = (id: SessionId): SessionSummary | undefined =>
    archived.has(id) ? undefined : sessions.byId[id]
  const groups: SessionGroup[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces.items) {
    const rows = workspace.sessionIds
      .map(visible)
      .filter((summary): summary is SessionSummary => summary !== undefined)
    if (rows.length === 0) continue
    for (const row of rows) accounted.add(row.id)
    groups.push({
      key: workspace.workspaceId,
      title: workspace.title,
      workspaceId: workspace.workspaceId,
      sessions: rows,
    })
  }
  const ungrouped = sessions.ids
    .map(visible)
    .filter((summary): summary is SessionSummary => summary !== undefined && !accounted.has(summary.id))
  if (ungrouped.length > 0) {
    groups.push({ key: 'ungrouped', title: ungroupedTitle, sessions: ungrouped })
  }
  return groups
}

/** One stat card. */
function StatCard({ label, value }: StatValue) {
  return (
    <div className={css.statCard}>
      <span className={css.statValue}>{value}</span>
      <span className={css.statLabel}>{label}</span>
    </div>
  )
}

/** The 6995-style center board: Agent dashboard with stat cards and session groups. */
function AgentBoard({
  selectedAgentLabel,
  selectedAgentId,
  stats,
  groups,
  baselinesReady,
  currentSessionId,
  presetNotice,
  workspaceNotice,
  openSession,
  startSession,
  t,
}: {
  selectedAgentLabel: string
  selectedAgentId: string
  stats: DashboardStats
  groups: readonly SessionGroup[]
  baselinesReady: boolean
  currentSessionId: string | undefined
  presetNotice: string | undefined
  workspaceNotice: string | undefined
  openSession: (sessionId: SessionId) => void
  startSession: (workspaceId?: WorkspaceId) => void
  t: DashboardFrameComponentProps['t']
}) {
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const cards: StatValue[] = [
    { label: t('stat.workspaces'), value: stats.workspaces },
    { label: t('stat.sessions'), value: stats.sessions },
    { label: t('stat.running'), value: stats.running },
  ]
  return (
    <div className={css.board}>
      <header className={css.boardHeader}>
        <h1 className={css.boardTitle}>{selectedAgentLabel}</h1>
        <span className={css.boardAgentId}>{selectedAgentId}</span>
      </header>
      {presetNotice !== undefined && <p className={css.presetNotice} role="status">{presetNotice}</p>}
      {workspaceNotice !== undefined && <p className={css.presetNotice} role="status">{workspaceNotice}</p>}
      <section className={css.statsRow} aria-label={t('shell.title')}>
        {cards.map(card => <StatCard key={card.label} {...card} />)}
      </section>
      {!baselinesReady && <p className={css.loading}>{t('shell.loading')}</p>}
      <button
        type="button"
        className={css.sessionsToggle}
        aria-expanded={sessionsOpen}
        onClick={() => { setSessionsOpen(open => !open) }}
      >
        <span>{t('sessions.list')}</span>
        <span aria-hidden="true">{sessionsOpen ? '▾' : '▸'}</span>
      </button>
      {sessionsOpen && (
        <section className={css.sessionGroups}>
          {groups.length === 0
            ? <p className={css.empty}>{t('sessions.empty')}</p>
            : groups.map(group => (
              <section key={group.key} className={css.sessionGroup}>
                <header className={css.groupHeader}>
                  <span className={css.groupTitle}>{group.title}</span>
                  {group.workspaceId !== undefined && (
                    <button type="button" className={css.groupNew} onClick={() => { startSession(group.workspaceId) }}>
                      {t('session.new')}
                    </button>
                  )}
                </header>
                <ul className={css.sessionList}>
                  {group.sessions.map(session => (
                    <li key={session.id}>
                      <button
                        type="button"
                        className={session.id === currentSessionId
                          ? clsx(css.sessionRow, css.sessionRowCurrent)
                          : css.sessionRow}
                        aria-label={`${t('session.open')}: ${session.displayTitle}`}
                        onClick={() => { openSession(session.id) }}
                      >
                        <span className={session.running ? clsx(css.statusDot, css.statusRunning) : css.statusDot} aria-hidden="true" />
                        <span className={css.sessionTitle}>{session.displayTitle}</span>
                        <span className={css.sessionMeta}>{session.cwd ?? session.id}</span>
                        {session.id === currentSessionId && <span className={css.currentBadge}>{t('session.current')}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </section>
      )}
    </div>
  )
}

/** The left navigation panel: Agents, stats, new session. Collapses to a narrow rail. */
function AgentNav({
  agents,
  selectedAgentId,
  onSelectAgent,
  onNewSession,
  collapsed,
  stats,
  t,
}: DashboardSidebarOwnerProps & {
  collapsed: boolean
  stats: DashboardStats
  t: DashboardFrameComponentProps['t']
}) {
  return (
    <nav className={collapsed ? clsx(css.agentNav, css.agentNavCollapsed) : css.agentNav} aria-label={t('nav.agents')} data-agent-selected={selectedAgentId}>
      <div className={collapsed ? css.shellTitleCollapsed : css.shellTitle}>
        {collapsed ? '☰' : t('shell.title')}
      </div>
      <ul className={css.agentList}>
        {agents.map(agent => (
          <li key={agent.id}>
            <button
              type="button"
              className={agent.id === selectedAgentId ? clsx(css.agentItem, css.agentItemActive, collapsed ? css.agentItemCollapsed : '') : clsx(css.agentItem, collapsed ? css.agentItemCollapsed : '')}
              aria-pressed={agent.id === selectedAgentId}
              data-agent-id={agent.id}
              data-agent-selected={agent.id === selectedAgentId}
              onClick={() => { onSelectAgent(agent.id) }}
              title={collapsed ? agent.label : undefined}
            >
              <span className={css.agentMark} aria-hidden="true">{agent.id.slice(0, 1).toUpperCase()}</span>
              {!collapsed && <span className={css.agentLabel}>{agent.label}</span>}
            </button>
          </li>
        ))}
      </ul>
      {!collapsed && (
        <div className={css.sidebarStats}>
          <span className={css.sidebarStatItem}>{t('stat.sessions')}: {stats.sessions}</span>
          <span className={css.sidebarStatItem}>{t('stat.running')}: {stats.running}</span>
        </div>
      )}
      <div className={css.sidebarFoot}>
        <button type="button" className={css.newSessionButton} data-new-session onClick={onNewSession} title={collapsed ? t('session.new') : undefined}>
          {collapsed ? '+' : t('session.new')}
        </button>
      </div>
    </nav>
  )
}

/**
 * Three-column product shell.
 */
export function DashboardFrame({
  useSessions,
  useWorkspaces,
  openSession,
  startSession,
  resolveAgentPresets,
  ensureAgentWorkspace,
  t,
  renderSlot,
}: DashboardFrameComponentProps) {
  const defaultAgent = AGENTS[0]
  if (defaultAgent === undefined) throw new Error('dashboard shell: Agent roster is empty')
  const [selectedAgentId, setSelectedAgentId] = useState<string>(defaultAgent.id)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [availablePresets, setAvailablePresets] = useState<ReadonlySet<string> | null>(null)
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s)

  useEffect(() => {
    let live = true
    void resolveAgentPresets().then((ids) => { if (live) setAvailablePresets(ids) })
    return () => { live = false }
  }, [resolveAgentPresets])

  const selectedAgent = useMemo(
    () => AGENTS.find(agent => agent.id === selectedAgentId) ?? defaultAgent,
    [defaultAgent, selectedAgentId],
  )
  const agents = useMemo<readonly AgentDescriptor[]>(
    () => AGENTS.map(agent => ({ id: agent.id, label: t(agent.labelKey) })),
    [t],
  )
  const usablePreset = useMemo(() => {
    if (availablePresets === null) return presetForAgent(selectedAgent.id)
    return resolveAgentPreset(selectedAgent.id, availablePresets)
  }, [availablePresets, selectedAgent])

  const presetNotice = useMemo(() => {
    if (availablePresets === null) return undefined
    const resolved = resolveAgentPreset(selectedAgent.id, availablePresets)
    if (resolved !== undefined) return undefined
    const mapped = presetForAgent(selectedAgent.id)
    return t('preset.missing', { preset: mapped ?? 'standard' })
  }, [availablePresets, selectedAgent, t])

  const workspaceNotice = useMemo(() => {
    if (!workspaces.baselinesReady) return undefined
    const hasDefault = workspaces.items.some(workspace => workspace.path.endsWith(`dashboard/${selectedAgent.id}`))
    return hasDefault ? undefined : t('workspace.none')
  }, [workspaces.baselinesReady, workspaces.items, selectedAgent.id, t])

  useEffect(() => {
    if (!workspaces.baselinesReady) return
    let cancelled = false
    void ensureAgentWorkspace(selectedAgent.id, usablePreset).then(
      (sessionId) => { if (!cancelled && sessions.current !== sessionId) openSession(sessionId) },
      (reason: unknown) => { if (!cancelled) console.warn('dashboard: auto-connect failed:', reason) },
    )
    return () => { cancelled = true }
  }, [ensureAgentWorkspace, openSession, selectedAgent.id, usablePreset, workspaces.baselinesReady])

  const startWithPreset = (workspaceId?: WorkspaceId): void => {
    void startSession(workspaceId, usablePreset)
  }
  const stats = useMemo<DashboardStats>(() => ({
    workspaces: workspaces.items.length,
    sessions: sessions.ids.length,
    running: sessions.ids.reduce((count, id) => count + (sessions.byId[id]?.running === true ? 1 : 0), 0),
  }), [sessions, workspaces])
  const groups = useMemo(
    () => groupSessions(sessions, workspaces, t('group.ungrouped')),
    [sessions, workspaces, t],
  )
  const sidebarOwner: DashboardSidebarOwnerProps = {
    agents,
    selectedAgentId: selectedAgent.id,
    onSelectAgent: (agentId) => { setSelectedAgentId(agentId) },
    onNewSession: () => { startWithPreset() },
  }
  const mainOwner: DashboardMainOwnerProps = {
    selectedAgentId: selectedAgent.id,
    selectedAgentLabel: t(selectedAgent.labelKey),
  }

  return (
    <div className={leftCollapsed ? clsx(css.frame, css.frameCollapsed) : css.frame} data-dsh-shell="dashboard">
      {/* Collapse toggle button */}
      <button
        type="button"
        className={css.collapseToggle}
        aria-label={leftCollapsed ? t('nav.open') : t('nav.close')}
        onClick={() => { setLeftCollapsed(c => !c) }}
      >
        <span aria-hidden="true">{leftCollapsed ? '▸' : '◂'}</span>
      </button>

      {/* Left column: Agent navigation panel */}
      <aside className={leftCollapsed ? clsx(css.leftPanel, css.leftPanelCollapsed) : css.leftPanel}>
        {renderSlot('dashboard.sidebar', sidebarOwner, {
          fallback: <AgentNav {...sidebarOwner} collapsed={leftCollapsed} stats={stats} t={t} />,
        })}
      </aside>

      {/* Center column: 6995-style board */}
      <main className={css.centerPanel}>
        {presetNotice !== undefined && <p className={css.presetNotice} role="status">{presetNotice}</p>}
        {workspaceNotice !== undefined && <p className={css.presetNotice} role="status">{workspaceNotice}</p>}
        {renderSlot('dashboard.main', mainOwner, {
          fallback: selectedAgent.id === 'coder'
            ? <CoderBoard />
            : selectedAgent.id === 'invest'
              ? <InvestBoard />
              : selectedAgent.id === 'video'
                ? <VideoBoard />
                : selectedAgent.id === 'btender'
                  ? <BtenderBoard />
                  : (
                    <AgentBoard
                      selectedAgentLabel={mainOwner.selectedAgentLabel}
                      selectedAgentId={mainOwner.selectedAgentId}
                      stats={stats}
                      groups={groups}
                      baselinesReady={workspaces.baselinesReady}
                      currentSessionId={sessions.current}
                      presetNotice={presetNotice}
                      workspaceNotice={workspaceNotice}
                      openSession={openSession}
                      startSession={startWithPreset}
                      t={t}
                    />
                  ),
        })}
      </main>

      {/* Right column: AI chat */}
      <aside className={css.rightPanel} data-conversation-host="true">
        {renderSlot('conversation', {})}
      </aside>
    </div>
  )
}
