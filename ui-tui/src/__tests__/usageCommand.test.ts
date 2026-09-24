import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionCommands } from '../app/slash/commands/session.js'
import type { SessionUsageResponse } from '../gatewayTypes.js'

const usageCommand = sessionCommands.find(cmd => cmd.name === 'usage')!

const guarded =
  <T>(fn: (r: T) => void) =>
  (r: null | T) => {
    if (r) {
      fn(r)
    }
  }

/** Build a ctx whose rpc routes by method name to a supplied map of results. */
const buildCtx = (results: Record<string, unknown>) => {
  const sys = vi.fn()
  const panel = vi.fn()

  const rpc = vi.fn((method: string, _params: unknown) => Promise.resolve(results[method]))

  const ctx = {
    gateway: { rpc },
    guarded,
    guardedErr: vi.fn(),
    sid: 'sid-1',
    stale: () => false,
    transcript: { page: vi.fn(), panel, sys }
  }

  const run = async (arg: string) => {
    usageCommand.run(arg, ctx as any, 'usage')
    await rpc.mock.results[0]?.value
    await Promise.resolve()
    await Promise.resolve()
  }

  return { ctx, panel, run, sys }
}

const baseUsage = (overrides: Partial<SessionUsageResponse> = {}): SessionUsageResponse =>
  ({ calls: 0, input: 0, output: 0, total: 0, ...overrides }) as SessionUsageResponse

const printed = (sys: ReturnType<typeof vi.fn>) => sys.mock.calls.map(c => c[0]).join('\n')

describe('/usage slash command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports "no API calls yet" and skips the Usage panel before any call', async () => {
    const { panel, run, sys } = buildCtx({ 'session.usage': baseUsage({ calls: 0 }) })

    await run('')

    expect(printed(sys)).toContain('no API calls yet')
    expect(panel).not.toHaveBeenCalled()
  })

  it('renders token totals in the Usage panel once calls exist', async () => {
    const { panel, run, sys } = buildCtx({
      'session.usage': baseUsage({ calls: 3, input: 1200, model: 'example-model', output: 300, total: 1500 })
    })

    await run('')

    const [title, sections] = panel.mock.calls[0] as [string, { rows?: [string, string][] }[]]
    const rows = Object.fromEntries(sections[0]?.rows ?? [])

    expect(title).toBe('Usage')
    expect(rows['Model']).toBe('example-model')
    expect(rows['API calls']).toBe((3).toLocaleString())
    expect(rows['Total tokens']).toBe((1500).toLocaleString())
    expect(printed(sys)).not.toContain('no API calls yet')
  })
})
