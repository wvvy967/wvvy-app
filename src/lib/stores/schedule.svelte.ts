import { DAYS, SCHEDULE, formatRange, type Day, type Show } from '../schedule';

// Public Google Sheet → gviz/tq endpoint. The sheet's "Share → publish to web"
// lets the station manager edit the schedule in Google Sheets and have the app
// pick it up on next load. No API key needed; Google reflects CORS origins for
// this endpoint, which is also why it works from the native webview.
const SHEET_ID = '1OMuXmpMk_Cu_rfNXb4WqV7PVVYB2wkKTyJNDG5dkpZg';
const SHEET_GID = '1098761152';
const FEED_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;

type GvizCell = { v: string | number | null } | null;
type GvizRow = { c: GvizCell[] };
type GvizResponse = { status: string; table: { rows: GvizRow[] } };

const DAY_BY_FULL: Record<string, Day> = {
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat'
};

// "8:15 PM" → 20.25 ; "12:00 AM" → 0 ; "12:00 PM" → 12
export function parseTime(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const mins = parseInt(m[2]!, 10);
  const pm = m[3]!.toUpperCase() === 'PM';
  if (h === 12) h = 0;
  if (pm) h += 12;
  return h + mins / 60;
}

// Strips the `/*O_o*/\ngoogle.visualization.Query.setResponse(...);` wrapper
// Google wraps the JSON in.
export function parseGvizText(text: string): GvizResponse {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('malformed gviz payload');
  return JSON.parse(text.slice(start, end + 1)) as GvizResponse;
}

export function rowsToSchedule(rows: GvizRow[]): Record<Day, Show[]> {
  const out: Record<Day, Show[]> = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] };
  // Row 0 is the header.
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]?.c ?? [];
    const dayRaw = String(cells[0]?.v ?? '').toLowerCase();
    const startRaw = cells[1]?.v == null ? '' : String(cells[1]!.v);
    const endRaw = cells[2]?.v == null ? '' : String(cells[2]!.v);
    const showName = cells[3]?.v == null ? '' : String(cells[3]!.v).trim();
    const djName = cells[4]?.v == null ? '' : String(cells[4]!.v).trim();

    const day = DAY_BY_FULL[dayRaw];
    if (!day || !showName) continue;
    const start = parseTime(startRaw);
    let end = parseTime(endRaw);
    if (start == null || end == null) continue;
    // Shows that wrap past midnight — the end time is the next morning.
    if (end <= start) end += 24;

    out[day].push({
      show: showName,
      // The sheet writes DJ names inconsistently; strip a leading "DJ " so the
      // UI can render the prefix itself without doubling it up.
      dj: djName.replace(/^DJ\s+/i, ''),
      start,
      end,
      display: formatRange(start, end)
    });
  }
  for (const d of DAYS) out[d].sort((a, b) => a.start - b.start);
  return out;
}

class ScheduleFeed {
  data = $state<Record<Day, Show[]>>(SCHEDULE);
  loading = $state(false);
  error = $state<string | null>(null);
  source = $state<'static' | 'sheet'>('static');

  #loaded = false;

  /** Fetches once per app session; the sheet changes far less often than a poll. */
  async load(force = false) {
    if (this.#loaded && !force) return;
    this.loading = true;
    this.error = null;
    try {
      const res = await fetch(FEED_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const parsed = parseGvizText(await res.text());
      if (parsed.status !== 'ok') throw new Error(`gviz status ${parsed.status}`);
      this.data = rowsToSchedule(parsed.table.rows);
      this.source = 'sheet';
      this.#loaded = true;
    } catch (err) {
      // Keep the static fallback already in `data` — a stale schedule beats an
      // empty screen. The UI shows a small notice so it's not passed off as live.
      this.error = err instanceof Error ? err.message : 'failed to load schedule';
    } finally {
      this.loading = false;
    }
  }
}

export const scheduleFeed = new ScheduleFeed();
