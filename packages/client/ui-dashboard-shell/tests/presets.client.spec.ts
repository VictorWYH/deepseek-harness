// Agent → preset resolution: the mapped preset must be a REAL shipped id and
// degrade to the deployment default (`standard`) when the live roster lacks it.
import { describe, expect, it } from 'vitest'
import {
  AGENT_PRESET_MAP, FALLBACK_PRESET, presetForAgent, resolveAgentPreset,
} from '../src/client/presets.ts'

describe('Agent → agentPreset resolution', () => {
  it('maps every product Agent to an existing shipped preset id', () => {
    const shipped = new Set(['code', 'cordis', 'minimal', 'standard'])
    for (const agentId of ['coder', 'btender', 'invest', 'video']) {
      const mapped = presetForAgent(agentId)
      expect(mapped).toBeDefined()
      expect(shipped.has(mapped!)).toBe(true)
    }
    // No hardcoded phantom ids survive.
    expect(AGENT_PRESET_MAP.coder).not.toBe('coder')
  })

  it('prefers the mapped preset when installed', () => {
    expect(resolveAgentPreset('coder', new Set(['standard', 'code', 'minimal']))).toBe('standard')
  })

  it('falls back to the deployment default when the mapped preset is absent', () => {
    // Map says `standard`; roster has it → still `standard`.
    expect(resolveAgentPreset('coder', new Set(['standard']))).toBe(FALLBACK_PRESET)
  })

  it('returns undefined only when neither the mapped preset nor the default is installed', () => {
    expect(resolveAgentPreset('coder', new Set(['minimal']))).toBeUndefined()
    expect(resolveAgentPreset('coder', new Set())).toBeUndefined()
  })

  it('resolves an unknown Agent to the deployment default when installed', () => {
    expect(resolveAgentPreset('unknown-agent', new Set(['standard']))).toBe(FALLBACK_PRESET)
    expect(resolveAgentPreset('unknown-agent', new Set(['minimal']))).toBeUndefined()
  })
})
