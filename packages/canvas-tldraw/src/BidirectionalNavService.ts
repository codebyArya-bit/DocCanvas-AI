import { Y } from 'yjs';
import { Highlight, Excerpt } from '@workspace/domain';

/**
 * Service enabling Bidirectional PDF <-> Workspace Navigation
 */
export class BidirectionalNavService {
  /**
   * Translates an Excerpt ID request into instructions for the PDF Viewer
   * to immediately scroll to the target.
   */
  static handleNavigateToAnchor(ydoc: Y.Doc, excerptId: string) {
    const excerptsMap = ydoc.getMap<Excerpt>('excerpts');
    const highlightsMap = ydoc.getMap<Highlight>('highlights');

    const excerpt = excerptsMap.get(excerptId);
    if (!excerpt) {
        console.warn(`[NavService] Excerpt missing for id: ${excerptId}`);
        return;
    }

    const highlight = highlightsMap.get(excerpt.highlightId);
    if (!highlight) {
        console.warn(`[NavService] Highlight missing for excerpt: ${excerptId}`);
        return;
    }

    const anchor = highlight.anchor;
    
    // Dispatch system-wide event that the AppShell container captures.
    // The AppShell will verify `anchor.documentId` is open, swap tabs if needed,
    // and instruct the PdfViewerWrapper to scroll.
    const scrollEvent = new CustomEvent('DO_PDF_SCROLL', {
      detail: { 
        documentId: anchor.documentId,
        pageIndex: anchor.pageIndex,
        rects: anchor.rects
      }
    });
    
    window.dispatchEvent(scrollEvent);
    console.log(`[NavService] Fired DO_PDF_SCROLL for Doc ${anchor.documentId}, Page ${anchor.pageIndex}`);
  }
}
