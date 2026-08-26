/**
 * Dashboard shell plugin, browser half: one register() call contributes the
 * product DashboardFrame into the runtime's built-in 'root' slot at priority
 * -1 — the lowest rank renders, so this entry shadows the native AppFrame's
 * priority-0 registration and takes over the whole browser surface — and, in
 * the same breath, declares the two child seats (`dashboard.sidebar` /
 * `dashboard.main`) the frame renders with built-in fallbacks. The plugin
 * holds no store: Agent selection is frame-local state, the sessions/
 * workspaces snapshots arrive through the global standard hooks, and Session
 * actions forward to the runtime services.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the panel-action face ui-conversation reaches through ctx.layout.
// The dashboard composition disables ui-layout wholesale (its native AppFrame
// registration would collide with this shell's re-hosted child seats), so this
// package provides the layout service shim itself.
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DashboardShellInjected } from './contract/slots.ts'
import { agentWorkspacePath, ensureAgentWorkspaceDirs } from './agent-workspace.ts'
import { DashboardFrame } from './DashboardFrame.tsx'
import { en, zh, type DashboardKey } from './locales.ts'

export type {
  AgentDescriptor, DashboardFrameComponentProps, DashboardMainOwnerProps,
  DashboardShellInjected, DashboardSidebarOwnerProps,
} from './contract/slots.ts'
export type { DashboardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dashboard shell copy. */
    dashboard: DashboardKey
  }
}

/** Dictionary namespace owned by this plugin (shell copy). */
const NS = 'dashboard'

/** Services required by the dashboard shell plugin. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'connection']

/**
 * The layout-service shim replacing ui-layout's controller in the dashboard
 * composition. The dashboard owns its rail and hosts no details column, so the
 * panel transitions ui-conversation triggers are structural no-ops: nothing is
 * lost, and the calls stay safe (fire-and-forget in ui-conversation).
 */
const dashboardLayoutService: ILayout = {
  toggleSidebar(): void { /* the Agent rail is always visible in this shell */ },
  openDetails(): void { /* no details column in this shell */ },
  closeDetails(): void { /* no details column in this shell */ },
}

/**
 * Register the product shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-dashboard-shell: dictionaries')

  // Provide ctx.layout before the root registration so ui-conversation (which
  // injects 'layout') can activate. Only provide when ui-layout is absent —
  // a partial composition that keeps the real controller must not be shadowed.
  ctx.effect(() => {
    if (ctx.get('layout') !== undefined) {
      // Another entry already owns the seat; this shim stays inert.
      return () => {}
    }
    const disposeService = ctx.reflect.provide('layout', dashboardLayoutService)
    return () => { void disposeService() }
  }, 'ui-dashboard-shell: layout service shim')

  /** The installed preset ids from the live roster; a transport failure degrades to empty. */
  const resolvePresetIds = async (): Promise<ReadonlySet<string>> => {
    const { api } = ctx.get('connection') as ConnectionHandle
    const response = await api.agentPresets.list({})
    if (!response.result.ok) return new Set()
    return new Set(response.result.value.presets.map(preset => preset.id))
  }

  /** The DSH home, resolved once and cached (a failure retries on next use). */
  let homePromise: Promise<string> | undefined
  const describeHome = async (): Promise<string> => {
    if (homePromise === undefined) {
      homePromise = (async () => {
        const { api } = ctx.get('connection') as ConnectionHandle
        const response = await api.host.describe({})
        if (!response.result.ok) throw new Error(`host.describe failed: ${response.result.error.message}`)
        return response.result.value.home
      })().catch((reason: unknown) => {
        homePromise = undefined
        throw reason
      })
    }
    return homePromise
  }

  /** Coalesces concurrent ensures per Agent+preset key. */
  const ensuring = new Map<string, Promise<SessionId>>()
  const ensureAgentWorkspace = (agentId: string, agentPreset?: string): Promise<SessionId> => {
    const key = `${agentId}:${agentPreset ?? ''}`
    const inFlight = ensuring.get(key)
    if (inFlight !== undefined) return inFlight
    const attempt = (async () => {
      const { api } = ctx.get('connection') as ConnectionHandle
      const home = await describeHome()
      const target = agentWorkspacePath(home, agentId)
      const workspaces = ctx.workspaces.list.getSnapshot()
      const sessionList = ctx.sessions.list.getSnapshot()
      const currentId = sessionList.current
      const current = currentId === undefined ? undefined : sessionList.byId[currentId]
      const existing = workspaces.items.find(workspace => workspace.path === target)
      // Already connected: the current session lives in this Agent's Workspace.
      if (current !== undefined && currentId !== undefined && existing !== undefined
        && (current.cwd === target || existing.sessionIds.includes(currentId))) {
        return currentId
      }
      const workspace = existing ?? await (async () => {
        await ensureAgentWorkspaceDirs(api, home, agentId)
        return ctx.workspaces.create({ path: target })
      })()
      let preset: string | undefined = agentPreset
      if (preset !== undefined) {
        const available = await resolvePresetIds()
        if (!available.has(preset)) {
          console.warn(`ui-dashboard-shell: agent preset "${preset}" is not installed; using the deployment default`)
          preset = undefined
        }
      }
      return ctx.workspaces.connectWorkspace(workspace.workspaceId, preset)
    })().finally(() => { ensuring.delete(key) })
    ensuring.set(key, attempt)
    return attempt
  }

  const injectProps = (): DashboardShellInjected => ({
    // The shell's Session actions ride the runtime's shared flows; the frame
    // stays a pure props component.
    openSession: (sessionId) => { ctx.sessions.open(sessionId) },
    // New Session binds the selected Agent's composition: the preset is
    // dropped when the live roster lacks it (the deployment default applies,
    // mirroring the frame's notice) so an uninstalled preset can never fail
    // the create with agent-preset-not-found.
    startSession: async (workspaceId, agentPreset) => {
      let preset: string | undefined = agentPreset
      if (preset !== undefined) {
        const available = await resolvePresetIds()
        if (!available.has(preset)) {
          console.warn(`ui-dashboard-shell: agent preset "${preset}" is not installed; using the deployment default`)
          preset = undefined
        }
      }
      ctx.workspaces.startSession(workspaceId, preset)
    },
    resolveAgentPresets: resolvePresetIds,
    ensureAgentWorkspace,
  })

  ctx.effect(
    () => ctx.slots.register({
      name: 'root',
      // Lowest renders: the product shell wins the single 'root' cell over
      // any priority-0 registration (the web-app bundle disables the native
      // chrome; the rank keeps this shell authoritative under partial
      // compositions too).
      priority: -1,
      // The frame owns geometry; these two holes are its replaceable regions.
      // Declaring them also declares the render authorization: only the frame
      // may render them, and a future occupant registers into the hole. The
      // shared product seats ('conversation' / 'details') are re-hosted here
      // because ui-layout's AppFrame is not registered under this composition
      // (its root entry would double-declare them); the frame renders
      // 'conversation' in its main region so the chat surface stays live.
      children: {
        'dashboard.sidebar': { kind: 'single', scope: 'root' },
        'dashboard.main': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        // The sidebar's directory-flow hole. The Dashboard composition disables
        // ui-sidebar, so nobody else declares this seat — but the composed
        // directory-picker pair registers its browse/native flow into BOTH
        // workspace holes transactionally (the sidebar one gates the hero
        // picker's "Add workspace" entry). Declaring it here unblocks that
        // pair; the seat is never rendered (no sidebar shell under this frame).
        'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
      },
      locale: NS,
      inject: injectProps,
    }, DashboardFrame),
    'ui-dashboard-shell: root registration',
  )
}
