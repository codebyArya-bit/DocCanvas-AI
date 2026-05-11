'use client'

import { useEffect, useRef } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { initPdfJsOnce, isExpectedPdfCancellation } from '../../lib/pdf-loader'

interface PdfCanvasPageProps {
  page: PDFPageProxy
  pageNumber: number
  zoom: number
}

type PdfTextLayerTaskLike = {
  render: () => Promise<void>
  cancel?: () => void
}

export function PdfCanvasPage({ page, pageNumber, zoom }: PdfCanvasPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null)
  const textLayerTaskRef = useRef<PdfTextLayerTaskLike | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const layer = layerRef.current
    const textLayerElement = textLayerRef.current
    if (!canvas || !layer || !textLayerElement || !page) return

    let cancelled = false

    const renderPage = async () => {
      try {
        const pdfjs = await initPdfJsOnce()
        if (cancelled) return

        const viewport = page.getViewport({ scale: zoom })
        const context = canvas.getContext('2d')
        if (!context) return

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
    }
  }, [page, pageNumber, zoom])

  return (
    <div ref={layerRef} className="page mobile-pdf-page-layer pdf-canvas-page" data-page-number={pageNumber} data-viewport-scale={zoom}>
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
      <div ref={textLayerRef} className="textLayer mobile-pdf-text-layer" data-main-rotation="0" />
    </div>
  )
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
