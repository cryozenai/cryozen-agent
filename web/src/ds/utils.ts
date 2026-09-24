import { type ClassValue, clsx } from 'clsx'
import { forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export type PolyProps<
  T extends React.ElementType,
  Own extends object = object
> = { as?: T } & Own & Omit<React.ComponentPropsWithoutRef<T>, 'as' | keyof Own>

export type PolyRef<T extends React.ElementType> =
  React.ComponentPropsWithRef<T>['ref']

export type PolyComponent<
  D extends React.ElementType,
  Own extends object = object
> = <T extends React.ElementType = D>(
  props: PolyProps<T, Own> & { ref?: PolyRef<T> }
) => null | React.ReactElement

export const polyRef = forwardRef as <
  D extends React.ElementType,
  Own extends object = object
>(
  render: <T extends React.ElementType = D>(
    props: PolyProps<T, Own>,
    ref: PolyRef<T>
  ) => null | React.ReactElement
) => PolyComponent<D, Own>

const hexToRgb = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
]

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`

export const colorDodge = (base: string, blend: string) => {
  const [br, bg, bb] = hexToRgb(base)
  const [lr, lg, lb] = hexToRgb(blend)

  const d = (b: number, l: number) =>
    l === 255 ? 255 : Math.min(255, Math.floor((b * 255) / (255 - l)))

  return rgbToHex(d(br, lr), d(bg, lg), d(bb, lb))
}

export const colorMix = (color: string, alpha: number) =>
  `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
