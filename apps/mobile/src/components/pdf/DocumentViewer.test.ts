import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { convertClientRectsToPageAnchorGeometry, getVisibleSelectionClientRects } from '../../lib/excerpts/pdf-selection'
import { resolveSelectionPopupPosition, type SelectionPopupPosition } from '../../lib/selection-popup-position'
import { anchorToHighlightRects, clampSplitRatio, viewerGridTemplateColumns } from './document-viewer-model'
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
assert.equal(clampSplitRatio(0), 0.02)
assert.equal(clampSplitRatio(1), 0.98)
assert.match(viewerGridTemplateColumns(0.02, 'desktop'), /minmax\(28px, 0\.02fr\)/)
assert.match(viewerGridTemplateColumns(0.98, 'desktop'), /minmax\(28px, 0\.020000000000000018fr\)/)

function popupOverlapsSelection(position: SelectionPopupPosition, width: number, height: number, rect: DOMRect) {
  return !(
    position.left + width <= rect.left ||
    position.left >= rect.right ||
    position.top + height <= rect.top ||
    position.top >= rect.bottom
  )
}

function popupTouchesSelection(position: SelectionPopupPosition, width: number, height: number, rect: DOMRect, gap = 12) {
  return (
    position.left < rect.right + gap &&
    position.left + width > rect.left - gap &&
    position.top < rect.bottom + gap &&
    position.top + height > rect.top - gap
  )
}

const popupWidth = 260
const popupHeight = 96
const viewportWidth = 900
const viewportHeight = 640
const selectionCases = [
  { name: 'top selection', rect: new DOMRect(320, 20, 160, 28), placement: 'below' },
  { name: 'middle selection', rect: new DOMRect(320, 280, 160, 28), placement: 'above' },
  { name: 'bottom selection', rect: new DOMRect(320, 592, 160, 28), placement: 'above' },
  { name: 'left edge selection', rect: new DOMRect(18, 250, 110, 32) },
  { name: 'right edge selection', rect: new DOMRect(780, 250, 100, 32) }
]

for (const entry of selectionCases) {
  const position = resolveSelectionPopupPosition({
    preferredLeft: entry.rect.left,
    preferredTop: entry.rect.bottom,
    popupWidth,
    popupHeight,
    viewportWidth,
    viewportHeight,
    selectionRect: entry.rect
  })
  if (entry.placement) assert.equal(position.placement, entry.placement, `${entry.name} should prefer ${entry.placement}`)
  assert.equal(popupOverlapsSelection(position, popupWidth, popupHeight, entry.rect), false, `${entry.name} should not be covered`)
}

const layoutSelectionCases = [
  { name: 'wide desktop top left', viewportWidth: 1280, viewportHeight: 720, rect: new DOMRect(84, 96, 230, 28) },
  { name: 'wide desktop top right', viewportWidth: 1280, viewportHeight: 720, rect: new DOMRect(1010, 96, 180, 28) },
  { name: 'compact A4 margin', viewportWidth: 720, viewportHeight: 540, rect: new DOMRect(96, 210, 260, 30) },
  { name: 'mobile narrow middle', viewportWidth: 390, viewportHeight: 700, rect: new DOMRect(44, 310, 280, 34) },
  { name: 'mobile narrow bottom', viewportWidth: 390, viewportHeight: 700, rect: new DOMRect(56, 640, 250, 28) }
]
for (const entry of layoutSelectionCases) {
  const width = Math.min(300, entry.viewportWidth - 24)
  const position = resolveSelectionPopupPosition({
    preferredLeft: entry.rect.left,
    preferredTop: entry.rect.bottom,
    popupWidth: width,
    popupHeight,
    viewportWidth: entry.viewportWidth,
    viewportHeight: entry.viewportHeight,
    selectionRect: entry.rect
  })
  assert.equal(popupTouchesSelection(position, width, popupHeight, entry.rect), false, `${entry.name} popup should keep safe gap`)
}

const smallViewportSelection = new DOMRect(130, 230, 100, 30)
const smallViewportPosition = resolveSelectionPopupPosition({
  preferredLeft: smallViewportSelection.left,
  preferredTop: smallViewportSelection.bottom,
  popupWidth: 300,
  popupHeight: 150,
  viewportWidth: 360,
  viewportHeight: 640,
  selectionRect: smallViewportSelection
})
assert.equal(popupOverlapsSelection(smallViewportPosition, 300, 150, smallViewportSelection), false)
assert.ok(['above', 'below', 'bottom-docked'].includes(smallViewportPosition.placement))

const oversizedPopupSelection = new DOMRect(240, 450, 180, 34)
const oversizedPopupPosition = resolveSelectionPopupPosition({
  preferredLeft: oversizedPopupSelection.left,
  preferredTop: oversizedPopupSelection.bottom,
  popupWidth: 340,
  popupHeight: 360,
  viewportWidth: 520,
  viewportHeight: 560,
  selectionRect: oversizedPopupSelection
})
assert.equal(popupOverlapsSelection(oversizedPopupPosition, 340, 360, oversizedPopupSelection), false, 'expanded popup should avoid selected text when vertical room exists')

const multiLineUnion = new DOMRect(300, 210, 220, 92)
const multiLineSelectionRects = [
  new DOMRect(300, 210, 180, 24),
  new DOMRect(320, 278, 200, 24)
]
const multiLinePosition = resolveSelectionPopupPosition({
  preferredLeft: multiLineUnion.left,
  preferredTop: multiLineUnion.bottom,
  popupWidth,
  popupHeight,
  viewportWidth,
  viewportHeight,
  selectionRect: multiLineUnion,
  selectionRects: multiLineSelectionRects
})
assert.equal(
  multiLineSelectionRects.some((rect) => popupTouchesSelection(multiLinePosition, popupWidth, popupHeight, rect)),
  false,
  'popup should avoid every selected client rect, not only the union bounds'
)

const cornerClampCases = [
  new DOMRect(8, 8, 96, 24),
  new DOMRect(792, 8, 96, 24),
  new DOMRect(8, 320, 96, 24),
  new DOMRect(792, 320, 96, 24)
]
for (const rect of cornerClampCases) {
  const position = resolveSelectionPopupPosition({
    preferredLeft: rect.left,
    preferredTop: rect.top,
    popupWidth,
    popupHeight,
    viewportWidth,
    viewportHeight,
    selectionRect: rect
  })
  assert.equal(popupTouchesSelection(position, popupWidth, popupHeight, rect), false, 'clamped corner popup should keep safe gap from selection')
}

const documentViewerSource = readFileSync(new URL('../DocumentViewer.tsx', import.meta.url), 'utf8')
const globalsCss = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8')
const selectionManagerSource = readFileSync(new URL('./SelectionManager.tsx', import.meta.url), 'utf8')
const selectionPopupCss = globalsCss.slice(
  globalsCss.indexOf('.selection-action-popup {'),
  globalsCss.indexOf('.selection-action-header')
)
assert.match(selectionPopupCss, /\.selection-action-popup\s*\{[^}]*position:\s*fixed/s)
assert.doesNotMatch(selectionPopupCss, /\.selection-action-popup\s*\{[^}]*position:\s*absolute/s)
assert.match(selectionManagerSource, /resolveSelectionPopupPosition/)
assert.match(selectionManagerSource, /resolvePdfPopupPosition/)
assert.match(selectionManagerSource, /is-placed-\$\{popupPosition\.placement\}/)
assert.doesNotMatch(selectionManagerSource, /position:\s*'absolute'/)
assert.doesNotMatch(selectionManagerSource, /function resolvePopupPosition/)
assert.match(selectionManagerSource, /const \[isSelecting, setIsSelecting\]/)
assert.match(selectionManagerSource, /document\.addEventListener\('selectionchange'/)
assert.match(selectionManagerSource, /SelectionLoupeState/)
assert.match(selectionManagerSource, /SelectionLoupe/)
assert.match(selectionManagerSource, /selectionRects:\s*popup\.selectionClientRects/)
assert.match(documentViewerSource, /SourceSelectionMagnifierLens/)
assert.match(documentViewerSource, /updateReadableSelectionMagnifier/)
assert.match(documentViewerSource, /document\.addEventListener\('selectionchange'/)
assert.match(globalsCss, /\.document-selection-loupe\s*\{[^}]*position:\s*fixed[^}]*pointer-events:\s*none/s)
assert.match(globalsCss, /\.document-selection-loupe-copy\s*\{[^}]*-webkit-line-clamp:\s*2/s)

const pdfPageMapStart = documentViewerSource.indexOf('pdfState.pages.map')
assert.notEqual(pdfPageMapStart, -1)
const pdfPageMapEnd = documentViewerSource.indexOf('</div>', pdfPageMapStart)
const pdfPageMarkup = documentViewerSource.slice(pdfPageMapStart, pdfPageMapEnd)
const expectedLayerOrder = [
  '<PdfCanvasPage',
  '<SelectedTextHighlightLayer',
  '<SourceInkLayer',
  '<SourceToolHitLayer',
  '<SourceTextboxLayer',
  '<SourceMarkerLayer'
]
let previousLayerIndex = -1
for (const layer of expectedLayerOrder) {
  const layerIndex = pdfPageMarkup.indexOf(layer)
  assert.ok(layerIndex > previousLayerIndex, `${layer} should render after the previous source page layer`)
  previousLayerIndex = layerIndex
}

const selectedHighlightLayerSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function SelectedTextHighlightLayer'),
  documentViewerSource.indexOf('function SourceInkLayer')
)
assert.match(selectedHighlightLayerSource, /anchorToHighlightRects/)
assert.match(selectedHighlightLayerSource, /mobile-text-highlight/)
assert.match(selectedHighlightLayerSource, /source-highlight-tag-marker/)
assert.match(selectedHighlightLayerSource, /hasTextFill/)
assert.match(selectedHighlightLayerSource, /is-tag-only/)
assert.match(selectedHighlightLayerSource, /onAnchorPopup\(anchor\)/)
assert.match(selectedHighlightLayerSource, /tagBadgeLabel/)
assert.match(selectedHighlightLayerSource, /getTagColor/)
assert.doesNotMatch(selectedHighlightLayerSource, />#\{tag\}</)

const deleteWorkspaceNodeSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function deleteWorkspaceNode'),
  documentViewerSource.indexOf('function changeSplit')
)
assert.match(deleteWorkspaceNodeSource, /shouldRemoveAnchor/)
assert.match(deleteWorkspaceNodeSource, /anchors:\s*shouldRemoveAnchor/)
assert.match(deleteWorkspaceNodeSource, /bookmarks:\s*shouldRemoveAnchor/)
assert.match(deleteWorkspaceNodeSource, /excerpts:\s*shouldRemoveAnchor/)

const tagManagerSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function ImprovedTagManagerModal'),
  documentViewerSource.indexOf('function ImprovedDefinedTermsModal')
)
assert.match(tagManagerSource, /documentTagAllocations/)
assert.match(tagManagerSource, /Tags in this document/)
assert.match(tagManagerSource, /cleanTagSentence/)

const sourceInkLayerSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function SourceInkLayer'),
  documentViewerSource.indexOf('function SourcePaneInkLayer')
)
assert.doesNotMatch(sourceInkLayerSource, /anchorToHighlightRects/)
assert.doesNotMatch(sourceInkLayerSource, /mobile-text-highlight/)
assert.match(sourceInkLayerSource, /mobile-source-ink-layer/)
assert.match(sourceInkLayerSource, /mobile-source-ink-canvas/)
assert.match(sourceInkLayerSource, /data-normalized-ink-canvas/)
assert.match(sourceInkLayerSource, /drawInkPath/)
assert.match(sourceInkLayerSource, /positionSourceInkCanvas\(canvas\)/)
assert.match(sourceInkLayerSource, /canvas\.getBoundingClientRect\(\)/)
assert.doesNotMatch(sourceInkLayerSource, /<polyline/)
assert.doesNotMatch(sourceInkLayerSource, /onPointerDown=\{handleCanvasPointerDown\}/)
assert.doesNotMatch(sourceInkLayerSource, /onPointerMove=\{handleCanvasPointerMove\}/)
assert.doesNotMatch(sourceInkLayerSource, /onPointerUp=\{handleCanvasPointerUp\}/)
assert.doesNotMatch(sourceInkLayerSource, /onPointerCancel=\{handleCanvasPointerUp\}/)
assert.doesNotMatch(sourceInkLayerSource, /function normalizeCanvasPointer/)
assert.doesNotMatch(sourceInkLayerSource, /event\.currentTarget\.setPointerCapture\(event\.pointerId\)/)
assert.doesNotMatch(sourceInkLayerSource, /onDraftStart\(toolMode, pageNumber, point\)/)
assert.doesNotMatch(sourceInkLayerSource, /onDraftMove\(pageNumber, point\)/)
assert.doesNotMatch(sourceInkLayerSource, /onDraftEnd\(\)/)
assert.doesNotMatch(sourceInkLayerSource, /onErase\(pageNumber, point, event\.clientX, event\.clientY\)/)
assert.doesNotMatch(documentViewerSource, /function normalizeInkPointer/)
assert.match(documentViewerSource, /function getSourcePageVisualInkElement/)
assert.match(documentViewerSource, /function getSourcePageInkBounds/)
assert.match(documentViewerSource, /function normalizePointInSourceInkBounds/)
assert.match(documentViewerSource, /function positionSourceInkCanvas/)
assert.match(documentViewerSource, /point:\s*normalizePointInSourceInkBounds\(clientX, clientY, pageElement\)/)
assert.match(documentViewerSource, /\.mobile-source-ink-canvas/)
assert.match(documentViewerSource, /\.mobile-pdf-page-layer/)
assert.match(documentViewerSource, /\.mobile-readable-web-document/)
assert.match(documentViewerSource, /const draftPathRef = useRef<DraftPath \| null>\(null\)/)
assert.match(documentViewerSource, /function commitInkDraft\(\)\s*\{\s*const currentDraftPath = draftPathRef\.current/s)
assert.match(documentViewerSource, /draftPathRef\.current = resolved/)

const sourceInkToolbarSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function SourceInkToolbar'),
  documentViewerSource.indexOf('function SourceMarkerLayer')
)
assert.match(sourceInkToolbarSource, /source-ink-toolbar/)
assert.match(sourceInkToolbarSource, /source-ink-toolbar-grip/)
assert.match(sourceInkToolbarSource, /source-ink-toolbar-close/)
assert.match(sourceInkToolbarSource, /Move ink toolbar/)
assert.match(sourceInkToolbarSource, /Close ink toolbar/)
assert.match(sourceInkToolbarSource, /setPointerCapture/)
assert.match(sourceInkToolbarSource, /Pen/)
assert.match(sourceInkToolbarSource, /Pencil/)
assert.match(sourceInkToolbarSource, /Highlighter/)
assert.match(sourceInkToolbarSource, /Eraser/)
assert.match(sourceInkToolbarSource, /aria-label="Undo ink stroke"/)
assert.match(sourceInkToolbarSource, /aria-label=\{`Clear ink on page \$\{pageNumber\}`\}/)
assert.match(sourceInkToolbarSource, /Icon name="trash"/)
assert.match(sourceInkToolbarSource, /usesColor \? \(/)
assert.doesNotMatch(sourceInkToolbarSource, /disabled=\{toolMode === 'eraser'\}/)
assert.match(sourceInkToolbarSource, /clampToolbarPosition/)
assert.match(sourceInkToolbarSource, /orientationchange/)
assert.match(sourceInkToolbarSource, /onClose/)
const clearCurrentPageInkSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function clearCurrentPageInk'),
  documentViewerSource.indexOf('function startInkDraft')
)
assert.match(clearCurrentPageInkSource, /clearCount === 0/)
assert.match(clearCurrentPageInkSource, /window\.confirm/)
assert.match(clearCurrentPageInkSource, /type:\s*'CLEAR_PAGE_INK'/)
assert.match(clearCurrentPageInkSource, /entry\.surface !== 'workspace'/)
assert.match(documentViewerSource, /type:\s*'CLEAR_PAGE_INK'/)
assert.match(documentViewerSource, /toolMode=\{toolMode\}/)
assert.match(documentViewerSource, /toolSettings=\{toolSettings\}/)
assert.match(documentViewerSource, /inkStrokes=\{workspace\.inkStrokes\}/)
assert.match(documentViewerSource, /freeformHighlights=\{workspace\.freeformHighlights\}/)
assert.match(documentViewerSource, /onWorkspaceInkStroke/)
assert.match(documentViewerSource, /onWorkspaceFreeformHighlight/)
assert.match(documentViewerSource, /ERASE_WORKSPACE_INK_AT_POINT/)
assert.match(documentViewerSource, /function GlobalInkCaptureLayer/)
assert.match(documentViewerSource, /data-global-ink-capture-layer="true"/)
assert.match(documentViewerSource, /function scrollGlobalInkSurface/)
assert.match(documentViewerSource, /onWheelScroll=\{scrollGlobalInkSurface\}/)
assert.match(documentViewerSource, /onWheel=\{onWheelScroll\}/)
assert.match(documentViewerSource, /sourcePaneRef\.current\?\.scrollBy/)
assert.match(documentViewerSource, /workspace\.scrollWheelBehavior/)
assert.match(documentViewerSource, /workspaceViewport:\s*\{[\s\S]*panX:[\s\S]*panY:/)
assert.match(documentViewerSource, /routeGlobalInkPoint/)
assert.match(documentViewerSource, /kind: 'source-pane'/)
assert.match(documentViewerSource, /function SourcePaneInkLayer/)
assert.match(documentViewerSource, /data-source-pane-ink-canvas="true"/)
assert.match(documentViewerSource, /ERASE_SURFACE_INK_AT_POINT/)
assert.match(documentViewerSource, /ref=\{viewerBodyRef\}/)
assert.match(globalsCss, /\.mobile-source-ink-canvas\s*\{[^}]*pointer-events:\s*none/s)
assert.match(globalsCss, /\.global-ink-capture-layer\s*\{[^}]*z-index:\s*190[^}]*pointer-events:\s*auto/s)
assert.match(globalsCss, /\.mobile-tool-panel\s*\{[^}]*z-index:\s*220/s)
assert.match(globalsCss, /\.mobile-source-pane-ink-canvas\s*\{[^}]*pointer-events:\s*none/s)
assert.match(globalsCss, /\.mobile-source-interaction-surface\.tool-pen \.mobile-source-ink-canvas,[\s\S]*?pointer-events:\s*none/s)
assert.match(globalsCss, /\.mobile-source-interaction-surface\.tool-pen \.mobile-source-ink-layer,[\s\S]*?z-index:\s*28[\s\S]*?pointer-events:\s*none/s)
assert.match(globalsCss, /\.mobile-source-interaction-surface\.tool-pen \.mobile-source-textbox-layer,[\s\S]*?\.mobile-source-interaction-surface\.tool-eraser \.mobile-source-marker-layer\s*\{[^}]*pointer-events:\s*none/s)
assert.match(globalsCss, /\.mobile-workspace-ink-canvas\s*\{[^}]*pointer-events:\s*none/s)
assert.match(globalsCss, /\.mobile-workspace-canvas\.is-inking \.mobile-workspace-ink-canvas\s*\{[^}]*z-index:\s*78[^}]*pointer-events:\s*auto/s)
assert.match(globalsCss, /\.mobile-workspace-canvas\.is-inking \.mobile-canvas-zoom-level,[\s\S]*?\.mobile-workspace-canvas\.is-inking \.workspace-tool-rail\s*\{[^}]*pointer-events:\s*none/s)
assert.match(globalsCss, /\.workspace-canvas-viewport\s*\{[^}]*isolation:\s*isolate/s)
assert.match(globalsCss, /\.mobile-canvas-grid\s*\{[^}]*min-width:\s*2200px[^}]*min-height:\s*1800px[^}]*will-change:\s*transform/s)
assert.match(globalsCss, /\.workspace-canvas-surface\s*\{[^}]*transform-origin:\s*0 0/s)
assert.match(globalsCss, /\.mobile-canvas-surface\s*\{[^}]*z-index:\s*10/s)
assert.match(globalsCss, /\.mobile-source-interaction-surface\.tool-textbox \.mobile-source-tool-hit-layer\s*\{[^}]*pointer-events:\s*auto/s)
assert.match(globalsCss, /\.mobile-source-interaction-surface\.tool-pen \.mobile-source-tool-hit-layer,[\s\S]*?pointer-events:\s*none/s)
assert.doesNotMatch(globalsCss, /\.mobile-source-interaction-surface\.tool-pen \.mobile-source-tool-hit-layer,[\s\S]*?\.mobile-source-interaction-surface\.tool-eraser \.mobile-source-tool-hit-layer \{\s*pointer-events:\s*auto/s)
assert.match(globalsCss, /\.source-ink-toolbar\s*\{/)
assert.match(globalsCss, /\.source-ink-toolbar-grip\s*\{/)
assert.match(globalsCss, /\.source-ink-toolbar-close\s*\{/)
assert.match(globalsCss, /\.source-ink-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s)
assert.match(globalsCss, /\.source-ink-toolbar\s*\{[^}]*overflow:\s*visible/s)
assert.doesNotMatch(globalsCss, /\.source-ink-toolbar\s*\{[^}]*overflow-x:\s*auto/s)
assert.match(globalsCss, /\.source-ink-toolbar-tools button,[\s\S]*?\.source-ink-toolbar-action\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s)

const layerZIndexes = Object.fromEntries(
  Array.from(globalsCss.matchAll(/\.(mobile-[\w-]+)\s*\{[^}]*z-index:\s*(\d+)/g)).map((match) => [match[1], Number(match[2])])
)
assert.ok(layerZIndexes['mobile-selected-text-highlight-layer'] < layerZIndexes['mobile-source-ink-layer'])
assert.ok(layerZIndexes['mobile-source-tool-hit-layer'] < layerZIndexes['mobile-source-textbox-layer'])
assert.ok(layerZIndexes['mobile-source-textbox-layer'] < layerZIndexes['mobile-source-marker-layer'])

const leftDrawerSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function LeftDrawer'),
  documentViewerSource.indexOf('function AnnotationLayer')
)
assert.match(leftDrawerSource, /className="mobile-left-popup-backdrop"/)
assert.match(leftDrawerSource, /className="mobile-left-popup"/)
assert.match(leftDrawerSource, /className="mobile-left-popup-body"/)
assert.match(leftDrawerSource, /Search documents/)
assert.match(leftDrawerSource, /Open Library/)
assert.match(leftDrawerSource, /Import More/)
assert.match(leftDrawerSource, /Duplicate metadata/)
assert.match(leftDrawerSource, /No bookmarks yet\./)
assert.match(leftDrawerSource, /No highlights yet\./)
assert.match(leftDrawerSource, /Export Project Bundle/)
assert.match(leftDrawerSource, /Reset split layout/)

assert.match(documentViewerSource, /className="mobile-drawer-shortcuts"/)
assert.match(documentViewerSource, /onClick=\{\(\) => openLeftPopup\('documents'\)\}/)
assert.match(documentViewerSource, /onClick=\{\(\) => openLeftPopup\('share'\)\}/)
assert.match(documentViewerSource, /setPanelMode\(panelMode === 'more' \? null : 'more'\)/)

const documentOutlinePopupSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function DocumentOutlinePopup'),
  documentViewerSource.indexOf('function AnnotationLayer')
)
assert.match(documentOutlinePopupSource, /currentDocumentTitle/)
assert.match(documentOutlinePopupSource, /mobile-popup-doc-title/)
assert.match(documentOutlinePopupSource, /sortOrder/)
assert.match(documentOutlinePopupSource, /mobile-popup-sort-btn/)
assert.match(documentOutlinePopupSource, /Add Document/)
assert.match(documentOutlinePopupSource, /Add Bookmark/)
assert.match(documentOutlinePopupSource, /Filter Documents/)
assert.match(documentOutlinePopupSource, /Filter Outline/)

const leftDrawerCss = globalsCss.slice(
  globalsCss.indexOf('.mobile-left-popup-backdrop'),
  globalsCss.indexOf('.mobile-pdf-pane,')
)
assert.match(leftDrawerCss, /\.mobile-left-popup\s*\{[^}]*position:\s*fixed/s)
assert.match(leftDrawerCss, /\.mobile-left-popup\s*\{[^}]*max-width:\s*calc\(100vw - 32px\)/s)
assert.match(leftDrawerCss, /\.mobile-left-popup-body\s*\{[^}]*overflow-y:\s*auto/s)
assert.match(leftDrawerCss, /\.mobile-left-popup-body\s*\{[^}]*overscroll-behavior:\s*contain/s)
assert.match(leftDrawerCss, /\.mobile-left-popup-item strong,\s*\.mobile-left-popup-item span,\s*\.mobile-left-popup-item small\s*\{[^}]*text-overflow:\s*ellipsis/s)

const documentOutlinePopupCss = globalsCss.slice(
  globalsCss.indexOf('.mobile-document-outline-popup'),
  globalsCss.indexOf('@keyframes popupFadeIn')
)
assert.match(documentOutlinePopupCss, /\.mobile-popup-doc-title\s*\{/)
assert.match(documentOutlinePopupCss, /\.mobile-popup-arrow\s*\{/)
assert.match(documentOutlinePopupCss, /\.mobile-popup-action-bar\s*\{/)
assert.match(documentOutlinePopupCss, /\.mobile-popup-search-sort\s*\{/)
assert.match(documentOutlinePopupCss, /\.mobile-popup-sort-btn\s*\{/)

const moreSettingsSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function MoreSettingsPanel'),
  documentViewerSource.indexOf('function PageEditPanel')
)
assert.match(moreSettingsSource, /lt-settings-panel/)
assert.match(moreSettingsSource, /SettingsSection/)
assert.match(moreSettingsSource, /SettingsRow/)
assert.match(moreSettingsSource, /SettingsFloatingMenu/)
assert.match(moreSettingsSource, /openMenuFromEvent/)
assert.match(moreSettingsSource, /Defined Terms & Attachments/)
assert.match(moreSettingsSource, /Finding Inconsistencies/)
assert.match(moreSettingsSource, /Underline Defined Terms/)
assert.match(moreSettingsSource, /Text Linking/)
assert.match(moreSettingsSource, /Scroll-Wheel Options/)
assert.match(moreSettingsSource, /Excerpt Double-Click Options/)
assert.match(moreSettingsSource, /Ink Settings/)
assert.match(moreSettingsSource, /Pen Scrolling Options/)
assert.match(moreSettingsSource, /Sync Across Devices/)
assert.match(moreSettingsSource, /Choose Layout/)
assert.match(moreSettingsSource, /Auto-Position Doc Comments/)
assert.match(documentViewerSource, /function tagDisplayLabel/)
assert.match(documentViewerSource, /tagDisplayLabel\(entry\.tag\)/)
assert.doesNotMatch(documentViewerSource.slice(
  documentViewerSource.indexOf('className="tag-manager-allocation-item"'),
  documentViewerSource.indexOf('function ImprovedDefinedTermsModal')
), /tagBadgeLabel\(entry\.tag\)/)

const bookmarkSelectionSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function bookmarkSelection'),
  documentViewerSource.indexOf('function tagSelection')
)
assert.match(bookmarkSelectionSource, /alreadyBookmarked/)
assert.match(bookmarkSelectionSource, /current\.bookmarks\.filter/)
assert.match(bookmarkSelectionSource, /function bookmarkPdfSelection/)

const pageEditPanelSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function PageEditPanel'),
  documentViewerSource.indexOf('function SelectionActionPopup')
)
assert.match(pageEditPanelSource, /Rotate Pages/)
assert.match(pageEditPanelSource, /Rotate 90° Clockwise/)
assert.match(pageEditPanelSource, /Apply to All Pages/)
assert.match(pageEditPanelSource, /Extract Page/)
assert.match(documentViewerSource, /<PdfCanvasPage[^>]*rotation=\{rotation\}/)
const modelSource = readFileSync(new URL('./document-viewer-model.ts', import.meta.url), 'utf8')
assert.match(modelSource, /applyClearSelectionColor/)
assert.match(modelSource, /workspace\.anchors\.filter\(a => a\.id !== anchor\.id\)/)
assert.match(modelSource, /activeAnchorId: workspace\.activeAnchorId === anchor\.id \? null : workspace\.activeAnchorId/)

// Parent handlePointerDown bails for ink modes — canvas owns those events
const parentPointerDownSource = documentViewerSource.slice(
  documentViewerSource.indexOf('function handlePointerDown'),
  documentViewerSource.indexOf('function handlePointerMove')
)
assert.match(parentPointerDownSource, /INK_TOOL_MODES\.has\(toolMode\).*?return/s)
assert.doesNotMatch(parentPointerDownSource, /setPointerCapture/)
assert.doesNotMatch(parentPointerDownSource, /freeform-highlight/)
assert.doesNotMatch(parentPointerDownSource, /toolMode === 'pen'/)
assert.doesNotMatch(parentPointerDownSource, /toolMode === 'pencil'/)
assert.doesNotMatch(parentPointerDownSource, /toolMode === 'eraser'/)

console.log('DocumentViewer selection geometry tests passed')
