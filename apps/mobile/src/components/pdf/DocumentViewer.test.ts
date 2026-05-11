import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { convertClientRectsToPageAnchorGeometry, getVisibleSelectionClientRects } from '../../lib/excerpts/pdf-selection'
import { anchorToHighlightRects } from './document-viewer-model'
import type { PageAnchor } from '@workspace/domain'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window as unknown as Window & typeof globalThis
globalThis.document = dom.window.document
globalThis.DOMRect = dom.window.DOMRect
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Text = dom.window.Text

const page = document.createElement('div')
page.className = 'page mobile-pdf-page-layer'
Object.defineProperty(page, 'offsetWidth', { configurable: true, value: 612 })
page.getBoundingClientRect = () => new DOMRect(0, 0, 612, 792)

const textLayer = document.createElement('div')
textLayer.className = 'textLayer'
page.append(textLayer)

const span = document.createElement('span')
span.dataset.textIndex = '0'
span.dataset.textLength = '86'
span.dataset.pageX = '72'
span.dataset.pageY = '85'
span.dataset.pageWidth = '451'
span.dataset.pageHeight = '11'
span.textContent = 'I am a Computer Science undergraduate with hands-on experience in backend development,'
span.getBoundingClientRect = () => new DOMRect(72, 85, 540, 11)
textLayer.append(span)
document.body.append(page)

const range = document.createRange()
range.setStart(span.firstChild as Text, 0)
range.setEnd(span.firstChild as Text, span.textContent.length)
range.getClientRects = () => [new DOMRect(72, 85, 540, 11)] as unknown as DOMRectList

const rects = getVisibleSelectionClientRects(range, textLayer, page)
assert.equal(rects.length, 1)
assert.equal(rects[0].left, 72)
assert.equal(rects[0].top, 85)
assert.equal(rects[0].width, 451)
assert.equal(rects[0].height, 11)

const offsetPage = document.createElement('div')
offsetPage.className = 'page mobile-pdf-page-layer'
Object.defineProperty(offsetPage, 'offsetWidth', { configurable: true, value: 600 })
offsetPage.getBoundingClientRect = () => new DOMRect(50, 100, 1200, 1600)

const orderedRects = [
  new DOMRect(150, 300, 200, 40),
  new DOMRect(160, 360, 220, 40)
]
const geometry = convertClientRectsToPageAnchorGeometry(orderedRects, offsetPage)
assert.ok(geometry)
assert.deepEqual(geometry.boundingBox, { x: 50, y: 100, width: 115, height: 50 })
assert.deepEqual(geometry.quadPoints.slice(0, 8), [50, 100, 150, 100, 150, 120, 50, 120])
assert.deepEqual(geometry.quadPoints.slice(8, 16), [55, 130, 165, 130, 165, 150, 55, 150])

const anchor: PageAnchor = {
  id: 'anchor-test',
  workspaceId: 'workspace-test',
  documentId: 'document-test',
  pageNumber: 1,
  boundingBox: geometry.boundingBox,
  quadPoints: [...geometry.quadPoints],
  viewportScale: 1,
  textQuote: 'line one\nline two',
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z'
}
const storedQuadPoints = [...anchor.quadPoints!]
const zoomedRects = anchorToHighlightRects(anchor, 2.2)
assert.equal(zoomedRects.length, 2)
assert.deepEqual(zoomedRects[0], { x: 110.00000000000001, y: 220.00000000000003, width: 220.00000000000003, height: 44 })
assert.deepEqual(zoomedRects[1], { x: 121.00000000000001, y: 286, width: 242.00000000000003, height: 44 })
assert.deepEqual(anchor.quadPoints, storedQuadPoints)

console.log('DocumentViewer selection geometry tests passed')
