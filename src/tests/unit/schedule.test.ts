import { describe, it, expect } from 'vitest';
import { formatHour, formatRange, isOnNow, currentDay, SCHEDULE, DAYS } from '$lib/schedule';
import { parseTime, parseGvizText, rowsToSchedule } from '$lib/stores/schedule.svelte';

describe('formatHour', () => {
  it('formats fractional hours as 12-hour clock time', () => {
    expect(formatHour(0)).toBe('12:00 AM');
    expect(formatHour(12)).toBe('12:00 PM');
    expect(formatHour(20.25)).toBe('8:15 PM');
    expect(formatHour(16)).toBe('4:00 PM');
  });

  // Shows that wrap past midnight carry an end past 24.
  it('normalises hours past midnight', () => {
    expect(formatHour(24)).toBe('12:00 AM');
    expect(formatHour(25)).toBe('1:00 AM');
  });
});

describe('formatRange', () => {
  it('drops the redundant meridiem within one half of the day', () => {
    expect(formatRange(17, 19)).toBe('5:00 — 7:00 PM');
  });

  it('keeps both when the range crosses noon or midnight', () => {
    expect(formatRange(20.92, 24)).toBe('8:55 PM — 12:00 AM');
    expect(formatRange(11, 13)).toBe('11:00 AM — 1:00 PM');
  });
});

describe('isOnNow', () => {
  const show = { show: 'X', dj: 'Y', start: 20, end: 22, display: '' };

  it('is true inside the window and false outside', () => {
    expect(isOnNow(show, 20)).toBe(true);
    expect(isOnNow(show, 21.5)).toBe(true);
    expect(isOnNow(show, 19.99)).toBe(false);
  });

  // End-exclusive, so a show ending at 22 and one starting at 22 never both
  // read as "on now".
  it('excludes the end boundary', () => {
    expect(isOnNow(show, 22)).toBe(false);
  });
});

describe('currentDay', () => {
  it('maps a date to its short day name', () => {
    // 2026-07-18 is a Saturday.
    expect(currentDay(new Date('2026-07-18T12:00:00'))).toBe('Sat');
    expect(currentDay(new Date('2026-07-19T12:00:00'))).toBe('Sun');
  });
});

describe('static fallback', () => {
  it('covers every day and derives display strings', () => {
    for (const d of DAYS) {
      expect(SCHEDULE[d]).toBeDefined();
      for (const show of SCHEDULE[d]) {
        expect(show.display).toBe(formatRange(show.start, show.end));
      }
    }
  });
});

describe('parseTime', () => {
  it('parses 12-hour times into fractional hours', () => {
    expect(parseTime('12:00 AM')).toBe(0);
    expect(parseTime('12:00 PM')).toBe(12);
    expect(parseTime('8:15 PM')).toBe(20.25);
    expect(parseTime('  4:00 pm  ')).toBe(16);
  });

  it('rejects anything it does not understand', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('20:00')).toBeNull();
    expect(parseTime('noon')).toBeNull();
  });
});

describe('parseGvizText', () => {
  it('strips the google.visualization wrapper', () => {
    const body = '/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"ok","table":{"rows":[]}});';
    expect(parseGvizText(body)).toEqual({ status: 'ok', table: { rows: [] } });
  });

  it('throws on a payload with no JSON body', () => {
    expect(() => parseGvizText('not json at all')).toThrow(/malformed/);
  });
});

describe('rowsToSchedule', () => {
  const header = { c: [{ v: 'Day' }, { v: 'Start' }, { v: 'End' }, { v: 'Show' }, { v: 'DJ' }] };
  const row = (day: string, start: string, end: string, show: string, dj: string) => ({
    c: [{ v: day }, { v: start }, { v: end }, { v: show }, { v: dj }]
  });

  it('maps sheet rows into per-day shows', () => {
    const out = rowsToSchedule([header, row('Friday', '4:00 PM', '6:00 PM', 'Sounds Like The 80s', 'CJ')]);
    expect(out.Fri).toHaveLength(1);
    expect(out.Fri[0]).toMatchObject({ show: 'Sounds Like The 80s', dj: 'CJ', start: 16, end: 18 });
  });

  // The sheet writes DJ names inconsistently; the UI renders its own "DJ" prefix.
  it('strips a leading "DJ " from the name', () => {
    const out = rowsToSchedule([header, row('Monday', '6:00 PM', '9:00 PM', 'Left Of The Dial', 'DJ Z')]);
    expect(out.Mon[0]?.dj).toBe('Z');
  });

  it('extends shows that wrap past midnight', () => {
    const out = rowsToSchedule([header, row('Thursday', '11:00 PM', '1:00 AM', 'Late Set', 'Nobody')]);
    expect(out.Thu[0]?.start).toBe(23);
    expect(out.Thu[0]?.end).toBe(25);
  });

  it('sorts each day by start time', () => {
    const out = rowsToSchedule([header, row('Tuesday', '8:00 PM', '11:00 PM', 'Late', 'A'), row('Tuesday', '5:00 PM', '7:00 PM', 'Early', 'B')]);
    expect(out.Tue.map((s) => s.show)).toEqual(['Early', 'Late']);
  });

  // A half-filled row is routine in a hand-edited sheet and must not poison the
  // whole schedule.
  it('skips rows with an unknown day, no show name, or unparseable times', () => {
    const out = rowsToSchedule([header, row('Someday', '4:00 PM', '6:00 PM', 'Bad Day', 'X'), row('Monday', '4:00 PM', '6:00 PM', '', 'X'), row('Monday', 'whenever', '6:00 PM', 'Bad Time', 'X')]);
    expect(Object.values(out).flat()).toHaveLength(0);
  });

  it('tolerates missing cells', () => {
    const out = rowsToSchedule([header, { c: [{ v: 'Monday' }, null, null, null, null] }]);
    expect(out.Mon).toHaveLength(0);
  });
});
