'use client'

import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PdfLoadingTaskLike = {
  promise: Promise<PDFDocumentProxy>
  destroy?: () => Promise<void> | void
}

type PdfJsModuleLike = {
  version: string
  GlobalWorkerOptions: { workerSrc: string }
  Util: {
    transform: (left: number[], right: number[]) => number[]
  }
  getDocument: (params: { data: Uint8Array; disableWorker?: boolean }) => PdfLoadingTaskLike
  TextLayer: new (params: { textContentSource: unknown; container: HTMLElement; viewport: unknown }) => {
    render: () => Promise<void>
    cancel?: () => void
  }
}

declare global {
  interface Window {
    __docuMindPdfJsInitialized?: boolean
    __docuMindPdfCancellationHandlersInstalled?: boolean
  }
}

let pdfModulePromise: Promise<PdfJsModuleLike> | null = null

export function isExpectedPdfCancellation(error: unknown) {
  const errorRecord = typeof error === 'object' && error !== null ? (error as { name?: unknown; message?: unknown }) : null
  const name = typeof errorRecord?.name === 'string' ? errorRecord.name : ''
  const message = typeof errorRecord?.message === 'string' ? errorRecord.message : ''
  const text = `${name} ${message} ${String(error)}`.toLowerCase()
  return (
    name === 'RenderingCancelledException' ||
    name === 'AbortException' ||
    text.includes('rendering cancelled') ||
    text.includes('rendering canceled') ||
    text.includes('abortexception')
  )
}

function installPdfCancellationGuards() {
  if (typeof window === 'undefined' || window.__docuMindPdfCancellationHandlersInstalled) {
    return
  }

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      if (isExpectedPdfCancellation(event.reason)) {
        event.preventDefault()
      }
    },
    { capture: true }
  )

  window.addEventListener(
    'error',
    (event) => {
      if (isExpectedPdfCancellation(event.error) || isExpectedPdfCancellation(event.message)) {
        event.preventDefault()
      }
    },
    { capture: true }
  )

  window.__docuMindPdfCancellationHandlersInstalled = true
}

export async function initPdfJsOnce(): Promise<PdfJsModuleLike> {
  installPdfCancellationGuards()

  if (!pdfModulePromise) {
    pdfModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJsModuleLike>
  }

  const pdfjs = await pdfModulePromise
  if (typeof window !== 'undefined' && !window.__docuMindPdfJsInitialized) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`
    window.__docuMindPdfJsInitialized = true
  }

  return pdfjs
}

export function normalizePdfBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes)
}

export async function destroyPdfTask(task: PdfLoadingTaskLike | null | undefined) {
  try {
    await task?.destroy?.()
  } catch (error) {
    if (isExpectedPdfCancellation(error)) {
      return
    }
    throw error
  }
}

export async function openPdfDocument(bytes: Uint8Array) {
  const pdfjs = await initPdfJsOnce()
  const viewerBytes = normalizePdfBytes(bytes)
  let task: PdfLoadingTaskLike | null = null

  try {
    task = pdfjs.getDocument({ data: viewerBytes })
    const document = await task.promise
    return { task, document }
  } catch (firstError) {
    await destroyPdfTask(task)
    task = null
    try {
      task = pdfjs.getDocument({ data: normalizePdfBytes(bytes), disableWorker: true })
      const document = await task.promise
      return { task, document }
    } catch (fallbackError) {
      await destroyPdfTask(task)
      if (isExpectedPdfCancellation(firstError) || isExpectedPdfCancellation(fallbackError)) {
        throw new Error('PDF import was interrupted. Try again.')
      }
      throw fallbackError
    }
  }
}
