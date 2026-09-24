import { beforeEach, expect, test } from 'vitest'

import {
  type AgentNoticePayload,
  clearAgentNotice,
  noticeToToast,
  showAgentNotice,
  splitMeta,
  stripGlyph
} from './agent-notices'
import { $notifications, clearNotifications } from './notifications'

function usage(overrides: Partial<AgentNoticePayload> = {}): AgentNoticePayload {
  return {
    key: 'quota.usage',
    kind: 'sticky',
    level: 'info',
    text: '• Half of the daily quota used',
    ...overrides
  }
}

beforeEach(() => {
  clearNotifications()
})

// ── noticeToToast: the whole mapping contract ────────────────────────────────

test('drops a notice with no text', () => {
  expect(noticeToToast(undefined)).toBeNull()
  expect(noticeToToast({ text: '' })).toBeNull()
  expect(noticeToToast({ text: '   ' })).toBeNull()
})

test('level maps to toast kind (warn → warning)', () => {
  expect(noticeToToast(usage({ level: 'info' }))?.kind).toBe('info')
  expect(noticeToToast(usage({ level: 'warn' }))?.kind).toBe('warning')
  expect(noticeToToast(usage({ level: 'error' }))?.kind).toBe('error')
  expect(noticeToToast(usage({ level: 'success' }))?.kind).toBe('success')
})

test('unknown / missing level falls back to info', () => {
  expect(noticeToToast({ text: 'x', level: 'bogus' })?.kind).toBe('info')
  expect(noticeToToast({ text: 'x' })?.kind).toBe('info')
})

test('sticky notices never auto-dismiss', () => {
  expect(noticeToToast(usage({ kind: 'sticky' }))?.durationMs).toBe(0)
})

test('ttl notice carries its ttl_ms as the duration', () => {
  const toast = noticeToToast({
    key: 'quota.restored',
    kind: 'ttl',
    level: 'success',
    text: '✓ restored',
    ttl_ms: 8000
  })

  expect(toast?.durationMs).toBe(8000)
})

test('ttl notice without a usable ttl_ms defers to notify()’s default', () => {
  expect(noticeToToast({ text: 'x', kind: 'ttl' })?.durationMs).toBeUndefined()
  expect(noticeToToast({ text: 'x', kind: 'ttl', ttl_ms: 0 })?.durationMs).toBeUndefined()
})

test('the notice key is the toast id, falling back to id', () => {
  expect(noticeToToast(usage({ key: 'quota.usage' }))?.id).toBe('quota.usage')
  expect(noticeToToast({ text: 'x', id: 'n1', key: undefined })?.id).toBe('n1')
})

test('the leading severity glyph is stripped from the toast message', () => {
  // The toast renders a kind icon, so the message must not double up on a glyph.
  expect(noticeToToast(usage())?.message).toBe('Half of the daily quota used')
  expect(noticeToToast(usage({ level: 'error', text: '✕ Requests paused' }))?.message).toBe('Requests paused')
  expect(noticeToToast(usage({ level: 'success', text: '✓ Requests resumed' }))?.message).toBe('Requests resumed')
})

test('the trailing "· detail" is split off as a secondary meta line, not inlined', () => {
  // Detail-carrying notices split on the first ` · `.
  const paused = noticeToToast({
    key: 'quota.exhausted',
    level: 'error',
    text: '✕ Requests paused · try again tomorrow'
  })

  expect(paused?.message).toBe('Requests paused')
  expect(paused?.meta).toBe('try again tomorrow')

  // The window notice carries a `· detail` tail too.
  const grant = noticeToToast({ key: 'quota.window', level: 'info', text: '• Window reset · 12 requests left' })
  expect(grant?.message).toBe('Window reset')
  expect(grant?.meta).toBe('12 requests left')

  // The usage line has no middot → whole line is the message, no meta.
  const plain = noticeToToast(usage())
  expect(plain?.message).toBe('Half of the daily quota used')
  expect(plain?.meta).toBeUndefined()
})

test('splitMeta splits on the first space-middot-space only', () => {
  expect(splitMeta('Requests paused · try again tomorrow')).toEqual(['Requests paused', 'try again tomorrow'])
  expect(splitMeta('Window reset · 12 requests left')).toEqual(['Window reset', '12 requests left'])
  expect(splitMeta('Requests resumed')).toEqual(['Requests resumed', undefined])
  // Interior middots after the first split stay in the meta.
  expect(splitMeta('a · b · c')).toEqual(['a', 'b · c'])
})

test('stripGlyph removes only a single leading severity glyph', () => {
  expect(stripGlyph('• Quota 50% used')).toBe('Quota 50% used')
  expect(stripGlyph('⚠ warn')).toBe('warn')
  expect(stripGlyph('✕ paused')).toBe('paused')
  expect(stripGlyph('✓ ok')).toBe('ok')
  // No leading glyph → unchanged; interior glyphs are preserved.
  expect(stripGlyph('Quota 50% used')).toBe('Quota 50% used')
  expect(stripGlyph('spent · 12 • requests left')).toBe('spent · 12 • requests left')
})

test('showAgentNotice renders a toast; empty text is a no-op', () => {
  showAgentNotice(usage())
  expect($notifications.get()).toHaveLength(1)
  expect($notifications.get()[0]?.id).toBe('quota.usage')

  showAgentNotice({ text: '' })
  expect($notifications.get()).toHaveLength(1)
})

test('re-emitting the same key replaces the toast instead of stacking (50→75→90)', () => {
  showAgentNotice(usage({ level: 'info', text: '• Quota 50% used' }))
  showAgentNotice(usage({ level: 'warn', text: '⚠ Quota 75% used' }))
  showAgentNotice(usage({ level: 'warn', text: '⚠ Quota 90% used' }))

  const toasts = $notifications.get().filter(item => item.id === 'quota.usage')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]?.message).toBe('Quota 90% used')
  expect(toasts[0]?.kind).toBe('warning')
})

test('clearAgentNotice dismisses only the matching key', () => {
  showAgentNotice(usage())
  showAgentNotice({ key: 'quota.exhausted', kind: 'sticky', level: 'error', text: '✕ paused' })
  expect($notifications.get()).toHaveLength(2)

  clearAgentNotice('quota.usage')
  const ids = $notifications.get().map(item => item.id)
  expect(ids).toContain('quota.exhausted')
  expect(ids).not.toContain('quota.usage')

  clearAgentNotice(undefined)
  expect($notifications.get()).toHaveLength(1)
})
