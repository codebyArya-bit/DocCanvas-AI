import assert from 'node:assert/strict'
import { shouldDeferPreviewScreenshotCommit } from './WebpageImportPanel'

assert.equal(
  shouldDeferPreviewScreenshotCommit({
    hasActivePointer: false,
    isPointerDragging: false,
    hasPendingWheelFlush: false,
    hasPendingTypeFlush: false
  }),
  false
)

assert.equal(
  shouldDeferPreviewScreenshotCommit({
    hasActivePointer: true,
    isPointerDragging: false,
    hasPendingWheelFlush: false,
    hasPendingTypeFlush: false
  }),
  true
)

assert.equal(
  shouldDeferPreviewScreenshotCommit({
    hasActivePointer: false,
    isPointerDragging: false,
    hasPendingWheelFlush: true,
    hasPendingTypeFlush: false
  }),
  true
)

assert.equal(
  shouldDeferPreviewScreenshotCommit({
    hasActivePointer: false,
    isPointerDragging: false,
    hasPendingWheelFlush: false,
    hasPendingTypeFlush: true
  }),
  true
)
