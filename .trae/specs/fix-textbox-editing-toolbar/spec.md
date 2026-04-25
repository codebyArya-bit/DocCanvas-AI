# Textbox Editing & Toolbar Reliability Spec

## Why
The current Textbox experience is unreliable: selection is inconsistent, editing cannot be repeated smoothly, and the toolbar popup often fails to appear. This blocks basic note-taking and formatting.

## What Changes
- Make Textbox selection and re-selection reliable across clicks, drags, and multi-line ranges.
- Make Textbox editing re-entrant: users can enter/exit edit mode multiple times without the editor becoming “stuck”.
- Make the Textbox toolbar popup appear consistently when the user focuses, selects, or performs actions inside a Textbox.
- Make the toolbar popup positioning responsive (fits on small screens, clamps to viewport, flips when needed).
- Add lightweight instrumentation hooks (non-logging UI state checks) only if needed for verification. **No secrets or user content logging**.

## Impact
- Affected specs: Textbox creation, Textbox editing, selection-based formatting toolbar, responsive UI behavior.
- Affected code: workspace canvas node orchestration, Textbox node component, ProseMirror selection tracking, toolbar positioning and styles.

## ADDED Requirements
### Requirement: Textbox Toolbar Availability
The system SHALL display the Textbox formatting toolbar whenever a Textbox is active for editing or the user has a selection/caret inside it.

#### Scenario: Caret focus (no highlight)
- **WHEN** the user clicks inside a Textbox editor to place the caret
- **THEN** the toolbar appears anchored near the caret or a fallback anchor within the Textbox
- **AND** the toolbar remains visible while the caret remains in that Textbox

#### Scenario: Multi-line highlight
- **WHEN** the user selects text spanning multiple lines inside the same Textbox
- **THEN** the toolbar appears anchored near the visible selection (preferably the first visible line of the selection)
- **AND** the toolbar does not disappear during selection transitions (pointerdown → drag → pointerup)

### Requirement: Responsive Toolbar Layout
The system SHALL keep the toolbar usable on narrow viewports.

#### Scenario: Small window
- **WHEN** the viewport width is small (mobile/narrow desktop)
- **THEN** the toolbar wraps or stacks controls without overflowing off-screen
- **AND** the toolbar position is clamped within the viewport bounds

## MODIFIED Requirements
### Requirement: Textbox Editing Lifecycle
The system SHALL allow entering edit mode, editing, exiting, and re-entering edit mode multiple times for the same Textbox.

#### Scenario: Re-enter editing
- **WHEN** the user clicks a Textbox, edits text, clicks outside to exit, then clicks inside again
- **THEN** the editor accepts input normally
- **AND** selection and caret behavior remains consistent

### Requirement: Selection Re-entrancy
The system SHALL allow multiple independent selections inside the same Textbox without requiring a blur/refocus workaround.

#### Scenario: Multiple selections
- **WHEN** the user selects one sentence, then selects another sentence in the same Textbox
- **THEN** the selection updates correctly and the toolbar stays available

## REMOVED Requirements
### Requirement: Toolbar Requires Highlight
**Reason**: Users need formatting actions at the caret, not only with a highlighted range.
**Migration**: Toolbar logic must treat caret focus inside Textbox as a valid anchor state (with fallback to Textbox bounds if selection rect is unavailable).

