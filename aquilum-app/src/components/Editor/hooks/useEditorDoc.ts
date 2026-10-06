import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import type * as Y from 'yjs';
import {
    getManagedWriter,
    getOrCreateDoc,
    isDocReconciled,
    isDocSynced,
    markDocReconciled,
    markDocSynced,
    releaseDoc,
    retainDoc,
    setManagedWriter,
} from '../../../modules/docs';
import { connectDoc } from '../../../modules/sync';
import {
    createDiskSync,
    documentText,
    useExternalDocSync,
    writeConflictCopy,
    writeSyncRecord,
    EXTERNAL_ORIGIN,
    DIRECT_WRITE_ORIGIN,
    type TextEdit,
} from '../../../modules/docSync';
import { useSettingsStore } from '../../../modules/settings';
import { markOpenStage } from '../../../modules/perf/openTrace';
import { warmDataviewResults } from '../extensions/dataview';
import { DocumentFileWriter } from '../../../modules/documents/DocumentFileWriter';
import { EDIT_WRITE, isFileCommandError, readFileSnapshot } from '../../../modules/documents/fileGateway';
import {
    isRenameConflict,
    renameWorkspaceFile,
} from '../../../modules/documents/renameWorkspaceFile';
import { fileStem } from '../../../modules/paths';
import { failureReason, noteOpenError } from '../noteOpenError';

interface EditorSyncPort {
    onExternalEdit?: (edit: TextEdit) => void;
    readCaret?: () => number | null;
    restoreCaret?: (position: number) => void;
}

export function useEditorDoc(
    filePath: string,
    port?: EditorSyncPort,
    workspacePath?: string | null,
) {
    const portRef = useRef(port);
    portRef.current = port;
    const ydoc = useMemo(() => getOrCreateDoc(filePath), [filePath]);
    const [readyDoc, setReadyDoc] = useState<Y.Doc | null>(() => (isDocSynced(ydoc) ? ydoc : null));
    const title = fileStem(filePath);
    const isReady = readyDoc === ydoc;
    const writerRef = useRef<DocumentFileWriter | null>(null);
    const [missing, setMissing] = useState(false);
    const [openError, setOpenError] = useState<Error | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const missingRef = useRef(false);
    const reportSaveFailure = useCallback((error: unknown) => {
        console.error('Failed to save the note', error);
        setSaveError(failureReason(error));
    }, []);
    const markMissing = useCallback((value: boolean) => {
        if (missingRef.current === value) return;
        missingRef.current = value;
        setMissing(value);
    }, []);
    const filePathRef = useRef(filePath);
    filePathRef.current = filePath;
    const saveDelayRef = useRef(1000);
    saveDelayRef.current = useSettingsStore().config?.editor.saveDebounceMs ?? 1000;

    const diskSync = useMemo(() => createDiskSync({
        ydoc,
        path: () => filePathRef.current,
        writer: () => writerRef.current,
        reconciled: isDocReconciled(ydoc),
        onReconciled: () => markDocReconciled(ydoc),
        onMissingChange: markMissing,
        onExternalEdit: (edit) => portRef.current?.onExternalEdit?.(edit),
        caret: {
            read: () => portRef.current?.readCaret?.() ?? null,
            restore: (position) => portRef.current?.restoreCaret?.(position),
        },
    }), [markMissing, ydoc]);

    useExternalDocSync(isReady ? diskSync : null, filePath);

    const awaitPendingSave = (): Promise<void> => {
        return writerRef.current?.idle() ?? Promise.resolve();
    };

    useEffect(() => {
        if (!isReady) return undefined;
        const ytext = documentText(ydoc);
        const persist = (_update: Uint8Array, origin: unknown) => {
            if (origin === EXTERNAL_ORIGIN || origin === DIRECT_WRITE_ORIGIN || missingRef.current) return;
            writerRef.current?.schedule({
                content: () => ytext.toString(),
                delayMs: saveDelayRef.current,
                onSaved: () => setSaveError(null),
                onError: (error) => {
                    if (isFileCommandError(error, 'conflict')) void diskSync.pull();
                    else reportSaveFailure(error);
                },
            });
        };
        ydoc.on('update', persist);
        return () => ydoc.off('update', persist);
    }, [diskSync, isReady, ydoc]);

    const renameTo = async (nextTitle: string): Promise<boolean> => {
        try {
            await awaitPendingSave();
            const newPath = await renameWorkspaceFile(filePath, nextTitle);
            return newPath !== null;
        } catch (err) {
            if (isRenameConflict(err)) {
                console.warn(`File ${nextTitle.trim()} already exists! Reverting.`);
            } else {
                console.error('Rename failed', err);
            }
            return false;
        }
    };

    useEffect(() => {
        let isMounted = true;
        retainDoc(ydoc);
        markMissing(false);

        if (isDocSynced(ydoc)) {
            writerRef.current = getManagedWriter(ydoc);
            setReadyDoc(ydoc);
            markOpenStage('doc');
            void diskSync.pull();
            return () => {
                isMounted = false;
                void awaitPendingSave().catch(() => {});
                releaseDoc(ydoc);
            };
        }

        const setupDoc = async () => {
            try {
                markOpenStage('request');
                const snapshot = await readFileSnapshot(filePath);
                markOpenStage('file');
                void warmDataviewResults(workspacePath, filePath, snapshot.content);
                if (!isMounted) return;
                const writer = new DocumentFileWriter(filePath, snapshot.hash, snapshot.content);
                writer.onSynced = (path, hash) => {
                    void writeSyncRecord(path, { fileHash: hash, textHash: hash })
                        .catch((error) => console.error('Failed to store the file sync point', error));
                };
                writer.onTruncate = (path, previous) => writeConflictCopy(path, previous, {
                    cause: 'truncated',
                    syncedHash: writer.syncedHash,
                }).then(() => undefined);
                writerRef.current = writer;
                setManagedWriter(ydoc, writer);

                await connectDoc(ydoc, filePath);
                markOpenStage('replica');
                if (!isMounted) return;

                markDocSynced(ydoc);
                await diskSync.pull(snapshot);
                if (!isMounted) return;
                setReadyDoc(ydoc);
                markOpenStage('doc');
            } catch (err) {
                console.error(err);
                if (isMounted) setOpenError(noteOpenError(filePath, err));
            }
        };

        void setupDoc();

        return () => {
            isMounted = false;
            void awaitPendingSave().catch(() => {});
            releaseDoc(ydoc);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ydoc]);

    useEffect(() => () => diskSync.dispose(), [diskSync]);

    useEffect(() => {
        const flush = () => {
            void awaitPendingSave().catch(() => {});
        };
        window.addEventListener('blur', flush);
        return () => window.removeEventListener('blur', flush);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const retrySave = () => {
        writerRef.current?.writeCurrent(() => documentText(ydoc).toString(), EDIT_WRITE)
            .then(() => setSaveError(null), reportSaveFailure);
    };

    return {
        saveError,
        retrySave,
        isReady,
        ydoc,
        title,
        renameTo,
        missing,
        openError,
    };
}
