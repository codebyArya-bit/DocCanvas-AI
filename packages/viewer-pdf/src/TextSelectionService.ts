import { TextAnchor, BoundingRect } from '@workspace/domain';

/**
 * Service responsible for robustly translating raw DOM ranges into 
 * exact normalized PDF coordinates. Solves the "source anchoring vague" issue.
 */
export class TextSelectionService {
  /**
   * Captures the current user DOM selection and normalizes it against the PDF page geometry.
   * This is entirely dynamic.
   */
  static captureSelection(
    documentId: string, 
    pageContainer: HTMLElement, 
    pageIndex: number
  ): TextAnchor | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    
    // Ensure the selection is actually inside this PDF page container
    // This prevents capturing selections from Workspace Textboxes or other UI elements
    if (!pageContainer.contains(range.commonAncestorContainer)) {
      return null;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return null;

    // Get the exact bounding boxes of the selection relative to the viewport
    const clientRects = Array.from(range.getClientRects());
    
    // Get the page container bounds to calculate normalized metrics
    const pageBounds = pageContainer.getBoundingClientRect();
    
    const rects: BoundingRect[] = clientRects.map(rect => {
      // Convert absolute viewport pixels to normalized percentages [0-1] relative to the specific PDF page.
      // This ensures highlights stay perfectly anchored regardless of zoom, UI pan, or tablet vs desktop display.
      return {
        x: (rect.left - pageBounds.left) / pageBounds.width,
        y: (rect.top - pageBounds.top) / pageBounds.height,
        width: rect.width / pageBounds.width,
        height: rect.height / pageBounds.height,
      };
    });

    // Filter out degenerate rects (0 width/height) caused by weird line-breaks
    const validRects = rects.filter(r => r.width > 0 && r.height > 0);

    if (validRects.length === 0) return null;

    return {
      documentId,
      pageIndex,
      selectedText,
      rects: validRects
    };
  }
  
  /**
   * Translates a stored normalized TextAnchor back into CSS style attributes 
   * so absolute <div> overlays can be drawn perfectly over the PDF page.
   */
  static deserializeToStyles(rect: BoundingRect): React.CSSProperties {
    return {
      position: 'absolute',
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.width * 100}%`,
      height: `${rect.height * 100}%`,
      backgroundColor: 'rgba(255, 226, 143, 0.4)', // standard highlight
      mixBlendMode: 'multiply',
      pointerEvents: 'auto', // Needs to be clickable for bidirectional nav
    };
  }
}
