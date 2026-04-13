import { Y } from 'yjs';
import { Editor, TLShapeId, TLArrowShape } from 'tldraw';
import { CanvasEdge } from '@workspace/domain';

/**
 * Service that observes tldraw operations and extracts semantic connections 
 * (arrows hooking nodes together) to synchronize them to the CRDT and backlink graph.
 */
export class LinkService {
  /**
   * Called whenever tldraw shapes change. We filter for Arrow shapes that have 
   * established a binding (arrowhead connected to a target shape).
   */
  static extractEdgesFromTldraw(ydoc: Y.Doc, editor: Editor) {
    const edgesMap = ydoc.getMap<CanvasEdge>('edges');
    
    // We get all shapes from the local tldraw store
    const shapes = editor.getCurrentPageShapes();
    const arrows = shapes.filter(s => s.type === 'arrow') as TLArrowShape[];

    ydoc.transact(() => {
      // Clear out disconnected edges or sync new ones
      arrows.forEach(arrow => {
        const startBinding = editor.getBindingsFromShape(arrow, 'arrow').find(b => b.props.terminal === 'start');
        const endBinding = editor.getBindingsFromShape(arrow, 'arrow').find(b => b.props.terminal === 'end');

        // Only valid if an arrow connects two nodes
        if (startBinding && endBinding) {
          const sourceId = startBinding.toId.replace('shape:', '');
          const targetId = endBinding.toId.replace('shape:', '');
          
          const edgeId = arrow.id.replace('shape:', '');
          
          edgesMap.set(edgeId, {
            id: edgeId,
            sourceNodeId: sourceId,
            targetNodeId: targetId,
            label: arrow.props.text // If the user typed text on the arrow
          });
        }
      });
      
      // We would also include cleanup logic here: if an edge exists in Yjs 
      // but the arrow was deleted or unbound in tldraw, map.delete(id).
    }, 'tldraw-edge-sync');
  }
}
