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

function samplePointWithinRect(rect: DOMRect) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  const x = Math.min(
    Math.max(rect.left + Math.min(4, Math.max(1, rect.width / 2)), 1),
    Math.max(1, viewportWidth - 1)
  )
  const y = Math.min(
    Math.max(rect.top + Math.min(4, Math.max(1, rect.height / 2)), 1),
    Math.max(1, viewportHeight - 1)
  )

  return { x, y }
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
  if (!targetTextLayer || !targetPage) {
    return []
  }

  const pageRect = targetPage.getBoundingClientRect()
  const startBoundary = resolveRangeBoundary(range, 'start')
  const endBoundary = resolveRangeBoundary(range, 'end')
  const selectedSpanSlices = collectSelectedSpanSlices(targetTextLayer, range, startBoundary, endBoundary)
  const indexedRects =
    selectedSpanSlices.length > 0
      ? buildRectsFromSelectedSpanSlices(selectedSpanSlices)
      : buildRectsFromIndexedSpans(targetTextLayer, startBoundary, endBoundary)
  const rawRects =
    indexedRects.length > 0
      ? indexedRects
      : Array.from(range.getClientRects()).filter(
          (rect) =>
            rect.width > 0.5 &&
            rect.height > 0.5 &&
            rect.left < pageRect.right &&
            rect.right > pageRect.left &&
            rect.top < pageRect.bottom &&
            rect.bottom > pageRect.top
        )

  const visibleRects = rawRects.filter((rect) => {
    const { x, y } = samplePointWithinRect(rect)
    const element = document.elementFromPoint(x, y)
    if (!element) {
      return false
    }

    const ownerTextLayer = element.closest('.textLayer')
    return ownerTextLayer === targetTextLayer
  })

  return dedupeRects(visibleRects)
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

function collectSelectedSpanSlices(
  textLayer: HTMLElement,
  range: Range,
  startBoundary: ResolvedBoundary | null,
  endBoundary: ResolvedBoundary | null
) {
  const startIndex = startBoundary?.index ?? Number.NEGATIVE_INFINITY
  const endIndex = endBoundary?.index ?? Number.POSITIVE_INFINITY
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

    const startOffset = indexValue === startBoundary?.index ? startBoundary.offset : 0
    const endOffset = indexValue === endBoundary?.index ? endBoundary.offset : textLength
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
    const spanRange = buildRangeForSpanSlice(slice.span, slice.startOffset, slice.endOffset)
    if (!spanRange) {
      continue
    }

    rects.push(
      ...Array.from(spanRange.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    )
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

    const startOffset = index === startBoundary.index ? startBoundary.offset : 0
    const endOffset = index === endBoundary.index ? endBoundary.offset : textLength
    if (endOffset <= startOffset) {
      continue
    }

    const spanRange = buildRangeForSpanSlice(span, startOffset, endOffset)
    if (!spanRange) {
      continue
    }

    rects.push(
      ...Array.from(spanRange.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    )
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

  if (anchor.quadPoints?.length) {
    const pageRect = page.getBoundingClientRect()
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

  const pageRect = page.getBoundingClientRect()
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
  if (!textLayer || !page || !root.contains(page)) {
    return null
  }

  const pageRect = page.getBoundingClientRect()
  const clientRects = getVisibleSelectionClientRects(range, textLayer, page)
  const unionRect = buildUnionRect(clientRects)
  if (!unionRect || clientRects.length === 0) {
    return null
  }

  const pageNumber = Number(page.dataset.pageNumber ?? '0')
  const viewportScale = Number(page.dataset.viewportScale ?? '1')
  const startBoundary = resolveRangeBoundary(range, 'start')
  const endBoundary = resolveRangeBoundary(range, 'end')

  return {
    text: selection.toString().replace(/\s+/g, ' ').trim(),
    pageNumber,
    anchor: {
      pageNumber,
      startSpanIndex: startBoundary?.index,
      startOffset: startBoundary?.offset,
      endSpanIndex: endBoundary?.index,
      endOffset: endBoundary?.offset,
      boundingBox: {
        x: unionRect.left - pageRect.left,
        y: unionRect.top - pageRect.top,
        width: unionRect.width,
        height: unionRect.height
      },
      quadPoints: clientRects.flatMap((rect) => [
        rect.left - pageRect.left,
        rect.top - pageRect.top,
        rect.right - pageRect.left,
        rect.top - pageRect.top,
        rect.right - pageRect.left,
        rect.bottom - pageRect.top,
        rect.left - pageRect.left,
        rect.bottom - pageRect.top
      ]),
      viewportScale,
      textQuote: selection.toString().replace(/\s+/g, ' ').trim()
    }
  }
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
