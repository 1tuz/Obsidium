import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { renderMarkdownToHtml } from '../../modules/export/markdownToHtml';
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

interface CanvasCardProps {
  node: CanvasCardNode;
  markdown?: string;
  color?: string;
  strokeColor?: string;
  editing?: boolean;
  selected?: boolean;
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
      : ['http', 'https', 'asset', 'file'];
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

function MarkdownPreview({
  node,
  markdown,
  resolveImageUrl,
  onOpenUrl,
  onOpenNoteLink,
}: Pick<CanvasCardProps, 'node' | 'markdown' | 'resolveImageUrl' | 'onOpenUrl' | 'onOpenNoteLink'>) {
  const html = sanitizeMarkdownLinks(renderMarkdownToHtml(markdown ?? '', {
    resolveImageUrl: resolveImageUrl ? (target) => resolveImageUrl(node, target) : undefined,
    noteLinks: Boolean(onOpenNoteLink),
  }));
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
  strokeColor,
  editing = false,
  selected = false,
  children,
  resolveImageUrl,
  onChange,
  onResize,
  onEditComplete,
  onOpenUrl,
  onOpenNoteLink,
}: CanvasCardProps) {
  const className = `q-canvas-card q-canvas-card--${node.type}${selected ? ' is-selected' : ''}`;
  const colorStyle = color || strokeColor ? {
    ...(color ? { '--q-canvas-node-color': color } : {}),
    ...(strokeColor ? { borderColor: strokeColor } : {}),
  } as Record<string, string> : undefined;

  if (node.type === 'group') {
    return <div className={className} style={colorStyle} role="group" aria-label="Canvas group">{children}</div>;
  }

  if (node.type === 'text') {
    return (
      <div className={className} style={colorStyle} data-node-id={node.id} aria-label="Text card">
        {editing
          ? <textarea aria-label="Text card content" autoFocus value={node.text ?? ''} onInput={(event) => {
            onChange?.(node.id, event.currentTarget.value);
            onResize?.(node.id, event.currentTarget.scrollHeight);
          }} onBlur={onEditComplete} onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
          }} />
          : <MarkdownPreview node={node} markdown={node.text ?? ''} resolveImageUrl={resolveImageUrl} onOpenUrl={onOpenUrl} onOpenNoteLink={onOpenNoteLink} />}
      </div>
    );
  }

  if (node.type === 'file') {
    const title = node.file?.split(/[\\/]/).pop() ?? 'Untitled';
    return (
      <div className={className} style={colorStyle} data-node-id={node.id} aria-label={`File card: ${title}`}>
        <div className="q-canvas-card__title">{title}</div>
        <MarkdownPreview node={node} markdown={markdown} resolveImageUrl={resolveImageUrl} onOpenUrl={onOpenUrl} onOpenNoteLink={onOpenNoteLink} />
      </div>
    );
  }

  if (node.type === 'link') {
    const url = node.url ?? '';
    const safe = isSafeLink(url);
    const imageUrl = /^https?:/i.test(url) ? url : resolveImageUrl?.(node, url) ?? url;
    return (
      <div className={className} style={colorStyle} data-node-id={node.id} aria-label="Link card">
        {safe && isImageUrl(url)
          ? <img className="q-canvas-card__image" src={imageUrl} alt="" loading="lazy" />
          : safe
            ? <a className="q-canvas-card__link" href={url} onClick={(event) => { event.preventDefault(); onOpenUrl?.(url); }}>{url}</a>
            : <span className="q-canvas-card__link">{url}</span>}
      </div>
    );
  }

  return <div className={className} style={colorStyle} data-node-id={node.id} aria-label="Canvas card" />;
});
