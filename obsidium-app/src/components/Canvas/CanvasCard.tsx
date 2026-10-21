import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useMemo, useRef } from 'react';
import { renderMarkdownToHtml } from '../../modules/export/markdownToHtml';
import { canvasTextOverflow } from '../../modules/canvas/textFit';
import { canvasAppearanceStyle, type CanvasAppearance } from '../../modules/canvas/nodeProps';
import { CanvasMedia } from './CanvasMedia';
import type { CanvasShapeKind } from './CanvasShape';
import './CanvasCard.css';

export interface CanvasCardNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group' | string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
}

export interface CanvasCardMedia {
  kind: 'image' | 'video';
  src: string;
  label: string;
}

interface CanvasCardProps {
  node: CanvasCardNode;
  markdown?: string;
  color?: string;
  shape?: CanvasShapeKind | null;
  appearance?: CanvasAppearance;
  media?: CanvasCardMedia | null;
  editing?: boolean;
  selected?: boolean;
  compact?: boolean;
  openHint?: string;
  children?: ComponentChildren;
  resolveImageUrl?: (node: CanvasCardNode, target: string) => string;
  onChange?: (nodeId: string, text: string) => void;
  onResize?: (nodeId: string, height: number) => void;
  onEditComplete?: () => void;
  onOpenUrl?: (url: string) => void;
  onOpenNoteLink?: (target: string, source: string) => void;
}

function sanitizeMarkdownLinks(html: string): string {
  return html.replace(/\b(href|src)="([^"]*)"/g, (attribute, kind: string, value: string) => {
    const protocol = value.replace(/[\u0000-\u0020]/g, '').match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
    if (!protocol) return attribute;
    const allowed = kind === 'href'
      ? ['http', 'https', 'mailto', 'tel']
      : ['http', 'https', 'asset', 'file', 'data', 'blob'];
    return allowed.includes(protocol) ? attribute : `${kind}="#"`;
  });
}

function isImageUrl(url: string): boolean {
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(url);
}

function isSafeLink(url: string): boolean {
  const protocol = url.replace(/[\u0000-\u0020]/g, '').match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  return !protocol || ['http', 'https', 'mailto', 'tel'].includes(protocol);
}

const firstLine = (text: string): string => text.split(/\r?\n/, 1)[0] ?? '';

function MarkdownPreview({
  node,
  markdown,
  resolveImageUrl,
  onOpenUrl,
  onOpenNoteLink,
}: Pick<CanvasCardProps, 'node' | 'markdown' | 'resolveImageUrl' | 'onOpenUrl' | 'onOpenNoteLink'>) {
  const noteLinks = Boolean(onOpenNoteLink);
  const hasResolver = Boolean(resolveImageUrl);
  const resolverRef = useRef(resolveImageUrl);
  const nodeRef = useRef(node);
  resolverRef.current = resolveImageUrl;
  nodeRef.current = node;
  const html = useMemo(() => {
    const resolve = resolverRef.current;
    return sanitizeMarkdownLinks(renderMarkdownToHtml(markdown ?? '', {
      resolveImageUrl: resolve ? (target) => resolve(nodeRef.current, target) : undefined,
      noteLinks,
    }));
  }, [markdown, noteLinks, hasResolver]);
  const noteLinkFrom = (target: HTMLElement): [string, string] | null => {
    const note = target.closest<HTMLElement>('a[data-note-target]');
    if (!note || !onOpenNoteLink) return null;
    return [note.dataset.noteTarget ?? '', note.dataset.noteSource ?? 'wiki'];
  };
  return <div className="q-canvas-card__markdown" onClick={(event) => {
    const note = noteLinkFrom(event.target as HTMLElement);
    if (note) {
      event.preventDefault();
      event.stopPropagation();
      onOpenNoteLink?.(note[0], note[1]);
      return;
    }
    const anchor = (event.target as HTMLElement).closest('a[href]');
    const href = anchor?.getAttribute('href');
    if (href && /^(?:https?:|mailto:|tel:)/i.test(href)) {
      event.preventDefault();
      onOpenUrl?.(href);
    }
  }} onKeyDown={(event) => {
    if (event.key !== 'Enter') return;
    const note = noteLinkFrom(event.target as HTMLElement);
    if (!note) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenNoteLink?.(note[0], note[1]);
  }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export const CanvasCard = memo(function CanvasCard({
  node,
  markdown,
  color,
  shape = null,
  appearance,
  media = null,
  editing = false,
  selected = false,
  compact = false,
  openHint,
  children,
  resolveImageUrl,
  onChange,
  onResize,
  onEditComplete,
  onOpenUrl,
  onOpenNoteLink,
}: CanvasCardProps) {
  const className = `q-canvas-card q-canvas-card--${node.type}${shape ? ' q-canvas-card--shape' : ''}${selected ? ' is-selected' : ''}`;
  const style = {
    ...(color ? { '--q-canvas-node-color': color } : {}),
    ...(appearance ? canvasAppearanceStyle(appearance) : {}),
  } as Record<string, string>;
  const styled = Object.keys(style).length > 0 ? style : undefined;
  if (node.type === 'group') {
    return <div className={className} style={styled} role="group" aria-label="Canvas group">{children}</div>;
  }

  if (node.type === 'text') {
    return (
      <div className={className} style={styled} data-node-id={node.id} aria-label="Text card">
        {editing
          ? <textarea
            aria-label="Text card content"
            autoFocus
            value={node.text ?? ''}
            onInput={(event) => {
              const target = event.currentTarget;
              onChange?.(node.id, target.value);
              onResize?.(node.id, shape ? node.height + canvasTextOverflow(target) : target.scrollHeight);
            }}
            onBlur={onEditComplete}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            }}
          />
          : compact
            ? <div className="q-canvas-card__markdown">{firstLine(node.text ?? '')}</div>
            : <MarkdownPreview node={node} markdown={node.text ?? ''} resolveImageUrl={resolveImageUrl} onOpenUrl={onOpenUrl} onOpenNoteLink={onOpenNoteLink} />}
      </div>
    );
  }

  if (node.type === 'file') {
    const title = node.file?.split(/[\\/]/).pop() ?? 'Untitled';
    if (media) {
      return (
        <div className={className} style={styled} data-node-id={node.id} aria-label={`File card: ${title}`}>
          <CanvasMedia kind={media.kind} src={media.src} label={media.label} />
        </div>
      );
    }
    return (
      <div className={className} style={styled} data-node-id={node.id} aria-label={`File card: ${title}`}>
        <div className="q-canvas-card__title" title={openHint}>{title}</div>
        {!compact && <MarkdownPreview node={node} markdown={markdown} resolveImageUrl={resolveImageUrl} onOpenUrl={onOpenUrl} onOpenNoteLink={onOpenNoteLink} />}
      </div>
    );
  }

  if (node.type === 'link') {
    const url = node.url ?? '';
    const safe = isSafeLink(url);
    const imageUrl = /^https?:/i.test(url) ? url : resolveImageUrl?.(node, url) ?? url;
    return (
      <div className={className} style={styled} data-node-id={node.id} aria-label="Link card">
        {compact
          ? <span className="q-canvas-card__link">{url}</span>
          : safe && isImageUrl(url)
            ? <CanvasMedia kind="image" src={imageUrl} label={url} />
            : safe
              ? <a className="q-canvas-card__link" href={url} onClick={(event) => { event.preventDefault(); onOpenUrl?.(url); }}>{url}</a>
              : <span className="q-canvas-card__link">{url}</span>}
      </div>
    );
  }

  return <div className={className} style={styled} data-node-id={node.id} aria-label="Canvas card" />;
});
