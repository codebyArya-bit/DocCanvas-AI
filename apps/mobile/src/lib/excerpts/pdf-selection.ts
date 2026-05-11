import type { Bookmark, CreateExcerptInput, Excerpt, PageAnchor } from '@workspace/domain'

export interface PdfSelection {
  text: string
  pageNumber: number
  anchor: Omit<PageAnchor, 'id' | 'createdAt' | 'updatedAt' | 'workspaceId' | 'documentId'>
}

export interface SelectionArtifactInput {
  workspaceId: string
  documentId: string
  text: string
  pageNumber: number
  startSpanIndex?: number
  startOffset?: number
  endSpanIndex?: number
  endOffset?: number
  boundingBox: PageAnchor['boundingBox']
  quadPoints?: number[]
  viewportScale: number
  selectionColor: string
  tags?: string[]
}

function buildUnionRect(rects: DOMRect[]): DOMRect | null {
  const boxes = rects.filter((rect) => rect.width > 0 && rect.height > 0)
  if (boxes.length === 0) {
    return null
  }

  const left = Math.min(...boxes.map((rect) => rect.left))
  const top = Math.min(...boxes.map((rect) => rect.top))
  const right = Math.max(...boxes.map((rect) => rect.right))
  const bottom = Math.max(...boxes.map((rect) => rect.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

export function convertClientRectsToPageAnchorGeometry(rects: DOMRect[], pageReference: HTMLElement) {
  const referenceRect = pageReference.getBoundingClientRect()
  const captureScale = pageReference.offsetWidth > 0 ? referenceRect.width / pageReference.offsetWidth : 1
  const safeScale = captureScale > 0 ? captureScale : 1
  const unionRect = buildUnionRect(rects)
  if (!unionRect || rects.length === 0) {
    return null
  }

  return {
    boundingBox: {
      x: (unionRect.left - referenceRect.left) / safeScale,
      y: (unionRect.top - referenceRect.top) / safeScale,
      width: unionRect.width / safeScale,
      height: unionRect.height / safeScale
    },
    quadPoints: rects.flatMap((rect) => [
      (rect.left - referenceRect.left) / safeScale,
      (rect.top - referenceRect.top) / safeScale,
      (rect.right - referenceRect.left) / safeScale,
      (rect.top - referenceRect.top) / safeScale,
      (rect.right - referenceRect.left) / safeScale,
      (rect.bottom - referenceRect.top) / safeScale,
      (rect.left - referenceRect.left) / safeScale,
      (rect.bottom - referenceRect.top) / safeScale
    ]),
    captureScale: safeScale
  }
}

function dedupeRects(rects: DOMRect[]) {
  const seen = new Set<string>()
  return rects.filter((rect) => {
    const key = [
      Math.round(rect.left * 100) / 100,
      Math.round(rect.top * 100) / 100,
      Math.round(rect.width * 100) / 100,
      Math.round(rect.height * 100) / 100
    ].join(':')
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function isUsableSelectionRect(rect: DOMRect) {
  return rect.width > 0.5 && rect.height > 0.5
}

function getSpanGeometryClientRect(span: HTMLElement) {
  const pageLayer = span.closest<HTMLElement>('.mobile-pdf-page-layer')
  const pageX = Number(span.dataset.pageX)
  const pageY = Number(span.dataset.pageY)
  const pageWidth = Number(span.dataset.pageWidth)
  const pageHeight = Number(span.dataset.pageHeight)
  if (!pageLayer || !Number.isFinite(pageX) || !Number.isFinite(pageY) || !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
    return span.getBoundingClientRect()
  }

  const layerRect = pageLayer.getBoundingClientRect()
  const appScale = pageLayer.offsetWidth > 0 ? layerRect.width / pageLayer.offsetWidth : 1
  return new DOMRect(
    layerRect.left + pageX * appScale,
    layerRect.top + pageY * appScale,
    pageWidth * appScale,
    pageHeight * appScale
  )
}

function intersectRects(left: DOMRect, right: DOMRect) {
  const x1 = Math.max(left.left, right.left)
  const y1 = Math.max(left.top, right.top)
  const x2 = Math.min(left.right, right.right)
  const y2 = Math.min(left.bottom, right.bottom)
  if (x2 <= x1 || y2 <= y1) {
    return null
  }

  return new DOMRect(x1, y1, x2 - x1, y2 - y1)
}

function trimSliceOffsets(text: string, startOffset: number, endOffset: number) {
  let start = clampTextOffset(startOffset, text.length)
  let end = clampTextOffset(endOffset, text.length)
  while (start < end && /\s/.test(text[start] ?? '')) {
    start += 1
  }
  while (end > start && /\s/.test(text[end - 1] ?? '')) {
    end -= 1
  }
  return { start, end }
}

function buildProportionalRectFromSpanSlice(slice: SelectedSpanSlice, spanRect: DOMRect, startOffset: number, endOffset: number) {
  const textLength = Math.max(1, getSpanTextLength(slice.span))
  const startRatio = startOffset / textLength
  const endRatio = endOffset / textLength
  const direction = slice.span.dir || window.getComputedStyle?.(slice.span).direction || 'ltr'
  const leftRatio = direction === 'rtl' ? 1 - endRatio : startRatio
  const rightRatio = direction === 'rtl' ? 1 - startRatio : endRatio
  const left = spanRect.left + spanRect.width * leftRatio
  const right = spanRect.left + spanRect.width * rightRatio
  return new DOMRect(left, spanRect.top, Math.max(1, right - left), spanRect.height)
}

function buildRectFromSpanSlice(slice: SelectedSpanSlice) {
  const text = slice.span.textContent ?? ''
  const trimmed = trimSliceOffsets(text, slice.startOffset, slice.endOffset)
  if (trimmed.end <= trimmed.start) {
    return []
  }

  const spanRect = getSpanGeometryClientRect(slice.span)
  if (!isUsableSelectionRect(spanRect)) {
    return []
  }

  if (trimmed.start === 0 && trimmed.end === text.length) {
    return [spanRect]
  }

  const spanRange = buildRangeForSpanSlice(slice.span, trimmed.start, trimmed.end)
  if (!spanRange) {
    return [buildProportionalRectFromSpanSlice(slice, spanRect, trimmed.start, trimmed.end)]
  }

  const nativeRects = Array.from(spanRange.getClientRects())
    .filter(isUsableSelectionRect)
    .map((rect) => intersectRects(rect, spanRect))
    .filter((rect): rect is DOMRect => rect !== null)
    .filter(isUsableSelectionRect)

  const sliceRatio = (trimmed.end - trimmed.start) / Math.max(1, text.length)
  const hasOverwideNativeRect = nativeRects.some((rect) => rect.width >= spanRect.width * 0.95 && sliceRatio < 0.85)
  if (nativeRects.length > 0 && !hasOverwideNativeRect) {
    return nativeRects
  }

  return [buildProportionalRectFromSpanSlice(slice, spanRect, trimmed.start, trimmed.end)]
}

export function getVisibleSelectionClientRects(
  range: Range,
  textLayer?: HTMLElement | null,
  page?: HTMLElement | null
) {
  const targetTextLayer =
    textLayer ??
    (closestFromNode(range.startContainer, '.textLayer') as HTMLElement | null) ??
    (closestFromNode(range.endContainer, '.textLayer') as HTMLElement | null) ??
    (closestFromNode(range.commonAncestorContainer, '.textLayer') as HTMLElement | null)
  const targetPage = page ?? targetTextLayer?.closest<HTMLElement>('.page') ?? null
  const targetPageLayer =
    targetTextLayer?.closest<HTMLElement>('.mobile-pdf-page-layer') ?? targetPage?.querySelector<HTMLElement>('.mobile-pdf-page-layer') ?? targetPage
  if (!targetTextLayer || !targetPage || !targetPageLayer) {
    return []
  }

  const startBoundary = resolveRangeBoundary(range, 'start')
  const endBoundary = resolveRangeBoundary(range, 'end')
  const selectedSpanSlices = collectSelectedSpanSlices(targetTextLayer, range, startBoundary, endBoundary)
  const indexedRects =
    selectedSpanSlices.length > 0
      ? buildRectsFromSelectedSpanSlices(selectedSpanSlices)
      : buildRectsFromIndexedSpans(targetTextLayer, startBoundary, endBoundary)
  if (indexedRects.length > 0) {
    return indexedRects
  }

  const layerRect = targetPageLayer.getBoundingClientRect()
  const nativeRects = Array.from(range.getClientRects()).filter(
    (rect) =>
      isUsableSelectionRect(rect) &&
      rect.left < layerRect.right &&
      rect.right > layerRect.left &&
      rect.top < layerRect.bottom &&
      rect.bottom > layerRect.top
  )
  return dedupeRects(nativeRects)
}

function closestFromNode(node: Node | null, selector: string) {
  if (!node) {
    return null
  }

  if (node instanceof Element) {
    return node.closest(selector)
  }

  return node.parentElement?.closest(selector) ?? null
}

function findIndexedSpanWithin(node: Node | null, fromEnd = false): HTMLElement | null {
  if (!node) {
    return null
  }

  if (node instanceof HTMLElement && node.matches('span[data-text-index]')) {
    return node
  }

  if (node instanceof Text) {
    return node.parentElement?.closest('span[data-text-index]') ?? null
  }

  if (node instanceof Element) {
    const matches = node.querySelectorAll<HTMLElement>('span[data-text-index]')
    return fromEnd ? matches[matches.length - 1] ?? null : matches[0] ?? null
  }

  return null
}

function findIndexedSpanForBoundary(container: Node, offset: number, isEndBoundary: boolean) {
  const direct = closestFromNode(container, 'span[data-text-index]') as HTMLElement | null
  if (direct) {
    return direct
  }

  if (!(container instanceof Element)) {
    return null
  }

  const childNodes = Array.from(container.childNodes)
  const preferredChild = isEndBoundary
    ? childNodes[Math.max(0, Math.min(childNodes.length - 1, offset - 1))] ?? null
    : childNodes[Math.max(0, Math.min(childNodes.length - 1, offset))] ?? null
  const preferredSpan = findIndexedSpanWithin(preferredChild, isEndBoundary)
  if (preferredSpan) {
    return preferredSpan
  }

  if (isEndBoundary) {
    for (let index = Math.min(offset - 1, childNodes.length - 1); index >= 0; index--) {
      const span = findIndexedSpanWithin(childNodes[index], true)
      if (span) {
        return span
      }
    }
  } else {
    for (let index = Math.max(0, offset); index < childNodes.length; index++) {
      const span = findIndexedSpanWithin(childNodes[index], false)
      if (span) {
        return span
      }
    }
  }

  return null
}

function getSpanTextLength(span: HTMLElement) {
  return span.textContent?.length ?? 0
}

function clampTextOffset(offset: number, textLength: number) {
  return Math.max(0, Math.min(offset, textLength))
}

function getBoundaryOffsetWithinSpan(span: HTMLElement, container: Node, offset: number) {
  const textLength = getSpanTextLength(span)
  if (!textLength) {
    return 0
  }

  try {
    const range = document.createRange()
    range.selectNodeContents(span)
    range.setEnd(container, offset)
    return clampTextOffset(range.toString().length, textLength)
  } catch {
    return 0
  }
}

function resolveRangeBoundary(range: Range, boundary: 'start' | 'end') {
  const container = boundary === 'start' ? range.startContainer : range.endContainer
  const offset = boundary === 'start' ? range.startOffset : range.endOffset
  const span = findIndexedSpanForBoundary(container, offset, boundary === 'end')
  if (!span) {
    return null
  }

  const indexValue = Number(span.dataset.textIndex)
  if (!Number.isFinite(indexValue)) {
    return null
  }

  const resolvedOffset = getBoundaryOffsetWithinSpan(span, container, offset)
  const textLength = getSpanTextLength(span)

  return {
    span,
    index: indexValue,
    offset: clampTextOffset(resolvedOffset, textLength)
  }
}

function findTextNodeAtOffset(span: HTMLElement, offset: number) {
  const textWalker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  const targetOffset = clampTextOffset(offset, getSpanTextLength(span))
  let remaining = targetOffset
  let current: Text | null = textWalker.nextNode() as Text | null
  let lastText: Text | null = null

  while (current) {
    lastText = current
    if (remaining <= current.data.length) {
      return {
        node: current,
        offset: remaining
      }
    }

    remaining -= current.data.length
    current = textWalker.nextNode() as Text | null
  }

  if (lastText) {
    return {
      node: lastText,
      offset: lastText.data.length
    }
  }

  return null
}

function buildRangeForSpanSlice(span: HTMLElement, startOffset: number, endOffset: number) {
  const startPoint = findTextNodeAtOffset(span, startOffset)
  const endPoint = findTextNodeAtOffset(span, endOffset)
  if (!startPoint || !endPoint) {
    return null
  }

  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

type AnchorRangeInput = Pick<PageAnchor, 'startSpanIndex' | 'startOffset' | 'endSpanIndex' | 'endOffset'>

function buildRangeFromAnchor(page: HTMLElement, anchor: AnchorRangeInput) {
  if (
    anchor.startSpanIndex == null ||
    anchor.endSpanIndex == null ||
    anchor.startOffset == null ||
    anchor.endOffset == null
  ) {
    return null
  }

  const textLayer = page.querySelector<HTMLElement>('.textLayer')
  if (!textLayer) {
    return null
  }

  const startSpan = textLayer.querySelector<HTMLElement>(`span[data-text-index="${anchor.startSpanIndex}"]`)
  const endSpan = textLayer.querySelector<HTMLElement>(`span[data-text-index="${anchor.endSpanIndex}"]`)
  if (!startSpan || !endSpan) {
    return null
  }

  const startPoint = findTextNodeAtOffset(startSpan, anchor.startOffset)
  const endPoint = findTextNodeAtOffset(endSpan, anchor.endOffset)
  if (!startPoint || !endPoint) {
    return null
  }

  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

interface ResolvedBoundary {
  span: HTMLElement
  index: number
  offset: number
}

interface SelectedSpanSlice {
  span: HTMLElement
  index: number
  startOffset: number
  endOffset: number
}

interface PositionedSelectionText {
  text: string
  left: number
  top: number
  width: number
  height: number
}

function collectSelectedSpanSlices(
  textLayer: HTMLElement,
  range: Range,
  startBoundary: ResolvedBoundary | null,
  endBoundary: ResolvedBoundary | null
) {
  if (!startBoundary || !endBoundary) {
    return []
  }

  const startIndex = startBoundary.index
  const endIndex = endBoundary.index
  const lowerBound = Math.min(startIndex, endIndex)
  const upperBound = Math.max(startIndex, endIndex)
  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>('span[data-text-index]'))
  const slices: SelectedSpanSlice[] = []

  for (const span of spans) {
    const indexValue = Number(span.dataset.textIndex)
    if (!Number.isFinite(indexValue) || indexValue < lowerBound || indexValue > upperBound) {
      continue
    }

    if (!range.intersectsNode(span)) {
      continue
    }

    const textLength = getSpanTextLength(span)
    if (!textLength) {
      continue
    }

    const startOffset = indexValue === startBoundary.index ? startBoundary.offset : 0
    const endOffset = indexValue === endBoundary.index ? endBoundary.offset : textLength
    const normalizedStart = Math.max(0, Math.min(startOffset, endOffset))
    const normalizedEnd = Math.min(textLength, Math.max(startOffset, endOffset))
    if (normalizedEnd <= normalizedStart) {
      continue
    }

    slices.push({
      span,
      index: indexValue,
      startOffset: normalizedStart,
      endOffset: normalizedEnd
    })
  }

  return slices
}

function buildRectsFromSelectedSpanSlices(slices: SelectedSpanSlice[]) {
  const rects: DOMRect[] = []
  for (const slice of slices) {
    // Skip whitespace-only spans for bounding boxes to prevent visual artifacts
    if ((slice.span.textContent ?? '').trim().length === 0) {
      continue
    }

    rects.push(...buildRectFromSpanSlice(slice))
  }

  return dedupeRects(rects)
}

function buildRectsFromIndexedSpans(
  textLayer: HTMLElement,
  startBoundary: ResolvedBoundary | null,
  endBoundary: ResolvedBoundary | null
) {
  if (!startBoundary || !endBoundary) {
    return []
  }

  const startIndex = Math.min(startBoundary.index, endBoundary.index)
  const endIndex = Math.max(startBoundary.index, endBoundary.index)
  const rects: DOMRect[] = []

  for (let index = startIndex; index <= endIndex; index++) {
    const span = textLayer.querySelector<HTMLElement>(`span[data-text-index="${index}"]`)
    if (!span) {
      continue
    }

    const textLength = getSpanTextLength(span)
    if (!textLength) {
      continue
    }

    if ((span.textContent ?? '').trim().length === 0) {
      continue
    }

    const startOffset = index === startBoundary.index ? startBoundary.offset : 0
    const endOffset = index === endBoundary.index ? endBoundary.offset : textLength
    if (endOffset <= startOffset) {
      continue
    }

    rects.push(...buildRectFromSpanSlice({ span, index, startOffset, endOffset }))
  }

  return dedupeRects(rects)
}

export function restorePdfSelectionFromAnchor(page: HTMLElement, anchor: Pick<PageAnchor, 'startSpanIndex' | 'startOffset' | 'endSpanIndex' | 'endOffset'>) {
  const range = buildRangeFromAnchor(page, anchor)
  if (!range) {
    return false
  }

  const selection = document.getSelection()
  if (!selection) {
    return false
  }

  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

export function resolveAnchorClientRects(
  page: HTMLElement,
  anchor: Pick<
    PageAnchor,
    'startSpanIndex' | 'startOffset' | 'endSpanIndex' | 'endOffset' | 'boundingBox' | 'quadPoints' | 'viewportScale'
  >
) {
  const range = buildRangeFromAnchor(page, anchor)
  if (range) {
    const rects = getVisibleSelectionClientRects(range, page.querySelector<HTMLElement>('.textLayer'), page)
    if (rects.length > 0) {
      return rects
    }
  }

  const currentViewportScale = Number(page.dataset.viewportScale ?? '1')
  const ratio = currentViewportScale / (anchor.viewportScale || currentViewportScale)
  const pageReference = page.querySelector<HTMLElement>('.mobile-pdf-page-layer') ?? page

  if (anchor.quadPoints?.length) {
    const pageRect = pageReference.getBoundingClientRect()
    const rects: DOMRect[] = []
    for (let index = 0; index < anchor.quadPoints.length; index += 8) {
      const quad = anchor.quadPoints.slice(index, index + 8)
      if (quad.length !== 8) {
        continue
      }

      const left = Math.min(quad[0], quad[2], quad[4], quad[6]) * ratio
      const right = Math.max(quad[0], quad[2], quad[4], quad[6]) * ratio
      const top = Math.min(quad[1], quad[3], quad[5], quad[7]) * ratio
      const bottom = Math.max(quad[1], quad[3], quad[5], quad[7]) * ratio
      rects.push(new DOMRect(pageRect.left + left, pageRect.top + top, right - left, bottom - top))
    }

    if (rects.length > 0) {
      return rects
    }
  }

  const pageRect = pageReference.getBoundingClientRect()
  return [
    new DOMRect(
      pageRect.left + anchor.boundingBox.x * ratio,
      pageRect.top + anchor.boundingBox.y * ratio,
      anchor.boundingBox.width * ratio,
      anchor.boundingBox.height * ratio
    )
  ]
}

export function capturePdfSelection(root: HTMLElement): PdfSelection | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  const textLayer = (
    closestFromNode(selection.anchorNode, '.textLayer') ??
    closestFromNode(selection.focusNode, '.textLayer') ??
    closestFromNode(range.commonAncestorContainer, '.textLayer')
  ) as HTMLElement | null
  const page = textLayer?.closest<HTMLElement>('.page')
  const pageLayer = textLayer?.closest<HTMLElement>('.mobile-pdf-page-layer') ?? page?.querySelector<HTMLElement>('.mobile-pdf-page-layer') ?? null
  if (!textLayer || !page || !pageLayer || !root.contains(page)) {
    return null
  }

  const clientRectsRaw = getVisibleSelectionClientRects(range, textLayer, page)

  const mergeNearbyRects = (rects: DOMRect[]) => {
    if (rects.length === 0) return rects

    const sorted = [...rects].sort((left, right) => {
      if (left.top === right.top) return left.left - right.left
      return left.top - right.top
    })

    const merged: DOMRect[] = []
    let current = sorted[0]

    for (let index = 1; index < sorted.length; index += 1) {
      const next = sorted[index]

      const currentMidY = (current.top + current.bottom) / 2
      const nextMidY = (next.top + next.bottom) / 2
      const sameLineThreshold = Math.max(2, Math.min(current.height, next.height) * 0.6)
      const sameLine = Math.abs(nextMidY - currentMidY) <= sameLineThreshold

      const gap = next.left - current.right
      const gapThreshold = Math.max(2, current.height * 0.55)
      const closeEnough = gap <= gapThreshold

      if (sameLine && closeEnough) {
        const left = Math.min(current.left, next.left)
        const top = Math.min(current.top, next.top)
        const right = Math.max(current.right, next.right)
        const bottom = Math.max(current.bottom, next.bottom)
        current = new DOMRect(left, top, right - left, bottom - top)
        continue
      }

      merged.push(current)
      current = next
    }

    merged.push(current)
    return merged
  }

  // Keep the browser's selection rects, but drop tiny noise rectangles and merge
  // adjacent rects on the same line to avoid per-character/per-span boxes.
  const clientRectsSized = clientRectsRaw.filter((rect) => rect.width > 1 && rect.height > 1)
  const clientRects = mergeNearbyRects(clientRectsSized.length > 0 ? clientRectsSized : clientRectsRaw)
  const unionRect = buildUnionRect(clientRects)
  if (!unionRect || clientRects.length === 0) {
    return null
  }

  const pageGeometry = convertClientRectsToPageAnchorGeometry(clientRects, pageLayer)
  if (!pageGeometry) {
    return null
  }

  const pageNumber = Number(page.dataset.pageNumber ?? '0')
  const viewportScale = Number(page.dataset.viewportScale ?? '1')
  const startBoundary = resolveRangeBoundary(range, 'start')
  const endBoundary = resolveRangeBoundary(range, 'end')
  const selectedText =
    reconstructPdfSelectionText(textLayer, range, startBoundary, endBoundary) ||
    selection.toString().replace(/\s+/g, ' ').trim()

  return {
    text: selectedText,
    pageNumber,
    anchor: {
      pageNumber,
      startSpanIndex: startBoundary?.index,
      startOffset: startBoundary?.offset,
      endSpanIndex: endBoundary?.index,
      endOffset: endBoundary?.offset,
      boundingBox: pageGeometry.boundingBox,
      quadPoints: pageGeometry.quadPoints,
      viewportScale,
      textQuote: selectedText
    }
  }
}

function reconstructPdfSelectionText(
  textLayer: HTMLElement,
  range: Range,
  startBoundary: ResolvedBoundary | null,
  endBoundary: ResolvedBoundary | null
) {
  const slices = collectSelectedSpanSlices(textLayer, range, startBoundary, endBoundary)
  const parts = slices
    .map((slice) => {
      const text = (slice.span.textContent ?? '').slice(slice.startOffset, slice.endOffset).replace(/\s+/g, ' ')
      if (!text.trim()) return null
      const rect = slice.span.getBoundingClientRect()
      return {
        text,
        left: Number(slice.span.dataset.pageX ?? rect.left),
        top: Number(slice.span.dataset.pageY ?? rect.top),
        width: Number(slice.span.dataset.pageWidth ?? rect.width),
        height: Number(slice.span.dataset.pageHeight ?? rect.height)
      }
    })
    .filter((part): part is PositionedSelectionText => Boolean(part))
    .sort((left, right) => {
      const rowTolerance = Math.max(3, Math.min(left.height || 12, right.height || 12) * 0.55)
      if (Math.abs(left.top - right.top) > rowTolerance) return left.top - right.top
      return left.left - right.left
    })

  if (parts.length === 0) return ''

  const rows: PositionedSelectionText[][] = []
  for (const part of parts) {
    const lastRow = rows[rows.length - 1]
    const last = lastRow?.[lastRow.length - 1]
    const rowTolerance = Math.max(3, Math.min(part.height || 12, last?.height || part.height || 12) * 0.55)
    if (!lastRow || !last || Math.abs(part.top - last.top) > rowTolerance) {
      rows.push([part])
    } else {
      lastRow.push(part)
    }
  }

  return rows
    .map((row) =>
      row
        .sort((left, right) => left.left - right.left)
        .reduce((text, part, index, entries) => {
          if (index === 0) return part.text.trim()
          const previous = entries[index - 1]
          const gap = part.left - (previous.left + previous.width)
          const needsSpace = gap > Math.max(2, Math.min(part.height || 12, previous.height || 12) * 0.16)
          return `${text}${needsSpace ? ' ' : ''}${part.text.trimStart()}`
        }, '')
        .trim()
    )
    .filter(Boolean)
    .join('\n')
    .trim()
}

function hashExcerpt(input: CreateExcerptInput) {
  return [
    input.documentId,
    input.pageNumber,
    input.extractedText.replace(/\s+/g, ' ').trim().toLowerCase(),
    Math.round(input.boundingBox.x),
    Math.round(input.boundingBox.y),
    Math.round(input.boundingBox.width),
    Math.round(input.boundingBox.height)
  ].join(':')
}

function hashSelection(input: SelectionArtifactInput) {
  return [
    input.documentId,
    input.pageNumber,
    input.startSpanIndex ?? 'na',
    input.startOffset ?? 'na',
    input.endSpanIndex ?? 'na',
    input.endOffset ?? 'na',
    input.text.replace(/\s+/g, ' ').trim().toLowerCase(),
    Math.round(input.boundingBox.x),
    Math.round(input.boundingBox.y),
    Math.round(input.boundingBox.width),
    Math.round(input.boundingBox.height)
  ].join(':')
}

export function buildPageAnchor(input: SelectionArtifactInput): PageAnchor {
  const now = new Date().toISOString()
  const id = `anchor-${hashSelection(input)}`

  return {
    id,
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    pageNumber: input.pageNumber,
    startSpanIndex: input.startSpanIndex,
    startOffset: input.startOffset,
    endSpanIndex: input.endSpanIndex,
    endOffset: input.endOffset,
    boundingBox: input.boundingBox,
    quadPoints: input.quadPoints,
    viewportScale: input.viewportScale,
    textQuote: input.text,
    selectionColor: input.selectionColor,
    tags: input.tags,
    createdAt: now,
    updatedAt: now
  }
}

export function buildExcerpt(input: SelectionArtifactInput): Excerpt {
  const now = new Date().toISOString()
  const normalizedHash = hashExcerpt({
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    pageNumber: input.pageNumber,
    extractedText: input.text,
    boundingBox: input.boundingBox,
    quadPoints: input.quadPoints,
    viewportScale: input.viewportScale
  })
  const anchor = buildPageAnchor(input)

  return {
    id: `excerpt-${normalizedHash}`,
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    pageNumber: input.pageNumber,
    boundingBox: input.boundingBox,
    quadPoints: input.quadPoints,
    viewportScale: input.viewportScale,
    anchorId: anchor.id,
    extractedText: input.text,
    normalizedHash,
    selectionColor: input.selectionColor,
    tags: input.tags,
    noteIds: [],
    createdAt: now,
    updatedAt: now
  }
}

export function buildBookmark(input: SelectionArtifactInput, documentOrder: number): Bookmark {
  const now = new Date().toISOString()
  const anchor = buildPageAnchor(input)

  return {
    id: `bookmark-${anchor.id}`,
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    sourceAnchorId: anchor.id,
    bookmarkLabel: input.text.slice(0, 64),
    documentOrder,
    selectionColor: input.selectionColor,
    tags: input.tags,
    createdAt: now,
    updatedAt: now
  }
}

export function buildAnchorLink(workspaceId: string, documentId: string, anchor: PageAnchor) {
  const box = anchor.boundingBox
  return `app://workspace/${workspaceId}/document/${documentId}?page=${anchor.pageNumber}&x=${Math.round(box.x)}&y=${Math.round(box.y)}&w=${Math.round(box.width)}&h=${Math.round(box.height)}`
}
