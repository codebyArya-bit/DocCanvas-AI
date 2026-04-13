import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLBaseBoxShape
} from 'tldraw'

const EXCERPT_CARD = 'excerpt-card'
const COMMENT_CARD = 'comment-card'

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    [EXCERPT_CARD]: {
      nodeId: string
      sourceAnchorId: string
      title: string
      text: string
      selectionColor: string
      w: number
      h: number
    }
    [COMMENT_CARD]: {
      nodeId: string
      sourceAnchorId: string
      title: string
      text: string
      selectionColor: string
      w: number
      h: number
    }
  }
}

export type ExcerptCardShape = TLBaseBoxShape & { type: typeof EXCERPT_CARD }
export type CommentCardShape = TLBaseBoxShape & { type: typeof COMMENT_CARD }

const sharedProps = {
  nodeId: T.string,
  sourceAnchorId: T.string,
  title: T.string,
  text: T.string,
  selectionColor: T.string,
  w: T.number,
  h: T.number
}

function openAnchor(anchorId: string) {
  window.dispatchEvent(
    new CustomEvent('workspace:open-anchor', {
      detail: { anchorId }
    })
  )
}

function dispatchCommentTextChange(nodeId: string, text: string) {
  window.dispatchEvent(
    new CustomEvent('workspace:comment-text-change', {
      detail: { nodeId, text }
    })
  )
}

function renderCard(shape: ExcerptCardShape | CommentCardShape, background: string) {
  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        background,
        border: `2px solid ${shape.props.selectionColor}`,
        borderRadius: 18,
        padding: '12px 16px',
        color: '#201c16',
        boxShadow: '0 12px 26px rgba(45, 45, 45, 0.16)',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      {/* Left side arrow anchor */}
      <div
        style={{
          position: 'absolute',
          left: -16,
          top: 46,
          width: 0,
          height: 0,
          borderTop: '12px solid transparent',
          borderBottom: '12px solid transparent',
          borderRight: `16px solid ${shape.props.selectionColor}`
        }}
      />
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
        {shape.props.title}
      </div>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word'
        }}
      >
        {shape.props.text}
      </div>
    </HTMLContainer>
  )
}

export class ExcerptCardShapeUtil extends BaseBoxShapeUtil<ExcerptCardShape> {
  static override type = EXCERPT_CARD
  static override props: RecordProps<ExcerptCardShape> = sharedProps

  override getDefaultProps(): ExcerptCardShape['props'] {
    return {
      nodeId: '',
      sourceAnchorId: '',
      title: '',
      text: '',
      selectionColor: '#ffd400',
      w: 320,
      h: 168
    }
  }

  override onClick(shape: ExcerptCardShape) {
    openAnchor(shape.props.sourceAnchorId)
  }

  override component(shape: ExcerptCardShape) {
    return renderCard(shape, '#fff8d8')
  }

  override indicator(shape: ExcerptCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />
  }
}

export class CommentCardShapeUtil extends BaseBoxShapeUtil<CommentCardShape> {
  static override type = COMMENT_CARD
  static override props: RecordProps<CommentCardShape> = sharedProps

  override getDefaultProps(): CommentCardShape['props'] {
    return {
      nodeId: '',
      sourceAnchorId: '',
      title: 'Comment',
      text: '',
      selectionColor: '#5d5df6',
      w: 320,
      h: 210
    }
  }

  override onClick(shape: CommentCardShape) {
    openAnchor(shape.props.sourceAnchorId)
  }

  override component(shape: CommentCardShape) {
    const accentColor = shape.props.selectionColor || '#5d5df6'
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          background: 'rgba(255, 255, 255, 0.97)',
          border: `2px solid ${accentColor}`,
          borderRadius: 18,
          padding: '0',
          color: '#201c16',
          boxShadow: '0 12px 26px rgba(45, 45, 45, 0.18)',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}
      >
        {/* Left side arrow anchor */}
        <div
          style={{
            position: 'absolute',
            left: -18,
            top: 46,
            width: 0,
            height: 0,
            borderTop: '12px solid transparent',
            borderBottom: '12px solid transparent',
            borderRight: `16px solid ${accentColor}`
          }}
        />
        {/* Drag handle header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px 7px',
            borderBottom: `1px solid ${accentColor}22`,
            background: `${accentColor}12`,
            borderRadius: '16px 16px 0 0',
            cursor: 'move',
            userSelect: 'none'
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: accentColor }}>
            Comment
          </span>
          <span style={{ fontSize: 10, color: accentColor, opacity: 0.6, letterSpacing: '0.06em' }}>✦</span>
        </div>

        {/* Editable textarea */}
        <textarea
          placeholder="Write a comment…"
          defaultValue={shape.props.text}
          style={{
            flex: 1,
            border: 'none',
            resize: 'none',
            background: 'transparent',
            padding: '10px 14px',
            fontSize: 14,
            lineHeight: 1.55,
            color: '#201c16',
            outline: 'none',
            fontFamily: 'inherit',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            pointerEvents: 'all'
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            dispatchCommentTextChange(shape.props.nodeId, e.target.value)
          }}
        />

        {/* Source quote footer */}
        {shape.props.title ? (
          <div
            style={{
              padding: '6px 14px 9px',
              fontSize: 11,
              color: '#6b6557',
              fontStyle: 'italic',
              borderTop: `1px solid ${accentColor}18`,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {shape.props.title}
          </div>
        ) : null}
      </HTMLContainer>
    )
  }

  override indicator(shape: CommentCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />
  }
}
