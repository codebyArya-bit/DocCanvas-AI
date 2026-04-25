# Fix Textbox Toolbar Functionality Spec

## Why
The Textbox toolbar appears but has two persistent failures: (1) it disappears during native control usage (select, number input, color picker), and (2) formatting commands from toolbar buttons do not apply to the selected text. These block basic formatting in textboxes.

## What Changes
- Make the toolbar stay visible during the full lifecycle of native controls (selects, number inputs, color pickers).
- Ensure all toolbar formatting commands (Bold, Italic, Underline, Strikethrough, Bullet List, Ordered List, Paragraph, Heading 1/2, Font Family, Font Size, Text Color, Highlight Color) apply to the ProseMirror selection in the textbox.
- Preserve the "toolbar only appears in textbox edit mode" behavior.

## Impact
- Affected specs: Textbox editing toolbar reliability.
- Affected code:
  - `apps/web/src/components/workspace/WorkspaceSelectionToolbar.tsx` — toolbar interaction tracking and command dispatch
  - `apps/web/src/components/workspace/WorkspaceCanvas.tsx` — textbox session lifecycle and toolbar mount state
  - `apps/web/src/components/notes/note-editor.tsx` — ProseMirror command application and selection preservation

## ADDED Requirements

### Requirement: Toolbar Must Remain Visible During Native Control Interaction
The system SHALL keep the textbox toolbar visible while the user is interacting with any native toolbar control.

#### Scenario: Font family select is open
- **WHEN** the user clicks the font family dropdown and the dropdown is open
- **THEN** the toolbar remains visible
- **AND** the toolbar does not fade or disappear

#### Scenario: Font size number input is focused
- **WHEN** the user tabs or clicks into the font size number input
- **THEN** the toolbar remains visible

#### Scenario: Native color picker is open
- **WHEN** the user clicks Text Color or Highlight Color and the OS/browser color picker is open
- **THEN** the toolbar remains visible

#### Scenario: User finishes interacting with control
- **WHEN** the user closes a select, dismisses a color picker, or tabs away from an input
- **AND** the textbox is no longer the active editing target
- **THEN** the toolbar dismisses normally

### Requirement: Toolbar Formatting Commands Must Apply to Selection
The system SHALL apply all toolbar formatting commands to the ProseMirror selection inside the textbox.

#### Scenario: Bold applied to selected text
- **WHEN** the user has text selected in a textbox and clicks Bold
- **THEN** the selected text becomes bold

#### Scenario: Italic applied to selected text
- **WHEN** the user has text selected in a textbox and clicks Italic
- **THEN** the selected text becomes italic

#### Scenario: Heading applied to selected block
- **WHEN** the user has text selected in a textbox and clicks H1 or H2
- **THEN** the selected block becomes a heading

#### Scenario: Paragraph applied to selected block
- **WHEN** the user has text selected in a textbox and clicks P
- **THEN** the selected block becomes a paragraph

#### Scenario: Ordered list applied
- **WHEN** the user has text selected in a textbox and clicks Ordered List (1.)
- **THEN** the selected block becomes an ordered list item

#### Scenario: Bullet list applied
- **WHEN** the user has text selected in a textbox and clicks Bullet List (•)
- **THEN** the selected block becomes a bullet list item

#### Scenario: Font family applied
- **WHEN** the user has text selected in a textbox and changes the font family
- **THEN** the selected text uses the chosen font

#### Scenario: Font size applied
- **WHEN** the user has text selected in a textbox and changes the font size
- **THEN** the selected text uses the chosen size

#### Scenario: Text color applied
- **WHEN** the user has text selected in a textbox and sets a text color
- **THEN** the selected text uses the chosen color

#### Scenario: Highlight color applied
- **WHEN** the user has text selected in a textbox and sets a highlight color
- **THEN** the selected text is highlighted with the chosen color

## MODIFIED Requirements

### Requirement: Textbox Toolbar Availability
The system SHALL display the Textbox formatting toolbar when a Textbox is active for editing.

#### Scenario: Edit mode active
- **WHEN** the user enters edit mode in a textbox
- **THEN** the toolbar becomes available
- **AND** it stays available while interacting with toolbar controls

## REMOVED Requirements
None.

## Out of Scope
- Changes to the Note toolbar behavior (it is already working).
- Changes to textbox creation, deletion, or drag/resize.
- Server-side or API changes.
