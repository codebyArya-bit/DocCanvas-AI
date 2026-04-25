'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface WorkspaceToolRailActionContext {
  onCreateTextBox: () => void
  onCreateAddWorkspace: () => void
}

interface WorkspaceToolRailProps {
  ctx: WorkspaceToolRailActionContext
}

type ToolId = 'textbox' | 'workspaceCard'

export function WorkspaceToolRail({ ctx }: WorkspaceToolRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const ctxRef = useRef(ctx)
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [tooltipTop, setTooltipTop] = useState<number>(0)

  useEffect(() => {
    ctxRef.current = ctx
  }, [ctx])

  const tools = useMemo(
    () => [
      {
        id: 'textbox' as const,
        icon: 'AB+',
        label: 'Draw Textbox in Workspace',
        shortcut: 'Ctrl + K',
        onClick: () => ctxRef.current.onCreateTextBox()
      },
      {
        id: 'workspaceCard' as const,
        icon: '+',
        label: 'Add Workspace Card',
        shortcut: 'Card',
        onClick: () => ctxRef.current.onCreateAddWorkspace()
      }
    ],
    []
  )

  const updateTooltipFromTarget = (target: HTMLElement | null, toolId: ToolId) => {
    const rail = railRef.current
    if (!rail || !target) {
      return
    }

    const railRect = rail.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    setTooltipTop(targetRect.top - railRect.top + targetRect.height / 2)
    setActiveTool(toolId)
  }

  const clearTooltip = () => setActiveTool(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isCombo = event.ctrlKey || event.metaKey
      if (!isCombo) {
        return
      }

      const target = event.target as HTMLElement | null
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.closest('.ProseMirror'))) {
        return
      }

      if (key === 'k' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        ctxRef.current.onCreateTextBox()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div ref={railRef} className="workspace-tool-rail" aria-label="Workspace tools">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className="workspace-tool-btn"
          aria-label={tool.label}
          onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseEnter={(event) => updateTooltipFromTarget(event.currentTarget, tool.id)}
          onFocus={(event) => updateTooltipFromTarget(event.currentTarget, tool.id)}
          onBlur={clearTooltip}
          onMouseLeave={clearTooltip}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            tool.onClick()
          }}
        >
          <span className="workspace-tool-icon" aria-hidden="true">
            {tool.icon}
          </span>
        </button>
      ))}

      {activeTool ? (
        <div className="workspace-tool-tooltip" style={{ top: tooltipTop }}>
          <div className="workspace-tool-tooltip-title">{tools.find((t) => t.id === activeTool)?.label ?? ''}</div>
          <div className="workspace-tool-tooltip-shortcut">{`(${tools.find((t) => t.id === activeTool)?.shortcut ?? ''})`}</div>
        </div>
      ) : null}
    </div>
  )
}
