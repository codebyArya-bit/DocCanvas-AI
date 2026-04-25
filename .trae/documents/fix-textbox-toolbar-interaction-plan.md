# Plan: Fix Textbox Toolbar Interaction Regressions

## Summary
- Fix repeated textbox toolbar dismissal for `font size`, `Text Color`, and `Highlight Color` while editing text in `div.note-toolbar.workspace-textbox-toolbar.is-visible`.
- Keep the textbox toolbar visible and interactive during native control usage without regressing the existing "show only in textbox edit mode" behavior.
- Ensure formatting commands still apply to the intended ProseMirror selection after focus temporarily shifts to toolbar controls.

## Current State Analysis
- `apps/web/src/components/workspace/WorkspaceSelectionToolbar.tsx`
  - Owns textbox toolbar rendering, toolbar interaction tracking, and native control handlers.
  - Already includes `nativeColorPickerOpenRef` and a delayed `scheduleStopInteracting()`.
  - Still treats multiple native-control transitions as generic interaction end states:
    - `onPointerUpCapture` and `onMouseUpCapture` schedule interaction shutdown globally.
    - `onBlurCapture` can schedule shutdown when focus temporarily leaves the toolbar for OS/browser-managed controls.
    - `select` and numeric input controls do not explicitly pin interaction for their full lifecycle.
- `apps/web/src/components/workspace/WorkspaceCanvas.tsx`
  - Keeps the textbox toolbar mounted while edit mode is active and positions it from either the selection rect or textbox fallback rect.
  - Uses `isTextToolbarInteractingRef` to decide whether the toolbar session should stay alive.
  - Calls `stopTextEditing()` once interaction is considered finished and the textbox is no longer interactive.
- `apps/web/src/components/notes/note-editor.tsx`
  - Preserves `lastSelectionRef` and uses it as fallback for mark application.
  - Already updates `lastSelectionRef` during DOM `selectionchange`, which supports toolbar actions after focus shifts.
- `apps/web/app/globals.css`
  - Already contains responsive textbox toolbar width and wrapping improvements.
  - CSS is no longer the main blocker; repeated disappearance is now primarily event/focus lifecycle related.

## Proposed Changes

### 1. Stabilize native-control interaction lifecycle
- File: `apps/web/src/components/workspace/WorkspaceSelectionToolbar.tsx`
- What:
  - Replace the current coarse "interaction on pointerdown, stop on pointerup/blur" logic with explicit control-aware interaction pinning.
  - Track whether the active toolbar interaction is:
    - normal toolbar button click
    - native `select`
    - number input edit
    - native color picker session
  - Prevent `scheduleStopInteracting()` from running while any native control session is active.
  - Release the interaction pin only after the control returns focus or the user fully exits the toolbar.
- Why:
  - The current fade occurs because browser-managed UI temporarily blurs the toolbar/editor, which is mistaken for the end of interaction.
- How:
  - Introduce explicit refs/state for active native control sessions instead of relying only on `nativeColorPickerOpenRef`.
  - Gate `onBlurCapture`, `onPointerUpCapture`, and `onMouseUpCapture` so they do not end interaction for open native controls.
  - Treat `select`, `input[type="number"]`, and `input[type="color"]` as long-lived interactive surfaces rather than momentary clicks.

### 2. Narrow toolbar-wide event suppression to buttons only
- File: `apps/web/src/components/workspace/WorkspaceSelectionToolbar.tsx`
- What:
  - Keep `preventDefault()` behavior for toolbar buttons that must preserve selection.
  - Avoid applying the same generic behavior to native controls that need their own focus lifecycle.
- Why:
  - Shared event handling across buttons and native inputs is the main source of repeated regressions.
- How:
  - Separate helper paths for:
    - formatting/action buttons
    - dropdown/select controls
    - numeric input
    - color inputs
  - Keep propagation stopped for all toolbar elements, but only call `preventDefault()` where selection preservation is required.

### 3. Keep editor selection restoration intentional after native control changes
- Files:
  - `apps/web/src/components/workspace/WorkspaceSelectionToolbar.tsx`
  - `apps/web/src/components/notes/note-editor.tsx` only if validation shows selection fallback is still insufficient
- What:
  - Preserve the current pattern of refocusing the editor before or immediately after applying size/color changes.
  - Validate that size/color changes still apply to the last intended selection and not only future typed text.
- Why:
  - Prevents a visual fix from hiding a still-broken formatting path.
- How:
  - Reuse the existing `lastSelectionRef` strategy.
  - Only adjust `note-editor.tsx` further if testing shows `setMarkWithAttrs()` still misses the selected range during toolbar control usage.

### 4. Clean up stale textbox-toolbar CSS contract if needed
- File: `apps/web/app/globals.css`
- What:
  - Remove or simplify stale menu-specific textbox toolbar rules that no longer correspond to the current native-control toolbar implementation, if they complicate debugging or layout.
- Why:
  - The toolbar has evolved from popup menus to native controls; leftover selectors increase maintenance risk.
- How:
  - Keep only rules that still apply to the current DOM structure.
  - Do not change note toolbar styling.

## Assumptions & Decisions
- Goal is to fix textbox toolbar functionality, not redesign its UX.
- Toolbar should remain visible while using native toolbar controls during textbox edit mode.
- Toolbar should still disappear when the user genuinely exits textbox editing or clicks away from the textbox session.
- Existing responsive positioning work in `globals.css` and mounting logic in `WorkspaceCanvas.tsx` should be preserved unless verification proves otherwise.
- No server/API changes are expected; this is a client-side interaction fix.

## Verification Steps
- Start the web app with `npm run dev`.
- In a textbox:
  - Enter edit mode.
  - Select text.
  - Open and use font size controls:
    - size dropdown
    - numeric size input
  - Open and use `Text Color`.
  - Open and use `Highlight Color`.
- Confirm:
  - the toolbar does not fade/disappear during interaction
  - the textbox remains in edit mode while using controls
  - the selected text formatting updates correctly
  - clicking outside the textbox session still dismisses the toolbar
- Re-run diagnostics for:
  - `apps/web/src/components/workspace/WorkspaceSelectionToolbar.tsx`
  - `apps/web/src/components/workspace/WorkspaceCanvas.tsx`
  - `apps/web/src/components/notes/note-editor.tsx`
