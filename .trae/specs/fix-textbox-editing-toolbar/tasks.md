# Tasks
- [x] Task 1: Reproduce and categorize Textbox failures
  - [x] Identify triggers for: toolbar not appearing, selection not updating, edit mode not re-entering
  - [x] Confirm behavior for: click caret, drag highlight, multi-line selection, resize/scroll, click outside

- [x] Task 2: Make toolbar appear reliably for caret + highlight
  - [x] Ensure “active textbox” state opens toolbar on focus/caret placement
  - [x] Ensure selection transitions do not close the toolbar prematurely
  - [x] Ensure fallback anchor within textbox is used when selection rect is temporarily unavailable

- [x] Task 3: Fix selection re-entrancy inside same textbox
  - [x] Ensure repeated selections inside same textbox update anchor consistently
  - [x] Improve multi-line selection anchoring so the toolbar feels attached to the selected text

- [x] Task 4: Fix edit lifecycle (enter/exit/re-enter)
  - [x] Ensure exit conditions do not leave stale state that blocks later edits
  - [x] Ensure focus and selection restore behavior is predictable after re-entering

- [x] Task 5: Make toolbar responsive and non-overflowing
  - [x] Clamp toolbar within viewport
  - [x] Wrap/stack toolbar controls on narrow screens
  - [x] Validate placement above/below selection when space is constrained

- [x] Task 6: Verification
  - [x] Add or update automated checks if feasible (typecheck, lint, minimal UI behavior assertions)
  - [x] Manual verification pass against checklist scenarios

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 1
- Task 5 depends on Task 2
- Task 6 depends on Tasks 2–5
