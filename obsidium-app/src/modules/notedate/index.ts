export interface NoteDate {
  year: number;
  month: number;
  day: number;
}

const SEPARATOR = /[-.]/;
const DIGITS = /^\d+$/;
const THIRTY_ONE_DAY_MONTHS = [1, 3, 5, 7, 8, 10, 12];
const THIRTY_DAY_MONTHS = [4, 6, 9, 11];

function number(field: string): number | null {
  return DIGITS.test(field) ? Number(field) : null;
}

function daysInMonth(year: number, month: number): number {
  if (THIRTY_ONE_DAY_MONTHS.includes(month)) return 31;
  if (THIRTY_DAY_MONTHS.includes(month)) return 30;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leap ? 29 : 28;
}

export function parseNoteDate(value: string): NoteDate | null {
  const head = value.split(/[Tt ]/).filter((part) => part !== '')[0];
  if (head === undefined) return null;
  const separator = SEPARATOR.exec(head)?.[0];
  if (separator === undefined) return null;
  const fields = head.split(separator);
  if (fields.length !== 3) return null;
  const [first, middle, third] = fields;
  const month = number(middle);
  let year: number | null;
  let day: number | null;
  if (first.length === 4) {
    year = number(first);
    day = number(third);
  } else if (third.length === 4) {
    year = number(third);
    day = number(first);
  } else {
    return null;
  }
  if (year === null || month === null || day === null) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function noteDateToIso(date: NoteDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}
