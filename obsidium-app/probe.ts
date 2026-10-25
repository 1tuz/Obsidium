
import { ChangeSet, Text } from '@codemirror/state';
import { noteEmbedBodyRange } from './src/modules/docs/noteEmbedEditing';
const text = Text.of('## Plan'.split('\n'));
const r = noteEmbedBodyRange(text, 'Plan');
const full = ChangeSet.of({ from: 0 + r!.from, to: 0 + r!.from, insert: 'x' }, text.length);
console.log(JSON.stringify(r), JSON.stringify(full.apply(text).toString()));
