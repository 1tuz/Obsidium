import { useEffect, useRef, useState, type RefObject } from 'react';
import { GraphRenderer, type GraphPathState } from './renderer';
import type { NoteLabels } from './noteLabels';
import type { GraphCameraState } from '../../modules/ui-state';
import { useStableCallback } from '../../hooks/useStableCallback';
import { readGraphFailure } from './readGraphFailure';
import { t } from '../../i18n';

interface GraphRendererInput {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  labels: NoteLabels;
  visible: boolean;
  attempt: number;
  onOpenNote: (path: string) => void;
  onGraphNodeSelect: (node: number, path: string) => void;
  onPositionChange: (node: number, x: number, y: number) => void;
  onCameraSettled: (camera: GraphCameraState) => void;
  onPathState: (state: GraphPathState) => void;
}

export function useGraphRenderer({
  canvasRef,
  labels,
  visible,
  attempt,
  onOpenNote,
  onGraphNodeSelect,
  onPositionChange,
  onCameraSettled,
  onPathState,
}: GraphRendererInput) {
  const rendererRef = useRef<GraphRenderer | null>(null);
  const scaleReadoutRef = useRef<HTMLSpanElement | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [visibleNodes, setVisibleNodes] = useState(0);
  const [generation, setGeneration] = useState(0);
  const openNote = useStableCallback(onOpenNote);
  const graphNodeSelected = useStableCallback(onGraphNodeSelect);
  const positionChanged = useStableCallback(onPositionChange);
  const cameraSettled = useStableCallback(onCameraSettled);
  const pathStateChanged = useStableCallback(onPathState);

  const attachScaleReadout = useStableCallback((element: HTMLSpanElement | null) => {
    scaleReadoutRef.current = element;
    rendererRef.current?.setScaleReadout(element);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    let renderer: GraphRenderer;
    try {
      renderer = new GraphRenderer(canvas, labels);
    } catch (cause) {
      setRendererError(readGraphFailure(cause));
      return;
    }
    rendererRef.current = renderer;
    setRendererError(null);
    renderer.onVisibleNodes = setVisibleNodes;
    renderer.onPositionChange = positionChanged;
    renderer.onContextLost = () => setRendererError(t('graph.errors.contextLost'));
    renderer.onCameraSettled = cameraSettled;
    renderer.onPathState = pathStateChanged;
    renderer.onSelect = (node) => {
      void labels.resolve(node).then((label) => {
        if (!label) return;
        graphNodeSelected(node, label.path);
        openNote(label.path);
      });
    };
    renderer.setScaleReadout(scaleReadoutRef.current);
    labels.onLoaded = () => renderer.redraw();
    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(canvas);
    renderer.resize();
    setGeneration((current) => current + 1);
    return () => {
      observer.disconnect();
      labels.onLoaded = null;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [visible, attempt, cameraSettled, canvasRef, labels, openNote, graphNodeSelected, positionChanged, pathStateChanged]);

  return { rendererRef, generation, rendererError, visibleNodes, attachScaleReadout };
}
