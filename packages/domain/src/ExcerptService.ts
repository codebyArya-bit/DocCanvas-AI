import { Y } from 'yjs'; // Assume yjs is available
import { v4 as uuidv4 } from 'uuid';
import { TextAnchor, Highlight, Excerpt, CanvasNode } from './models';

/**
 * Service orchestrating the transaction between a raw PDF text selection
 * and the creation of live, synchronized Excerpt nodes in the workspace.
 */
export class ExcerptService {
  /**
   * Called when a user highlights text in the PDF and drags it onto the Canvas.
   * This executes as a single atomic Yjs transaction.
   */
  static extractExcerptToCanvas(
    ydoc: Y.Doc,
    anchor: TextAnchor,
    userId: string,
    dropX: number,
    dropY: number
  ): string {
    const excerptId = uuidv4();
    const highlightId = excerptId; // 1:1 mapping for simplicity, or generate new

    // 1. We must execute this inside a single transaction so local state and remote peers
    // do not see a Highlight without an Excerpt, or vice versa.
    ydoc.transact(() => {
      
      const highlightsMap = ydoc.getMap<Highlight>('highlights');
      highlightsMap.set(highlightId, {
        id: highlightId,
        anchor,
        color: 'rgba(255, 226, 143, 0.4)',
        createdAt: Date.now(),
        userId
      });

      const excerptsMap = ydoc.getMap<Excerpt>('excerpts');
      excerptsMap.set(excerptId, {
        id: excerptId,
        highlightId: highlightId,
        previewText: anchor.selectedText
      });

      // 2. Instantiate the physical CanvasNode representation at the drop coordinates
      const nodesMap = ydoc.getMap<CanvasNode>('nodes');
      nodesMap.set(excerptId, {
        id: excerptId,
        type: 'excerpt',
        data: { excerptId }, // Foreign key back to the excerpt map
        x: dropX,
        y: dropY,
        width: 300,  // Default card width
        height: 100  // Default card height
      });

    }, 'user-extract-excerpt'); // Origin tag for history tracking

    return excerptId;
  }
}
