import { useRef } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import {
  applyRelocation,
  NOTES_RELOCATED_EVENT,
  type NotesRelocated,
  type RelocationTargets,
} from './relocation';

export function useNoteRelocation(targets: RelocationTargets): void {
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const queue = useRef(Promise.resolve());

  useTauriEvent<NotesRelocated>(NOTES_RELOCATED_EVENT, (relocation) => {
    queue.current = queue.current
      .then(() => applyRelocation(relocation, targetsRef.current))
      .catch((error) => console.error('Failed to follow relocated notes', error));
  });
}
