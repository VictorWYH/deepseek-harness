/**
 * DashboardFrame: the product shell registered into the runtime's built-in
 * 'root' slot at priority -1 (lowest rank renders, so this entry shadows the
 * native AppFrame's priority-0 registration and takes over the whole browser
 * surface — the web-app bundle also disables ui-layout/ui-sidebar/
 * ui-conversation; the rank keeps the shell authoritative under partial
 * compositions too). Owns Agent selection as component-local state and
 * projects the read-only `useSessions` / `useWorkspaces` snapshots into the
 * selected Agent's dashboard (workspace-grouped Session list, stat cards).
 * Both child holes (`dashboard.sidebar` / `dashboard.main`) render through
 * `renderSlot` with built-in fallbacks, so a future phase can replace either
 * region by registering into the hole. Pure component: everything arrives
 * through the composed props shares — zero ctx or framework imports.
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
import { presetForAgent } from './presets.ts'
import css from './DashboardFrame.module.css'

/** One stat card's display value and label. */
interface StatValue {
  label: string
  value: number
}

/** One workspace- or ungrouped-grouped session list section. */
export interface SessionGroup {
  /** Stable group key (workspace id, or 'ungrouped'). */
  key: string
  /** Group display title. */
  title: string
  /** Owning workspace for the scoped New Session action; absent for ungrouped. */
  workspaceId?: WorkspaceId
  /** Sessions in display order (workspace account order / host list order). */
  sessions: readonly SessionSummary[]
}

/** Read-only counts projected from the two runtime snapshots. */
export interface DashboardStats {
  workspaces: number
  sessions: number
  running: number
}

/** Phase-1 static Agent roster; the future profile plane keys these ids. */
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

/**
 * Project the sessions snapshot into display groups: one per Workspace that
 * accounts at least one visible Session (host account order), then the
 * ungrouped bucket for Sessions the workspace registry does not account.
 * Archived sessions are hidden from every group.
 * @param sessions - the read-only sessions list snapshot.
 * @param workspaces - the read-only workspaces list snapshot.
 * @param ungroupedTitle - resolved copy for the ungrouped bucket.
 * @returns the display groups.
 */
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

/** The Agent navigation rail — the built-in `dashboard.sidebar` fallback. */
function AgentNav({
  agents,
  selectedAgentId,
  onSelectAgent,
  onNewSession,
  onClose,
  t,
}: DashboardSidebarOwnerProps & { onClose?: () => void; t: DashboardFrameComponentProps['t'] }) {
  return (
    <nav className={css.agentNav} aria-label={t('nav.agents')} data-agent-selected={selectedAgentId}>
      {onClose !== undefined && (
        <button type="button" className={css.sidebarClose} aria-label={t('nav.close')} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      )}
      <div className={css.shellTitle}>{t('shell.title')}</div>
      <ul className={css.agentList}>
        {agents.map(agent => (
          <li key={agent.id}>
            <button
              type="button"
              className={agent.id === selectedAgentId ? clsx(css.agentItem, css.agentItemActive) : css.agentItem}
              aria-pressed={agent.id === selectedAgentId}
              data-agent-id={agent.id}
              data-agent-selected={agent.id === selectedAgentId}
              onClick={() => { onSelectAgent(agent.id) }}
            >
              <span className={css.agentMark} aria-hidden="true">{agent.id.slice(0, 1).toUpperCase()}</span>
              <span className={css.agentLabel}>{agent.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={css.sidebarFoot}>
        <button type="button" className={css.newSessionButton} data-new-session onClick={onNewSession}>
          {t('session.new')}
        </button>
      </div>
    </nav>
  )
}

/** One stat card in the dashboard's summary row. */
function StatCard({ label, value }: StatValue) {
  return (
    <div className={css.statCard}>
      <span className={css.statValue}>{value}</span>
      <span className={css.statLabel}>{label}</span>
    </div>
  )
}

/** The selected Agent's dashboard — the built-in `dashboard.main` fallback. */
function AgentDashboard({
  selectedAgentId,
  selectedAgentLabel,
  sessions,
  baselinesReady,
  stats,
  groups,
  openSession,
  startSession,
  presetNotice,
  t,
}: {
  selectedAgentId: string
  selectedAgentLabel: string
  sessions: SessionListState
  baselinesReady: boolean
  stats: DashboardStats
  groups: readonly SessionGroup[]
  openSession: (sessionId: SessionId) => void
  startSession: (workspaceId?: WorkspaceId) => void
  presetNotice: string | undefined
  t: DashboardFrameComponentProps['t']
}) {
  const cards: StatValue[] = [
    { label: t('stat.workspaces'), value: stats.workspaces },
    { label: t('stat.sessions'), value: stats.sessions },
    { label: t('stat.running'), value: stats.running },
  ]
  return (
    <div className={css.dashboard}>
      <header className={css.dashboardHeader}>
        <div className={css.dashboardHeading}>
          <h1 className={css.dashboardTitle}>{selectedAgentLabel}</h1>
          <span className={css.dashboardAgentId}>{selectedAgentId}</span>
        </div>
        <button type="button" className={css.newSessionButton} data-new-session onClick={() => { startSession() }}>
          {t('session.new')}
        </button>
      </header>

      {presetNotice !== undefined && (
        <p className={css.presetNotice} role="status">{presetNotice}</p>
      )}

      <section className={css.statsRow} aria-label={t('shell.title')}>
        {cards.map(card => <StatCard key={card.label} {...card} />)}
      </section>

      {!baselinesReady && <p className={css.loading}>{t('shell.loading')}</p>}

      <section className={css.sessionGroups}>
        {groups.length === 0
          ? <p className={css.empty}>{t('sessions.empty')}</p>
          : groups.map(group => (
            <section key={group.key} className={css.sessionGroup}>
              <header className={css.groupHeader}>
                <span className={css.groupTitle}>{group.title}</span>
                {group.workspaceId !== undefined && (
                  <button
                    type="button"
                    className={css.groupNew}
                    onClick={() => { startSession(group.workspaceId) }}
                  >
                    {t('session.new')}
                  </button>
                )}
              </header>
              <ul className={css.sessionList}>
                {group.sessions.map(session => (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={session.id === sessions.current
                        ? clsx(css.sessionRow, css.sessionRowCurrent)
                        : css.sessionRow}
                      aria-label={`${t('session.open')}: ${session.displayTitle}`}
                      onClick={() => { openSession(session.id) }}
                    >
                      <span
                        className={session.running ? clsx(css.statusDot, css.statusRunning) : css.statusDot}
                        aria-hidden="true"
                      />
                      <span className={css.sessionTitle}>{session.displayTitle}</span>
                      <span className={css.sessionMeta}>{session.cwd ?? session.id}</span>
                      {session.id === sessions.current && (
                        <span className={css.currentBadge}>{t('session.current')}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </section>
    </div>
  )
}

/**
 * Render the two-column product shell. All live data arrives through the
 * global standard hooks; the only local state is the selected Agent.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the shell element tree.
 */
export function DashboardFrame({
  useSessions,
  useWorkspaces,
  openSession,
  startSession,
  resolveAgentPresets,
  t,
  renderSlot,
}: DashboardFrameComponentProps) {
  const defaultAgent = AGENTS[0]
  if (defaultAgent === undefined) throw new Error('dashboard shell: Agent roster is empty')
  const [selectedAgentId, setSelectedAgentId] = useState<string>(defaultAgent.id)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** Installed preset ids from the live roster; null while the lookup is in flight. */
  const [availablePresets, setAvailablePresets] = useState<ReadonlySet<string> | null>(null)
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s)

  useEffect(() => {
    let live = true
    void resolveAgentPresets().then((ids) => {
      if (live) setAvailablePresets(ids)
    })
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
  /** The selected Agent's mapped preset, when the Agent has one and it is
   *  installed (or the roster is still loading — the injected action guards). */
  const usablePreset = useMemo(() => {
    const mapped = presetForAgent(selectedAgent.id)
    if (mapped === undefined) return undefined
    return availablePresets === null || availablePresets.has(mapped) ? mapped : undefined
  }, [availablePresets, selectedAgent])
  /** Surface a missing-preset notice instead of silently starting on the default. */
  const presetNotice = useMemo(() => {
    const mapped = presetForAgent(selectedAgent.id)
    if (mapped === undefined || availablePresets === null || availablePresets.has(mapped)) return undefined
    return t('preset.missing', { preset: mapped })
  }, [availablePresets, selectedAgent, t])
  const startWithPreset = (workspaceId?: WorkspaceId): void => {
    void startSession(workspaceId, usablePreset)
  }
  const stats = useMemo<DashboardStats>(() => ({
    workspaces: workspaces.items.length,
    sessions: sessions.ids.length,
    running: sessions.ids.reduce(
      (count, id) => count + (sessions.byId[id]?.running === true ? 1 : 0),
      0,
    ),
  }), [sessions, workspaces])
  const groups = useMemo(
    () => groupSessions(sessions, workspaces, t('group.ungrouped')),
    [sessions, workspaces, t],
  )

  const sidebarOwner: DashboardSidebarOwnerProps = {
    agents,
    selectedAgentId: selectedAgent.id,
    onSelectAgent: (agentId) => { setSelectedAgentId(agentId); setSidebarOpen(false) },
    onNewSession: () => { startWithPreset(); setSidebarOpen(false) },
  }
  const mainOwner: DashboardMainOwnerProps = {
    selectedAgentId: selectedAgent.id,
    selectedAgentLabel: t(selectedAgent.labelKey),
  }

  return (
    <div className={sidebarOpen ? clsx(css.frame, css.frameSidebarOpen) : css.frame} data-dsh-shell="dashboard">
      <button type="button" className={css.mobileMenuButton} aria-label={t('nav.open')} aria-expanded={sidebarOpen} onClick={() => { setSidebarOpen(true) }}>
        <span aria-hidden="true">☰</span>
      </button>
      {sidebarOpen && <button type="button" className={css.sidebarScrim} aria-label={t('nav.close')} onClick={() => { setSidebarOpen(false) }} />}
      <aside className={css.sidebarRegion}>
        {renderSlot('dashboard.sidebar', sidebarOwner, {
          fallback: <AgentNav {...sidebarOwner} onClose={() => { setSidebarOpen(false) }} t={t} />,
        })}
      </aside>
      <main className={css.mainRegion}>
        {renderSlot('dashboard.main', mainOwner, {
          fallback: (
            <AgentDashboard
              selectedAgentId={mainOwner.selectedAgentId}
              selectedAgentLabel={mainOwner.selectedAgentLabel}
              sessions={sessions}
              baselinesReady={workspaces.baselinesReady}
              stats={stats}
              groups={groups}
              openSession={openSession}
              startSession={startWithPreset}
              presetNotice={presetNotice}
              t={t}
            />
          ),
        })}
        {/* The re-hosted conversation seat: ui-conversation's ConversationRoot
            renders the hero when no session is current and the live chat when
            one is — the Dashboard main region hosts it below the Agent board. */}
        <section className={css.conversationRegion} data-conversation-host>
          {renderSlot('conversation', {})}
        </section>
      </main>
    </div>
  )
}
