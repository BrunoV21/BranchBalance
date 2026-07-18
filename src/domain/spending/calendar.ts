import type { CalendarDate } from '@/domain/types';

const calendarPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface LocalCalendar {
  today(): CalendarDate;
}

export function calendarDateFromLocalDate(date: Date): CalendarDate {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isCalendarDate(value: string): value is CalendarDate {
  const match = calendarPattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  return instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day;
}

export function calendarDayOrdinal(value: CalendarDate): number {
  const match = calendarPattern.exec(value);
  if (!match || !isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

export function inclusiveCalendarDays(start: CalendarDate, end: CalendarDate): number {
  return calendarDayOrdinal(end) - calendarDayOrdinal(start) + 1;
}

export const systemLocalCalendar: LocalCalendar = {
  today: () => calendarDateFromLocalDate(new Date()),
};
