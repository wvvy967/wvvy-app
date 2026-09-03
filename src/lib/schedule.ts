// Weekly DJ schedule. Times are fractional hours and may run past 24 for shows
// that wrap past midnight (a show ending at 25 ends at 1:00 AM), so everything
// here normalises before formatting.

export type Show = {
  show: string;
  dj: string;
  start: number;
  end: number;
  display: string;
};

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type Day = (typeof DAYS)[number];

// Full names for headings; the abbreviations above stay the storage/key form.
export const DAY_FULL: Record<Day, string> = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday'
};

/** The week reordered to start at `from` (default today), so today leads. */
export function weekFrom(from: Day = currentDay()): Day[] {
  const i = DAYS.indexOf(from);
  return [...DAYS.slice(i), ...DAYS.slice(0, i)];
}

// 20.25 → "8:15 PM" ; 24 → "12:00 AM"
export function formatHour(h: number): string {
  const norm = ((h % 24) + 24) % 24;
  const hh = Math.floor(norm);
  const mm = Math.round((norm - hh) * 60);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

// "5:00 PM — 7:30 PM" is wider than a phone row, so a range that stays within one
// half of the day drops the redundant first meridiem. Ranges that cross noon or
// midnight keep both: "8:55 PM — 12:00 AM".
export function formatRange(start: number, end: number): string {
  const from = formatHour(start);
  const to = formatHour(end);
  const fromParts = from.split(' ');
  const toParts = to.split(' ');
  return fromParts[1] === toParts[1] ? `${fromParts[0]} — ${to}` : `${from} — ${to}`;
}

// Static fallback, used until the live sheet loads and kept if it never does.
// `display` is derived below so these stay in sync with start/end.
const FALLBACK: Record<Day, Omit<Show, 'display'>[]> = {
  Sun: [
    { show: 'SUNDAY SESSIONS', dj: 'RICKY PRIME', start: 12, end: 14 },
    { show: 'OPEN YER EARS', dj: 'ALLEN', start: 19.5, end: 21.5 }
  ],
  Mon: [
    { show: 'Piece of Work', dj: 'Mike Reed', start: 16, end: 18 },
    { show: 'Left Of The Dial', dj: 'DARTH & DJ Z', start: 18, end: 21 }
  ],
  Tue: [
    { show: 'THE GG SPOT', dj: 'GIMILI', start: 17, end: 19 },
    { show: 'KITCHEN TABLE', dj: 'GREGORY', start: 20, end: 23 }
  ],
  Wed: [{ show: 'THE ROCK AND ROLL RICK DOUBLE HOUR', dj: 'ROCK AND ROLL RICK', start: 17, end: 19.5 }],
  Thu: [{ show: 'TWO SEVENS CLASH', dj: 'JAHSHECKY', start: 20.25, end: 23 }],
  Fri: [
    { show: "SOUNDS LIKE THE 80'S", dj: 'CJ', start: 16, end: 18 },
    { show: 'WORLD ACCORDING TO MUSIC', dj: 'HOCINE', start: 18, end: 20 },
    { show: 'ELECTRO LOUNGE', dj: 'RCF (RICHARD CARL)', start: 20.92, end: 24 }
  ],
  Sat: [{ show: 'TWO FARLOURS', dj: 'FARLS', start: 20, end: 22 }]
};

export const SCHEDULE: Record<Day, Show[]> = Object.fromEntries(DAYS.map((d) => [d, FALLBACK[d].map((s) => ({ ...s, display: formatRange(s.start, s.end) }))])) as Record<Day, Show[]>;

export function currentDay(date = new Date()): Day {
  return DAYS[date.getDay()]!;
}

// Fractional hour of the given moment, for "on now" comparisons.
export function currentHour(date = new Date()): number {
  return date.getHours() + date.getMinutes() / 60;
}

/**
 * Whether a show is airing at `hour` on its own day. Shows that wrap past
 * midnight carry an end past 24, so a show running 11 PM–1 AM is on at 23.5 but
 * also — from the *next* day's perspective — at 0.5. Only the same-day case is
 * handled here; the caller decides which day it is asking about.
 */
export function isOnNow(show: Show, hour: number): boolean {
  return hour >= show.start && hour < show.end;
}
