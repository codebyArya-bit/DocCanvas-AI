import type { Bookmark, CanvasNode, Excerpt, PageAnchor } from '@workspace/domain'

export interface SourceHighlightDescriptor {
  anchorId: string
  pageNumber: number
  boundingBox: PageAnchor['boundingBox']
  startSpanIndex?: number
  startOffset?: number
  endSpanIndex?: number
  endOffset?: number
  quadPoints?: number[]
  viewportScale: number
  selectionColor: string
  tags?: string[]
  showHighlight: boolean
  showMarker: boolean
}

export function buildSourceHighlightDescriptors(options: {
  anchors: PageAnchor[]
  excerpts: Excerpt[]
  bookmarks: Bookmark[]
  canvasNodes: CanvasNode[]
  activeTag: string | null
  filteredAnchorIds: Set<string>
}): SourceHighlightDescriptor[] {
  const { anchors, excerpts, bookmarks, canvasNodes, activeTag, filteredAnchorIds } = options

  const resolveHighlightColor = (anchorId: string) =>
    anchors.find((anchor) => anchor.id === anchorId)?.selectionColor ??
    excerpts.find((excerpt) => excerpt.anchorId === anchorId)?.selectionColor ??
    null

  const resolveMarkerColor = (anchorId: string) =>
    resolveHighlightColor(anchorId) ??
    bookmarks.find((bookmark) => bookmark.sourceAnchorId === anchorId)?.selectionColor ??
    '#5d5df6'

  const resolveTags = (anchorId: string) =>
    Array.from(
      new Set([
        ...(anchors.find((anchor) => anchor.id === anchorId)?.tags ?? []),
        ...excerpts.filter((excerpt) => excerpt.anchorId === anchorId).flatMap((excerpt) => excerpt.tags ?? []),
        ...bookmarks.filter((bookmark) => bookmark.sourceAnchorId === anchorId).flatMap((bookmark) => bookmark.tags ?? []),
        ...canvasNodes.filter((node) => node.sourceAnchorId === anchorId).flatMap((node) => node.tags ?? [])
      ])
    )

  return anchors
    .filter((anchor) => {
      const hasColor = Boolean(anchor.selectionColor)
      const hasTag = (anchor.tags?.length ?? 0) > 0
      const hasExcerpt = excerpts.some((excerpt) => excerpt.anchorId === anchor.id)
      const hasBookmark = bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id)
      const hasNode = canvasNodes.some((node) => node.sourceAnchorId === anchor.id)
      const keepVisible = hasColor || hasTag || hasExcerpt || hasBookmark || hasNode
      if (!keepVisible) {
        return false
      }
      if (!activeTag) {
        return true
      }
      return filteredAnchorIds.has(anchor.id)
    })
    .map((anchor) => {
      const hasColor = Boolean(anchor.selectionColor)
      const hasTag = (anchor.tags?.length ?? 0) > 0
      const hasExcerpt = excerpts.some((excerpt) => excerpt.anchorId === anchor.id)
      const hasBookmark = bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id)
      const hasNode = canvasNodes.some((node) => node.sourceAnchorId === anchor.id)
      const highlightColor = resolveHighlightColor(anchor.id)
      const matchesActiveTag = Boolean(activeTag && filteredAnchorIds.has(anchor.id))

      return {
        anchorId: anchor.id,
        pageNumber: anchor.pageNumber,
        boundingBox: anchor.boundingBox,
        startSpanIndex: anchor.startSpanIndex,
        startOffset: anchor.startOffset,
        endSpanIndex: anchor.endSpanIndex,
        endOffset: anchor.endOffset,
        quadPoints: anchor.quadPoints,
        viewportScale: anchor.viewportScale,
        selectionColor: resolveMarkerColor(anchor.id),
        tags: resolveTags(anchor.id),
        showHighlight: Boolean(highlightColor) || matchesActiveTag,
        showMarker: hasExcerpt || hasBookmark || hasNode
      }
    })
}
