'use client'

import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { initPdfJsOnce, isExpectedPdfCancellation } from '../../lib/pdf-loader'

interface PdfCanvasPageProps {
  document: PDFDocumentProxy
  pageNumber: number
  zoom: number
  rotation?: number
  rootRef?: RefObject<HTMLElement | null>
}

type PdfTextLayerTaskLike = {
  render: () => Promise<void>
  cancel?: () => void
}

const DEFAULT_PAGE_WIDTH = 612
const DEFAULT_PAGE_HEIGHT = 792

export function PdfCanvasPage({ document, pageNumber, zoom, rotation = 0, rootRef }: PdfCanvasPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null)
  const textLayerTaskRef = useRef<PdfTextLayerTaskLike | null>(null)
  const lastZoomRef = useRef(zoom)
  const [isVisible, setIsVisible] = useState(false)
  const [pageSize, setPageSize] = useState(() => ({
    width: DEFAULT_PAGE_WIDTH * zoom,
    height: DEFAULT_PAGE_HEIGHT * zoom
  }))

  useEffect(() => {
    const previousZoom = lastZoomRef.current
    lastZoomRef.current = zoom
    if (previousZoom <= 0 || previousZoom === zoom) return
    const ratio = zoom / previousZoom
    setPageSize((size) => ({
      width: size.width * ratio,
      height: size.height * ratio
    }))
  }, [zoom])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return

    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries.some((entry) => entry.isIntersecting))
      },
      {
        root: rootRef?.current ?? layer.closest('.mobile-pdf-pane'),
        rootMargin: '300px',
        threshold: 0.1
      }
    )

    observer.observe(layer)
    return () => observer.disconnect()
  }, [rootRef])

  useEffect(() => {
    const canvas = canvasRef.current
    const layer = layerRef.current
    const textLayerElement = textLayerRef.current
    if (!canvas || !layer || !textLayerElement || !isVisible) {
      clearRenderedPage(canvas, textLayerElement)
      return
    }

    let cancelled = false

    const renderPage = async () => {
      try {
        const pdfjs = await initPdfJsOnce()
        if (cancelled) return

        const page = await document.getPage(pageNumber)
        if (cancelled) return

        const viewport = page.getViewport({ scale: zoom, rotation })
        const context = canvas.getContext('2d')
        if (!context) return

        setPageSize({ width: viewport.width, height: viewport.height })
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        layer.style.width = `${viewport.width}px`
        layer.style.height = `${viewport.height}px`
        layer.dataset.pageNumber = String(pageNumber)
        layer.dataset.viewportScale = String(zoom)
        textLayerElement.style.width = `${viewport.width}px`
        textLayerElement.style.height = `${viewport.height}px`
        textLayerElement.style.setProperty('--total-scale-factor', String(zoom))
        textLayerElement.dataset.mainRotation = String(rotation)
        textLayerElement.textContent = ''

        if (renderTaskRef.current) {
          void renderTaskRef.current.promise.catch((error) => {
            if (!isExpectedPdfCancellation(error)) {
              console.error(`Failed to render PDF page ${pageNumber}:`, error)
            }
          })
          renderTaskRef.current.cancel()
        }
        if (textLayerTaskRef.current) {
          textLayerTaskRef.current.cancel?.()
          textLayerTaskRef.current = null
        }

        renderTaskRef.current = page.render({
          canvas,
          canvasContext: context,
          viewport: viewport
        })
        void renderTaskRef.current.promise.catch((error) => {
          if (!isExpectedPdfCancellation(error)) {
            console.error(`Failed to render PDF page ${pageNumber}:`, error)
          }
        })

        const textContent = await page.getTextContent()
        if (cancelled) return
        textLayerTaskRef.current = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerElement,
          viewport
        })
        await textLayerTaskRef.current.render()
        if (cancelled) return
        indexTextLayerSpans(textLayerElement, layer, textContent.items)

        await renderTaskRef.current.promise
        renderTaskRef.current = null
        textLayerTaskRef.current = null
      } catch (error) {
        if (isExpectedPdfCancellation(error)) {
          return
        }
        console.error(`Failed to render PDF page ${pageNumber}:`, error)
      }
    }

    renderPage()

    return () => {
      cancelled = true
      cancelRenderTasks(renderTaskRef, textLayerTaskRef, pageNumber)
      clearRenderedPage(canvas, textLayerElement)
    }
  }, [document, isVisible, pageNumber, zoom, rotation])

  return (
    <div
      ref={layerRef}
      className="page mobile-pdf-page-layer pdf-canvas-page"
      data-page-number={pageNumber}
      data-viewport-scale={zoom}
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      <canvas
        ref={canvasRef}
        className="pdf-page-canvas"
        data-page-number={pageNumber}
        style={{
          display: 'block',
          maxWidth: '100%',
          height: 'auto'
        }}
      />
      <div ref={textLayerRef} className="textLayer mobile-pdf-text-layer" data-main-rotation={rotation} />
    </div>
  )
}

function cancelRenderTasks(
  renderTaskRef: MutableRefObject<ReturnType<PDFPageProxy['render']> | null>,
  textLayerTaskRef: MutableRefObject<PdfTextLayerTaskLike | null>,
  pageNumber: number
) {
  if (renderTaskRef.current) {
    void renderTaskRef.current.promise.catch((error) => {
      if (!isExpectedPdfCancellation(error)) {
        console.error(`Failed to render PDF page ${pageNumber}:`, error)
      }
    })
    renderTaskRef.current.cancel()
    renderTaskRef.current = null
  }
  if (textLayerTaskRef.current) {
    textLayerTaskRef.current.cancel?.()
    textLayerTaskRef.current = null
  }
}

function clearRenderedPage(canvas: HTMLCanvasElement | null, textLayerElement: HTMLDivElement | null) {
  if (canvas) {
    const context = canvas.getContext('2d')
    context?.clearRect(0, 0, canvas.width, canvas.height)
    canvas.width = 0
    canvas.height = 0
  }
  if (textLayerElement) {
    textLayerElement.textContent = ''
    delete textLayerElement.dataset.textReady
  }
}

function indexTextLayerSpans(textLayerElement: HTMLElement, pageLayer: HTMLElement, textItems: unknown[]) {
  const spans = Array.from(textLayerElement.querySelectorAll<HTMLElement>('span[role="presentation"], span'))
  const layerRect = pageLayer.getBoundingClientRect()
  const appScale = pageLayer.offsetWidth > 0 ? layerRect.width / pageLayer.offsetWidth : 1
  let textIndex = 0

  spans.forEach((span) => {
    const text = span.textContent ?? ''
    if (!text.trim()) return
    const rect = span.getBoundingClientRect()
    span.dataset.textIndex = String(textIndex)
    span.dataset.textLength = String(text.length)
    span.dataset.pageX = String((rect.left - layerRect.left) / appScale)
    span.dataset.pageY = String((rect.top - layerRect.top) / appScale)
    span.dataset.pageWidth = String(rect.width / appScale)
    span.dataset.pageHeight = String(rect.height / appScale)
    textIndex += 1
  })

  textLayerElement.dataset.textReady = String(textIndex || textItems.length)
}
