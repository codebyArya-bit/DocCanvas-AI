import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';

/**
 * We extend the basic ProseMirror schema to include our `excerpt_reference`.
 * This prevents the Notes system from being a "static mockup". The notes are 
 * fundamentally aware of the exact workspace Excerpt they refer to.
 */
export const workspaceSchema = new Schema({
  nodes: basicSchema.spec.nodes.append({
    excerpt_reference: {
      inline: true,          // Excerpts drop directly in sentences
      group: 'inline',
      selectable: true,
      draggable: true,
      attrs: {
        excerptId: { default: '' },
        previewText: { default: 'Excerpt' }
      },
      // Determines how it converts to HTML for the actual React DOM view
      toDOM(node) {
        return [
          'span',
          {
            class: 'pm-excerpt-ref inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 cursor-pointer hover:bg-amber-200',
            'data-excerpt-id': node.attrs.excerptId,
            title: 'Double click to navigate to source',
          },
          ['span', { class: 'mr-1' }, '🔗'], // Link Visual
          ['span', { class: 'truncate max-w-xs' }, node.attrs.previewText]
        ];
      },
      // Re-hydrates from DOM pasted logic
      parseDOM: [{ 
        tag: 'span.pm-excerpt-ref', 
        getAttrs(dom) {
          return {
            excerptId: (dom as HTMLElement).getAttribute('data-excerpt-id') || '',
            previewText: (dom as HTMLElement).textContent?.replace('🔗', '').trim() || ''
          };
        }
      }]
    }
  }),
  marks: basicSchema.spec.marks
});
