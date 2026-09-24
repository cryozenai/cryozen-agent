import { describe, expect, it } from 'vitest'

import {
  BUILTIN_THEME_LIST,
  BUILTIN_THEMES,
  cryozenAltTheme,
  DEFAULT_SKIN_NAME,
  DEFAULT_TYPOGRAPHY,
  EMOJI_FALLBACK,
  migrateSkinName
} from './presets'

// #40364: none of the UI text/mono fonts carry emoji glyphs, so every font
// stack must end with a color-emoji fallback or emoji render as tofu on
// platforms whose default font lacks them (e.g. Linux).
describe('theme typography emoji fallback (#40364)', () => {
  const stacks: Array<[string, string]> = [
    ['DEFAULT_TYPOGRAPHY.fontSans', DEFAULT_TYPOGRAPHY.fontSans],
    ['DEFAULT_TYPOGRAPHY.fontMono', DEFAULT_TYPOGRAPHY.fontMono],
    // A theme may override only fontMono (fontSans then falls back to the
    // default, which already carries the emoji stack), so skip undefined.
    ...BUILTIN_THEME_LIST.flatMap(theme =>
      (
        [
          [`${theme.name}.fontSans`, theme.typography?.fontSans],
          [`${theme.name}.fontMono`, theme.typography?.fontMono]
        ] as Array<[string, string | undefined]>
      ).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  ]

  it.each(stacks)('%s includes a color-emoji font', (_label, stack) => {
    expect(stack).toMatch(/Apple Color Emoji|Segoe UI Emoji|Noto Color Emoji|(^|,\s*)emoji\b/)
  })

  it('EMOJI_FALLBACK lists the major platform emoji fonts', () => {
    expect(EMOJI_FALLBACK).toContain('Apple Color Emoji')
    expect(EMOJI_FALLBACK).toContain('Segoe UI Emoji')
    expect(EMOJI_FALLBACK).toContain('Noto Color Emoji')
  })
})

// The pre-GitHub palette stays available as cryozen-alt; the default name
// still means GitHub chrome + brand blue.
describe('cryozen-alt is the retired palette, not the default', () => {
  it('is registered under its own name and leaves cryozen as the default', () => {
    expect(DEFAULT_SKIN_NAME).toBe('cryozen')
    expect(BUILTIN_THEMES['cryozen-alt']).toBe(cryozenAltTheme)
    expect(BUILTIN_THEMES.cryozen).not.toBe(cryozenAltTheme)
    expect(cryozenAltTheme.darkColors?.background).toBe('#0D2F86')
    expect(BUILTIN_THEMES.cryozen.darkColors?.background).not.toBe(cryozenAltTheme.darkColors?.background)
  })
})

describe('migrateSkinName', () => {
  it('maps every legacy or retired id onto a registered built-in', () => {
    for (const legacy of ['default', 'gold']) {
      expect(BUILTIN_THEMES[migrateSkinName(legacy)], legacy).toBeDefined()
    }
  })

  it('maps retired ids onto the default skin', () => {
    expect(migrateSkinName('gold')).toBe(DEFAULT_SKIN_NAME)
  })

  it('passes current and unknown names through untouched', () => {
    for (const name of [...Object.keys(BUILTIN_THEMES), 'bloomberg']) {
      expect(migrateSkinName(name)).toBe(name)
    }
  })
})
