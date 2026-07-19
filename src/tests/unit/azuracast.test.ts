import { describe, it, expect } from 'vitest';
import { parseNowPlaying, hasTrack, fmtDuration, fmtLocalClock, type RawResponse } from '$lib/azuracast';

describe('parseNowPlaying', () => {
  it('flattens a full AzuraCast payload', () => {
    const raw: RawResponse = {
      station: {
        mounts: [
          { bitrate: 64, format: 'aac', is_default: false },
          { bitrate: 128, format: 'mp3', is_default: true }
        ]
      },
      live: { is_live: true, streamer_name: '  DJ Z  ' },
      now_playing: {
        song: { artist: ' Sonic Youth ', title: ' Teen Age Riot ', album: 'Daydream Nation', art: 'https://art' },
        played_at: 1_700_000_000,
        elapsed: 42,
        duration: 260
      },
      playing_next: { song: { artist: 'Slint', title: 'Good Morning, Captain' } },
      song_history: [{ played_at: 1_699_999_000, song: { artist: 'Wire', title: 'Outdoor Miner' } }]
    };

    const data = parseNowPlaying(raw);

    // The default mount wins over the first one listed.
    expect(data.bitrate).toBe(128);
    expect(data.format).toBe('mp3');
    // Whitespace from the encoder is trimmed everywhere.
    expect(data.nowPlaying.artist).toBe('Sonic Youth');
    expect(data.nowPlaying.title).toBe('Teen Age Riot');
    expect(data.live).toEqual({ isLive: true, streamer: 'DJ Z' });
    expect(data.playingNext?.title).toBe('Good Morning, Captain');
    expect(data.history).toHaveLength(1);
    expect(data.elapsed).toBe(42);
  });

  it('falls back to the first mount when none is flagged default', () => {
    const data = parseNowPlaying({ station: { mounts: [{ bitrate: 96, format: 'mp3' }] } });
    expect(data.bitrate).toBe(96);
  });

  // The station serves a near-empty payload before the backend reports a song,
  // and a shape change upstream shouldn't throw during render.
  it('degrades gracefully on an empty payload', () => {
    const data = parseNowPlaying({});
    expect(data.nowPlaying).toEqual({ artist: '', title: '', album: undefined, art: undefined, playedAt: undefined });
    expect(data.history).toEqual([]);
    expect(data.playingNext).toBeNull();
    expect(data.bitrate).toBeNull();
    expect(data.live.isLive).toBe(false);
  });

  it('treats a playing_next without a song as absent', () => {
    expect(parseNowPlaying({ playing_next: {} }).playingNext).toBeNull();
  });
});

describe('hasTrack', () => {
  it('needs a title or an artist', () => {
    expect(hasTrack({ artist: '', title: '' })).toBe(false);
    expect(hasTrack({ artist: 'Wire', title: '' })).toBe(true);
    expect(hasTrack({ artist: '', title: 'Outdoor Miner' })).toBe(true);
    expect(hasTrack(null)).toBe(false);
    expect(hasTrack(undefined)).toBe(false);
  });
});

describe('fmtDuration', () => {
  it('formats seconds as M:SS', () => {
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(9)).toBe('0:09');
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(600)).toBe('10:00');
  });

  it('guards against non-finite and negative input', () => {
    expect(fmtDuration(NaN)).toBe('0:00');
    expect(fmtDuration(Infinity)).toBe('0:00');
    expect(fmtDuration(-5)).toBe('0:00');
  });
});

describe('fmtLocalClock', () => {
  it('renders a placeholder for missing timestamps', () => {
    expect(fmtLocalClock(undefined)).toBe('--:--');
    expect(fmtLocalClock(0)).toBe('--:--');
    expect(fmtLocalClock(NaN)).toBe('--:--');
  });

  it('formats an epoch as a local HH:MM', () => {
    expect(fmtLocalClock(1_700_000_000)).toMatch(/^\d{1,2}:\d{2}(\s?[AP]M)?$/i);
  });
});
