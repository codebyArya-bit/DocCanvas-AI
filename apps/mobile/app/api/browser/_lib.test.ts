import assert from 'node:assert/strict'
import {
  extractSearchQuery,
  normalizeNavigationInput,
  normalizeSearchEngine,
  searchUrlFor,
  shouldReusePreviewCache
} from './_lib'

assert.equal(normalizeSearchEngine('bing'), 'bing')
assert.equal(normalizeSearchEngine('google'), 'google')
assert.equal(normalizeSearchEngine('unknown'), 'bing')

assert.equal(searchUrlFor('liquid text', 'bing'), 'https://www.bing.com/search?q=liquid%20text&mkt=en-US&setlang=en-US&cc=US&ensearch=1')
assert.equal(
  normalizeNavigationInput('example.com/path', 'bing'),
  'https://example.com/path'
)
assert.equal(
  normalizeNavigationInput('https://www.bing.com/search?q=docu', 'bing'),
  'https://www.bing.com/search?q=docu&mkt=en-US&setlang=en-US&cc=US&ensearch=1'
)
assert.equal(extractSearchQuery('https://www.bing.com/search?q=notes'), 'notes')
assert.equal(extractSearchQuery('https://example.com/search?q=notes'), null)

const cachedPreview = {
  url: 'https://www.bing.com/',
  title: 'Bing',
  screenshotDataUrl: 'data:image/jpeg;base64,abc',
  blocked: false,
  reason: undefined,
  capturedAt: 1000
}

assert.equal(shouldReusePreviewCache(cachedPreview, 'https://www.bing.com/', 1200, 420), true)
assert.equal(shouldReusePreviewCache(cachedPreview, 'https://www.bing.com/search?q=notes', 1200, 420), false)
assert.equal(shouldReusePreviewCache(cachedPreview, 'https://www.bing.com/', 1600, 420), false)
