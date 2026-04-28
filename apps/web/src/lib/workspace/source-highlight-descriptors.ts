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
  showBookmarkIcon: boolean
  showTagBadges: boolean
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
      const hasExcerpt = excerpts.some((excerpt) => excerpt.anchorId === anchor.id)
      const hasExcerptOrCommentNode = canvasNodes.some(
        (node) => node.sourceAnchorId === anchor.id && (node.kind === 'excerpt' || node.kind === 'comment')
      )
      const hasBookmark = bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id)
      const hasNonBookmarkTag = Boolean(
        (anchor.tags?.length ?? 0) > 0 ||
          excerpts.some((excerpt) => excerpt.anchorId === anchor.id && (excerpt.tags?.length ?? 0) > 0) ||
          canvasNodes.some((node) => node.sourceAnchorId === anchor.id && (node.tags?.length ?? 0) > 0)
      )
      const highlightColor = resolveHighlightColor(anchor.id)
      const matchesActiveTag = Boolean(activeTag && filteredAnchorIds.has(anchor.id) && hasNonBookmarkTag)
      const showBookmarkOnly = hasBookmark && !hasExcerpt && !hasExcerptOrCommentNode && !hasNonBookmarkTag
      const bookmarkColor = bookmarks.find((bookmark) => bookmark.sourceAnchorId === anchor.id)?.selectionColor

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
        selectionColor: showBookmarkOnly ? bookmarkColor ?? '#5d5df6' : resolveMarkerColor(anchor.id),
        tags: resolveTags(anchor.id),
        showHighlight: !showBookmarkOnly && (Boolean(highlightColor) || matchesActiveTag),
        showMarker: hasExcerpt || hasExcerptOrCommentNode,
        showBookmarkIcon: hasBookmark,
        showTagBadges: !showBookmarkOnly
      }
    })
}
