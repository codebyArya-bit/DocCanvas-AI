import React from 'react';
import { HTMLContainer, ShapeUtil, TLBaseShape, BaseBoxShapeUtil } from 'tldraw';
import { Excerpt, Highlight } from '@workspace/domain';

// Define the custom Excerpt Shape internal to tldraw's type system
export type ExcerptShape = TLBaseShape<'excerpt', {
  w: number;
  h: number;
  excerptId: string;
  previewText: string;
}>;

export class ExcerptShapeUtil extends BaseBoxShapeUtil<ExcerptShape> {
  static override type = 'excerpt' as const;

  override getDefaultProps(): ExcerptShape['props'] {
    return {
      w: 300,
      h: 100,
      excerptId: '',
      previewText: 'Loading excerpt...'
    };
  }

  // Double click fires the bidirectional sync event
  override onDoubleClick(shape: ExcerptShape) {
    // Dispatch a custom window event that the AppShell/PDFWrapper listens to
    const event = new CustomEvent('NAVIGATE_TO_ANCHOR', {
      detail: { excerptId: shape.props.excerptId }
    });
    window.dispatchEvent(event);
  }

  override component(shape: ExcerptShape) {
    return (
      <HTMLContainer className="border rounded-md shadow-sm bg-white overflow-hidden pointer-events-auto">
        <div className="flex flex-col h-full">
          <div className="bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 border-b border-amber-200 flex justify-between items-center">
            <span>Excerpt</span>
            {/* The source connection button visual */}
            <span className="text-amber-600 opacity-50 hover:opacity-100 cursor-pointer transition-opacity" title="Source Linked">
               🔗
            </span>
          </div>
          <div className="p-3 text-sm text-gray-800 flex-grow select-text overflow-y-auto">
            {shape.props.previewText}
          </div>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: ExcerptShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
