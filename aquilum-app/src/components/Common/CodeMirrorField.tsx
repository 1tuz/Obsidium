import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type FocusEventHandler,
} from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  aquilumCodeMirrorTheme,
  aquilumFieldSetup,
  aquilumHorizontalFieldTheme,
  aquilumSingleLineExtensions,
  normalizeSingleLineText,
  syncDocument,
} from './codeMirror';

const noExtensions: Extension[] = [];

export interface CodeMirrorFieldRef {
  readonly view: EditorView | null;
  focus: () => void;
  select: () => void;
  blur: () => void;
  setValue: (value: string) => void;
}

interface CodeMirrorFieldProps {
  value: string;
  onChange?: (value: string) => void;
  ariaLabel: string;
  mode?: 'single-line' | 'multiline';
  lineWrapping?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  disabled?: boolean;
  extensions?: Extension[];
  onKeyDown?: (event: KeyboardEvent, view: EditorView) => boolean | void;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  onCreate?: (view: EditorView) => void;
}

export const CodeMirrorField = forwardRef<CodeMirrorFieldRef, CodeMirrorFieldProps>(
  function CodeMirrorField({
    value,
    onChange,
    ariaLabel,
    mode = 'single-line',
    lineWrapping = mode === 'multiline',
    placeholder,
    className = '',
    autoFocus = false,
    spellCheck = false,
    disabled = false,
    extensions = noExtensions,
    onKeyDown,
    onFocus,
    onBlur,
    onCreate,
  }, forwardedRef) {
    const editorRef = useRef<ReactCodeMirrorRef>(null);
    const keyDownRef = useRef(onKeyDown);
    keyDownRef.current = onKeyDown;

    const text = mode === 'single-line' ? normalizeSingleLineText(value) : value;
    const textRef = useRef(text);
    textRef.current = text;
    const initialTextRef = useRef(text);

    useImperativeHandle(forwardedRef, () => ({
      get view() {
        return editorRef.current?.view ?? null;
      },
      focus() {
        editorRef.current?.view?.focus();
      },
      select() {
        const view = editorRef.current?.view;
        if (!view) return;
        view.focus();
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      },
      blur() {
        editorRef.current?.view?.contentDOM.blur();
      },
      setValue(next: string) {
        const view = editorRef.current?.view;
        if (view) syncDocument(view, mode === 'single-line' ? normalizeSingleLineText(next) : next);
      },
    }), [mode]);

    useLayoutEffect(() => {
      const view = editorRef.current?.view;
      if (view) syncDocument(view, text);
    }, [text]);

    const fieldExtensions = useMemo<Extension[]>(() => [
      aquilumFieldSetup,
      aquilumCodeMirrorTheme,
      EditorView.contentAttributes.of({
        'aria-label': ariaLabel,
        'aria-multiline': String(mode === 'multiline'),
        autocapitalize: 'off',
        autocomplete: 'off',
        spellcheck: String(spellCheck),
      }),
      EditorState.readOnly.of(disabled),
      EditorView.editable.of(!disabled),
      Prec.highest(EditorView.domEventHandlers({
        keydown(event, view) {
          const handled = keyDownRef.current?.(event, view) === true;
          if (handled || event.defaultPrevented) return true;
          if (mode === 'single-line' && event.key === 'Enter') {
            event.preventDefault();
            return true;
          }
          return false;
        },
      })),
      mode === 'single-line' ? aquilumSingleLineExtensions : [],
      mode === 'single-line' && !lineWrapping ? aquilumHorizontalFieldTheme : [],
      lineWrapping ? EditorView.lineWrapping : [],
      ...extensions,
    ], [ariaLabel, disabled, extensions, lineWrapping, mode, spellCheck]);

    const handleChange = useCallback((nextValue: string) => {
      const normalized = mode === 'single-line' ? normalizeSingleLineText(nextValue) : nextValue;
      if (normalized === textRef.current) return;
      onChange?.(normalized);
    }, [mode, onChange]);

    const classes = [
      'q-code-mirror-field',
      `q-code-mirror-field--${mode}`,
      className,
    ].filter(Boolean).join(' ');

    return (
      <CodeMirror
        ref={editorRef}
        className={classes}
        theme="none"
        value={initialTextRef.current}
        placeholder={placeholder}
        autoFocus={autoFocus}
        basicSetup={false}
        indentWithTab={false}
        extensions={fieldExtensions}
        onCreateEditor={(view) => {
          syncDocument(view, textRef.current);
          onCreate?.(view);
        }}
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  },
);
