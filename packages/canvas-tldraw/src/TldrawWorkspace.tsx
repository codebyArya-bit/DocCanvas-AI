import React, { useEffect, useState } from 'react';
import { Tldraw, useEditor } from 'tldraw';
import 'tldraw/tldraw.css';
import { ExcerptShapeUtil } from './ExcerptNode';
import { Y } from 'yjs'; // Assume standard yjs import
import { CanvasNode, Excerpt } from '@workspace/domain';

const customShapeUtils = [ExcerptShapeUtil];

export interface TldrawWorkspaceProps {
  ydoc: Y.Doc; // The central CRDT document
}

/**
 * An adapter component that transforms Yjs state changes into tldraw Canvas updates
 * and passes the custom shapes for rendering Excerpts.
 */
export const TldrawWorkspace: React.FC<TldrawWorkspaceProps> = ({ ydoc }) => {
  return (
    <div className="w-full h-full relative z-0">
      <Tldraw shapeUtils={customShapeUtils}>
        <WorkspaceAdapter ydoc={ydoc} />
      </Tldraw>
    </div>
  );
};

// Internal component to access the tldraw hook context
const WorkspaceAdapter: React.FC<{ ydoc: Y.Doc }> = ({ ydoc }) => {
  const editor = useEditor();

  useEffect(() => {
    // 1. Subscribe to Yjs changes injected from other modules (like the PDF extract dropping)
    const nodesMap = ydoc.getMap<CanvasNode>('nodes');
    const excerptsMap = ydoc.getMap<Excerpt>('excerpts');

    const handleNodesChange = () => {
      // Sync Y.map updates down into the tldraw local state store
      nodesMap.forEach((node, id) => {
        if (node.type === 'excerpt') {
          // Look up real excerpt data
          const excerpt = excerptsMap.get(node.data.excerptId);
          if (!excerpt) return;

          // Check if shape exists, if not create it
          const existingShape = editor.getShape(node.id as any);
          if (!existingShape) {
            editor.createShape({
              id: editor.createShapeId(node.id),
              type: 'excerpt',
              x: node.x,
              y: node.y,
              props: {
                w: node.width,
                h: node.height,
                excerptId: excerpt.id,
                previewText: excerpt.previewText,
              }
            });
          } else {
            // Update existing shape properties
            editor.updateShape({
              id: existingShape.id,
              props: {
                w: node.width,
                h: node.height,
                excerptId: excerpt.id,
                previewText: excerpt.previewText,
              }
            });
          }
        }
      });
    };

    nodesMap.observe(handleNodesChange);
    handleNodesChange(); // initial hydration

    // 2. Listen to editor changes and push updates back to Yjs
    const unsubscribe = editor.store.listen(() => {
      const updatedNodes = editor.getShapes().filter((shape) => shape.type === 'excerpt');
      updatedNodes.forEach((shape) => {
        const node = nodesMap.get(shape.id);
        if (node) {
          nodesMap.set(shape.id, {
            ...node,
            x: shape.x,
            y: shape.y,
            width: shape.props.w,
            height: shape.props.h,
          });
        }
      });
    });

    return () => {
      nodesMap.unobserve(handleNodesChange);
      unsubscribe();
    };
  }, [editor, ydoc]);

  return null; // Logic-only component
};
