/**
 * Phase-1 Agent → agentPreset mapping: which installed composition preset each
 * product Agent's New Session flow should request.
 *
 * The deployment's SHIPPED preset roster (apps/cli/config/agent-presets) is
 * `code`, `cordis`, `minimal`, `standard` — there is no `coder`/`btender`/
 * `invest`/`video` preset. Product Agent ids are labels, not preset ids, so
 * mapping to a nonexistent id would make every Agent surface a spurious
 * "preset not installed" notice and silently fall back. Every Agent maps to
 * the deployment default (`standard`) instead, and resolution re-checks the
 * live `agentPreset.list` roster so a later rename/removal still degrades to
 * the default composition instead of failing the create.
 */

/** The deployment's default composition (web-app bundle `agent-presets default`). */
export const FALLBACK_PRESET = 'standard'

/** Agent id → agentPreset id; only roster keys that have a composition preset. */
export const AGENT_PRESET_MAP: Readonly<Record<string, string>> = {
  // The shipped web composition's actual default is `standard`; product Agent
  // ids are labels, not preset ids. Deployments may add aliases later.
  coder: 'standard',
  btender: 'standard',
  invest: 'standard',
  video: 'standard',
}

/**
 * Resolve the composition preset an Agent's New Session flow should request.
 * @param agentId - the selected product Agent id.
 * @returns the mapped preset id, or undefined when the Agent has none.
 */
export function presetForAgent(agentId: string): string | undefined {
  return AGENT_PRESET_MAP[agentId]
}

/**
 * Resolve an Agent's preset against the LIVE installed roster: the mapped
 * preset when installed, else the deployment default (`standard`) when
 * installed, else undefined (the caller surfaces a missing-preset notice).
 * @param agentId - the selected product Agent id.
 * @param available - the installed preset ids from `agentPreset.list`.
 * @returns the preset id to request, or undefined when nothing is usable.
 */
export function resolveAgentPreset(
  agentId: string,
  available: ReadonlySet<string>,
): string | undefined {
  const mapped = presetForAgent(agentId)
  if (mapped !== undefined && available.has(mapped)) return mapped
  return available.has(FALLBACK_PRESET) ? FALLBACK_PRESET : undefined
}
