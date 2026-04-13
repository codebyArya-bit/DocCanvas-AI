import React, { useEffect, useRef } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin, undo, redo } from 'y-prosemirror';
import { Y } from 'yjs';
import { workspaceSchema } from './ExcerptReferenceSchema';

interface ProseMirrorEditorProps {
  ydoc: Y.Doc;
}

export const ProseMirrorEditor: React.FC<ProseMirrorEditorProps> = ({ ydoc }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Get the shared XML fragment that represents the Notes
    const yXmlFragment = ydoc.getXmlFragment('prosemirror-notes');

    // 2. Initialize the CRDT backed state
    const state = EditorState.create({
      schema: workspaceSchema,
      plugins: [
        ySyncPlugin(yXmlFragment),
        yCursorPlugin(ydoc.awareness), // Requires awareness from WebRTC provider
        yUndoPlugin()
      ]
    });

    // 3. Mount the actual ProseMirror DOM view
    const view = new EditorView(containerRef.current, {
      state,
      handleDoubleClickOn: (view, pos, node, nodePos, event, direct) => {
        // Intercept double clicks on our custom node
        if (node.type.name === 'excerpt_reference') {
          const excerptId = node.attrs.excerptId;
          // Fire structural event mapped to the Bidirectional Nav Service
          window.dispatchEvent(new CustomEvent('NAVIGATE_TO_ANCHOR', {
            detail: { excerptId }
          }));
          return true; // We handled it
        }
        return false;
      }
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, [ydoc]);

  // Command binding for testing injection
  // In reality, this triggers when a Canvas excerpt is dragged into the ProseMirror box
  const injectExcerptTest = (excerptId: string, previewText: string) => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    const tr = view.state.tr;
    const node = workspaceSchema.nodes.excerpt_reference.create({ excerptId, previewText });
    tr.replaceSelectionWith(node);
    view.dispatch(tr);
  };

  return (
    <div className="flex flex-col h-full bg-white border border-gray-300 shadow-sm">
      <div className="p-2 bg-gray-50 border-b flex space-x-2 text-sm">
        <button className="px-2 py-1 bg-white border shadow-sm rounded hover:bg-gray-100" onClick={() => undo(viewRef.current!.state)}>Undo</button>
        <button className="px-2 py-1 bg-white border shadow-sm rounded hover:bg-gray-100" onClick={() => redo(viewRef.current!.state)}>Redo</button>
      </div>
      <div 
        ref={containerRef} 
        className="flex-grow p-6 outline-none overflow-y-auto prose prose-sm max-w-none" 
      />
    </div>
  );
};
