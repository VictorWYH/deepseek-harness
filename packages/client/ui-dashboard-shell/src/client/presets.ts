/**
 * Phase-1 Agent → agentPreset mapping: which installed composition preset each
 * product Agent's New Session flow should request. The ids mirror the
 * deployment's shipped preset names (`coder`, `btender`, `invest`, `video`);
 * availability is checked against the live `agentPreset.list` roster at
 * runtime, so a missing preset degrades to the deployment default instead of
 * failing the create.
 */

/** Agent id → agentPreset id; only roster keys that have a composition preset. */
export const AGENT_PRESET_MAP: Readonly<Record<string, string>> = {
  coder: 'coder',
  btender: 'btender',
  invest: 'invest',
  video: 'video',
}

/**
 * Resolve the composition preset an Agent's New Session flow should request.
 * @param agentId - the selected product Agent id.
 * @returns the mapped preset id, or undefined when the Agent has none.
 */
export function presetForAgent(agentId: string): string | undefined {
  return AGENT_PRESET_MAP[agentId]
}
