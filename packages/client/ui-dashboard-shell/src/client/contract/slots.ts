/**
 * Dashboard shell slot contract: the registrant-side props composition for the
 * runtime's built-in `root` slot, plus the child holes this shell declares
 * (`dashboard.sidebar` / `dashboard.main`) and the shared product seats it
 * re-hosts while the native AppFrame is not registered (`conversation`,
 * rendered in the main region so the conversation surface keeps working;
 * `details`, declared for ui-conversation's details panel).
 *
 * The frame owns Agent selection as component-local state and projects the
 * read-only `useSessions` / `useWorkspaces` snapshots into the selected
 * Agent's dashboard. Both dashboard holes are single seats at `root` scope:
 * the frame renders them through `renderSlot` with built-in fallbacks, so a
 * future phase can replace either region by registering into the hole without
 * touching the frame.
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the runtime's SlotMap merge (the 'root' entry) and the
// session/workspace id brands into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ui-layout's SlotMap merge for the shared product seats
// ('conversation' / 'details') this shell re-hosts while the native AppFrame
// is not registered under this composition.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The product shell's left rail: the Agent list. Declared by this
     * package's `root` entry (declaring is claiming); the frame renders a
     * built-in Agent list as the fallback while no package occupies the seat.
     */
    'dashboard.sidebar': { kind: 'single'; scope: 'root'; owner: DashboardSidebarOwnerProps }
    /**
     * The product shell's right region: the selected Agent's dashboard and
     * Session list. Declared by this package's `root` entry; the frame
     * renders the built-in dashboard as the fallback while unoccupied.
     */
    'dashboard.main': { kind: 'single'; scope: 'root'; owner: DashboardMainOwnerProps }
  }
}

/** One Agent row in the product shell's navigation rail. */
export interface AgentDescriptor {
  /** Stable product id (the future Profile/agent binding key). */
  id: string
  /** Display label, resolved through the dashboard locale namespace. */
  label: string
}

/** Owner share of the sidebar hole: Agent navigation state decided by the frame. */
export interface DashboardSidebarOwnerProps {
  /** The full Agent roster in display order. */
  agents: readonly AgentDescriptor[]
  /** Currently selected Agent id. */
  selectedAgentId: string
  /** Select another Agent (the frame owns the selection state). */
  onSelectAgent: (agentId: string) => void
  /** Start a New Session through the runtime's shared action. */
  onNewSession: () => void
}

/** Owner share of the main hole: the frame's Agent selection. */
export interface DashboardMainOwnerProps {
  /** Currently selected Agent id. */
  selectedAgentId: string
  /** Display label of the selected Agent. */
  selectedAgentLabel: string
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The shell keeps only its own actions; business data arrives
 * through the global `useSessions` / `useWorkspaces` standard hooks.
 */
export type DashboardShellInjected = {
  /**
   * Open an existing session as current through the runtime sessions service.
   * @param sessionId - a listed session id.
   */
  openSession: (sessionId: SessionId) => void
  /**
   * Start a New Session through the runtime workspaces service: with a
   * workspace, reuse-or-create its blank session and open it; without one,
   * inherit the current Session Workspace, then the recent Workspace. An
   * `agentPreset` names the composition the new session's agent is built
   * from; the implementation drops a preset the live roster does not contain
   * (the deployment default applies) rather than failing the create.
   * @param workspaceId - explicit target Workspace for scoped actions.
   * @param agentPreset - optional composition preset for the new session.
   */
  startSession: (workspaceId?: WorkspaceId, agentPreset?: string) => Promise<void>
  /**
   * Resolve the ids of the installed agent presets (the live `agentPreset.list`
   * roster). Used by the frame to surface which Agents' presets are missing.
   * @returns the available preset ids.
   */
  resolveAgentPresets: () => Promise<ReadonlySet<string>>
}

/**
 * Full component props: runtime root share (global hooks), the declared
 * holes' render shares (the two dashboard seats plus the re-hosted
 * 'conversation' / 'details' product seats), this package's injected
 * callbacks, and the standard locale seat. No store is registered — Agent
 * selection is component-local.
 */
export type DashboardFrameComponentProps =
  PropsRuntime<'root'>
  & PropsRenderSlots<'dashboard.sidebar' | 'dashboard.main' | 'conversation' | 'details'>
  & DashboardShellInjected
  & PropsLocale<'dashboard'>
