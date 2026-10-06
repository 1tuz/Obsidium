import { createAtFreeName, createFile } from '../documents/fileGateway';
import { fileStem, siblingPath } from '../paths';
import { formatMoment } from '../templates/placeholders';

export type ConflictCause = 'diverged' | 'no-sync-point' | 'displaced' | 'truncated' | 'reverted';

export interface ConflictReport {
  cause: ConflictCause;
  diskHash?: string;
  syncedHash?: string;
}

interface Explanation {
  title: string;
  why: string;
}

const EXPLANATIONS: Record<ConflictCause, Explanation> = {
  diverged: {
    title: 'файл и документ изменились одновременно',
    why: 'И файл на диске, и открытый в редакторе документ изменились после последней сверки.'
      + ' Свести их без потери было нельзя, поэтому в заметке осталась версия с диска,'
      + ' а версия из редактора сохранена здесь.',
  },
  'no-sync-point': {
    title: 'точка сверки недоступна',
    why: 'Хранилище точек синхронизации не ответило, поэтому сравнить версии было нечем.'
      + ' Приложение не стало молча выбирать сторону: в заметке осталась версия с диска,'
      + ' а версия из редактора сохранена здесь.',
  },
  displaced: {
    title: 'строки не поместились при слиянии',
    why: 'В заметку приехала внешняя правка, и её сведение с тем, что набиралось в редакторе,'
      + ' вытеснило строки ниже. Остальной текст заметки цел.',
  },
  reverted: {
    title: 'изменения версии отменены поверх более поздних правок',
    why: 'Отмена изменений одной версии из истории задела строки, которые правились позже.'
      + ' В заметке эти места вернулись к виду до той версии, а более поздний текст этих строк'
      + ' сохранён здесь.',
  },
  truncated: {
    title: 'заметка обнулена при сохранении',
    why: 'Сохранение записало в заметку пустой текст, хотя до этого в ней был текст.'
      + ' Прежнее содержимое сохранено здесь до того, как файл был обнулён.'
      + ' Если вы очистили заметку сами, эту копию можно просто удалить.',
  },
};

const STAMP_PATTERN = 'YYYY-MM-DD HH-mm';
const MOMENT_PATTERN = 'YYYY-MM-DD HH:mm';

function quoted(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function report(filePath: string, stem: string, detail: ConflictReport, now: Date): string {
  const explanation = EXPLANATIONS[detail.cause];
  const lines = [
    '---',
    `конфликт: ${formatMoment(MOMENT_PATTERN, now)}`,
    `заметка: ${quoted(stem)}`,
    `причина: ${quoted(explanation.title)}`,
    '---',
    '',
    `> Это конфликтная копия. Текст ниже не попал в заметку «${stem}»`
      + ' — он сохранён здесь, чтобы не пропасть.',
    '>',
    `> **Почему.** ${explanation.why}`,
    '>',
    `> **Когда.** ${formatMoment(MOMENT_PATTERN, now)}`,
    `> **Заметка.** \`${filePath}\``,
  ];
  if (detail.diskHash) {
    lines.push(`> **Отпечаток файла на диске.** \`${oneLine(detail.diskHash)}\``);
  }
  if (detail.syncedHash) {
    lines.push(`> **Отпечаток последней сверки.** \`${oneLine(detail.syncedHash)}\``);
  }
  lines.push('', '## Текст, который не попал в заметку', '');
  return lines.join('\n');
}

export async function writeConflictCopy(
  filePath: string,
  body: string,
  detail: ConflictReport,
  now: Date = new Date(),
): Promise<string | null> {
  if (!body.trim()) return null;
  const stem = fileStem(filePath);
  const label = `${stem} (конфликт ${formatMoment(STAMP_PATTERN, now)})`;
  const content = report(filePath, stem, detail, now)
    + (body.endsWith('\n') ? body : `${body}\n`);

  return createAtFreeName(
    (attempt) => siblingPath(filePath, `${label}${attempt === 0 ? '' : ` ${attempt + 1}`}.md`),
    (target) => createFile(target, content),
  );
}
