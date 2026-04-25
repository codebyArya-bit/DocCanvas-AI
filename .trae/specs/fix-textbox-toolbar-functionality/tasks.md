# Tasks

- [x] Task 1: Diagnose toolbar fade during native control usage
  - [x] SubTask 1.1: Read current WorkspaceSelectionToolbar.tsx interaction tracking logic
  - [x] SubTask 1.2: Identify where `scheduleStopInteracting` fires during select/number/color usage
  - [x] SubTask 1.3: Identify why existing `activeNativeControlRef` and `nativeColorPickerOpenRef` are insufficient

- [x] Task 2: Fix toolbar visibility during native control interaction
  - [x] SubTask 2.1: Update interaction pinning to cover all native control types (select, number input, color picker)
  - [x] SubTask 2.2: Prevent `scheduleStopInteracting` from firing while any native control is active
  - [x] SubTask 2.3: Ensure `onInteractionChange(false)` fires only when all controls are closed AND the textbox is no longer active
  - [x] SubTask 2.4: Run diagnostics and verify clean build

- [x] Task 3: Diagnose toolbar formatting commands not applying
  - [x] SubTask 3.1: Read current editor command dispatch in WorkspaceSelectionToolbar.tsx
  - [x] SubTask 3.2: Check whether `editor.focus()` is called before command dispatch
  - [x] SubTask 3.3: Verify ProseMirror selection is preserved when toolbar button is clicked (prevent collapse)
  - [x] SubTask 3.4: Trace `setMarkWithAttrs` and `setBlockType` in note-editor.tsx for textbox nodeId context

- [x] Task 4: Fix toolbar formatting commands
  - [x] SubTask 4.1: Ensure `editor.focus()` is called before every formatting action in the toolbar
  - [x] SubTask 4.2: Ensure `lastSelectionRef` is updated on every ProseMirror transaction in the textbox editor
  - [x] SubTask 4.3: Verify `setMarkWithAttrs` fallbacks apply to the correct nodeId range
  - [x] SubTask 4.4: Run diagnostics and verify clean build

- [x] Task 5: End-to-end verification
  - [x] SubTask 5.1: Start `npm run dev` and confirm the app compiles
  - [ ] SubTask 5.2: Manual test: Bold, Italic, Underline, Strikethrough
  - [ ] SubTask 5.3: Manual test: P, H1, H2, Bullet List, Ordered List
  - [ ] SubTask 5.4: Manual test: Font Family, Font Size, Text Color, Highlight Color
  - [ ] SubTask 5.5: Verify toolbar stays visible during all native control interactions

# Task Dependencies
- Task 2 depends on Task 1
- Task 4 depends on Task 3
- Task 5 depends on Tasks 2 and 4
