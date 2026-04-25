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
import { buildSourceHighlightDescriptors } from '../../lib/workspace/source-highlight-descriptors'

function makeTarget(matches: string[]) {
  return {
    closest(selector: string) {
      return matches.some((match) => selector.includes(match)) ? {} : null
    }
  }
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
    showMarker: highlight.showMarker
  })),
  [{ anchorId: 'anchor-1', selectionColor: '#ff6b6b', showHighlight: true, showMarker: true }]
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
    showMarker: highlight.showMarker
  })),
  [{ anchorId: 'anchor-1', showHighlight: false, showMarker: true }]
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
    showMarker: highlight.showMarker
  })),
  [{ anchorId: 'anchor-1', showHighlight: true, showMarker: true }]
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
    showMarker: highlight.showMarker
  })),
  [{ anchorId: 'anchor-1', selectionColor: '#2ecc71', showHighlight: true, showMarker: true }]
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
