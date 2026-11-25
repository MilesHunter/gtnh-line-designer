import type { PngCaptureRect } from './types'

/**
 * Clamp a renderer-provided CSS rectangle to the window content area.
 * capturePage expects integer DIP coordinates inside the page viewport.
 */
export function clampCaptureRect(
  rect: PngCaptureRect,
  contentWidth: number,
  contentHeight: number
): PngCaptureRect | null {
  if (
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(contentHeight) ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return null
  }
  const maxWidth = Math.max(0, Math.floor(contentWidth))
  const maxHeight = Math.max(0, Math.floor(contentHeight))
  const x = Math.min(Math.max(0, Math.round(rect.x)), maxWidth)
  const y = Math.min(Math.max(0, Math.round(rect.y)), maxHeight)
  const width = Math.min(Math.max(0, Math.round(rect.width)), maxWidth - x)
  const height = Math.min(Math.max(0, Math.round(rect.height)), maxHeight - y)
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}
