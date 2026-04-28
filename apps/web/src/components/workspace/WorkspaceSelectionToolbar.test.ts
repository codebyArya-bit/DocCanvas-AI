import assert from 'node:assert/strict'
import {
  clampFontSize,
  parseToolbarFontSizeValue,
  resolveTextboxToolbarPosition,
  shouldIgnoreToolbarBlur,
  shouldHoldToolbarInteractionOnRelease,
  validateColor
} from './WorkspaceSelectionToolbar'
import { getTextToolbarVisibilityDecision } from './WorkspaceCanvas'
import { shouldPreserveWorkspaceFocusForPointerTarget } from '../pdf/SelectionManager'
import {
  clampPopupPosition,
  getSelectionActionPopupPlacementMode
} from '../pdf/AnchorService'
import { buildSourceHighlightDescriptors } from '../../lib/workspace/source-highlight-descriptors'
import {
  buildReportSections,
  drawSourceAnnotations,
  getAnnotationRects,
  getAnnotationUnionRect,
  mergeExcerptNodeText,
  type ExportAnnotation,
  type ExportOptions
} from '../export/ExportModal'

function makeTarget(matches: string[]) {
  return {
    closest(selector: string) {
      return matches.some((match) => selector.includes(match)) ? {} : null
    }
  }
}

function makeRect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  } as DOMRect
}

assert.equal(shouldHoldToolbarInteractionOnRelease(makeTarget(['button'])), true)
assert.equal(shouldHoldToolbarInteractionOnRelease(makeTarget(['input'])), true)
assert.equal(shouldHoldToolbarInteractionOnRelease(makeTarget(['label.note-toolbar-color-trigger'])), true)
assert.equal(shouldHoldToolbarInteractionOnRelease(makeTarget(['[role="button"]'])), true)
assert.equal(shouldHoldToolbarInteractionOnRelease(makeTarget(['.workspace-textbox-toolbar'])), true)
assert.equal(shouldHoldToolbarInteractionOnRelease(null), false)

assert.equal(shouldPreserveWorkspaceFocusForPointerTarget(makeTarget(['.workspace-textbox-toolbar'])), true)
assert.equal(shouldPreserveWorkspaceFocusForPointerTarget(makeTarget(['.workspace-textbox-editor'])), true)
assert.equal(shouldPreserveWorkspaceFocusForPointerTarget(makeTarget(['.workspace-pane'])), true)
assert.equal(shouldPreserveWorkspaceFocusForPointerTarget(null), false)

const popupContainerRect = makeRect(0, 0, 900, 700)
const popupSize = { width: 320, height: 180 }
const multiLineSelectionRects = [
  makeRect(180, 120, 260, 22),
  makeRect(180, 148, 180, 22)
]
const multiLineSelectionUnion = makeRect(180, 120, 260, 50)
const popupPlacement = clampPopupPosition({
  containerRect: popupContainerRect,
  selectionRect: multiLineSelectionUnion,
  selectionRects: multiLineSelectionRects,
  popupWidth: popupSize.width,
  popupHeight: popupSize.height,
  gap: 14,
  mode: 'avoid-overlap'
})

for (const rect of multiLineSelectionRects) {
  const horizontalOverlap = Math.max(
    0,
    Math.min(popupPlacement.left + popupSize.width, rect.left + rect.width) - Math.max(popupPlacement.left, rect.left)
  )
  const verticalOverlap = Math.max(
    0,
    Math.min(popupPlacement.top + popupSize.height, rect.top + rect.height) - Math.max(popupPlacement.top, rect.top)
  )
  assert.equal(horizontalOverlap * verticalOverlap, 0)
}

const fallbackPlacement = clampPopupPosition({
  containerRect: makeRect(0, 0, 340, 260),
  selectionRect: makeRect(90, 92, 140, 28),
  selectionRects: [makeRect(90, 92, 140, 28)],
  popupWidth: 240,
  popupHeight: 140,
  gap: 14,
  mode: 'avoid-overlap'
})
assert.equal(fallbackPlacement.left >= 18, true)
assert.equal(fallbackPlacement.top >= 18, true)
assert.equal(
  getSelectionActionPopupPlacementMode(),
  process.env.NEXT_PUBLIC_SELECTION_ACTION_POPUP_PLACEMENT_MODE === 'legacy' ? 'legacy' : 'avoid-overlap'
)

const baseAnchor = {
  id: 'anchor-1',
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  pageNumber: 1,
  boundingBox: { x: 10, y: 20, width: 100, height: 18 },
  viewportScale: 1,
  textQuote: 'Selected source text',
  createdAt: '2026-04-25T00:00:00.000Z',
  updatedAt: '2026-04-25T00:00:00.000Z'
}

assert.deepEqual(
  buildSourceHighlightDescriptors({
    anchors: [{ ...baseAnchor, selectionColor: '#ff6b6b' }],
    excerpts: [],
    bookmarks: [],
    canvasNodes: [],
    activeTag: null,
    filteredAnchorIds: new Set()
  }).map((highlight) => ({
    anchorId: highlight.anchorId,
    selectionColor: highlight.selectionColor,
    showHighlight: highlight.showHighlight,
    showMarker: highlight.showMarker,
    showBookmarkIcon: highlight.showBookmarkIcon,
    showTagBadges: highlight.showTagBadges
  })),
  [
    {
      anchorId: 'anchor-1',
      selectionColor: '#ff6b6b',
      showHighlight: true,
      showMarker: false,
      showBookmarkIcon: false,
      showTagBadges: true
    }
  ]
)

assert.deepEqual(
  buildSourceHighlightDescriptors({
    anchors: [{ ...baseAnchor, selectionColor: undefined, tags: ['idea'] }],
    excerpts: [],
    bookmarks: [],
    canvasNodes: [],
    activeTag: null,
    filteredAnchorIds: new Set()
  }).map((highlight) => ({
    anchorId: highlight.anchorId,
    showHighlight: highlight.showHighlight,
    showMarker: highlight.showMarker,
    showBookmarkIcon: highlight.showBookmarkIcon,
    showTagBadges: highlight.showTagBadges
  })),
  [{ anchorId: 'anchor-1', showHighlight: false, showMarker: false, showBookmarkIcon: false, showTagBadges: true }]
)

assert.deepEqual(
  buildSourceHighlightDescriptors({
    anchors: [{ ...baseAnchor, selectionColor: undefined, tags: ['evidence'] }],
    excerpts: [],
    bookmarks: [],
    canvasNodes: [],
    activeTag: 'evidence',
    filteredAnchorIds: new Set(['anchor-1'])
  }).map((highlight) => ({
    anchorId: highlight.anchorId,
    showHighlight: highlight.showHighlight,
    showMarker: highlight.showMarker,
    showBookmarkIcon: highlight.showBookmarkIcon,
    showTagBadges: highlight.showTagBadges
  })),
  [{ anchorId: 'anchor-1', showHighlight: true, showMarker: false, showBookmarkIcon: false, showTagBadges: true }]
)

assert.deepEqual(
  buildSourceHighlightDescriptors({
    anchors: [{ ...baseAnchor, selectionColor: '#2ecc71' }],
    excerpts: [{
      id: 'excerpt-1',
      workspaceId: 'workspace-1',
      documentId: 'document-1',
      pageNumber: 1,
      anchorId: 'anchor-1',
      extractedText: 'Selected source text',
      normalizedHash: 'hash',
      boundingBox: baseAnchor.boundingBox,
      viewportScale: 1,
      selectionColor: '#2ecc71',
      noteIds: [],
      createdAt: baseAnchor.createdAt,
      updatedAt: baseAnchor.updatedAt
    }],
    bookmarks: [],
    canvasNodes: [],
    activeTag: null,
    filteredAnchorIds: new Set()
  }).map((highlight) => ({
    anchorId: highlight.anchorId,
    selectionColor: highlight.selectionColor,
    showHighlight: highlight.showHighlight,
    showMarker: highlight.showMarker,
    showBookmarkIcon: highlight.showBookmarkIcon,
    showTagBadges: highlight.showTagBadges
  })),
  [
    {
      anchorId: 'anchor-1',
      selectionColor: '#2ecc71',
      showHighlight: true,
      showMarker: true,
      showBookmarkIcon: false,
      showTagBadges: true
    }
  ]
)

assert.deepEqual(
  buildSourceHighlightDescriptors({
    anchors: [{ ...baseAnchor, selectionColor: '#ff6b6b' }],
    excerpts: [],
    bookmarks: [
      {
        id: 'bookmark-1',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
        sourceAnchorId: 'anchor-1',
        bookmarkLabel: 'Selected source text',
        documentOrder: 1,
        selectionColor: '#2176d2',
        tags: ['saved'],
        createdAt: baseAnchor.createdAt,
        updatedAt: baseAnchor.updatedAt
      }
    ],
    canvasNodes: [],
    activeTag: 'saved',
    filteredAnchorIds: new Set(['anchor-1'])
  }).map((highlight) => ({
    anchorId: highlight.anchorId,
    selectionColor: highlight.selectionColor,
    showHighlight: highlight.showHighlight,
    showMarker: highlight.showMarker,
    showBookmarkIcon: highlight.showBookmarkIcon,
    showTagBadges: highlight.showTagBadges
  })),
  [
    {
      anchorId: 'anchor-1',
      selectionColor: '#2176d2',
      showHighlight: false,
      showMarker: false,
      showBookmarkIcon: true,
      showTagBadges: false
    }
  ]
)

assert.deepEqual(
  buildSourceHighlightDescriptors({
    anchors: [{ ...baseAnchor, selectionColor: '#2ecc71' }],
    excerpts: [
      {
        id: 'excerpt-1',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
        pageNumber: 1,
        anchorId: 'anchor-1',
        extractedText: 'Selected source text',
        normalizedHash: 'hash',
        boundingBox: baseAnchor.boundingBox,
        viewportScale: 1,
        selectionColor: '#2ecc71',
        noteIds: [],
        createdAt: baseAnchor.createdAt,
        updatedAt: baseAnchor.updatedAt
      }
    ],
    bookmarks: [
      {
        id: 'bookmark-1',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
        sourceAnchorId: 'anchor-1',
        bookmarkLabel: 'Selected source text',
        documentOrder: 1,
        selectionColor: '#2176d2',
        tags: [],
        createdAt: baseAnchor.createdAt,
        updatedAt: baseAnchor.updatedAt
      }
    ],
    canvasNodes: [],
    activeTag: null,
    filteredAnchorIds: new Set()
  }).map((highlight) => ({
    anchorId: highlight.anchorId,
    selectionColor: highlight.selectionColor,
    showHighlight: highlight.showHighlight,
    showMarker: highlight.showMarker,
    showBookmarkIcon: highlight.showBookmarkIcon,
    showTagBadges: highlight.showTagBadges
  })),
  [
    {
      anchorId: 'anchor-1',
      selectionColor: '#2ecc71',
      showHighlight: true,
      showMarker: true,
      showBookmarkIcon: true,
      showTagBadges: true
    }
  ]
)

const multiRectAnnotation: ExportAnnotation = {
  id: 'anchor-export-1',
  kind: 'excerpt',
  pageNumber: 1,
  text: 'Final Report-format Internship 8th Sem Aryabrat Mishra',
  color: '#ff6b6b',
  boundingBox: { x: 10, y: 20, width: 160, height: 58 },
  quadPoints: [
    10, 20, 110, 20, 110, 38, 10, 38,
    12, 52, 172, 52, 172, 70, 12, 70
  ],
  viewportScale: 1
}

assert.deepEqual(getAnnotationRects(multiRectAnnotation), [
  { x: 10, y: 20, width: 100, height: 18 },
  { x: 12, y: 52, width: 160, height: 18 }
])
assert.deepEqual(getAnnotationUnionRect(multiRectAnnotation), { x: 10, y: 20, width: 162, height: 50 })
assert.deepEqual(
  getAnnotationRects({
    ...multiRectAnnotation,
    quadPoints: undefined,
    boundingBox: { x: 4, y: 8, width: 40, height: 12 }
  }),
  [{ x: 4, y: 8, width: 40, height: 12 }]
)

const drawCalls: Array<[number, number, number, number]> = []
const strokeCalls: Array<[number, number, number, number]> = []
const arcCalls: Array<[number, number, number]> = []
const fakeContext = {
  canvas: { width: 400, height: 300 },
  save() {},
  restore() {},
  beginPath() {},
  arc(x: number, y: number, radius: number) {
    arcCalls.push([x, y, radius])
  },
  fill() {},
  fillRect(x: number, y: number, width: number, height: number) {
    drawCalls.push([x, y, width, height])
  },
  strokeRect(x: number, y: number, width: number, height: number) {
    strokeCalls.push([x, y, width, height])
  }
} as unknown as CanvasRenderingContext2D
const exportOptions: ExportOptions = {
  inlineCitations: true,
  fullCommentSources: false,
  highlights: true,
  marginComments: false,
  workspaceComments: true,
  workspaceExcerpts: true,
  orientation: 'portrait',
  pageSize: 'a4',
  format: 'pdf'
}
drawSourceAnnotations(fakeContext, [multiRectAnnotation], 2, exportOptions)
assert.deepEqual(drawCalls, [
  [20, 40, 200, 36],
  [24, 104, 320, 36]
])
assert.deepEqual(strokeCalls, drawCalls)
assert.deepEqual(arcCalls, [])

drawCalls.length = 0
strokeCalls.length = 0
arcCalls.length = 0
drawSourceAnnotations(
  fakeContext,
  [
    {
      ...multiRectAnnotation,
      id: 'bookmark-export-1',
      kind: 'bookmark',
      color: '#2176d2'
    }
  ],
  2,
  exportOptions
)
assert.deepEqual(drawCalls, [])
assert.deepEqual(strokeCalls, [])
assert.deepEqual(arcCalls, [[12, 58, 4]])

drawCalls.length = 0
strokeCalls.length = 0
arcCalls.length = 0
drawSourceAnnotations(
  fakeContext,
  [
    {
      ...multiRectAnnotation,
      id: 'comment-export-1',
      kind: 'comment',
      color: '#2ecc71'
    },
    {
      ...multiRectAnnotation,
      id: 'text-export-1',
      kind: 'text',
      color: '#999999'
    }
  ],
  2,
  exportOptions
)
assert.deepEqual(drawCalls, [])
assert.deepEqual(strokeCalls, [])
assert.deepEqual(arcCalls, [])

const typedSections = buildReportSections(
  {
    documentTitle: 'Typed export',
    sourceDocument: null,
    annotations: [
      multiRectAnnotation,
      {
        ...multiRectAnnotation,
        id: 'comment-anchor',
        kind: 'comment',
        text: 'Patient Clinical Report'
      },
      {
        ...multiRectAnnotation,
        id: 'bookmark-anchor',
        kind: 'bookmark',
        text: 'Datasets Available'
      }
    ],
    nodes: [
      {
        id: 'comment-node',
        kind: 'comment',
        text: 'Review this title',
        sourceAnchorId: 'comment-anchor'
      }
    ],
    links: []
  },
  exportOptions
)
const excerptSection = typedSections.find((section) => section.id === 'anchor-export-1')
const commentSection = typedSections.find((section) => section.id === 'comment-anchor')
const bookmarkSection = typedSections.find((section) => section.id === 'bookmark-anchor')
assert.equal(excerptSection?.kind, 'excerpt')
assert.equal(excerptSection?.excerpt, 'Final Report-format Internship 8th Sem Aryabrat Mishra')
assert.equal(commentSection?.kind, 'comment')
assert.equal(commentSection?.excerpt, undefined)
assert.equal(commentSection?.comments[0]?.text, 'Review this title')
assert.equal(bookmarkSection?.kind, 'bookmark')
assert.equal(bookmarkSection?.excerpt, undefined)
assert.equal(bookmarkSection?.bookmarkLabel, 'Datasets Available')

assert.equal(
  mergeExcerptNodeText([
    { id: 'node-b', kind: 'excerpt', text: '8th Sem Aryabrat Mishra', sourceAnchorId: 'anchor-export-1', x: 12, y: 52 },
    { id: 'node-a', kind: 'excerpt', text: 'Final Report-format Internship', sourceAnchorId: 'anchor-export-1', x: 10, y: 20 }
  ]),
  'Final Report-format Internship 8th Sem Aryabrat Mishra'
)

assert.equal(shouldIgnoreToolbarBlur({
  hasNativeColorPickerOpen: true,
  hasActiveNativeControl: false,
  nextTargetInsideToolbar: false,
  activeElementInsideToolbar: false
}), true)
assert.equal(shouldIgnoreToolbarBlur({
  hasNativeColorPickerOpen: false,
  hasActiveNativeControl: true,
  nextTargetInsideToolbar: false,
  activeElementInsideToolbar: false
}), true)
assert.equal(shouldIgnoreToolbarBlur({
  hasNativeColorPickerOpen: false,
  hasActiveNativeControl: false,
  nextTargetInsideToolbar: true,
  activeElementInsideToolbar: false
}), true)
assert.equal(shouldIgnoreToolbarBlur({
  hasNativeColorPickerOpen: false,
  hasActiveNativeControl: false,
  nextTargetInsideToolbar: false,
  activeElementInsideToolbar: true
}), true)
assert.equal(shouldIgnoreToolbarBlur({
  hasNativeColorPickerOpen: false,
  hasActiveNativeControl: false,
  nextTargetInsideToolbar: false,
  activeElementInsideToolbar: false
}), false)

assert.equal(clampFontSize(4), 4)
assert.equal(clampFontSize(2), 4)
assert.equal(clampFontSize(84), 84)
assert.equal(clampFontSize(120), 84)
assert.equal(parseToolbarFontSizeValue('16px'), 16)
assert.equal(parseToolbarFontSizeValue(' 84 '), 84)
assert.equal(parseToolbarFontSizeValue('999px'), 84)
assert.equal(parseToolbarFontSizeValue('2'), 4)
assert.equal(parseToolbarFontSizeValue('abc'), null)

assert.equal(validateColor('#abc', '#000000'), '#aabbcc')
assert.equal(validateColor('#A1B2C3', '#000000'), '#a1b2c3')
assert.equal(validateColor('rgb(255, 0, 128)', '#000000'), '#ff0080')
assert.equal(validateColor('rgba(12, 34, 56, 0.4)', '#000000'), '#0c2238')
assert.equal(validateColor('red', '#000000'), '#000000')
assert.equal(validateColor(undefined, '#fff08a'), '#fff08a')

assert.deepEqual(
  resolveTextboxToolbarPosition({
    left: 200,
    top: 680,
    toolbarWidth: 420,
    toolbarHeight: 252,
    viewportWidth: 1280,
    viewportHeight: 900,
    nodeRect: { top: 594.5, bottom: 882.5 }
  }),
  {
    left: 12,
    top: 330.5,
    placement: 'above'
  }
)

assert.deepEqual(
  resolveTextboxToolbarPosition({
    left: 200,
    top: 80,
    toolbarWidth: 420,
    toolbarHeight: 120,
    viewportWidth: 1280,
    viewportHeight: 900,
    nodeRect: { top: 60, bottom: 260 }
  }),
  {
    left: 12,
    top: 272,
    placement: 'below'
  }
)

assert.equal(getTextToolbarVisibilityDecision({
  nextHasSelection: true,
  hasNextRect: true,
  hasActiveRect: false,
  hasAnchorRect: true,
  editorStillActive: true,
  toolbarInteracting: false,
  selectionInProgress: false
}), 'selection')
assert.equal(getTextToolbarVisibilityDecision({
  nextHasSelection: true,
  hasNextRect: false,
  hasActiveRect: true,
  hasAnchorRect: false,
  editorStillActive: false,
  toolbarInteracting: false,
  selectionInProgress: false
}), 'preserve')
assert.equal(getTextToolbarVisibilityDecision({
  nextHasSelection: false,
  hasNextRect: false,
  hasActiveRect: false,
  hasAnchorRect: true,
  editorStillActive: true,
  toolbarInteracting: false,
  selectionInProgress: false
}), 'anchor')
assert.equal(getTextToolbarVisibilityDecision({
  nextHasSelection: false,
  hasNextRect: false,
  hasActiveRect: true,
  hasAnchorRect: false,
  editorStillActive: false,
  toolbarInteracting: true,
  selectionInProgress: false
}), 'preserve')
assert.equal(getTextToolbarVisibilityDecision({
  nextHasSelection: false,
  hasNextRect: false,
  hasActiveRect: false,
  hasAnchorRect: false,
  editorStillActive: false,
  toolbarInteracting: false,
  selectionInProgress: false
}), 'close')
