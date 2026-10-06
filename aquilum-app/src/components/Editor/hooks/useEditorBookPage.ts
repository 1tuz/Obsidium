import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { importCoverBytes, pickAndImportCover } from '../../../modules/docs/covers';
import { nextRandomCoverPattern } from '../../../modules/docs/coverPatterns';
import { hasBookFile, pickAndImportBook } from '../../../modules/docs/books';
import { formatSyntheticPages } from '../../../modules/docs/bookProgress';
import { persistBookReaderMeta } from '../../../modules/docs/persistBookReaderMeta';
import { onDocChange } from '../../../modules/docs';
import {
  FM_BOOK_COVER,
  FM_BOOK_FILE,
  FM_PAGE_COVER,
  FM_PAGE_COVER_POSITION,
  hasPageCover,
  parseFrontmatter,
  resolveBookFields,
  setFrontmatterField,
  type BookMetadata,
  type ResolvedBookFields,
} from '../../../modules/docs/frontmatter';
import { applyYdocText } from '../../../modules/docs/ydocContent';
import { hydrateFromFm } from '../../../modules/docs/bookPageRuntime';
import type { CoverFieldKey } from '../types';
import { documentText } from '../../../modules/docSync/applyExternalText';

type LayoutSnapshot = {
  metadata: BookMetadata | null;
  resolved: ResolvedBookFields;
  isBook: boolean;
  hasCover: boolean;
};

function snapshotFromDoc(doc: string): LayoutSnapshot | null {
  const parsed = parseFrontmatter(doc);
  if (!parsed) return null;
  return {
    metadata: parsed.data,
    resolved: resolveBookFields(parsed.data),
    isBook: parsed.data.type === 'book',
    hasCover: hasPageCover(parsed.data),
  };
}

export function useEditorBookPage(options: {
  ydoc: Y.Doc;
  filePath: string;
  workspacePath: string | null;
  isReady: boolean;
  docContent: string;
  setDocContent: (content: string) => void;
}) {
  const { ydoc, filePath, workspacePath, isReady, docContent, setDocContent } = options;
  const coverUploadLock = useRef(false);
  const bookUploadLock = useRef(false);
  const stickyLayout = useRef<LayoutSnapshot | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [bookBusy, setBookBusy] = useState(false);

  const sourceDoc = docContent || (isReady ? documentText(ydoc).toString() : '');

  useEffect(() => {
    stickyLayout.current = null;
  }, [filePath]);

  const layout = useMemo(() => {
    const next = snapshotFromDoc(sourceDoc);
    if (next) stickyLayout.current = next;
    return stickyLayout.current ?? {
      metadata: null,
      resolved: {},
      isBook: false,
      hasCover: false,
    };
  }, [sourceDoc]);

  const { metadata, resolved, isBook, hasCover } = layout;
  const bookFile = resolved.bookFile;
  const bookAttached = hasBookFile(bookFile);
  const pageLayout = hasCover || isBook;

  useEffect(() => {
    if (isBook) hydrateFromFm(filePath, metadata);
  }, [filePath, isBook, metadata]);

  useEffect(() => {
    if (!isBook) return;
    return onDocChange(filePath, () => {
      setDocContent(documentText(ydoc).toString());
    });
  }, [filePath, isBook, setDocContent, ydoc]);

  const applyCoverField = useCallback((key: CoverFieldKey, value: string) => {
    if (key === 'pages') {
      const pending = persistBookReaderMeta(filePath, { pages: value });
      setDocContent(documentText(ydoc).toString());
      void pending.catch((error) => {
        console.error('Failed to persist book progress', error);
      });
      return;
    }
    const current = documentText(ydoc).toString();
    const next = setFrontmatterField(current, key, value);
    if (!next || next === current) return;
    applyYdocText(ydoc, next);
    setDocContent(next);
  }, [filePath, setDocContent, ydoc]);

  const runCoverImport = useCallback(async (
    task: (workspaceRoot: string) => Promise<void>,
  ) => {
    if (!workspacePath || coverUploadLock.current) return;
    coverUploadLock.current = true;
    setCoverUploading(true);
    try {
      await task(workspacePath);
    } catch (error) {
      console.error('Failed to import cover', error);
    } finally {
      coverUploadLock.current = false;
      setCoverUploading(false);
    }
  }, [workspacePath]);

  const uploadCover = useCallback((kind: 'page' | 'book') => runCoverImport(async (root) => {
    const relative = await pickAndImportCover(root);
    if (!relative) return;
    if (kind === 'page') {
      applyCoverField('cover', 'true');
      applyCoverField(FM_PAGE_COVER, relative);
      applyCoverField(FM_PAGE_COVER_POSITION, '');
    } else {
      applyCoverField(FM_BOOK_COVER, relative);
    }
  }), [applyCoverField, runCoverImport]);

  const handleUploadBook = useCallback(async () => {
    if (!workspacePath || bookUploadLock.current) return;
    bookUploadLock.current = true;
    setBookBusy(true);
    try {
      const imported = await pickAndImportBook(workspacePath);
      if (!imported) return;
      const currentDoc = documentText(ydoc).toString();
      const existingPages = parseFrontmatter(currentDoc)?.data.pages;
      const { formatted } = formatSyntheticPages(
        typeof existingPages === 'string' ? existingPages : undefined,
        imported.byteLength,
      );
      applyCoverField(FM_BOOK_FILE, imported.relative);
      applyCoverField('pages', formatted);
    } catch (error) {
      console.error('Failed to import book file', error);
    } finally {
      bookUploadLock.current = false;
      setBookBusy(false);
    }
  }, [applyCoverField, workspacePath, ydoc]);

  const handleReplacePageCover = useCallback(() => {
    void uploadCover('page');
  }, [uploadCover]);

  const handleRandomPageCover = useCallback(() => {
    applyCoverField('cover', 'true');
    applyCoverField(FM_PAGE_COVER, nextRandomCoverPattern(resolved.pageCoverUrl));
    applyCoverField(FM_PAGE_COVER_POSITION, '');
  }, [applyCoverField, resolved.pageCoverUrl]);

  const handleReplaceBookCover = useCallback(() => {
    void uploadCover('book');
  }, [uploadCover]);

  const handleRemoveBookCover = useCallback(() => {
    applyCoverField(FM_BOOK_COVER, '');
  }, [applyCoverField]);

  const handlePasteBookCover = useCallback((file: File) => {
    void runCoverImport(async (root) => {
      applyCoverField(FM_BOOK_COVER, await importCoverBytes(root, file));
    });
  }, [applyCoverField, runCoverImport]);

  const handleRemovePageCover = useCallback(() => {
    applyCoverField('cover', '');
    applyCoverField(FM_PAGE_COVER, '');
    applyCoverField(FM_PAGE_COVER_POSITION, '');
  }, [applyCoverField]);

  const handlePageCoverPositionChange = useCallback((position: string) => {
    applyCoverField(FM_PAGE_COVER_POSITION, position);
  }, [applyCoverField]);

  return {
    metadata,
    resolved,
    isBook,
    hasCover,
    bookFile,
    bookAttached,
    pageLayout,
    coverUploading,
    bookBusy,
    handleReplacePageCover,
    handleRandomPageCover,
    handleReplaceBookCover,
    handleRemoveBookCover,
    handlePasteBookCover,
    handleRemovePageCover,
    handlePageCoverPositionChange,
    handleUploadBook,
  };
}
