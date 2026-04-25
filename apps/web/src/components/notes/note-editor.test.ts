import assert from 'node:assert/strict'
import { mergeStoredMarks } from './note-editor'
import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

const schema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block'),
  marks: basicSchema.spec.marks.append({
    textColor: {
      attrs: { color: { default: '#1f1b16' } },
      toDOM: (mark) => ['span', { style: `color: ${mark.attrs.color}` }, 0]
    },
    textHighlight: {
      attrs: { color: { default: '#fff08a' } },
      toDOM: (mark) => ['span', { style: `background-color: ${mark.attrs.color}` }, 0]
    },
    fontSize: {
      attrs: { size: { default: '16px' } },
      toDOM: (mark) => ['span', { style: `font-size: ${mark.attrs.size}` }, 0]
    }
  })
})

const textColor = schema.marks.textColor.create({ color: '#ff0000' })
const oldTextColor = schema.marks.textColor.create({ color: '#1f1b16' })
const highlight = schema.marks.textHighlight.create({ color: '#00ff00' })
const fontSize = schema.marks.fontSize.create({ size: '24px' })

assert.deepEqual(mergeStoredMarks(null, textColor), [textColor])
assert.deepEqual(mergeStoredMarks([highlight, fontSize], textColor), [highlight, fontSize, textColor])
assert.deepEqual(mergeStoredMarks([oldTextColor, highlight, fontSize], textColor), [highlight, fontSize, textColor])
