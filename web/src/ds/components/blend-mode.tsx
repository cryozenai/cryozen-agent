import { createElement, useMemo } from 'react'

import { cn, colorDodge, colorMix, type PolyProps, polyRef } from '../utils'

const LAYER_KEYS = { bg: 'bgColor', fg: 'fgColor', mg: 'mgColor' } as const
type Layer = keyof typeof LAYER_KEYS
type LayerSpec = `${Layer}/${number}` | Layer

const parseSpec = (spec: LayerSpec): [Layer, number?] => {
  const [layer, alpha] = spec.split('/') as [Layer, string?]

  return [layer, alpha ? parseFloat(alpha) : undefined]
}

// Static LENS_0 colors: the dashboard applies themes through CSS variables
// rather than live per-layer color controls, so every layer blends against
// the base canvas color and every target layer resolves to the accent.
const CANVAS_COLOR = '#041c1c'
const LAYER_COLOR = '#ffe6cb'

const useBlend = (spec?: LayerSpec | string) => {
  const layerKey = spec?.split('/')[0]
  const isLayerSpec = layerKey && layerKey in LAYER_KEYS

  const [target, alpha] = isLayerSpec
    ? parseSpec(spec as LayerSpec)
    : [undefined, undefined]

  const targetColor = target ? LAYER_COLOR : spec

  return useMemo(() => {
    if (!spec || !targetColor) {
      return undefined
    }

    const result = colorDodge(CANVAS_COLOR, targetColor)

    return alpha != null ? colorMix(result, alpha) : result
  }, [spec, targetColor, alpha])
}

export const useBlendMode = (opts: BlendModeOpts = {}): BlendColors => {
  const { background, color } = opts

  return {
    backgroundColor: useBlend(background),
    color: useBlend(color)
  }
}

export const withBlendMode = <P extends BlendColors>(
  Component: React.ComponentType<P>,
  opts?: BlendModeOpts
) => {
  const Wrapped = (
    props: Omit<P, keyof BlendColors> & Partial<BlendModeOpts>
  ) => {
    const { against, background, color, ...rest } = props as P & BlendModeOpts

    const colors = useBlendMode({
      against: against ?? opts?.against,
      background: background ?? opts?.background,
      color: color ?? opts?.color
    })

    return <Component {...(rest as P)} {...colors} />
  }

  Wrapped.displayName = `withBlendMode(${Component.displayName ?? Component.name ?? 'Component'})`

  return Wrapped
}

export const BlendMode = polyRef<'div', BlendModeOwnProps>(
  (
    { against, as, background, children, className, color, style, ...rest },
    ref
  ) => {
    const colors = useBlendMode({ against, background, color })

    if (typeof children === 'function') {
      return <>{children(colors)}</>
    }

    return createElement((as ?? 'div') as React.ElementType, {
      ...rest,
      children,
      className: cn(className),
      ref,
      style: { ...colors, ...style }
    })
  }
)

interface BlendModeOwnProps extends BlendModeOpts {
  children?: ((colors: BlendColors) => React.ReactNode) | React.ReactNode
}

export interface BlendColors {
  backgroundColor?: string
  color?: string
}

interface BlendModeOpts {
  against?: Layer
  background?: LayerSpec | string
  color?: LayerSpec | string
}

export type BlendModeProps<T extends React.ElementType = 'div'> = PolyProps<
  T,
  BlendModeOwnProps
>
