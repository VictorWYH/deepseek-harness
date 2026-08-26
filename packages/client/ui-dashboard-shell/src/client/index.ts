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
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { DashboardShellInjected } from './contract/slots.ts'
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
export const inject = ['slots', 'sessions', 'workspaces', 'locale']

/**
 * Register the product shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-dashboard-shell: dictionaries')

  const injectProps = (): DashboardShellInjected => ({
    // The shell's Session actions ride the runtime's shared flows; the frame
    // stays a pure props component.
    openSession: (sessionId) => { ctx.sessions.open(sessionId) },
    startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
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
      // may render them, and a future occupant registers into the hole.
      children: {
        'dashboard.sidebar': { kind: 'single', scope: 'root' },
        'dashboard.main': { kind: 'single', scope: 'root' },
      },
      locale: NS,
      inject: injectProps,
    }, DashboardFrame),
    'ui-dashboard-shell: root registration',
  )
}
