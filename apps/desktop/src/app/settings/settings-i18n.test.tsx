import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { Locale } from '@/i18n/types'

import { ComboboxInput } from './combobox-input'

afterEach(cleanup)

describe('Settings i18n', () => {
  // `ja` has no combobox copy of its own, so it must fall back to English
  // rather than render a raw key.
  it.each([
    ['en', 'Show options'],
    ['ja', 'Show options']
  ] satisfies [Locale, string][])('renders combobox affordances in %s', (locale, expectedLabel) => {
    render(
      <I18nProvider configClient={null} initialLocale={locale}>
        <ComboboxInput onChange={() => {}} options={[]} value="" />
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: expectedLabel })).toBeTruthy()
  })
})
