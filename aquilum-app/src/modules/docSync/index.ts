export { applyEditsToText, type TextEdit } from './textDiff';
export { mergeExternalChange } from './mergeText';
export {
  writeSyncRecord,
  forgetSyncRecord,
  moveSyncRecord,
} from './syncRecord';
export { writeConflictCopy } from './conflictCopy';
export {
  applyDocumentText,
  applyTextEdits,
  documentText,
  EXTERNAL_ORIGIN,
  DIRECT_WRITE_ORIGIN,
} from './applyExternalText';
export { createDiskSync } from './diskSync';
export { useExternalDocSync } from './useExternalDocSync';
