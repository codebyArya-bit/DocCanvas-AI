'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Bookmark, CanvasEdge, CanvasNode, Excerpt, Note, PageAnchor, TextStyle } from '@workspace/domain'
import { buildAnchorLink, buildBookmark, buildExcerpt, buildPageAnchor, type SelectionArtifactInput } from '../lib/excerpts/pdf-selection'
import { loadWorkspaceState, persistWorkspaceState } from '../lib/indexeddb/local-cache'
import type { PersistedPdfDocument, WorkspacePersistenceState } from '../lib/workspace/workspace-state'
import { buildWorkspaceNodeLink, type WorkspaceNodeLink } from '../lib/workspace/node-links'
import { WorkspaceCanvas } from './workspace/WorkspaceCanvas'
import { NoteEditor } from './notes/note-editor'
import { PdfViewer } from './pdf/pdf-viewer'
import { LinkLayer } from './workspace/LinkLayer'
import type { AnchorViewportMetric } from './pdf/AnchorService'
import { WorkspaceTextToolbar } from './workspace/WorkspaceTextToolbar'

const WORKSPACE_ID = 'workspace-1'

const seedNote: Note = {
  id: 'note-1',
  workspaceId: WORKSPACE_ID,
  title: 'Synthesis',
  excerptIds: [],
  documentIds: [],
  prosemirrorJson: { type: 'doc', content: [{ type: 'paragraph' }] },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

const defaultTextStyle: TextStyle = {
  preset: 'body',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  fontSize: 16,
  fontWeight: 'normal',
  fontStyle: 'normal',
  underline: false,
  strikethrough: false
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const existing = items.find((item) => item.id === nextItem.id)
  if (!existing) {
    return [...items, nextItem]
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item))
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
) {
  return !(
    left.x + left.width <= right.x ||
    left.x >= right.x + right.width ||
    left.y + left.height <= right.y ||
    left.y >= right.y + right.height
  )
}

export function WorkspaceShell() {
  const shellRef = useRef<HTMLElement | null>(null)
  const workspacePaneRef = useRef<HTMLElement | null>(null)
  const documentPaneRef = useRef<HTMLElement | null>(null)
  const [documentState, setDocumentState] = useState<PersistedPdfDocument | null>(null)
  const [anchors, setAnchors] = useState<PageAnchor[]>([])
  const [excerpts, setExcerpts] = useState<Excerpt[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([])
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([])
  const [workspaceLinks, setWorkspaceLinks] = useState<WorkspaceNodeLink[]>([])
  const [anchorMetrics, setAnchorMetrics] = useState<Record<string, AnchorViewportMetric>>({})
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [activeNote, setActiveNote] = useState<Note>(seedNote)
  const [hydrated, setHydrated] = useState(false)
  const [shellRect, setShellRect] = useState<DOMRect | null>(null)
  const [workspaceRect, setWorkspaceRect] = useState<DOMRect | null>(null)
  const [documentPaneRect, setDocumentPaneRect] = useState<DOMRect | null>(null)
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [activeAnchorJumpKey, setActiveAnchorJumpKey] = useState(0)

  const excerptIndex = useMemo(() => new Map(excerpts.map((excerpt) => [excerpt.id, excerpt])), [excerpts])
  const anchorIndex = useMemo(() => new Map(anchors.map((anchor) => [anchor.id, anchor])), [anchors])

  useEffect(() => {
    let isMounted = true
    void loadWorkspaceState<WorkspacePersistenceState>(WORKSPACE_ID).then((state) => {
      if (!isMounted) {
        return
      }

      if (state) {
        setDocumentState(state.document)
        setAnchors(state.anchors)
        setExcerpts(state.excerpts)
        setBookmarks(state.bookmarks)
        setCanvasNodes(state.canvasNodes)
        setCanvasEdges(state.canvasEdges ?? [])
        setWorkspaceLinks(state.workspaceLinks ?? [])
        setActiveAnchorId(state.activeAnchorId)
      }

      setHydrated(true)
    })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!hydrated) {
      return
    }

    void persistWorkspaceState<WorkspacePersistenceState>(WORKSPACE_ID, {
      document: documentState,
      anchors,
      excerpts,
      bookmarks,
      canvasNodes,
      canvasEdges,
      workspaceLinks,
      activeAnchorId
    }).catch((error) => {
      console.error('Failed to persist workspace state', error)
    })
  }, [activeAnchorId, anchors, bookmarks, canvasEdges, canvasNodes, documentState, excerpts, hydrated, workspaceLinks])

  useEffect(() => {
    const measure = () => {
      setShellRect(shellRef.current?.getBoundingClientRect() ?? null)
      setWorkspaceRect(workspacePaneRef.current?.getBoundingClientRect() ?? null)
      setDocumentPaneRect(documentPaneRef.current?.getBoundingClientRect() ?? null)
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  function resolveWorkspaceRow(viewportRatio: number, nodeHeight: number) {
    const paneHeight = workspacePaneRef.current?.getBoundingClientRect().height ?? 720
    const clampedRatio = Math.max(0.04, Math.min(0.94, viewportRatio))
    return Math.round(24 + clampedRatio * Math.max(0, paneHeight - nodeHeight - 48))
  }

  function findFreeWorkspacePosition(
    preferred: { x: number; y: number; width: number; height: number },
    existingNodes: CanvasNode[],
    ignoreNodeId?: string
  ) {
    const paneRect = workspacePaneRef.current?.getBoundingClientRect()
    const paneWidth = paneRect?.width ?? 960
    const paneHeight = paneRect?.height ?? 720
    const verticalStep = preferred.height + 18
    const clampedX = Math.max(24, Math.min(preferred.x, Math.max(24, paneWidth - preferred.width - 24)))
    let candidateY = Math.max(24, Math.min(preferred.y, Math.max(24, paneHeight - preferred.height - 24)))
    let attempts = 0

    while (attempts < 64) {
      const overlaps = existingNodes.some((node) => {
        if (node.id === ignoreNodeId) {
          return false
        }

        return rectanglesOverlap(
          {
            x: clampedX,
            y: candidateY,
            width: preferred.width,
            height: preferred.height
          },
          node
        )
      })

      if (!overlaps) {
        return { x: clampedX, y: candidateY }
      }

      candidateY += verticalStep
      if (candidateY + preferred.height > paneHeight - 24) {
        candidateY = 24
      }
      attempts += 1
    }

    return { x: clampedX, y: candidateY }
  }

  function findFirstAvailableWorkspacePosition(
    candidates: Array<{ x: number; y: number; width: number; height: number }>,
    existingNodes: CanvasNode[],
    ignoreNodeId?: string
  ) {
    for (const candidate of candidates) {
      const position = findFreeWorkspacePosition(candidate, existingNodes, ignoreNodeId)
      const overlaps = existingNodes.some((node) => {
        if (node.id === ignoreNodeId) {
          return false
        }

        return rectanglesOverlap(
          {
            x: position.x,
            y: position.y,
            width: candidate.width,
            height: candidate.height
          },
          node
        )
      })

      if (!overlaps) {
        return position
      }
    }

    return findFreeWorkspacePosition(candidates[0], existingNodes, ignoreNodeId)
  }

  function upsertAnchorAndExcerpt(input: SelectionArtifactInput) {
    const anchor = buildPageAnchor(input)
    const excerpt = buildExcerpt(input)

    setAnchors((current) => upsertById(current, anchor))
    setExcerpts((current) => upsertById(current, excerpt))

    return { anchor, excerpt }
  }

  function ensureEdge(
    anchorId: string,
    nodeId: string,
    label?: string,
    kind: 'auto' | 'manual' = 'auto',
    color?: string
  ) {
    const now = new Date().toISOString()
    const edge: CanvasEdge = {
      id: `edge-${anchorId}-${nodeId}`,
      workspaceId: WORKSPACE_ID,
      sourceNodeId: nodeId,
      sourceAnchorId: anchorId,
      targetNodeId: nodeId,
      kind,
      color,
      controlBias: 0.42,
      label,
      createdAt: now,
      updatedAt: now
    }

    setCanvasEdges((current) => upsertById(current, edge))
  }

  function createExcerptNode(excerpt: Excerpt, anchor: PageAnchor, viewportRatio: number, x?: number, y?: number) {
    const now = new Date().toISOString()
    const nodeId = `canvas-excerpt-${excerpt.id}`
    const baseNode: CanvasNode = {
      id: nodeId,
      workspaceId: WORKSPACE_ID,
      kind: 'excerpt',
      excerptId: excerpt.id,
      documentId: excerpt.documentId,
      sourceAnchorId: anchor.id,
      selectionColor: excerpt.selectionColor,
      title: `Excerpt · Page ${anchor.pageNumber}`,
      text: excerpt.extractedText,
      tags: excerpt.tags,
      textStyle: defaultTextStyle,
      x: x ?? 128,
      y: y ?? resolveWorkspaceRow(viewportRatio, 140),
      width: 280,
      height: 140,
      createdAt: now,
      updatedAt: now
    }

    setCanvasNodes((current) => {
      const position = findFreeWorkspacePosition(
        {
          x: baseNode.x,
          y: baseNode.y,
          width: baseNode.width,
          height: baseNode.height
        },
        current,
        nodeId
      )
      return upsertById(current, {
        ...baseNode,
        x: position.x,
        y: position.y
      })
    })
    ensureEdge(anchor.id, nodeId, 'excerpt', 'auto', excerpt.selectionColor)
    focusBoth(anchor.id, nodeId)
  }

  function createCommentNode(excerpt: Excerpt, anchor: PageAnchor, viewportRatio: number) {
    const now = new Date().toISOString()
    const nodeId = `canvas-comment-${anchor.id}`
    const relatedExcerptNode =
      canvasNodes.find((node) => node.kind === 'excerpt' && node.excerptId === excerpt.id) ?? null
    const baseNode: CanvasNode = {
      id: nodeId,
      workspaceId: WORKSPACE_ID,
      kind: 'comment',
      excerptId: excerpt.id,
      documentId: excerpt.documentId,
      sourceAnchorId: anchor.id,
      selectionColor: excerpt.selectionColor,
      title: 'Comment',
      text: '',
      tags: excerpt.tags,
      textStyle: defaultTextStyle,
      x: relatedExcerptNode ? relatedExcerptNode.x + relatedExcerptNode.width + 28 : 36,
      y: relatedExcerptNode ? relatedExcerptNode.y : resolveWorkspaceRow(viewportRatio, 184),
      width: 300,
      height: 156,
      createdAt: now,
      updatedAt: now
    }

    setCanvasNodes((current) => {
      const excerptNode =
        current.find((node) => node.kind === 'excerpt' && node.excerptId === excerpt.id) ?? relatedExcerptNode
      const candidateBoxes = excerptNode
        ? [
            {
              x: excerptNode.x + excerptNode.width + 28,
              y: excerptNode.y,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: excerptNode.x - baseNode.width - 28,
              y: excerptNode.y,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: excerptNode.x + excerptNode.width + 28,
              y: excerptNode.y + baseNode.height + 18,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: excerptNode.x - baseNode.width - 28,
              y: excerptNode.y + baseNode.height + 18,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: baseNode.x,
              y: baseNode.y,
              width: baseNode.width,
              height: baseNode.height
            }
          ]
        : [
            {
              x: baseNode.x,
              y: baseNode.y,
              width: baseNode.width,
              height: baseNode.height
            }
          ]
      const position = findFirstAvailableWorkspacePosition(candidateBoxes, current, nodeId)

      return upsertById(current, {
        ...baseNode,
        x: position.x,
        y: position.y
      })
    })
    ensureEdge(anchor.id, nodeId, 'comment', 'auto', excerpt.selectionColor)
    focusBoth(anchor.id, nodeId)
  }

  function focusBoth(anchorId: string | null, nodeId: string | null, edgeId?: string | null) {
    setActiveAnchorId(anchorId)
    setActiveNodeId(nodeId)
    setActiveEdgeId(edgeId ?? (anchorId && nodeId ? `edge-${anchorId}-${nodeId}` : null))
    if (anchorId) {
      setActiveAnchorJumpKey((current) => current + 1)
    }
  }

  function tagSelection(selection: SelectionArtifactInput, tags: string[]) {
    const anchor = buildPageAnchor({ ...selection, tags })
    setAnchors((current) => {
      const existing = current.find((item) => item.id === anchor.id)
      if (!existing) {
        return [...current, anchor]
      }

      return current.map((item) =>
        item.id === anchor.id
          ? {
              ...item,
              tags,
              updatedAt: new Date().toISOString()
            }
          : item
      )
    })

    setExcerpts((current) =>
      current.map((excerpt) =>
        excerpt.anchorId === anchor.id
          ? {
              ...excerpt,
              tags,
              updatedAt: new Date().toISOString()
            }
          : excerpt
      )
    )
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.sourceAnchorId === anchor.id
          ? {
              ...bookmark,
              tags,
              updatedAt: new Date().toISOString()
            }
          : bookmark
      )
    )
    setCanvasNodes((current) =>
      current.map((node) =>
        node.sourceAnchorId === anchor.id
          ? {
              ...node,
              tags,
              updatedAt: new Date().toISOString()
            }
          : node
      )
    )
  }

  function recolorSelection(selection: SelectionArtifactInput) {
    const anchor = buildPageAnchor(selection)
    const anchorId = anchor.id
    const now = new Date().toISOString()

    setAnchors((current) => {
      const existing = current.find((item) => item.id === anchorId)
      if (!existing) {
        return [...current, anchor]
      }

      return current.map((item) =>
        item.id === anchorId
          ? {
              ...item,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : item
      )
    })

    setExcerpts((current) =>
      current.map((excerpt) =>
        excerpt.anchorId === anchorId
          ? {
              ...excerpt,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : excerpt
      )
    )
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.sourceAnchorId === anchorId
          ? {
              ...bookmark,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : bookmark
      )
    )
    setCanvasNodes((current) =>
      current.map((node) =>
        node.sourceAnchorId === anchorId
          ? {
              ...node,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : node
      )
    )
    setCanvasEdges((current) =>
      current.map((edge) =>
        edge.sourceAnchorId === anchorId
          ? {
              ...edge,
              color: selection.selectionColor,
              updatedAt: now
            }
          : edge
      )
    )
  }

  function applyNodeLinkedUpdates(
    nodeId: string,
    updates: {
      selectionColor?: string
      tags?: string[]
    }
  ) {
    const node = canvasNodes.find((entry) => entry.id === nodeId)
    if (!node) {
      return
    }

    const now = new Date().toISOString()
    if (updates.selectionColor) {
      if (node.sourceAnchorId) {
        setAnchors((current) =>
          current.map((anchor) =>
            anchor.id === node.sourceAnchorId
              ? {
                  ...anchor,
                  selectionColor: updates.selectionColor!,
                  updatedAt: now
                }
              : anchor
          )
        )
      }

      setCanvasNodes((current) =>
        current.map((entry) =>
          entry.id === nodeId
            ? {
                ...entry,
                selectionColor: updates.selectionColor,
                updatedAt: now
              }
            : entry
        )
      )

      if (node.sourceAnchorId) {
        setExcerpts((current) =>
          current.map((excerpt) =>
            excerpt.anchorId === node.sourceAnchorId
              ? {
                  ...excerpt,
                  selectionColor: updates.selectionColor!,
                  updatedAt: now
                }
              : excerpt
          )
        )
        setBookmarks((current) =>
          current.map((bookmark) =>
            bookmark.sourceAnchorId === node.sourceAnchorId
              ? {
                  ...bookmark,
                  selectionColor: updates.selectionColor!,
                  updatedAt: now
                }
              : bookmark
          )
        )
        setCanvasEdges((current) =>
          current.map((edge) =>
            edge.sourceAnchorId === node.sourceAnchorId
              ? {
                  ...edge,
                  color: updates.selectionColor!,
                  updatedAt: now
                }
              : edge
          )
        )
      }
    }

    if (updates.tags) {
      setCanvasNodes((current) =>
        current.map((entry) =>
          entry.id === nodeId
            ? {
                ...entry,
                tags: updates.tags,
                updatedAt: now
              }
            : entry
        )
      )

      if (node.sourceAnchorId) {
        setAnchors((current) =>
          current.map((anchor) =>
            anchor.id === node.sourceAnchorId
              ? {
                  ...anchor,
                  tags: updates.tags,
                  updatedAt: now
                }
              : anchor
          )
        )
        setExcerpts((current) =>
          current.map((excerpt) =>
            excerpt.anchorId === node.sourceAnchorId
              ? {
                  ...excerpt,
                  tags: updates.tags,
                  updatedAt: now
                }
              : excerpt
          )
        )
        setBookmarks((current) =>
          current.map((bookmark) =>
            bookmark.sourceAnchorId === node.sourceAnchorId
              ? {
                  ...bookmark,
                  tags: updates.tags,
                  updatedAt: now
                }
              : bookmark
          )
        )
      }
    }
  }

  function removeNodeAndCleanup(nodeId: string) {
    const node = canvasNodes.find((entry) => entry.id === nodeId)
    if (!node) {
      return
    }

    const remainingNodes = canvasNodes.filter((entry) => entry.id !== nodeId)
    const remainingEdges = canvasEdges.filter((edge) => edge.targetNodeId !== nodeId)
    const remainingWorkspaceLinks = workspaceLinks.filter((link) => link.fromNodeId !== nodeId && link.toNodeId !== nodeId)
    const remainingBookmarks = bookmarks
    const shouldRemoveExcerpt = node.kind === 'excerpt' && node.excerptId
      ? !remainingNodes.some((entry) => entry.excerptId === node.excerptId)
      : false
    const remainingExcerpts = shouldRemoveExcerpt
      ? excerpts.filter((excerpt) => excerpt.id !== node.excerptId)
      : excerpts
    const shouldRemoveAnchor = node.sourceAnchorId
      ? !remainingNodes.some((entry) => entry.sourceAnchorId === node.sourceAnchorId) &&
        !remainingBookmarks.some((bookmark) => bookmark.sourceAnchorId === node.sourceAnchorId) &&
        !remainingExcerpts.some((excerpt) => excerpt.anchorId === node.sourceAnchorId)
      : false
    const remainingAnchors = shouldRemoveAnchor
      ? anchors.filter((anchor) => anchor.id !== node.sourceAnchorId)
      : anchors

    setCanvasNodes(remainingNodes)
    setCanvasEdges(remainingEdges)
    setWorkspaceLinks(remainingWorkspaceLinks)
    if (shouldRemoveExcerpt) {
      setExcerpts(remainingExcerpts)
    }
    if (shouldRemoveAnchor) {
      setAnchors(remainingAnchors)
    }

    if (activeNodeId === nodeId) {
      setActiveNodeId(null)
    }
    if (node.sourceAnchorId && (shouldRemoveAnchor || activeAnchorId === node.sourceAnchorId)) {
      setActiveAnchorId(null)
    }
    setActiveEdgeId((current) => {
      if (!current) {
        return current
      }
      return remainingEdges.some((edge) => edge.id === current) ? current : null
    })
  }

  function removeExcerptByAnchorId(anchorId: string) {
    const nodesToRemove = canvasNodes.filter((entry) => entry.kind === 'excerpt' && entry.sourceAnchorId === anchorId)
    if (nodesToRemove.length === 0) {
      return
    }

    const nodeIdsToRemove = new Set(nodesToRemove.map((node) => node.id))
    const excerptIdsToConsider = new Set(nodesToRemove.map((node) => node.excerptId).filter(Boolean) as string[])
    const remainingNodes = canvasNodes.filter((entry) => !nodeIdsToRemove.has(entry.id))
    const remainingEdges = canvasEdges.filter((edge) => !nodeIdsToRemove.has(edge.targetNodeId))
    const remainingWorkspaceLinks = workspaceLinks.filter(
      (link) => !nodeIdsToRemove.has(link.fromNodeId) && !nodeIdsToRemove.has(link.toNodeId)
    )

    const excerptIdsToRemove = new Set<string>()
    excerptIdsToConsider.forEach((excerptId) => {
      if (!remainingNodes.some((entry) => entry.excerptId === excerptId)) {
        excerptIdsToRemove.add(excerptId)
      }
    })

    const remainingExcerpts = excerptIdsToRemove.size
      ? excerpts.filter((excerpt) => !excerptIdsToRemove.has(excerpt.id))
      : excerpts

    const shouldRemoveAnchor =
      !remainingNodes.some((entry) => entry.sourceAnchorId === anchorId) &&
      !bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchorId) &&
      !remainingExcerpts.some((excerpt) => excerpt.anchorId === anchorId)

    const remainingAnchors = shouldRemoveAnchor ? anchors.filter((anchor) => anchor.id !== anchorId) : anchors

    setCanvasNodes(remainingNodes)
    setCanvasEdges(remainingEdges)
    setWorkspaceLinks(remainingWorkspaceLinks)
    if (excerptIdsToRemove.size) {
      setExcerpts(remainingExcerpts)
    }
    if (shouldRemoveAnchor) {
      setAnchors(remainingAnchors)
    }

    if (activeNodeId && nodeIdsToRemove.has(activeNodeId)) {
      setActiveNodeId(null)
    }
    if (activeAnchorId === anchorId) {
      setActiveAnchorId(null)
    }
    setActiveEdgeId((current) => {
      if (!current) {
        return current
      }
      return remainingEdges.some((edge) => edge.id === current) ? current : null
    })
  }

  function removeHighlightByAnchorId(anchorId: string) {
    const nodesToRemove = canvasNodes.filter((entry) => entry.sourceAnchorId === anchorId)
    const nodeIdsToRemove = new Set(nodesToRemove.map((node) => node.id))
    const excerptIdsToConsider = new Set(nodesToRemove.map((node) => node.excerptId).filter(Boolean) as string[])

    const remainingNodes = canvasNodes.filter((entry) => entry.sourceAnchorId !== anchorId)
    const remainingEdges = canvasEdges.filter((edge) => !nodeIdsToRemove.has(edge.targetNodeId))
    const remainingWorkspaceLinks = workspaceLinks.filter(
      (link) => !nodeIdsToRemove.has(link.fromNodeId) && !nodeIdsToRemove.has(link.toNodeId)
    )

    const excerptIdsToRemove = new Set<string>()
    excerptIdsToConsider.forEach((excerptId) => {
      if (!remainingNodes.some((entry) => entry.excerptId === excerptId)) {
        excerptIdsToRemove.add(excerptId)
      }
    })

    const remainingExcerpts = excerptIdsToRemove.size
      ? excerpts.filter((excerpt) => excerpt.anchorId !== anchorId && !excerptIdsToRemove.has(excerpt.id))
      : excerpts.filter((excerpt) => excerpt.anchorId !== anchorId)

    const remainingBookmarks = bookmarks.filter((bookmark) => bookmark.sourceAnchorId !== anchorId)
    const remainingAnchors = anchors.filter((anchor) => anchor.id !== anchorId)

    setCanvasNodes(remainingNodes)
    setCanvasEdges(remainingEdges)
    setWorkspaceLinks(remainingWorkspaceLinks)
    setBookmarks(remainingBookmarks)
    setAnchors(remainingAnchors)
    setExcerpts(remainingExcerpts)

    if (activeAnchorId === anchorId) {
      setActiveAnchorId(null)
    }
    if (activeNodeId && nodeIdsToRemove.has(activeNodeId)) {
      setActiveNodeId(null)
    }
    setActiveEdgeId((current) => {
      if (!current) {
        return current
      }
      return remainingEdges.some((edge) => edge.id === current) ? current : null
    })
  }

  function normalizeSelectionText(input: string) {
    return input.replace(/\s+/g, ' ').trim().toLowerCase()
  }

  function removeHighlightsByAnchorIds(anchorIds: string[]) {
    const idsToRemove = new Set(anchorIds)
    if (idsToRemove.size === 0) {
      return
    }

    const nodesToRemove = canvasNodes.filter((entry) => entry.sourceAnchorId && idsToRemove.has(entry.sourceAnchorId))
    const nodeIdsToRemove = new Set(nodesToRemove.map((node) => node.id))

    const remainingNodes = canvasNodes.filter((entry) => !(entry.sourceAnchorId && idsToRemove.has(entry.sourceAnchorId)))
    const remainingEdges = canvasEdges.filter(
      (edge) => !idsToRemove.has(edge.sourceAnchorId) && !nodeIdsToRemove.has(edge.targetNodeId)
    )
    const remainingWorkspaceLinks = workspaceLinks.filter(
      (link) => !nodeIdsToRemove.has(link.fromNodeId) && !nodeIdsToRemove.has(link.toNodeId)
    )
    const remainingBookmarks = bookmarks.filter((bookmark) => !idsToRemove.has(bookmark.sourceAnchorId))
    const remainingAnchors = anchors.filter((anchor) => !idsToRemove.has(anchor.id))
    const remainingExcerpts = excerpts.filter((excerpt) => !idsToRemove.has(excerpt.anchorId))

    setCanvasNodes(remainingNodes)
    setCanvasEdges(remainingEdges)
    setWorkspaceLinks(remainingWorkspaceLinks)
    setBookmarks(remainingBookmarks)
    setAnchors(remainingAnchors)
    setExcerpts(remainingExcerpts)

    if (activeAnchorId && idsToRemove.has(activeAnchorId)) {
      setActiveAnchorId(null)
    }
    if (activeNodeId && nodeIdsToRemove.has(activeNodeId)) {
      setActiveNodeId(null)
    }
    setActiveEdgeId((current) => {
      if (!current) {
        return current
      }
      return remainingEdges.some((edge) => edge.id === current) ? current : null
    })
  }

  function removeHighlightBySelectionIdentity(selection: SelectionArtifactInput, fallbackAnchorId: string) {
    const normalizedText = normalizeSelectionText(selection.text)
    const matches = anchors.filter((anchor) => {
      if (anchor.documentId !== selection.documentId) return false
      if (anchor.pageNumber !== selection.pageNumber) return false
      if ((anchor.startSpanIndex ?? null) !== (selection.startSpanIndex ?? null)) return false
      if ((anchor.startOffset ?? null) !== (selection.startOffset ?? null)) return false
      if ((anchor.endSpanIndex ?? null) !== (selection.endSpanIndex ?? null)) return false
      if ((anchor.endOffset ?? null) !== (selection.endOffset ?? null)) return false
      return normalizeSelectionText(anchor.textQuote) === normalizedText
    })

    const ids = new Set<string>([fallbackAnchorId, ...matches.map((a) => a.id)])
    removeHighlightsByAnchorIds(Array.from(ids))
  }

  const clearFocusAll = () => {
    focusBoth(null, null, null)
  }

  function resolveAnchorColor(anchorId: string) {
    return (
      canvasNodes.find((node) => node.sourceAnchorId === anchorId)?.selectionColor ??
      excerpts.find((excerpt) => excerpt.anchorId === anchorId)?.selectionColor ??
      bookmarks.find((bookmark) => bookmark.sourceAnchorId === anchorId)?.selectionColor ??
      anchors.find((anchor) => anchor.id === anchorId)?.selectionColor ??
      '#5d5df6'
    )
  }

  const highlightedAnchors = useMemo(
    () =>
      anchors.map((anchor) => ({
        anchorId: anchor.id,
        pageNumber: anchor.pageNumber,
        boundingBox: anchor.boundingBox,
        quadPoints: anchor.quadPoints,
        viewportScale: anchor.viewportScale,
        selectionColor: resolveAnchorColor(anchor.id),
        tags: anchor.tags
      })),
    [anchors, bookmarks, canvasNodes, excerpts]
  )

  const anchorNodeIds = useMemo(() => {
    const grouped = new Map<string, string[]>()
    canvasNodes.forEach((node) => {
      if (!node.sourceAnchorId) {
        return
      }

      const bucket = grouped.get(node.sourceAnchorId) ?? []
      bucket.push(node.id)
      grouped.set(node.sourceAnchorId, bucket)
    })
    return grouped
  }, [canvasNodes])
  const resolvePreferredNodeIdForAnchor = useMemo(() => {
    return (anchorId: string, explicitNodeId?: string | null) => {
      const nodeIds = anchorNodeIds.get(anchorId) ?? []
      if (explicitNodeId && nodeIds.includes(explicitNodeId)) {
        return explicitNodeId
      }

      if (activeNodeId && nodeIds.includes(activeNodeId)) {
        return activeNodeId
      }

      if (nodeIds.length === 1) {
        return nodeIds[0]
      }

      return null
    }
  }, [activeNodeId, anchorNodeIds])
  const activeNode = useMemo(
    () => canvasNodes.find((node) => node.id === activeNodeId) ?? null,
    [activeNodeId, canvasNodes]
  )
  const activeToolbarPosition = useMemo(() => {
    if (!activeNode || !workspaceRect) {
      return { left: 18, top: 18 }
    }

    const toolbarWidth = 980
    const toolbarHeight = 60
    const preferredLeft = activeNode.x + activeNode.width / 2 - toolbarWidth / 2
    const preferredTop = activeNode.y - toolbarHeight - 12

    return {
      left: Math.max(18, Math.min(preferredLeft, Math.max(18, workspaceRect.width - toolbarWidth - 18))),
      top: Math.max(18, preferredTop)
    }
  }, [activeNode, workspaceRect])

  return (
    <main ref={shellRef} className="workspace-shell">
      <header className="workspace-header">
        <div>
          <div className="split-title">Document Intelligence Workspace</div>
          <strong>Selection → action popup → workspace node → linked navigation</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="document-button"
            type="button"
            onClick={() => setNotesOpen((current) => !current)}
          >
            {notesOpen ? 'Hide Notes' : 'Notes'}
          </button>
          <div className="split-title">PDF.js • draggable workspace • SVG link layer</div>
        </div>
      </header>

      <section ref={documentPaneRef} className="workspace-panel document-pane">
        <PdfViewer
          shellRef={shellRef}
          workspaceId={WORKSPACE_ID}
          documentState={documentState}
          anchors={anchors}
          highlightedAnchors={highlightedAnchors}
          bookmarks={bookmarks}
          excerptNodes={canvasNodes
            .filter((n) => n.kind === 'excerpt' && n.sourceAnchorId)
            .map((n) => ({
              id: n.id,
              sourceAnchorId: n.sourceAnchorId!,
              title: n.title ?? 'Excerpt',
              text: n.text ?? '',
              selectionColor: n.selectionColor ?? '#ffd400',
              tags: n.tags ?? []
            }))}
          activeSourceFocus={
            activeAnchorId
              ? {
                  anchorId: activeAnchorId,
                  selectionColor: resolveAnchorColor(activeAnchorId),
                  jumpKey: activeAnchorJumpKey
                }
              : null
          }
          onDocumentImported={(nextDocument) => {
            setDocumentState(nextDocument)
            setAnchors([])
            setExcerpts([])
            setBookmarks([])
            setCanvasNodes([])
            setCanvasEdges([])
            setActiveAnchorId(null)
            setActiveNodeId(null)
          }}
          onAutoExcerpt={({ selection, viewportRatio }) => {
            const { anchor, excerpt } = upsertAnchorAndExcerpt(selection)
            createExcerptNode(excerpt, anchor, viewportRatio)
          }}
          onComment={({ selection, viewportRatio }) => {
            const { anchor, excerpt } = upsertAnchorAndExcerpt(selection)
            createCommentNode(excerpt, anchor, viewportRatio)
          }}
          onBookmark={(selection) => {
            const anchor = buildPageAnchor(selection)
            const isAlreadyBookmarked = bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id)
            if (isAlreadyBookmarked) {
              setBookmarks((current) => current.filter((bookmark) => bookmark.sourceAnchorId !== anchor.id))
              if (activeAnchorId === anchor.id) {
                setActiveAnchorId(null)
              }
              return
            }

            const nextOrder =
              bookmarks.reduce((max, bookmark) => Math.max(max, bookmark.documentOrder), 0) + 1
            const bookmark = buildBookmark(selection, nextOrder)
            setAnchors((current) => upsertById(current, anchor))
            setBookmarks((current) => upsertById(current, bookmark))
            setActiveAnchorId(anchor.id)
            const linkedNodeId = resolvePreferredNodeIdForAnchor(anchor.id)
            setActiveNodeId(linkedNodeId)
          }}
          onRemoveExcerpt={(anchorId) => {
            removeExcerptByAnchorId(anchorId)
          }}
          onRemoveHighlight={({ anchorId, selection }) => {
            removeHighlightBySelectionIdentity(selection, anchorId)
          }}
          onTag={tagSelection}
          onSelectionChange={recolorSelection}
          onOpenAnchor={(anchorId) => {
            focusBoth(anchorId, resolvePreferredNodeIdForAnchor(anchorId))
          }}
          onAnchorMetricsChange={setAnchorMetrics}
          onClearFocus={clearFocusAll}
        />
      </section>

      <section ref={workspacePaneRef} className="workspace-panel workspace-pane">
        <WorkspaceCanvas
          paneRef={workspacePaneRef}
          canvasNodes={canvasNodes}
          activeNodeId={activeNodeId}
          workspaceLinks={workspaceLinks}
          onCanvasNodesChange={setCanvasNodes}
          onCreateWorkspaceLink={(fromNodeId, toNodeId) => {
            setWorkspaceLinks((current) => {
              if (current.some((link) => link.fromNodeId === fromNodeId && link.toNodeId === toNodeId)) {
                return current
              }

              return [...current, buildWorkspaceNodeLink(fromNodeId, toNodeId)]
            })
          }}
          onOpenWorkspaceLink={(link) => {
            setActiveNodeId(link.toNodeId)
          }}
          onDropSelection={({ excerpt, anchor, x, y }) => {
            setAnchors((current) => upsertById(current, anchor))
            setExcerpts((current) => upsertById(current, excerpt))
            createExcerptNode(excerpt, anchor, y / Math.max(1, workspaceRect?.height ?? 720), x, y)
          }}
          onOpenAnchor={(anchorId, preferredNodeId) => {
            focusBoth(anchorId, resolvePreferredNodeIdForAnchor(anchorId, preferredNodeId))
          }}
          onFocusNode={setActiveNodeId}
          onClearSelection={() => {
            focusBoth(null, null, null)
          }}
        />
        <WorkspaceTextToolbar
          node={activeNode}
          left={activeToolbarPosition.left}
          top={activeToolbarPosition.top}
          onStyleChange={(stylePatch) => {
            if (!activeNodeId) {
              return
            }

            setCanvasNodes((current) =>
              current.map((node) =>
                node.id === activeNodeId
                  ? {
                      ...node,
                      textStyle: {
                        ...defaultTextStyle,
                        ...(node.textStyle ?? {}),
                        ...stylePatch
                      },
                      updatedAt: new Date().toISOString()
                    }
                  : node
              )
            )
          }}
          onColorChange={(color) => {
            if (!activeNodeId) {
              return
            }
            applyNodeLinkedUpdates(activeNodeId, { selectionColor: color })
          }}
          onCopy={() => {
            if (activeNode?.text) {
              void navigator.clipboard.writeText(activeNode.text)
            }
          }}
          onCut={() => {
            if (!activeNodeId) {
              return
            }

            if (activeNode?.text) {
              void navigator.clipboard.writeText(activeNode.text)
            }
            removeNodeAndCleanup(activeNodeId)
          }}
          onCopyLink={() => {
            if (!activeNode?.sourceAnchorId || !documentState) {
              return
            }

            const anchor = anchorIndex.get(activeNode.sourceAnchorId)
            if (!anchor) {
              return
            }

            void navigator.clipboard.writeText(buildAnchorLink(WORKSPACE_ID, documentState.record.id, anchor))
          }}
          onDelete={() => {
            if (!activeNodeId) {
              return
            }
            removeNodeAndCleanup(activeNodeId)
          }}
          onPromoteChild={() => {
            if (!activeNode) {
              return
            }

            const now = new Date().toISOString()
            const duplicatedNode: CanvasNode = {
              ...activeNode,
              id: `${activeNode.id}-child-${Date.now()}`,
              title: `Child · ${activeNode.title ?? 'Node'}`,
              x: activeNode.x + 36,
              y: activeNode.y + 36,
              createdAt: now,
              updatedAt: now
            }

            setCanvasNodes((current) => [...current, duplicatedNode])
            if (duplicatedNode.sourceAnchorId) {
              ensureEdge(duplicatedNode.sourceAnchorId, duplicatedNode.id, 'child', 'auto', duplicatedNode.selectionColor)
            }
            setActiveNodeId(duplicatedNode.id)
          }}
          onComment={() => {
            if (!activeNode?.sourceAnchorId) {
              return
            }

            const anchor = anchorIndex.get(activeNode.sourceAnchorId)
            if (!anchor) {
              return
            }

            const relatedExcerpt = activeNode.excerptId ? excerptIndex.get(activeNode.excerptId) : null
            if (!relatedExcerpt) {
              return
            }

            createCommentNode(relatedExcerpt, anchor, activeNode.y / Math.max(1, workspaceRect?.height ?? 720))
          }}
          onEdit={() => {
            if (activeNodeId) {
              setActiveNodeId(activeNodeId)
            }
          }}
          onTagsChange={(tags) => {
            if (!activeNodeId) {
              return
            }
            applyNodeLinkedUpdates(activeNodeId, { tags })
          }}
        />
      </section>

      <LinkLayer
        shellRect={shellRect}
        workspaceRect={workspaceRect}
        documentPaneRect={documentPaneRect}
        anchorMetrics={anchorMetrics}
        nodes={canvasNodes}
        edges={canvasEdges}
        activeAnchorId={activeAnchorId}
        activeEdgeId={activeEdgeId}
      />

      {notesOpen ? (
        <aside className="workspace-notes-overlay">
          <NoteEditor
            note={activeNote}
            excerpts={Array.from(excerptIndex.values())}
            onNoteChange={setActiveNote}
          />
        </aside>
      ) : null}
    </main>
  )
}
