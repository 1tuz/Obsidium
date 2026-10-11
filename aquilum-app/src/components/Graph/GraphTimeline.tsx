import { useEffect, useState } from 'react';
import { formatDateTime, t } from '../../i18n';
import { Button } from '../Common/Button';
import type { GraphTimelineEvent } from '../../modules/graph';

interface GraphTimelineProps {
  events: GraphTimelineEvent[];
  selectedEventId: number | null;
  loading: boolean;
  snapshotLoading: boolean;
  error: string | null;
  onSelect: (eventId: number | null) => void;
  onOpenChange: (open: boolean) => void;
}

export function GraphTimeline({
  events,
  selectedEventId,
  loading,
  snapshotLoading,
  error,
  onSelect,
  onOpenChange,
}: GraphTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const selectedIndex = events.findIndex(({ eventId }) => eventId === selectedEventId);
  const activeIndex = selectedEventId === null ? events.length - 1 : selectedIndex;
  const currentEvent = events[activeIndex] ?? null;

  useEffect(() => {
    if (playingIndex === null || loading || snapshotLoading) return;
    if (playingIndex >= events.length - 1) {
      setPlayingIndex(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const nextIndex = playingIndex + 1;
      onSelect(events[nextIndex].eventId);
      setPlayingIndex(nextIndex);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [events, loading, onSelect, playingIndex, snapshotLoading]);

  const toggleExpanded = () => {
    const next = !expanded;
    if (!next) {
      setPlayingIndex(null);
      onSelect(null);
    }
    setExpanded(next);
    onOpenChange(next);
  };

  const startPlayback = () => {
    if (events.length < 2) return;
    const startIndex = selectedEventId === null ? 0 : Math.max(selectedIndex, 0);
    onSelect(events[startIndex].eventId);
    setPlayingIndex(startIndex);
  };

  const chooseEvent = (index: number) => {
    setPlayingIndex(null);
    onSelect(events[index].eventId);
  };

  return (
    <section className="q-graph-timeline" aria-label={t('graph.timelineTitle')}>
      <Button size="s" variant="ghost" aria-expanded={expanded} onClick={toggleExpanded}>
        {t(expanded ? 'graph.timelineClose' : 'graph.timelineOpen')}
      </Button>
      {expanded && (
        <div className="q-graph-timeline__controls">
          {events[0] && <span>{t('graph.timelineSince', { date: formatDateTime(events[0].atNs / 1_000_000) })}</span>}
          {events.length > 0 && (
            <>
              <Button
                size="s"
                variant="ghost"
                onClick={() => playingIndex === null ? startPlayback() : setPlayingIndex(null)}
                disabled={loading || events.length < 2}
              >
                {t(playingIndex === null ? 'graph.timelinePlay' : 'graph.timelinePause')}
              </Button>
              <input
                type="range"
                aria-label={t('graph.timelineTitle')}
                min={0}
                max={events.length - 1}
                step={1}
                value={Math.max(activeIndex, 0)}
                disabled={loading || events.length < 2}
                onInput={(event) => chooseEvent(Number(event.currentTarget.value))}
              />
              <span>{currentEvent ? formatDateTime(currentEvent.atNs / 1_000_000) : ''}</span>
              <Button
                size="s"
                variant="ghost"
                onClick={() => {
                  setPlayingIndex(null);
                  onSelect(null);
                }}
                disabled={loading || selectedEventId === null}
              >
                {t('graph.timelineLive')}
              </Button>
            </>
          )}
          {(loading || snapshotLoading) && <span role="status">{t('graph.timelineLoading')}</span>}
          {error && <span role="alert">{error}</span>}
          {!loading && !error && events.length < 2 && <span>{t('graph.timelineEmpty')}</span>}
        </div>
      )}
    </section>
  );
}
