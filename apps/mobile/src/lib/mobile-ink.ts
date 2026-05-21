import type { MobileToolSettings, NormalizedPoint } from './mobile-store'

export type InkPathKind = 'pen' | 'pencil' | 'freeform-highlight'

export const SMOOTH_INK_TOLERANCE = 0.004

export type InkCanvasSize = { width: number; height: number }

export type InkPointerSample = Pick<PointerEvent, 'clientX' | 'clientY'>

export function getCoalescedPointerEvents<T extends InkPointerSample>(
  event: T & { getCoalescedEvents?: () => PointerEvent[] }
): InkPointerSample[] {
  return event.getCoalescedEvents?.() ?? [event]
}

export function smoothInkPath(
  points: NormalizedPoint[],
  kind: InkPathKind,
  settings?: MobileToolSettings
): NormalizedPoint[] {
  const usablePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))

  if (usablePoints.length < 2) return usablePoints

  if (kind === 'freeform-highlight' && settings?.highlight.smoothed === false) {
    return usablePoints
  }

  return reduceInkPoints(usablePoints, SMOOTH_INK_TOLERANCE)
}

export function drawInkCurve(
  context: CanvasRenderingContext2D,
  points: NormalizedPoint[],
  canvasSize: InkCanvasSize
) {
  if (points.length < 2) return

  context.beginPath()

  const first = toCanvasPoint(points[0], canvasSize)
  context.moveTo(first.x, first.y)

  if (points.length === 2) {
    const second = toCanvasPoint(points[1], canvasSize)
    context.lineTo(second.x, second.y)
    return
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = toCanvasPoint(points[index], canvasSize)
    const next = toCanvasPoint(points[index + 1], canvasSize)
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2)
  }

  const last = toCanvasPoint(points[points.length - 1], canvasSize)
  context.lineTo(last.x, last.y)
}

export function getPredictedInkPoint(points: NormalizedPoint[], factor = 0.35): NormalizedPoint | null {
  if (points.length < 2) return null
  const previous = points[points.length - 2]
  const current = points[points.length - 1]
  return {
    x: current.x + (current.x - previous.x) * factor,
    y: current.y + (current.y - previous.y) * factor
  }
}

export function hitTestStroke(
  points: NormalizedPoint[],
  target: NormalizedPoint,
  radius: number,
  canvasSize?: InkCanvasSize
) {
  if (points.length === 0) return false
  const testPoints = canvasSize ? points.map((point) => toCanvasPoint(point, canvasSize)) : points
  const testTarget = canvasSize ? toCanvasPoint(target, canvasSize) : target
  const testRadius = Math.max(0, radius)

  if (testPoints.some((point) => distance(point, testTarget) <= testRadius)) return true

  for (let index = 1; index < testPoints.length; index += 1) {
    if (distanceToSegment(testTarget, testPoints[index - 1], testPoints[index]) <= testRadius) return true
  }

  return false
}

export function getStrokeBounds(points: NormalizedPoint[], strokeSize = 1, canvasSize?: InkCanvasSize) {
  const testPoints = canvasSize ? points.map((point) => toCanvasPoint(point, canvasSize)) : points
  if (testPoints.length === 0) return null
  const padding = Math.max(0, strokeSize / 2)
  const xs = testPoints.map((point) => point.x)
  const ys = testPoints.map((point) => point.y)
  const minX = Math.min(...xs) - padding
  const minY = Math.min(...ys) - padding
  const maxX = Math.max(...xs) + padding
  const maxY = Math.max(...ys) + padding
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}

function reduceInkPoints(points: NormalizedPoint[], tolerance: number): NormalizedPoint[] {
  if (points.length < 3) return points

  const result: NormalizedPoint[] = [points[0]]

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = result[result.length - 1]
    const current = points[index]
    if (Math.hypot(current.x - previous.x, current.y - previous.y) >= tolerance) {
      result.push(current)
    }
  }

  const last = points[points.length - 1]
  const previous = result[result.length - 1]
  if (!previous || previous.x !== last.x || previous.y !== last.y) {
    result.push(last)
  }

  return result.length >= 2 ? result : points
}

function toCanvasPoint(point: NormalizedPoint, canvasSize: InkCanvasSize) {
  return {
    x: point.x * canvasSize.width,
    y: point.y * canvasSize.height
  }
}

function distance(left: NormalizedPoint, right: NormalizedPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function distanceToSegment(point: NormalizedPoint, start: NormalizedPoint, end: NormalizedPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return distance(point, start)

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))
  )

  return distance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy
  })
}
