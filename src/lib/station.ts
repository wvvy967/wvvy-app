// Single source of truth for everything WVVY-specific. This app is a
// single-station player, so these are constants rather than env config — but
// they're centralised here so a rebrand or a station move is one file.

export const STATION = {
  name: 'WVVY 96.7 LPFM',
  shortName: 'WVVY',
  frequency: '96.7',
  legalName: 'WVVY-LP',
  licensee: 'Martha’s Vineyard Community Radio, Inc.',
  tagline: 'Free-form community radio',
  city: 'Tisbury, MA 02568',
  location: 'Tisbury, Martha’s Vineyard',
  poBox: 'PO Box 1989',
  email: 'stationmanager@wvvy.org',
  website: 'https://wvvy.org'
} as const;

// AzuraCast Icecast mount, served over HTTPS straight from the station's own
// install — no proxy in between.
const STREAM_URL = 'https://radio.wvvy.org/listen/wvvy/radio.mp3';

// `nocache` busts any intermediary cache per tune-in (Icecast ignores the extra
// query string). Native players are especially prone to resuming a stale
// buffered response otherwise.
export function streamUrl(): string {
  return `${STREAM_URL}?nocache=${Math.floor(Math.random() * 1_000_000)}`;
}

export const NOWPLAYING_API_URL = 'https://radio.wvvy.org/api/station/wvvy/nowplaying';

// Stable, shareable endpoints for "other ways to listen" — the bare mount pastes
// into any player or smart speaker; the playlist files suit hardware that wants
// .pls/.m3u (car stereos, Sonos, VLC). No nocache: these are meant to be saved.
export const LISTEN = {
  direct: STREAM_URL,
  pls: 'https://radio.wvvy.org/public/wvvy/playlist.pls',
  m3u: 'https://radio.wvvy.org/public/wvvy/playlist.m3u',
  publicPage: 'https://radio.wvvy.org/public/wvvy'
} as const;

export const PAYPAL_URL = 'https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=PFTS9Z9VF67RC';
export const VENMO_HANDLE = 'WVVY967';
export const VENMO_URL = 'https://venmo.com/u/WVVY967';

export const storageKeys = {
  volume: 'wvvy:volume'
} as const;
