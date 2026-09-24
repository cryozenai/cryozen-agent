import { forwardRef } from 'react'

import { Typography, type TypographyProps } from '.'

export const Small = forwardRef<HTMLSpanElement, TypographyProps<'small'>>(
  (props, ref) => {
    return (
      <Typography as='small' label variant="sm" {...{ ref, ...props }} />
    )
  }
)
