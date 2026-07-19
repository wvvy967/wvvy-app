// AzuraCast public "now playing" API for the WVVY station. This module holds the
// pure pieces — response types and a mapper that flattens AzuraCast's nested
// JSON into the flat shape the UI consumes. Polling lives in nowplaying.svelte.ts.

export type Track = {
  artist: string;
  title: string;
  album?: string;
  art?: string;
  // Epoch seconds (UTC) the track started, when AzuraCast reports it.
  playedAt?: number;
};

export type NowPlayingData = {
  nowPlaying: Track;
  playingNext: Track | null;
  history: Track[];
  // Note: AzuraCast also reports listener counts. The app deliberately does not
  // surface them — an online-listener number is a fraction of an FM audience and
  // means nothing to someone just tuning in — so they aren't parsed at all.
  // A live DJ (Web DJ / streamer) connected via the harbor input.
  live: { isLive: boolean; streamer: string };
  bitrate: number | null;
  format: string | null;
  // Position within the current track, in seconds.
  elapsed: number;
  duration: number;
};

// AzuraCast's nested response is loosely typed here — we read defensively and
// fall back to safe defaults so a shape change upstream degrades gracefully
// rather than throwing during render.
type RawSong = { artist?: string; title?: string; album?: string; art?: string };
type RawNowPlaying = { song?: RawSong; played_at?: number; elapsed?: number; duration?: number };
type RawHistoryEntry = { played_at?: number; song?: RawSong };
type RawMount = { bitrate?: number; format?: string; is_default?: boolean };

export type RawResponse = {
  station?: { mounts?: RawMount[] };
  live?: { is_live?: boolean; streamer_name?: string };
  now_playing?: RawNowPlaying;
  playing_next?: RawNowPlaying | null;
  song_history?: RawHistoryEntry[];
};

function mapSong(song: RawSong | undefined, playedAt?: number): Track {
  return {
    artist: song?.artist?.trim() ?? '',
    title: song?.title?.trim() ?? '',
    album: song?.album?.trim() || undefined,
    art: song?.art || undefined,
    playedAt
  };
}

export function parseNowPlaying(raw: RawResponse): NowPlayingData {
  const mount = raw.station?.mounts?.find((m) => m.is_default) ?? raw.station?.mounts?.[0];
  return {
    nowPlaying: mapSong(raw.now_playing?.song, raw.now_playing?.played_at),
    playingNext: raw.playing_next?.song ? mapSong(raw.playing_next.song) : null,
    history: (raw.song_history ?? []).map((h) => mapSong(h.song, h.played_at)),
    live: {
      isLive: raw.live?.is_live ?? false,
      streamer: raw.live?.streamer_name?.trim() ?? ''
    },
    bitrate: mount?.bitrate ?? null,
    format: mount?.format ?? null,
    elapsed: raw.now_playing?.elapsed ?? 0,
    duration: raw.now_playing?.duration ?? 0
  };
}

// A track counts as "real" once it has a title or artist — the station serves a
// blank payload before the backend reports its first song.
export function hasTrack(t: Track | null | undefined): boolean {
  if (!t) return false;
  return t.title.length > 0 || t.artist.length > 0;
}

// M:SS for track-progress readouts.
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Local wall-clock HH:MM for history rows. Unlike the website (which labels
// times UTC), a phone is always in the listener's zone — so show their time.
export function fmtLocalClock(epoch: number | undefined): string {
  if (!epoch || !Number.isFinite(epoch)) return '--:--';
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
