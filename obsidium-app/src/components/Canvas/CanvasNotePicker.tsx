import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { useKnowledgeSearch } from '../../modules/search';
import { CodeMirrorField, type CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { Dialog } from '../Common/Dialog';
import { ScrollArea } from '../Common/ScrollArea';
import { SearchContent } from '../Search/SearchContent';

interface CanvasNotePickerProps {
  open: boolean;
  workspacePath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function CanvasNotePicker({ open, workspacePath, onClose, onSelect }: CanvasNotePickerProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<CodeMirrorFieldRef>(null);
  const search = useKnowledgeSearch({ open, query, workspacePath });
  const results = search.results.filter((result) => result.extension.toLowerCase() === 'md');

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => setSelectedIndex(0), [query]);
  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  const select = (index: number) => {
    const result = results[index];
    if (!result) return;
    onSelect(result.path);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={t('canvas.search.title')}
      headerless
      className="q-search-dialog"
      initialFocus={() => inputRef.current?.select()}
      onClose={onClose}
    >
      <div className="q-search-box">
        <CodeMirrorField
          ref={inputRef}
          className="q-search-input q-canvas-search-input"
          value={query}
          onChange={setQuery}
          placeholder={t('canvas.search.placeholder')}
          ariaLabel={t('canvas.search.placeholder')}
          mode="single-line"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setSelectedIndex((index) => results.length
                ? (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length
                : 0);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              select(selectedIndex);
            }
          }}
        />
      </div>
      <ScrollArea className="q-search-results" role="listbox" aria-label={t('search.resultsAria')}>
        <SearchContent
          {...search}
          query={query}
          results={results}
          selectedIndex={selectedIndex}
          workspacePath={workspacePath}
          onSelectIndex={setSelectedIndex}
          onOpenResult={(result) => select(results.indexOf(result))}
        />
      </ScrollArea>
    </Dialog>
  );
}
