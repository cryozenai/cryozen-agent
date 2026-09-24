import { describe, expect, it } from 'vitest'

import { billingDialogCopy, type BillingWallBlock } from './billingDialog.js'

function makeBlock(overrides: Partial<BillingWallBlock> = {}): BillingWallBlock {
  return {
    billing_url: 'https://openrouter.ai/settings/credits',
    provider_label: 'OpenRouter',
    ...overrides
  }
}

describe('billingDialogCopy', () => {
  it('offers to open a third-party provider billing page', () => {
    const copy = billingDialogCopy(makeBlock())
    expect(copy.title).toContain('OpenRouter')
    expect(copy.confirmLabel).toBe('Open billing page')
  })

  it('falls back to switching providers when there is no URL', () => {
    const copy = billingDialogCopy(makeBlock({ billing_url: null, provider_label: 'DeepSeek' }))
    expect(copy.title).toContain('DeepSeek')
    expect(copy.confirmLabel).toBe('Switch provider')
  })
})
