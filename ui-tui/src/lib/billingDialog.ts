/** The fields of the gateway's billing-wall block (`message.complete` `payload.billing`) this dialog reads. */
export interface BillingWallBlock {
  billing_url?: null | string
  provider_label?: null | string
}

export interface BillingDialogCopy {
  cancelLabel: string
  confirmLabel: string
  detail: string
  title: string
}

/**
 * Copy for the out-of-credits confirm dialog (the TUI's billing wall). The
 * dialog is the actionable layer: the full provider guidance already lands in
 * the transcript, so `detail` stays to one concise, non-truncating line and the
 * confirm button carries the recovery: the provider's billing page, or `/model`
 * to switch when there is no URL. Pure + exported so the wording is
 * unit-tested without driving the gateway.
 */
export function billingDialogCopy(block: BillingWallBlock): BillingDialogCopy {
  const label = block.provider_label || 'your provider'

  return {
    cancelLabel: 'Dismiss',
    confirmLabel: block.billing_url ? 'Open billing page' : 'Switch provider',
    detail: `${label} reports your credits or billing are exhausted.`,
    title: `Out of credits · ${label}`
  }
}
