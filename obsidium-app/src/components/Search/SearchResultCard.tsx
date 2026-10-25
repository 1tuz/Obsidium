import { File } from 'lucide';
import { Icon } from '../Common/Icon';
import { Chip } from '../Common/Chip';
import type { SearchResult } from '../../modules/search';
import { highlightMatches } from './highlight';
import './SearchResultCard.css';
import { plural, t } from '../../i18n';

interface SearchResultCardProps {
  result: SearchResult;
  queryTerms: string[];
  selected: boolean;
  onSelect: (newTab: boolean) => void;
  onHover: () => void;
  onAddQueryTerm: (term: string) => void;
}

export function SearchResultCard({
  result,
  queryTerms,
  selected,
  onSelect,
  onHover,
  onAddQueryTerm,
}: SearchResultCardProps) {
  const matchedTerms = result.matchedTerms ?? [];
  const matchedTags = result.matchedTags ?? [];
  const snippetTerms = result.matchedTerms ?? queryTerms;

  return (
    <div
      role="option"
      aria-selected={selected}
      className={`q-search-result ${selected ? 'is-selected' : ''}`}
      onClick={(event) => onSelect(event.ctrlKey || event.metaKey)}
      onMouseEnter={onHover}
      data-result-path={result.path}
    >
      <span className="q-search-result__header">
        <span className="q-search-result__identity">
          <Icon icon={File} className="q-search-result__icon" />
          <span className="q-search-result__filename">
            <span className="q-search-result__title">{highlightMatches(result.title, queryTerms)}</span>
            {result.extension && (
              <span className="q-search-result__extension">
                .{highlightMatches(result.extension, queryTerms)}
              </span>
            )}
          </span>
          {result.heading && (
            <span className="q-search-result__heading" title={result.heading}>
              {result.heading}
            </span>
          )}
        </span>
        <span className="q-search-result__count">{formatMatchCount(result.matchCount)}</span>
      </span>
      {matchedTerms.length + matchedTags.length > 0 && (
        <span className="q-search-result__matches">
          {matchedTerms.map((term) => (
            <Chip
              key={`term:${term}`}
              className="q-search-result__chip"
              label={term}
              title={t('search.addTermHint')}
              aria-label={t('search.addTermToQuery', { term })}
              onClick={(event) => {
                event.stopPropagation();
                onAddQueryTerm(term);
              }}
            />
          ))}
          {matchedTags.map((tag) => (
            <Chip
              key={`tag:${tag}`}
              className="q-search-result__chip q-search-result__chip--tag"
              label={`#${tag}`}
              title={t('search.addTagHint')}
              aria-label={t('search.addTagToQuery', { tag })}
              onClick={(event) => {
                event.stopPropagation();
                onAddQueryTerm(`tag:${tag}`);
              }}
            />
          ))}
        </span>
      )}
      <span className="q-search-result__snippet">
        {highlightMatches(result.snippet, snippetTerms)}
      </span>
    </div>
  );
}

function formatMatchCount(count: number): string {
  return plural('search.matches', count);
}
