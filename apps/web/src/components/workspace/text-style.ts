import type { TextStyle } from '@workspace/domain'

export function getTextStyleCss(style?: TextStyle) {
  const preset = style?.preset ?? 'body'

  let fontSize = style?.fontSize ?? 16
  let fontWeight = style?.fontWeight ?? 'normal'
  let fontStyle = style?.fontStyle ?? 'normal'
  let letterSpacing = 'normal'

  if (preset === 'heading-1') {
    fontSize = style?.fontSize ?? 24
    fontWeight = style?.fontWeight ?? 'bold'
    letterSpacing = '-0.02em'
  } else if (preset === 'heading-2') {
    fontSize = style?.fontSize ?? 20
    fontWeight = style?.fontWeight ?? 'bold'
    letterSpacing = '-0.01em'
  } else if (preset === 'quote') {
    fontSize = style?.fontSize ?? 17
    fontStyle = style?.fontStyle ?? 'italic'
  }

  const decorations = [style?.underline ? 'underline' : '', style?.strikethrough ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')

  return {
    fontFamily: style?.fontFamily ?? '"Segoe UI", system-ui, sans-serif',
    fontSize,
    fontWeight,
    fontStyle,
    letterSpacing,
    textDecoration: decorations || 'none'
  }
}
