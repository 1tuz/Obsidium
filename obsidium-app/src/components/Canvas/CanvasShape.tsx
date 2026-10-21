import { canvasStrokeDasharray, type CanvasCorners, type CanvasStrokeStyle, type CanvasStrokeWidth } from '../../modules/canvas/nodeProps';
import './CanvasShape.css';

export type CanvasShapeKind = 'rectangle' | 'diamond' | 'ellipse' | 'number' | 'sticker';

interface CanvasShapeProps {
  shape: CanvasShapeKind;
  width: number;
  height: number;
  zoom: number;
  selected: boolean;
  stroke?: string;
  fill?: string;
  strokeWidth?: CanvasStrokeWidth;
  strokeStyle?: CanvasStrokeStyle;
  corners?: CanvasCorners;
}

interface ShapeGeometryProps {
  shape: CanvasShapeKind;
  width: number;
  height: number;
  className: string;
  stroke?: string;
  fill?: string;
  strokeWidth: number;
  strokeDasharray?: string;
  corners?: CanvasCorners;
  pointerEvents?: 'none';
  inset?: number;
  style?: Record<string, string>;
}

function ShapeGeometry({
  shape,
  width,
  height,
  className,
  stroke,
  fill,
  strokeWidth,
  strokeDasharray,
  corners = 'round',
  pointerEvents,
  inset = 1,
  style,
}: ShapeGeometryProps) {
  const geometry = {
    className,
    ...(stroke === undefined ? {} : { stroke }),
    ...(fill === undefined ? {} : { fill }),
    'stroke-width': strokeWidth,
    'stroke-linejoin': 'round',
    ...(strokeDasharray === undefined ? {} : { 'stroke-dasharray': strokeDasharray }),
    ...(pointerEvents === undefined ? {} : { 'pointer-events': pointerEvents }),
    ...(style === undefined ? {} : { style }),
  } as const;

  if (shape === 'sticker') {
    return (
      <rect
        {...geometry}
        x={inset}
        y={inset}
        width={Math.max(0, width - inset * 2)}
        height={Math.max(0, height - inset * 2)}
        rx={10}
      />
    );
  }

  if (shape === 'diamond') {
    return (
      <polygon
        {...geometry}
        points={`${width / 2},1 ${width - 1},${height / 2} ${width / 2},${height - 1} 1,${height / 2}`}
      />
    );
  }

  if (shape === 'ellipse' || shape === 'number') {
    return (
      <ellipse
        {...geometry}
        cx={width / 2}
        cy={height / 2}
        rx={Math.max(0, width / 2 - 1)}
        ry={Math.max(0, height / 2 - 1)}
      />
    );
  }

  return (
    <rect
      {...geometry}
      x={1}
      y={1}
      width={Math.max(0, width - 2)}
      height={Math.max(0, height - 2)}
      rx={corners === 'round' ? 10 : 0}
    />
  );
}

export function CanvasShape({
  shape,
  width,
  height,
  zoom,
  selected,
  stroke,
  fill,
  strokeWidth = 2,
  strokeStyle = 'solid',
  corners = 'round',
}: CanvasShapeProps) {
  const sticker = shape === 'sticker';
  return (
    <svg
      className="q-canvas__shape"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <ShapeGeometry
        shape={shape}
        width={width}
        height={height}
        className={sticker ? 'q-canvas__shape-body q-canvas__shape-body--sticker' : 'q-canvas__shape-body'}
        stroke={sticker ? 'none' : stroke}
        fill={sticker ? undefined : fill}
        strokeWidth={sticker ? 0 : strokeWidth / zoom}
        strokeDasharray={sticker ? undefined : canvasStrokeDasharray(strokeStyle, strokeWidth, 1 / zoom)}
        corners={corners}
        inset={sticker ? 0 : 1}
        style={fill === undefined ? undefined : { fill }}
      />
      {selected && (
        <ShapeGeometry
          shape={shape}
          width={width}
          height={height}
          className="q-canvas__shape-outline"
          fill="none"
          strokeWidth={1.5 / zoom}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
