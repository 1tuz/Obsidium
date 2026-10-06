import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type * as Y from 'yjs';
import { DOCUMENT_HEAD_LIMIT, documentHead } from './useEditorDocContent';
import { ViewStateController } from '../viewState/controller';
import { initialSelection } from '../viewState/positions';
import { resolveEditorScrollElement } from '../viewState/scroll';
import { markOpenStage } from '../../../modules/perf/openTrace';
import type { ViewState } from '../../../modules/ui-state';

export function useEditorViewSetup(options: {
  documentId: string | null;
  viewStateReady: boolean;
  initialViewState: ViewState | null;
  revealOffset?: number;
  ydoc: Y.Doc;
  isReady: boolean;
  initialBody: string;
  onViewStateChange: (state: ViewState) => void;
  setDocContent: (content: string) => void;
  inactive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    documentId,
    viewStateReady,
    initialViewState,
    revealOffset,
    ydoc,
    isReady,
    initialBody,
    onViewStateChange,
    setDocContent,
    inactive = false,
  } = options;
  const onViewStateChangeRef = useRef(onViewStateChange);
  onViewStateChangeRef.current = onViewStateChange;
  const handleViewStateChange = useCallback((state: ViewState) => {
    onViewStateChangeRef.current(state);
  }, []);

  const controller = useMemo(
    () => (isReady && documentId && viewStateReady
      ? new ViewStateController({
        documentId,
        ydoc,
        initial: initialViewState,
        onChange: handleViewStateChange,
        revealOffset,
      })
      : null),
    [documentId, handleViewStateChange, isReady, revealOffset, viewStateReady, ydoc],
  );

  const selection = useMemo(
    () => initialSelection(initialViewState, ydoc, initialBody.length, revealOffset),
    [initialBody.length, initialViewState, revealOffset, ydoc],
  );

  const viewRef = useRef<EditorView | null>(null);
  const controllerRef = useRef<ViewStateController | null>(null);
  const attachedRef = useRef<ViewStateController | null>(null);
  controllerRef.current = controller;

  const attachWhenReady = useCallback(() => {
    const view = viewRef.current;
    const pending = controllerRef.current;
    const container = containerRef.current;
    if (!view || !pending || !container) return;
    if (attachedRef.current === pending) return;
    attachedRef.current = pending;
    pending.attach(view, resolveEditorScrollElement(container));
  }, []);

  useLayoutEffect(() => () => {
    controller?.dispose(true);
    if (attachedRef.current === controller) attachedRef.current = null;
  }, [controller]);

  useEffect(attachWhenReady, [attachWhenReady, controller]);

  const wasInactive = useRef(inactive);
  useEffect(() => {
    const shown = wasInactive.current && !inactive;
    wasInactive.current = inactive;
    if (!shown) return;
    const view = viewRef.current;
    if (!view) return;
    controllerRef.current?.restoreNow();
    view.focus();
    markOpenStage('mount');
  }, [inactive]);


  const handleCreate = useCallback((view: EditorView) => {
    viewRef.current = view;
    markOpenStage('mount');
    attachWhenReady();
  }, [attachWhenReady]);

  const handleUpdate = useCallback((update: ViewUpdate) => {
    controller?.update(update);
    if (update.docChanged && update.changes.touchesRange(0, DOCUMENT_HEAD_LIMIT)) {
      setDocContent(documentHead(update.state.doc));
    }
  }, [controller, setDocContent]);

  const ready = isReady && viewStateReady;

  return {
    containerRef,
    selection,
    handleCreate,
    handleUpdate,
    ready,
  };
}
