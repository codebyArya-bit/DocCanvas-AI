'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface ExportNode {
  id: string
  kind: 'excerpt' | 'comment' | 'note' | 'text'
  title?: string
  text?: string
  tags?: string[]
  sourceAnchorId?: string
  selectionColor?: string
  nodeColor?: string
  x?: number
  y?: number
}

export interface ExportRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ExportAnnotation {
  id: string
  kind: 'excerpt' | 'comment' | 'bookmark' | 'note' | 'text'
  pageNumber: number
  text: string
  color: string
  tags?: string[]
  boundingBox: ExportRect
  quadPoints?: number[]
  viewportScale: number
}

export interface ExportData {
  documentTitle: string
  sourceDocument: {
    title: string
    pageCount: number
    mimeType: string
    bytes: Uint8Array
  } | null
  annotations: ExportAnnotation[]
  nodes: ExportNode[]
  links: Array<{ fromNodeId: string; toNodeId: string }>
}

export interface ExportOptions {
  inlineCitations: boolean
  fullCommentSources: boolean
  highlights: boolean
  marginComments: boolean
  workspaceComments: boolean
  workspaceExcerpts: boolean
  orientation: 'portrait' | 'landscape'
  pageSize: 'a4' | 'letter' | 'legal'
  format: 'pdf' | 'html' | 'docx' | 'xlsx' | 'ppt'
}

interface ExportModalProps {
  open: boolean
  data: ExportData
  onClose: () => void
  onCopyHtml: (html: string) => Promise<boolean>
}

interface ReportSection {
  id: string
  kind: ExportAnnotation['kind'] | ExportNode['kind']
  title: string
  pageNumber?: number
  color: string
  excerpt?: string
  bookmarkLabel?: string
  taggedText?: string
  comments: ExportNode[]
  tags: string[]
  sourceAnchorId?: string
  connectionCount: number
}

type PdfLoadingTaskLike = {
  promise: Promise<PdfDocumentLike>
  destroy?: () => Promise<void> | void
}

type PdfDocumentLike = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageLike>
  destroy?: () => Promise<void> | void
}

type PdfPageLike = {
  getViewport: (params: { scale: number }) => { width: number; height: number }
  render: (params: {
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
    intent?: string
  }) => { promise: Promise<void>; cancel: () => void }
}

type PdfJsModuleLike = {
  version: string
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (params: { data: Uint8Array; disableWorker?: boolean }) => PdfLoadingTaskLike
}

type JsPdfDocumentLike = {
  addImage: (imageData: HTMLCanvasElement | string, format: string, x: number, y: number, width: number, height: number) => void
  addPage: (format?: string | [number, number], orientation?: 'portrait' | 'landscape') => void
  deletePage: (targetPage: number) => void
  getNumberOfPages: () => number
  save: (filename: string) => void
  setDrawColor: (r: number, g: number, b: number) => void
  setFillColor: (r: number, g: number, b: number) => void
  setFont: (fontName: string, fontStyle?: string) => void
  setFontSize: (fontSize: number) => void
  setTextColor: (r: number, g: number, b: number) => void
  splitTextToSize: (text: string, maxWidth: number) => string[]
  text: (text: string | string[], x: number, y: number) => void
  rect: (x: number, y: number, width: number, height: number, style?: string) => void
  circle: (x: number, y: number, radius: number, style?: string) => void
  internal: {
    pageSize: {
      getWidth: () => number
      getHeight: () => number
    }
  }
}

type JsPdfConstructor = new (options: { orientation: 'portrait' | 'landscape'; unit: 'pt'; format: 'a4' | 'letter' | 'legal' }) => JsPdfDocumentLike

let pdfModulePromise: Promise<PdfJsModuleLike> | null = null
let pdfModuleConfigured = false

async function loadPdfModule() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJsModuleLike>
  }

  const pdfjs = await pdfModulePromise
  if (!pdfModuleConfigured) {
    pdfModuleConfigured = true
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`
  }

  return pdfjs
}

const defaultOptions: ExportOptions = {
  inlineCitations: true,
  fullCommentSources: false,
  highlights: true,
  marginComments: true,
  workspaceComments: true,
  workspaceExcerpts: true,
  orientation: 'portrait',
  pageSize: 'a4',
  format: 'pdf'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function shouldRenderNode(node: ExportNode, options: ExportOptions) {
  if (node.kind === 'comment') return options.workspaceComments
  if (node.kind === 'excerpt') return options.workspaceExcerpts
  return true
}

function nodeColor(node?: ExportNode, fallback = '#4268a5') {
  return node?.nodeColor ?? node?.selectionColor ?? fallback
}

function uniqueTags(...tagGroups: Array<string[] | undefined>) {
  return Array.from(new Set(tagGroups.flatMap((tags) => tags ?? []).filter(Boolean)))
}

function titleFromTags(tags: string[], fallback: string) {
  if (tags.length === 0) return fallback
  return tags
    .slice(0, 2)
    .map((tag) =>
      tag
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    )
    .join(' / ')
}

export function formatTags(tags: string[]) {
  const normalized = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
  return normalized.length ? `Tags: ${normalized.map((tag) => `#${tag}`).join(' ')}` : ''
}

function normalizeExportText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function compareExportNodeReadingOrder(a: ExportNode, b: ExportNode) {
  if (typeof a.y === 'number' && typeof b.y === 'number' && a.y !== b.y) {
    return a.y - b.y
  }
  if (typeof a.x === 'number' && typeof b.x === 'number' && a.x !== b.x) {
    return a.x - b.x
  }
  return a.id.localeCompare(b.id)
}

export function mergeExcerptNodeText(nodes: ExportNode[]) {
  return normalizeExportText(
    nodes
      .slice()
      .sort(compareExportNodeReadingOrder)
      .map((node) => node.text ?? '')
      .filter(Boolean)
      .join(' ')
  )
}

export function getAnnotationRects(annotation: ExportAnnotation): ExportRect[] {
  if (!annotation.quadPoints || annotation.quadPoints.length < 8) {
    return [annotation.boundingBox]
  }

  const rects: ExportRect[] = []
  for (let index = 0; index < annotation.quadPoints.length; index += 8) {
    const quad = annotation.quadPoints.slice(index, index + 8)
    if (quad.length < 8) {
      continue
    }

    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const right = Math.max(...xs)
    const bottom = Math.max(...ys)
    const width = right - left
    const height = bottom - top
    if (width > 0 && height > 0) {
      rects.push({ x: left, y: top, width, height })
    }
  }

  return rects.length > 0 ? rects : [annotation.boundingBox]
}

export function getAnnotationUnionRect(annotation: ExportAnnotation): ExportRect {
  const rects = getAnnotationRects(annotation)
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

export function buildReportSections(data: ExportData, options: ExportOptions): ReportSection[] {
  const nodes = data.nodes.filter((node) => shouldRenderNode(node, options))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const commentIdsByAnchor = new Map<string, Set<string>>()
  const usedNodeIds = new Set<string>()

  nodes.forEach((node) => {
    if (node.kind === 'comment' && node.sourceAnchorId) {
      const bucket = commentIdsByAnchor.get(node.sourceAnchorId) ?? new Set<string>()
      bucket.add(node.id)
      commentIdsByAnchor.set(node.sourceAnchorId, bucket)
    }
  })

  data.links.forEach((link) => {
    const from = nodeById.get(link.fromNodeId)
    const to = nodeById.get(link.toNodeId)
    if (!from || !to) return

    const excerpt = from.kind === 'excerpt' ? from : to.kind === 'excerpt' ? to : null
    const comment = from.kind === 'comment' ? from : to.kind === 'comment' ? to : null
    if (!excerpt?.sourceAnchorId || !comment) return

    const bucket = commentIdsByAnchor.get(excerpt.sourceAnchorId) ?? new Set<string>()
    bucket.add(comment.id)
    commentIdsByAnchor.set(excerpt.sourceAnchorId, bucket)
  })

  const sections: ReportSection[] = data.annotations
    .slice()
    .sort((a, b) => {
      const aRect = getAnnotationUnionRect(a)
      const bRect = getAnnotationUnionRect(b)
      return a.pageNumber - b.pageNumber || aRect.y - bRect.y || aRect.x - bRect.x
    })
    .map((annotation, index) => {
      const excerptNodes = nodes.filter((node) => node.kind === 'excerpt' && node.sourceAnchorId === annotation.id)
      const primaryExcerpt = excerptNodes[0]
      const mergedExcerpt = mergeExcerptNodeText(excerptNodes)
      excerptNodes.forEach((node) => usedNodeIds.add(node.id))

      const comments = Array.from(commentIdsByAnchor.get(annotation.id) ?? [])
        .map((id) => nodeById.get(id))
        .filter((node): node is ExportNode => Boolean(node))
      comments.forEach((node) => usedNodeIds.add(node.id))

      const tags = uniqueTags(annotation.tags, primaryExcerpt?.tags, ...comments.map((comment) => comment.tags))
      const taggedText =
        annotation.kind === 'text' && tags.length > 0 ? normalizeExportText(annotation.text) : ''
      const sectionNodeIds = new Set([...excerptNodes.map((node) => node.id), ...comments.map((node) => node.id)])
      const connectionCount = data.links.filter((link) => sectionNodeIds.has(link.fromNodeId) || sectionNodeIds.has(link.toNodeId)).length

      return {
        id: annotation.id,
        kind: annotation.kind,
        title: titleFromTags(
          tags,
          annotation.kind === 'bookmark'
            ? `Bookmark ${index + 1}`
            : annotation.kind === 'comment'
              ? `Comment ${index + 1}`
              : `Insight ${index + 1}`
        ),
        pageNumber: annotation.pageNumber,
        color: annotation.color,
        ...(annotation.kind === 'excerpt' ? { excerpt: mergedExcerpt || normalizeExportText(annotation.text) } : {}),
        ...(annotation.kind === 'bookmark' ? { bookmarkLabel: normalizeExportText(annotation.text) || 'Bookmarked source' } : {}),
        ...(taggedText ? { taggedText } : {}),
        comments,
        tags,
        sourceAnchorId: annotation.id,
        connectionCount
      }
    })

  nodes.forEach((node) => {
    if (usedNodeIds.has(node.id)) return
    if (node.kind === 'comment' && !options.workspaceComments) return
    if (node.kind === 'excerpt' && !options.workspaceExcerpts) return

    sections.push({
      id: node.id,
      kind: node.kind,
      title: node.title || titleFromTags(node.tags ?? [], node.kind === 'comment' ? 'Workspace Comment' : 'Workspace Note'),
      color: nodeColor(node),
      ...(node.kind === 'comment' || !node.text ? {} : { excerpt: node.text }),
      comments: node.kind === 'comment' ? [node] : [],
      tags: node.tags ?? [],
      ...(node.sourceAnchorId ? { sourceAnchorId: node.sourceAnchorId } : {}),
      connectionCount: data.links.filter((link) => link.fromNodeId === node.id || link.toNodeId === node.id).length
    })
    usedNodeIds.add(node.id)
  })

  return sections
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function renderNotesHtml(data: ExportData, options: ExportOptions) {
  const blocks = renderReportSectionsHtml(data, options)
  return wrapExportHtml(`My Research Notes - ${data.documentTitle}`, blocks || '<p>No workspace content selected for export.</p>', options)
}

function renderReportSectionsHtml(data: ExportData, options: ExportOptions) {
  const sections = buildReportSections(data, options)
  return sections
    .map((section, index) => {
      const tagText = formatTags(section.tags)
      const tags = tagText ? `<div class="tags">${escapeHtml(tagText)}</div>` : ''
      const citation = options.inlineCitations && section.pageNumber ? ` <sup>Page ${section.pageNumber}</sup>` : ''
      const source = options.fullCommentSources && section.sourceAnchorId ? `<div class="source">Source: ${escapeHtml(section.sourceAnchorId)}</div>` : ''
      const excerpt = section.excerpt
        ? `<div class="report-label">Excerpt${section.pageNumber ? ` · Page ${section.pageNumber}` : ''}</div><blockquote>${escapeHtml(section.excerpt)}</blockquote>`
        : ''
      const bookmark = section.bookmarkLabel
        ? `<div class="report-bookmark"><span aria-hidden="true"></span>${escapeHtml(section.bookmarkLabel)}</div>`
        : ''
      const taggedText = section.taggedText
        ? `<div class="report-tagged-text"><strong>Tagged text</strong><p>${escapeHtml(section.taggedText)}</p></div>`
        : ''
      const comments = section.comments.length
        ? `<div class="report-comments">${section.comments
            .map((comment) => `<div class="report-comment"><strong>Comment</strong><p>${escapeHtml(comment.text || 'Untitled comment')}</p></div>`)
            .join('')}</div>`
        : ''
      const connections = section.connectionCount ? `<div class="source">${section.connectionCount} related connection${section.connectionCount === 1 ? '' : 's'}</div>` : ''

      return `<section class="report-section" style="--section-color:${escapeHtml(section.color)}">
  <h2>${index + 1}. ${escapeHtml(section.title)}${citation}</h2>
  ${excerpt}
  ${bookmark}
  ${taggedText}
  ${comments}
  ${tags}
  ${connections}
  ${source}
</section>`
    })
    .join('\n')
}

function wrapExportHtml(title: string, content: string, options: ExportOptions) {
  const pageSize = options.pageSize === 'a4' ? 'A4' : options.pageSize === 'letter' ? 'Letter' : 'Legal'
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page{size:${pageSize} ${options.orientation};margin:16mm}
    body{font-family:Segoe UI,system-ui,sans-serif;margin:32px;color:#1f1b16;background:#fffaf2}
    h1{font-size:22px;margin:0 0 20px}
    .export-block{border-left:5px solid #4268a5;border-radius:8px;background:#fff;padding:14px 16px;margin:0 0 14px;box-shadow:0 8px 22px rgba(34,44,70,.08)}
    .report-section{break-inside:avoid;page-break-inside:avoid;border-top:1px solid #c7c7c7;padding:14px 0 18px}
    .report-section h2{color:#174da3;font-size:16px;margin:0 0 8px}
    .report-label{margin:8px 0 4px;color:#1f1b16;font-size:12px;font-weight:700}
    .report-section blockquote{margin:0;border:1px solid color-mix(in srgb,var(--section-color) 55%,#ddd);background:color-mix(in srgb,var(--section-color) 13%,white);padding:10px 12px;line-height:1.45}
    .report-bookmark{display:flex;align-items:center;gap:8px;margin-top:8px;color:#33445d;font-size:13px;line-height:1.4}
    .report-bookmark span{width:9px;height:9px;border-radius:999px;background:var(--section-color);box-shadow:0 0 0 2px #fff}
    .report-tagged-text{margin-top:8px;color:#1f1b16}
    .report-tagged-text strong{display:block;margin-bottom:3px;color:#33445d;font-size:12px}
    .report-comments{display:grid;gap:8px;margin-top:10px}
    .report-comment{border:1px solid #b8dbb6;background:#f2fff0;padding:8px 10px}
    .report-comment strong{display:block;color:#1f7a24;font-size:12px;margin-bottom:3px}
    .kind{text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:#5f5548}
    h2{font-size:16px;margin:4px 0 8px}
    p{margin:0;line-height:1.55}
    .tags{margin-top:10px;color:#33445d;font-size:12px;line-height:1.45}
    .source{font-size:12px;color:#5f5548;margin-top:10px}
    #export-root{display:grid;gap:18px;margin-top:18px}
    .combined-source-pages{display:grid;gap:18px}
    .combined-report-pages{break-before:page;page-break-before:always;margin-top:22px}
    .export-page{break-inside:avoid;page-break-inside:avoid}
    .export-page-title{font-size:12px;font-weight:700;color:#5f5548;margin:0 0 6px}
    .export-page-surface{position:relative;width:720px;max-width:100%;aspect-ratio:var(--page-aspect,0.77);background:linear-gradient(180deg,#fff,#f8f8f8);border:1px solid #d9ccb2;box-shadow:0 10px 26px rgba(34,44,70,.12);overflow:hidden}
    .export-pdf-page-image{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}
    .export-page-placeholder{position:absolute;inset:20px;border:1px dashed #d9ccb2;border-radius:8px;display:grid;place-items:center;color:#7a6d5c;font-size:13px;text-align:center;padding:18px}
    .export-annotation-overlay{position:absolute;border:2px solid var(--annotation-color);background:color-mix(in srgb,var(--annotation-color) 34%,transparent);border-radius:5px}
    .export-annotation-overlay.is-bookmark{width:0!important;height:0!important;border:0;background:transparent}
    .export-bookmark-marker{position:absolute;left:-10px;top:50%;width:8px;height:8px;border-radius:999px;background:var(--annotation-color);box-shadow:0 0 0 2px #fff;transform:translateY(-50%)}
    .export-annotation-label{position:absolute;left:0;top:100%;max-width:260px;margin-top:4px;padding:5px 7px;border-radius:6px;background:#fff;color:#1f1b16;font-size:10px;box-shadow:0 4px 12px rgba(34,44,70,.18)}
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${content}
</body>
</html>`
}

function getDocumentPageNumbers(data: ExportData) {
  const pageCount = data.sourceDocument?.pageCount ?? 0
  const maxAnnotationPage = data.annotations.reduce((max, annotation) => Math.max(max, annotation.pageNumber), 0)
  const count = Math.max(pageCount, maxAnnotationPage, 1)
  return Array.from({ length: count }, (_, index) => index + 1)
}

function getPageBounds(annotations: ExportAnnotation[]) {
  const rects = annotations.flatMap(getAnnotationRects)
  const maxX = rects.reduce((max, rect) => Math.max(max, rect.x + rect.width), 612)
  const maxY = rects.reduce((max, rect) => Math.max(max, rect.y + rect.height), 792)
  return {
    width: Math.max(612, maxX + 24),
    height: Math.max(792, maxY + 24)
  }
}

function getAnnotationRectPercentStyle(rect: ExportRect, bounds: { width: number; height: number }) {
  return {
    left: `${(rect.x / bounds.width) * 100}%`,
    top: `${(rect.y / bounds.height) * 100}%`,
    width: `${(rect.width / bounds.width) * 100}%`,
    height: `${(rect.height / bounds.height) * 100}%`
  }
}

function waitForBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}

function hexToRgb(color: string, fallback: [number, number, number] = [66, 104, 165]): [number, number, number] {
  const normalized = color.trim().replace('#', '')
  const value =
    normalized.length === 3
      ? normalized.split('').map((part) => part + part).join('')
      : normalized

  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return fallback
  }

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ]
}

function mixWithWhite(rgb: [number, number, number], amount = 0.86): [number, number, number] {
  return [
    Math.round(rgb[0] * (1 - amount) + 255 * amount),
    Math.round(rgb[1] * (1 - amount) + 255 * amount),
    Math.round(rgb[2] * (1 - amount) + 255 * amount)
  ]
}

export function drawSourceAnnotations(
  context: CanvasRenderingContext2D,
  annotations: ExportAnnotation[],
  viewportScale: number,
  options: ExportOptions
) {
  if (!options.highlights && !options.marginComments) return

  annotations.forEach((annotation) => {
    const ratio = viewportScale / (annotation.viewportScale || viewportScale)
    const rects = getAnnotationRects(annotation).map((rect) => ({
      x: rect.x * ratio,
      y: rect.y * ratio,
      width: rect.width * ratio,
      height: rect.height * ratio
    }))
    const unionLeft = Math.min(...rects.map((rect) => rect.x))
    const unionBottom = Math.max(...rects.map((rect) => rect.y + rect.height))
    const [r, g, b] = hexToRgb(annotation.color)
    const isBookmark = annotation.kind === 'bookmark'

    if (options.highlights && annotation.kind === 'excerpt') {
      context.save()
      context.globalAlpha = 0.26
      context.fillStyle = `rgb(${r}, ${g}, ${b})`
      rects.forEach((rect) => context.fillRect(rect.x, rect.y, rect.width, rect.height))
      context.globalAlpha = 0.78
      context.strokeStyle = `rgb(${r}, ${g}, ${b})`
      context.lineWidth = 2
      rects.forEach((rect) => context.strokeRect(rect.x, rect.y, rect.width, rect.height))
      context.restore()
    }

    if (isBookmark) {
      const firstRect = rects.slice().sort((left, right) => left.y - right.y || left.x - right.x)[0]
      if (firstRect) {
        context.save()
        context.fillStyle = `rgb(${r}, ${g}, ${b})`
        context.beginPath()
        context.arc(Math.max(6, firstRect.x - 8), firstRect.y + firstRect.height / 2, 4, 0, Math.PI * 2)
        context.fill()
        context.restore()
      }
    }

    if (options.marginComments && annotation.text && annotation.kind === 'excerpt') {
      const label = annotation.text.length > 42 ? `${annotation.text.slice(0, 39)}...` : annotation.text
      context.save()
      context.font = '12px Segoe UI, sans-serif'
      const labelWidth = Math.min(Math.max(context.measureText(label).width + 12, 80), 260)
      const labelX = Math.min(unionLeft, context.canvas.width - labelWidth - 8)
      const labelY = Math.min(unionBottom + 6, context.canvas.height - 24)
      context.fillStyle = 'rgba(255,255,255,0.94)'
      context.fillRect(labelX, labelY, labelWidth, 20)
      context.strokeStyle = `rgb(${r}, ${g}, ${b})`
      context.strokeRect(labelX, labelY, labelWidth, 20)
      context.fillStyle = '#1f1b16'
      context.fillText(label, labelX + 6, labelY + 14)
      context.restore()
    }
  })
}

async function renderSourcePageCanvas(
  pdfDocument: PdfDocumentLike,
  pageNumber: number,
  annotations: ExportAnnotation[],
  options: ExportOptions
) {
  const page = await pdfDocument.getPage(pageNumber)
  const viewportScale = 1.25
  const viewport = page.getViewport({ scale: viewportScale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas rendering is not available.')
  }

  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: context, viewport }).promise
  drawSourceAnnotations(context, annotations, viewportScale, options)
  return canvas
}

function addCanvasPageToPdf(pdf: JsPdfDocumentLike, canvas: HTMLCanvasElement, options: ExportOptions, addNewPage: boolean) {
  if (addNewPage) {
    pdf.addPage(options.pageSize, options.orientation)
  }

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 24
  const maxWidth = pageWidth - margin * 2
  const maxHeight = pageHeight - margin * 2
  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height)
  const width = canvas.width * scale
  const height = canvas.height * scale
  const x = (pageWidth - width) / 2
  const y = (pageHeight - height) / 2

  pdf.addImage(canvas, 'PNG', x, y, width, height)
}

function writeWrappedText(
  pdf: JsPdfDocumentLike,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const lines = pdf.splitTextToSize(text, maxWidth)
  pdf.text(lines, x, y)
  return y + lines.length * lineHeight
}

async function addReportPagesToPdf(
  pdf: JsPdfDocumentLike,
  sections: ReportSection[],
  data: ExportData,
  options: ExportOptions,
  onSectionComplete: () => void,
  addNewPage = true
) {
  if (addNewPage) {
    pdf.addPage(options.pageSize, options.orientation)
  }

  const margin = 48
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const contentWidth = pageWidth - margin * 2
  const bottom = pageHeight - margin
  let y = margin

  const addPageIfNeeded = (requiredHeight: number) => {
    if (y + requiredHeight <= bottom) return
    pdf.addPage(options.pageSize, options.orientation)
    y = margin
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(22)
  pdf.setTextColor(31, 27, 22)
  pdf.text('My Research Notes', margin, y)
  y += 18
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(95, 85, 72)
  pdf.text(data.documentTitle, margin, y)
  y += 24

  if (sections.length === 0) {
    pdf.setTextColor(95, 85, 72)
    pdf.setFontSize(12)
    pdf.text('No workspace content selected for export.', margin, y)
    onSectionComplete()
    await waitForBrowser()
    return
  }

  for (const [index, section] of sections.entries()) {
    addPageIfNeeded(96)
    const accent = hexToRgb(section.color)
    const fill = mixWithWhite(accent)

    pdf.setDrawColor(199, 199, 199)
    pdf.rect(margin, y, contentWidth, 0.5, 'S')
    y += 16

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.setTextColor(23, 77, 163)
    y = writeWrappedText(pdf, `${index + 1}. ${section.title}${section.pageNumber ? ` (Page ${section.pageNumber})` : ''}`, margin, y, contentWidth, 16)
    y += 6

    if (section.excerpt) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(31, 27, 22)
      pdf.text(`Excerpt${section.pageNumber ? ` · Page ${section.pageNumber}` : ''}`, margin, y)
      y += 10

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      const excerptLines = pdf.splitTextToSize(section.excerpt, contentWidth - 18)
      const excerptHeight = excerptLines.length * 12 + 16
      addPageIfNeeded(excerptHeight + 12)
      pdf.setFillColor(...fill)
      pdf.setDrawColor(...accent)
      pdf.rect(margin, y, contentWidth, excerptHeight, 'FD')
      pdf.setTextColor(31, 27, 22)
      pdf.text(excerptLines, margin + 9, y + 14)
      y += excerptHeight + 10
    }

    if (section.bookmarkLabel) {
      const bookmarkLines = pdf.splitTextToSize(section.bookmarkLabel, contentWidth - 18)
      const bookmarkHeight = bookmarkLines.length * 12 + 8
      addPageIfNeeded(bookmarkHeight + 8)
      pdf.setFillColor(...accent)
      pdf.circle(margin + 4, y + 6, 4, 'F')
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.setTextColor(51, 68, 93)
      pdf.text(bookmarkLines, margin + 14, y + 9)
      y += bookmarkHeight + 8
    }

    if (section.taggedText) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(51, 68, 93)
      pdf.text('Tagged text', margin, y)
      y += 10

      const taggedLines = pdf.splitTextToSize(section.taggedText, contentWidth)
      addPageIfNeeded(taggedLines.length * 12 + 8)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.setTextColor(31, 27, 22)
      pdf.text(taggedLines, margin, y)
      y += taggedLines.length * 12 + 8
    }

    for (const comment of section.comments) {
      const commentText = comment.text || 'Untitled comment'
      const commentLines = pdf.splitTextToSize(commentText, contentWidth - 18)
      const commentHeight = commentLines.length * 12 + 22
      addPageIfNeeded(commentHeight + 8)
      pdf.setFillColor(242, 255, 240)
      pdf.setDrawColor(184, 219, 182)
      pdf.rect(margin, y, contentWidth, commentHeight, 'FD')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(31, 122, 36)
      pdf.text('Comment', margin + 9, y + 12)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.setTextColor(31, 27, 22)
      pdf.text(commentLines, margin + 9, y + 26)
      y += commentHeight + 8
    }

    const tagText = formatTags(section.tags)
    if (tagText) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(51, 68, 93)
      y = writeWrappedText(pdf, tagText, margin, y, contentWidth, 11)
      y += 8
    }

    if (section.connectionCount) {
      const connectionText = `${section.connectionCount} related connection${section.connectionCount === 1 ? '' : 's'}`
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(95, 85, 72)
      y = writeWrappedText(pdf, connectionText, margin, y, contentWidth, 11)
      y += 8
    }

    onSectionComplete()
    await waitForBrowser()
  }
}

async function exportCombinedPdf(
  data: ExportData,
  options: ExportOptions,
  sections: ReportSection[],
  onProgress: (current: number, total: number) => void
) {
  if (!data.sourceDocument) {
    throw new Error('No source PDF is loaded.')
  }

  const [{ jsPDF }, pdfjs] = await Promise.all([
    import('jspdf') as unknown as Promise<{ jsPDF: JsPdfConstructor }>,
    loadPdfModule()
  ])
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'pt', format: options.pageSize })
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data.sourceDocument.bytes), disableWorker: true })
  const pdfDocument = await loadingTask.promise
  const pageCount = data.sourceDocument.pageCount || pdfDocument.numPages
  const totalSteps = pageCount + Math.max(sections.length, 1)
  let currentStep = 0

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const annotations = data.annotations.filter((annotation) => annotation.pageNumber === pageNumber)
      const canvas = await renderSourcePageCanvas(pdfDocument, pageNumber, annotations, options)
      addCanvasPageToPdf(pdf, canvas, options, pageNumber > 1)
      canvas.width = 0
      canvas.height = 0
      currentStep += 1
      onProgress(currentStep, totalSteps)
      await waitForBrowser()
    }

    await addReportPagesToPdf(pdf, sections, data, options, () => {
      currentStep += 1
      onProgress(Math.min(currentStep, totalSteps), totalSteps)
    })

    while (pdf.getNumberOfPages() > pageCount + 1 && currentStep < totalSteps) {
      currentStep += 1
      onProgress(Math.min(currentStep, totalSteps), totalSteps)
    }

    pdf.save('combined-source-notes-export.pdf')
  } finally {
    void pdfDocument.destroy?.()
    void loadingTask.destroy?.()
  }
}

function renderCsv(data: ExportData) {
  const rows = [
    ['type', 'page', 'text', 'tags', 'sourceAnchorId'],
    ...data.annotations.map((annotation) => [
      annotation.kind,
      String(annotation.pageNumber),
      annotation.text,
      (annotation.tags ?? []).join(';'),
      annotation.id
    ]),
    ...data.nodes.map((node) => [
      node.kind,
      '',
      node.text ?? '',
      (node.tags ?? []).join(';'),
      node.sourceAnchorId ?? ''
    ])
  ]

  return rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\n')
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" className="export-toggle-row" onClick={onChange}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className={`export-toggle${checked ? ' is-on' : ''}`} aria-hidden="true" />
    </button>
  )
}

function SelectControl<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<{ label: string; value: T }>
  onChange: (value: T) => void
}) {
  return (
    <label className="export-select-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function PdfExportPage({
  bytes,
  pageNumber,
  onRendered
}: {
  bytes: Uint8Array | null
  pageNumber: number
  onRendered: (pageNumber: number, bounds: { width: number; height: number }) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bytes) {
      return
    }

    let cancelled = false
    let loadingTask: PdfLoadingTaskLike | null = null
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null

    const renderPage = async () => {
      const pdfjs = await loadPdfModule()
      const viewerBytes = new Uint8Array(bytes)
      loadingTask = pdfjs.getDocument({ data: viewerBytes, disableWorker: true })
      const document = await loadingTask.promise
      if (cancelled) return

      const page = await document.getPage(pageNumber)
      if (cancelled) return

      const viewport = page.getViewport({ scale: 1.35 })
      const context = canvas.getContext('2d')
      if (!context) return

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      renderTask = page.render({ canvasContext: context, viewport })
      await renderTask.promise
      if (!cancelled) {
        onRendered(pageNumber, { width: viewport.width, height: viewport.height })
      }
    }

    void renderPage().catch(() => {})

    return () => {
      cancelled = true
      try {
        renderTask?.cancel()
      } catch {}
      void loadingTask?.destroy?.()
    }
  }, [bytes, onRendered, pageNumber])

  if (!bytes) {
    return <div className="export-page-placeholder">No source PDF loaded.</div>
  }

  return <canvas ref={canvasRef} className="export-pdf-canvas" aria-label={`Source PDF page ${pageNumber}`} />
}

export function ExportModal({ open, data, onClose, onCopyHtml }: ExportModalProps) {
  const [options, setOptions] = useState<ExportOptions>(defaultOptions)
  const [mode, setMode] = useState<'notes' | 'document'>('document')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'blocked' | 'downloaded'>('idle')
  const [pageBounds, setPageBounds] = useState<Record<number, { width: number; height: number }>>({})
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null)

  const reportSections = useMemo(() => buildReportSections(data, options), [data, options])
  const documentPages = useMemo(() => getDocumentPageNumbers(data), [data])
  const pdfBytes = data.sourceDocument?.bytes ?? null
  const sourcePageCount = data.sourceDocument?.pageCount ?? 0
  const sourcePagesReady = sourcePageCount > 0 && documentPages.slice(0, sourcePageCount).every((pageNumber) => Boolean(pageBounds[pageNumber]))
  const reportHtml = useMemo(() => renderNotesHtml(data, options), [data, options])

  const handlePageRendered = (pageNumber: number, bounds: { width: number; height: number }) => {
    setPageBounds((current) =>
      current[pageNumber]?.width === bounds.width && current[pageNumber]?.height === bounds.height
        ? current
        : { ...current, [pageNumber]: bounds }
    )
  }

  const toggle = (key: keyof ExportOptions) => {
    setOptions((current) => ({ ...current, [key]: !current[key] }))
  }

  useEffect(() => {
    setPageBounds({})
    setExportProgress(null)
  }, [data.sourceDocument?.title, data.sourceDocument?.pageCount])

  const exportCurrentFormat = async () => {
    if (isExporting) {
      return
    }

    if (options.format === 'xlsx') {
      downloadBlob(new Blob([renderCsv(data)], { type: 'text/csv' }), 'workspace-export.csv')
      setCopyState('downloaded')
      return
    }

    if (options.format === 'docx') {
      downloadBlob(new Blob([reportHtml], { type: 'application/msword' }), 'workspace-export.doc')
      setCopyState('downloaded')
      return
    }

    if (options.format === 'ppt') {
      downloadBlob(new Blob([reportHtml], { type: 'application/vnd.ms-powerpoint' }), 'workspace-export.ppt')
      setCopyState('downloaded')
      return
    }

    if (options.format === 'pdf') {
      if (mode === 'document') {
        if (!data.sourceDocument || !sourcePagesReady) {
          setCopyState('blocked')
          return
        }

        setIsExporting(true)
        setCopyState('idle')
        setExportProgress({ current: 0, total: data.sourceDocument.pageCount + Math.max(reportSections.length, 1) })
        try {
          await exportCombinedPdf(data, options, reportSections, (current, total) => {
            setExportProgress({ current, total })
          })
          setCopyState('downloaded')
        } catch {
          setCopyState('blocked')
        } finally {
          setIsExporting(false)
        }
        return
      }

      // Notes Only Export
      setIsExporting(true)
      setCopyState('idle')
      const totalSteps = Math.max(reportSections.length, 1)
      setExportProgress({ current: 0, total: totalSteps })
      try {
        const [{ jsPDF }] = await Promise.all([
          import('jspdf') as unknown as Promise<{ jsPDF: JsPdfConstructor }>
        ])
        const pdf = new jsPDF({ orientation: options.orientation, unit: 'pt', format: options.pageSize })
        let currentStep = 0
        await addReportPagesToPdf(pdf, reportSections, data, options, () => {
          currentStep += 1
          setExportProgress({ current: Math.min(currentStep, totalSteps), total: totalSteps })
        }, false) // Do not add an initial page, use the default one created by jsPDF constructor
        
        pdf.save('research-notes.pdf')
        setCopyState('downloaded')
      } catch {
        setCopyState('blocked')
      } finally {
        setIsExporting(false)
      }
      return
    }

    downloadBlob(new Blob([reportHtml], { type: 'text/html' }), 'workspace-export.html')
    setCopyState('downloaded')
  }

  if (!open) return null

  return (
    <div className="export-modal-overlay" role="dialog" aria-modal="true" aria-label="Export workspace">
      <div className="export-modal">
        <header className="export-modal-header">
          <strong>Export Your Notes</strong>
          <button type="button" className="export-close-button" onClick={onClose} aria-label="Close export">
            x
          </button>
        </header>
        <div className="export-modal-body">
          <aside className="export-options">
            <div className="export-mode-tabs" role="tablist" aria-label="Export mode">
              <button type="button" className={mode === 'notes' ? 'is-active' : ''} onClick={() => setMode('notes')}>
                Notes Export
              </button>
              <button type="button" className={mode === 'document' ? 'is-active' : ''} onClick={() => setMode('document')}>
                Combined PDF
              </button>
            </div>
            <div className="export-option-section">
              <h3>Export Output</h3>
              <SelectControl
                label="Format"
                value={options.format}
                options={[
                  { label: 'PDF', value: 'pdf' },
                  { label: 'HTML', value: 'html' },
                  { label: 'Word', value: 'docx' },
                  { label: 'Excel', value: 'xlsx' },
                  { label: 'PowerPoint', value: 'ppt' }
                ]}
                onChange={(format) => setOptions((current) => ({ ...current, format }))}
              />
              <SelectControl
                label="Orientation"
                value={options.orientation}
                options={[
                  { label: 'Portrait', value: 'portrait' },
                  { label: 'Landscape', value: 'landscape' }
                ]}
                onChange={(orientation) => setOptions((current) => ({ ...current, orientation }))}
              />
              <SelectControl
                label="Page size"
                value={options.pageSize}
                options={[
                  { label: 'A4', value: 'a4' },
                  { label: 'Letter', value: 'letter' },
                  { label: 'Legal', value: 'legal' }
                ]}
                onChange={(pageSize) => setOptions((current) => ({ ...current, pageSize }))}
              />
            </div>
            <div className="export-option-section">
              <h3>General Options</h3>
              <Toggle label="Inline Citations" description="Add source anchor refs inline." checked={options.inlineCitations} onChange={() => toggle('inlineCitations')} />
              <Toggle label="Full Comment Sources" description="Append source references below blocks." checked={options.fullCommentSources} onChange={() => toggle('fullCommentSources')} />
            </div>
            <div className="export-option-section">
              <h3>Document Notes</h3>
              <Toggle label="Highlights" description="Show excerpt highlight styling." checked={options.highlights} onChange={() => toggle('highlights')} />
              <Toggle label="Margin Comments" description="Include document-side annotations." checked={options.marginComments} onChange={() => toggle('marginComments')} />
            </div>
            <div className="export-option-section">
              <h3>Workspace Notes</h3>
              <Toggle label="Comments" description="Add each workspace comment." checked={options.workspaceComments} onChange={() => toggle('workspaceComments')} />
              <Toggle label="Excerpts" description="Add each workspace excerpt." checked={options.workspaceExcerpts} onChange={() => toggle('workspaceExcerpts')} />
            </div>
          </aside>
          <section className="export-preview-shell">
            <div className="export-preview-notice">
              {mode === 'document'
                ? sourcePagesReady
                  ? 'Combined PDF preview exports source pages first, then My Research Notes.'
                  : 'Rendering source pages before PDF export is enabled.'
                : 'Notes preview updates from workspace data without changing the canvas.'}
            </div>
            {mode === 'document' ? (
              <div className="export-document-preview">
                <div id="export-root" className="export-root">
                  <div className="combined-source-pages">
                    {documentPages.map((pageNumber) => {
                      const pageAnnotations = data.annotations.filter((annotation) => annotation.pageNumber === pageNumber)
                      const bounds = pageBounds[pageNumber] ?? getPageBounds(pageAnnotations)
                      return (
                        <section key={pageNumber} className="export-page">
                          <div className="export-page-title">Source Page {pageNumber}</div>
                          <div className="export-page-surface" style={{ '--page-aspect': String(bounds.width / bounds.height) } as React.CSSProperties}>
                            <PdfExportPage bytes={pdfBytes} pageNumber={pageNumber} onRendered={handlePageRendered} />
                            {(options.highlights || options.marginComments)
                              ? pageAnnotations.flatMap((annotation) =>
                                  getAnnotationRects(annotation).map((rect, rectIndex) => {
                                    const style = getAnnotationRectPercentStyle(rect, bounds)
                                    const isBookmark = annotation.kind === 'bookmark'
                                    if (annotation.kind !== 'excerpt' && !isBookmark) {
                                      return []
                                    }
                                    if (isBookmark && rectIndex > 0) {
                                      return []
                                    }
                                    return (
                                      <div
                                        key={`${annotation.id}-${rectIndex}`}
                                        className={`export-annotation-overlay${isBookmark ? ' is-bookmark' : ''}`}
                                        style={{
                                          '--annotation-color': annotation.color,
                                          left: style.left,
                                          top: style.top,
                                          width: style.width,
                                          height: style.height
                                        } as React.CSSProperties}
                                      >
                                        {isBookmark ? <span className="export-bookmark-marker" /> : null}
                                        {options.marginComments && annotation.kind === 'excerpt' && rectIndex === 0 ? (
                                          <span className="export-annotation-label">{annotation.text || 'Annotation'}</span>
                                        ) : null}
                                      </div>
                                    )
                                  })
                                )
                              : null}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                  <section className="combined-report-pages export-preview">
                    <h2>My Research Notes</h2>
                    {reportSections.length === 0 ? (
                      <p className="export-preview-empty">No workspace content selected for export.</p>
                    ) : (
                      reportSections.map((section, index) => (
                        <article key={section.id} className="export-report-section" style={{ '--section-color': section.color } as React.CSSProperties}>
                          <h3>
                            {index + 1}. {section.title}
                          </h3>
                          {section.excerpt ? (
                            <>
                              <div className="export-report-label">Excerpt{section.pageNumber ? ` · Page ${section.pageNumber}` : ''}</div>
                              <blockquote>{section.excerpt}</blockquote>
                            </>
                          ) : null}
                          {section.bookmarkLabel ? (
                            <div className="export-report-bookmark">
                              <span aria-hidden="true" />
                              {section.bookmarkLabel}
                            </div>
                          ) : null}
                          {section.taggedText ? (
                            <div className="export-report-tagged-text">
                              <strong>Tagged text</strong>
                              <p>{section.taggedText}</p>
                            </div>
                          ) : null}
                          {section.comments.length ? (
                            <div className="export-report-comments">
                              {section.comments.map((comment) => (
                                <div key={comment.id} className="export-report-comment">
                                  <strong>Comment</strong>
                                  <p>{comment.text || 'Untitled comment'}</p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {section.tags.length ? (
                            <div className="export-preview-tags">{formatTags(section.tags)}</div>
                          ) : null}
                          {section.connectionCount ? (
                            <small className="export-preview-source">
                              {section.connectionCount} related connection{section.connectionCount === 1 ? '' : 's'}
                            </small>
                          ) : null}
                          {options.inlineCitations && section.pageNumber ? <small className="export-preview-source">Page {section.pageNumber}</small> : null}
                        </article>
                      ))
                    )}
                  </section>
                </div>
              </div>
            ) : (
              <div className="export-preview">
                <h2>My Research Notes</h2>
                {reportSections.length === 0 ? (
                  <p className="export-preview-empty">No workspace content selected for export.</p>
                ) : (
                  reportSections.map((section, index) => (
                    <article key={section.id} className="export-report-section" style={{ '--section-color': section.color } as React.CSSProperties}>
                      <h3>
                        {index + 1}. {section.title}
                      </h3>
                      {section.excerpt ? (
                        <>
                          <div className="export-report-label">Excerpt{section.pageNumber ? ` · Page ${section.pageNumber}` : ''}</div>
                          <blockquote>{section.excerpt}</blockquote>
                        </>
                      ) : null}
                      {section.bookmarkLabel ? (
                        <div className="export-report-bookmark">
                          <span aria-hidden="true" />
                          {section.bookmarkLabel}
                        </div>
                      ) : null}
                      {section.taggedText ? (
                        <div className="export-report-tagged-text">
                          <strong>Tagged text</strong>
                          <p>{section.taggedText}</p>
                        </div>
                      ) : null}
                      {section.comments.length ? (
                        <div className="export-report-comments">
                          {section.comments.map((comment) => (
                            <div key={comment.id} className="export-report-comment">
                              <strong>Comment</strong>
                              <p>{comment.text || 'Untitled comment'}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {section.tags.length ? (
                        <div className="export-preview-tags">{formatTags(section.tags)}</div>
                      ) : null}
                      {section.connectionCount ? (
                        <small className="export-preview-source">
                          {section.connectionCount} related connection{section.connectionCount === 1 ? '' : 's'}
                        </small>
                      ) : null}
                      {options.inlineCitations && section.pageNumber ? <small className="export-preview-source">Page {section.pageNumber}</small> : null}
                    </article>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
        <footer className="export-modal-footer">
          <span>
            {isExporting && exportProgress
              ? `Exporting ${exportProgress.current} / ${exportProgress.total}.`
              : copyState === 'copied'
              ? 'Copied HTML to clipboard.'
              : copyState === 'blocked'
                ? data.sourceDocument
                  ? 'Export failed or source pages are still rendering.'
                  : 'Load a source PDF before exporting PDF.'
                : copyState === 'downloaded'
                  ? 'Export action started.'
                  : ''}
          </span>
          <button type="button" className="document-button" onClick={async () => setCopyState((await onCopyHtml(reportHtml)) ? 'copied' : 'blocked')}>
            Copy to Clipboard
          </button>
          <button
            type="button"
            className="document-button"
            onClick={exportCurrentFormat}
            disabled={isExporting || (options.format === 'pdf' && !sourcePagesReady)}
            title={options.format === 'pdf' && !sourcePagesReady ? 'Source PDF pages are still rendering.' : undefined}
          >
            {isExporting && exportProgress ? `Exporting ${exportProgress.current} / ${exportProgress.total}` : `Export ${options.format.toUpperCase()}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
