import { fileName } from '../paths';
import { createTracer } from './trace';

type OpenStage =
  | 'request'
  | 'file'
  | 'replica'
  | 'doc'
  | 'mount'
  | 'scroll'
  | 'links'
  | 'images'
  | 'callouts'
  | 'dataview';

const tracer = createTracer<OpenStage>({
  name: 'open',
  origin: 'now',
  order: ['request', 'file', 'replica', 'doc', 'mount', 'scroll', 'links', 'images', 'callouts', 'dataview'],
  labels: {
    request: 'React дошёл до запроса файла',
    file: 'файл прочитан с диска',
    replica: 'реплика IndexedDB подключена',
    doc: 'текст документа готов',
    mount: 'редактор смонтирован',
    scroll: 'прокрутка восстановлена',
    links: 'вики-ссылки разрешены',
    images: 'вложения разрешены',
    callouts: 'книжные строки',
    dataview: 'запросы dataview',
  },
});

export function beginOpenTrace(path: string): void {
  tracer.begin(fileName(path));
}

export function markOpenStage(stage: OpenStage): void {
  tracer.mark(stage);
}
