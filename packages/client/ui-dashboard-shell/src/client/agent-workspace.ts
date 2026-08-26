/**
 * Agent → default Workspace mapping for the Dashboard shell.
 *
 * Each product Agent owns one durable Workspace at
 * `<DSH home>/dashboard/<agentId>` — the folder IS the stable workspace key
 * (the Host workspace registry keys on the canonical directory path). The
 * namespace lives under the DSH home, so user Workspaces are never touched,
 * and a fresh home becomes immediately conversable: entering an Agent
 * ensures the folder exists, registers the path idempotently, and connects
 * its blank Session without ever opening the workspace picker.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'

/** Namespace directory under the DSH home holding every Agent's Workspace. */
export const DASHBOARD_WORKSPACES_DIR = 'dashboard'

/** Host error code reported when a directory already exists. */
export const DIRECTORY_EXISTS = 'directory-exists'

/**
 * The default Workspace directory path for one Agent.
 * @param home - the DSH home (host.describe().home; canonical).
 * @param agentId - stable product Agent id (folder segment).
 * @returns `<home>/dashboard/<agentId>` using the home's separator spelling.
 */
export function agentWorkspacePath(home: string, agentId: string): string {
  const separator = home.includes('\\') ? '\\' : '/'
  const base = home.replace(/[\\/]+$/, '')
  return `${base}${separator}${DASHBOARD_WORKSPACES_DIR}${separator}${agentId}`
}

/** `<home>/dashboard` — the namespace root shared by every Agent Workspace. */
export function agentWorkspacesRoot(home: string): string {
  const separator = home.includes('\\') ? '\\' : '/'
  return `${home.replace(/[\\/]+$/, '')}${separator}${DASHBOARD_WORKSPACES_DIR}`
}

/**
 * Whether a workspace path is this Agent's default Workspace
 * (`<home>/dashboard/<agentId>`), matched by stable suffix so the frame can
 * resolve the Agent's workspace without knowing the DSH home.
 * @param path - a workspace's canonical path.
 * @param agentId - the product Agent id.
 * @returns true when the path ends with `dashboard/<agentId>`.
 */
export function isAgentWorkspacePath(path: string, agentId: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.endsWith(`/${DASHBOARD_WORKSPACES_DIR}/${agentId}`)
}

/** True when a browse error is the host's "directory already exists" code. */
function isDirectoryExists(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason
    && (reason as { code?: unknown }).code === DIRECTORY_EXISTS
}

/**
 * Ensure the Agent's workspace directory exists on the Host: the shared
 * `dashboard` root under the home, then the Agent's own folder. An existing
 * directory is a no-op (the host reports `directory-exists`).
 * @param api - the wire client (host.describe / host.createDirectory).
 * @param home - the DSH home.
 * @param agentId - product Agent id (folder segment).
 * @returns the Agent's workspace path.
 */
export async function ensureAgentWorkspaceDirs(
  api: ConnectionHandle['api'],
  home: string,
  agentId: string,
): Promise<string> {
  const root = agentWorkspacesRoot(home)
  const target = agentWorkspacePath(home, agentId)
  const ensure = async (parent: string, name: string): Promise<void> => {
    const response = await api.host.createDirectory({ path: parent, name })
    if (!response.result.ok && !isDirectoryExists(response.result.error)) {
      throw new Error(
        `host.createDirectory('${name}' under '${parent}') failed: ${response.result.error.message}`,
      )
    }
  }
  await ensure(home, DASHBOARD_WORKSPACES_DIR)
  await ensure(root, agentId)
  return target
}
