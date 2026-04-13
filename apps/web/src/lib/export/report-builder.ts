import type { Excerpt, Note } from '@workspace/domain'

export function buildMarkdownReport(notes: Note[], excerpts: Excerpt[]) {
  return [
    '# Workspace Report',
    '',
    '## Notes',
    ...notes.map((note) => `### ${note.title}`),
    '',
    '## Excerpts',
    ...excerpts.map((excerpt) => `- ${excerpt.extractedText}`)
  ].join('\n')
}
