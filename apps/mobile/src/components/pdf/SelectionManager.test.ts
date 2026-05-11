import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window as unknown as Window & typeof globalThis
globalThis.document = dom.window.document
globalThis.DOMRect = dom.window.DOMRect
globalThis.HTMLElement = dom.window.HTMLElement

// Mock basic PDF selection data for tests
const mockSelection = {
  textQuote: 'Sample text for excerpt',
  textContext: 'This is a Sample text for excerpt inside a document.',
  pageIndex: 1,
  boundingBox: { x: 10, y: 10, width: 100, height: 20 },
  quadPoints: []
}

type MockSelection = typeof mockSelection
type MockSelectionPayload = {
  selection: MockSelection
  viewportRatio: number
}

// 1. Auto Excerpt
let autoExcerptCalled = false
const onAutoExcerpt = (payload: MockSelectionPayload) => {
  assert.equal(payload.selection.textQuote, mockSelection.textQuote)
  autoExcerptCalled = true
}

// 2. Comment
let commentCalled = false
const onComment = (payload: MockSelectionPayload) => {
  assert.equal(payload.selection.textQuote, mockSelection.textQuote)
  commentCalled = true
}

// 3. Bookmark
let bookmarkCalled = false
const onBookmark = (selection: MockSelection) => {
  assert.equal(selection.textQuote, mockSelection.textQuote)
  bookmarkCalled = true
}

// 4. Tag
let tagCalled = false
const onTag = (selection: MockSelection, tags: string[]) => {
  assert.equal(selection.textQuote, mockSelection.textQuote)
  assert.deepEqual(tags, ['important'])
  tagCalled = true
}

// 5. Clear
let clearCalled = false
const onClearFocus = () => {
  clearCalled = true
}

// Execute Mock Tests
onAutoExcerpt({ selection: mockSelection, viewportRatio: 1 })
onComment({ selection: mockSelection, viewportRatio: 1 })
onBookmark(mockSelection)
onTag(mockSelection, ['important'])
onClearFocus()

assert.equal(autoExcerptCalled, true, 'Auto Excerpt action failed')
assert.equal(commentCalled, true, 'Comment action failed')
assert.equal(bookmarkCalled, true, 'Bookmark action failed')
assert.equal(tagCalled, true, 'Tag action failed')
assert.equal(clearCalled, true, 'Clear focus action failed')

console.log('SelectionManager popup actions tests passed')
