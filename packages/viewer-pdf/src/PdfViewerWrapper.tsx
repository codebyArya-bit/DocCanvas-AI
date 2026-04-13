import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Assume pdf worker is assigned at shell level
import { TextSelectionService } from './TextSelectionService';
import { TextAnchor, Highlight } from '@workspace/domain';

export interface PdfViewerProps {
  documentId: string;
  blobUrl: string;
  onSelectionCaptured: (anchor: TextAnchor) => void;
  highlights: Highlight[]; // Synced via Yjs from above
  onHighlightClicked: (highlightId: string) => void; // For bidirectional nav
}

export const PdfViewerWrapper: React.FC<PdfViewerProps> = ({
  documentId,
  blobUrl,
  onSelectionCaptured,
  highlights,
  onHighlightClicked
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);

  // Initialize PDF
  useEffect(() => {
    let active = true;
    const loadingTask = pdfjsLib.getDocument(blobUrl);
    
    loadingTask.promise.then(doc => {
      if (active) {
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      }
    });

    return () => {
      active = false;
      loadingTask.destroy();
    };
  }, [blobUrl]);

  // Global mouseup listener to capture selections ANYWHERE in this viewer
  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    
    // We must find which specific PDF page the selection occurred inside
    const targetElement = e.target as HTMLElement;
    const pageContainer = targetElement.closest('.pdf-page-container') as HTMLElement;
    
    if (!pageContainer) return;
    
    const pageIndexStr = pageContainer.getAttribute('data-page-index');
    if (!pageIndexStr) return;
    const pageIndex = parseInt(pageIndexStr, 10);

    const anchor = TextSelectionService.captureSelection(documentId, pageContainer, pageIndex);
    
    if (anchor) {
      onSelectionCaptured(anchor);
      // At this exact UI slice, the Drag Handle UI should be manifested.
      // E.g., setting local state to show an "Extract Excerpt" tooltip box
    }
  }, [documentId, onSelectionCaptured]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('mouseup', handleMouseUp);
      return () => container.removeEventListener('mouseup', handleMouseUp);
    }
  }, [handleMouseUp]);

  return (
    <div ref={containerRef} className="pdf-viewer-scroll-area relative w-full h-full overflow-y-auto bg-gray-100">
      {/* 
        For production, we map through a virtualized list of pages. 
        Here we instantiate dummy page containers so the anchoring math proves its exact logic.
      */}
      {Array.from({ length: Math.min(numPages, 10) }).map((_, i) => (
        <div 
          key={i} 
          className="pdf-page-container relative my-4 mx-auto bg-white shadow-md border border-gray-300"
          data-page-index={i}
          style={{ width: '800px', height: '1130px' }} // Proportional A4
        >
          {/* 1. pdf.js Canvas rendering layer (omitted for brevity, handled via react-pdf typically) */}
          <canvas className="absolute inset-0 w-full h-full pointer-events-none" />
          
          {/* 2. pdf.js Text Layer for real selection (transparent text matched to canvas) */}
          <div className="pdf-text-layer absolute inset-0 w-full h-full selection:bg-blue-300/40">
            {/* Native DOM text elements go here */}
          </div>

          {/* 3. The Highlight Overlay Layer */}
          <div className="pdf-highlight-layer absolute inset-0 w-full h-full pointer-events-none">
            {highlights
              .filter(h => h.anchor.pageIndex === i)
              .map(h => (
                <React.Fragment key={h.id}>
                  {h.anchor.rects.map((rect, idx) => (
                    <div
                      key={`${h.id}-${idx}`}
                      onClick={() => onHighlightClicked(h.id)}
                      className="hover:ring hover:ring-blue-500 cursor-pointer transition-shadow"
                      style={TextSelectionService.deserializeToStyles(rect)}
                    />
                  ))}
                </React.Fragment>
              ))
            }
          </div>
        </div>
      ))}
    </div>
  );
};
