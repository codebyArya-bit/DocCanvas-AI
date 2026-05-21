import assert from 'node:assert/strict'
import {
  drawInkCurve,
  getCoalescedPointerEvents,
  getPredictedInkPoint,
  getStrokeBounds,
  hitTestStroke,
  SMOOTH_INK_TOLERANCE,
  smoothInkPath
} from './mobile-ink'
import type { MobileToolSettings, NormalizedPoint } from './mobile-store'

const settings: MobileToolSettings = {
  pen: { color: '#111111', size: 4 },
  pencil: { color: '#444444', size: 3, opacity: 0.58 },
  highlight: { color: '#ffee00', size: 18, opacity: 0.42, smoothed: true },
  eraser: { size: 24 }
}

const jitter: NormalizedPoint[] = [
  { x: 0, y: 0 },
  { x: SMOOTH_INK_TOLERANCE / 4, y: 0 },
  { x: SMOOTH_INK_TOLERANCE / 2, y: 0 },
  { x: 0.02, y: 0.02 }
]

let points = smoothInkPath(jitter, 'pen', settings)
assert.deepEqual(points[0], jitter[0])
assert.deepEqual(points.at(-1), jitter.at(-1))
assert.ok(points.length < jitter.length)

points = smoothInkPath(jitter, 'pencil', settings)
assert.ok(points.length < jitter.length)

const highlighterRaw = smoothInkPath(jitter, 'freeform-highlight', {
  ...settings,
  highlight: { ...settings.highlight, smoothed: false }
})
assert.deepEqual(highlighterRaw, jitter)

const highlighterSmooth = smoothInkPath(jitter, 'freeform-highlight', settings)
assert.ok(highlighterSmooth.length < jitter.length)

assert.deepEqual(smoothInkPath([{ x: Number.NaN, y: 1 }], 'pen', settings), [])
assert.deepEqual(smoothInkPath([{ x: 0.1, y: 0.1 }], 'pen', settings), [{ x: 0.1, y: 0.1 }])

function mockContext() {
  const calls: string[] = []
  return {
    calls,
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    quadraticCurveTo: () => calls.push('quadraticCurveTo')
  } as unknown as CanvasRenderingContext2D & { calls: string[] }
}

for (const candidate of [
  [],
  [{ x: 0, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 0.5, y: 0.2 }, { x: 1, y: 1 }]
]) {
  const context = mockContext()
  assert.doesNotThrow(() => drawInkCurve(context, candidate, { width: 100, height: 100 }))
}

const twoPointContext = mockContext()
drawInkCurve(twoPointContext, [{ x: 0, y: 0 }, { x: 1, y: 1 }], { width: 100, height: 100 })
assert.ok(twoPointContext.calls.includes('lineTo'))

const curveContext = mockContext()
drawInkCurve(curveContext, [{ x: 0, y: 0 }, { x: 0.5, y: 0.2 }, { x: 1, y: 1 }], { width: 100, height: 100 })
assert.ok(curveContext.calls.includes('quadraticCurveTo'))

const fallbackEvent = { clientX: 10, clientY: 20 }
assert.deepEqual(getCoalescedPointerEvents(fallbackEvent), [fallbackEvent])

const orderedSamples = [
  { clientX: 1, clientY: 2 } as PointerEvent,
  { clientX: 3, clientY: 4 } as PointerEvent,
  { clientX: 5, clientY: 6 } as PointerEvent
]
assert.deepEqual(
  getCoalescedPointerEvents({ clientX: 0, clientY: 0, getCoalescedEvents: () => orderedSamples }),
  orderedSamples
)

assert.equal(getPredictedInkPoint([{ x: 0, y: 0 }]), null)
assert.deepEqual(getPredictedInkPoint([{ x: 0, y: 0 }, { x: 10, y: 20 }]), { x: 13.5, y: 27 })

const storedPoints = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
const previewPoints = [...storedPoints]
const prediction = getPredictedInkPoint(previewPoints)
if (prediction) previewPoints.push(prediction)
assert.equal(storedPoints.length, 2)
assert.equal(previewPoints.length, 3)

const hitPoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }]
const immutableHitPoints = hitPoints.map((point) => ({ ...point }))
assert.equal(hitTestStroke(hitPoints, { x: 0.5, y: 0.05 }, 0.06), true)
assert.equal(hitTestStroke(hitPoints, { x: 0.5, y: 0.2 }, 0.06), false)
assert.deepEqual(hitPoints, immutableHitPoints)
assert.equal(hitTestStroke(hitPoints, { x: 0.5, y: 0.05 }, 60, { width: 1000, height: 1000 }), true)
assert.equal(hitTestStroke(hitPoints, { x: 0.5, y: 0.2 }, 60, { width: 1000, height: 1000 }), false)

function assertClose(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should be close to ${expected}`)
}

const normalizedBounds = getStrokeBounds([{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.6 }], 0.1)
assert.ok(normalizedBounds)
assertClose(normalizedBounds.x, 0.15)
assertClose(normalizedBounds.y, 0.25)
assertClose(normalizedBounds.width, 0.3)
assertClose(normalizedBounds.height, 0.4)
assert.deepEqual(getStrokeBounds([{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.6 }], 10, { width: 1000, height: 500 }), {
  x: 195,
  y: 145,
  width: 210,
  height: 160
})

console.log('Mobile ink smoothing tests passed')
