# App Review response — WVVY 1.0 (Submission aafe78f0…)

Working notes for clearing the 5.2.3 rejection and the 2.1 information request.
Not committed (covered by global gitignore, like CLAUDE.md).

Fill the `[bracketed]` placeholders before pasting.

Confirmed FCC facts:

- Licensee legal name (501(c)(3)): **Martha's Vineyard Community Radio, Inc.**
- Call sign WVVY-LP · Facility ID 135357 · FRN 0019573492 · Tisbury, MA · 96.7 MHz

---

## 1. Evidence to attach in App Review Information

Attach exactly these two FCC PDFs (both pulled and verified):

- [ ] **`ReferenceCopy (1).pdf`** — 2022 **Renewal of License** (file `0000171624`).
      Granted 03/21/2022, **Active, expires 04/01/2030**. Licensee Martha's Vineyard
      Community Radio, Inc. → THE CURRENT LICENSE.
- [ ] **`ReferenceCopy (2).pdf`** — 2015 **License To Cover** (file `BLL-20150714ABC`).
      Granted, Active, **Channel 244 / 96.7 MHz** → proves the current 96.7 facility.
- [ ] **Letter of Authorization** on licensee letterhead, signed by an officer —
      **James A. Glavin, Treasurer** is the authorized signer on WVVY's FCC filings.
- [ ] ASCAP / BMI / SESAC certificates (optional, supporting).
- [ ] SoundExchange webcaster coverage — confirm the station carries it; get it if
      not. Not required to clear Apple, but the correct license for online
      simulcast of sound recordings.

The two FCC PDFs together prove the full 5.2.3 chain: a currently-valid license,
held by the named licensee, on WVVY's actual frequency (96.7). The "REFERENCE COPY

- Not for submission" watermark only means "don't re-file to the FCC"; as evidence
  for Apple these official records are fine.

### DO NOT attach these

- The **2008** documents (`authorization.pdf`, file `BMLL-20080128ADB`): license
  **expired April 1, 2014** and was for **93.7 MHz** (WVVY moved to 96.7 in 2015).
- `ReferenceCopy (3).pdf` — duplicate of (2).
- `ReferenceCopy (4).pdf` — 2013 ownership report; not license evidence, and it
  contains board members' home addresses (unnecessary PII to send Apple).

### If a cleaner single artifact is wanted (optional)

The 2022 renewal's **license authorization certificate** shows 96.7 + the 2030
expiration on one page. Pull it from FCC LMS (Facility ID `135357`) if desired —
`publicfiles.fcc.gov` is empty because LPFM is exempt from the OPIF, so use LMS or
fccdata.org, not publicfiles.

---

## 2. Reply to the reviewer (paste into the Resolution Center message thread)

Hello, and thank you for the review.

WVVY is the **official app of a single FCC-licensed radio station** — WVVY 96.7
LPFM (call sign WVVY-LP), a low-power community station broadcasting from Tisbury,
Martha's Vineyard, Massachusetts since 2007, operated by Martha's Vineyard Community Radio, Inc.,
a 501(c)(3) non-profit.

The app is **not a radio aggregator or a discovery service**. It streams only
WVVY's own over-the-air broadcast, delivered from the station's own server
(radio.wvvy.org — the same domain as the station's website, wvvy.org). There is
no third-party catalog, no directory of other stations, and no search across
external content. Every screen concerns this one station: a play button for the
live signal, the station's now-playing metadata, its volunteer DJ schedule, and
links to donate to the non-profit.

To evidence our rights to the content, we have attached to the App Review
Information section:

1. The FCC license authorization for WVVY-LP, showing Martha's Vineyard Community Radio, Inc. as
   the licensed broadcaster.
2. A signed letter of authorization from the licensee confirming this is the
   official WVVY app and that our developer account is authorized to distribute
   the station's stream.

The music aired on WVVY is licensed by the station through ASCAP, BMI, and SESAC
[and SoundExchange — confirm before including]. Certificates are attached.

Please let us know if any further documentation would help. Thank you.

---

## 3. App Review Information — Notes field (paste for this and future submissions)

PURPOSE & AUDIENCE
WVVY is the official player app for WVVY 96.7 LPFM (WVVY-LP), a licensed low-power
FM community radio station in Tisbury, Martha's Vineyard, MA, on air since 2007
and run by a 501(c)(3) non-profit. The app lets listeners tune in to the station's
live broadcast, see what's playing now, view the volunteer DJ schedule, and donate
to the station. Audience: the station's local listeners and its diaspora who want
the signal beyond FM range.

SINGLE STATION — NOT AN AGGREGATOR
The app carries only WVVY's own broadcast, streamed from the station's own server
(radio.wvvy.org). It does not aggregate, search, or discover third-party stations
or catalogs. Rights documentation (FCC license + letter of authorization from the
licensee) is attached above.

ACCESSING THE APP
No account, login, or registration. No paid content, purchases, or subscriptions.
No user-generated content. Launch the app and press play to hear the live stream.
All four screens (Listen, Schedule, Support, About) are reachable immediately with
no credentials or sample files.

PERMISSIONS / SENSITIVE DATA
The app requests no sensitive permissions — no location, contacts, camera,
microphone, photos, or App Tracking Transparency prompt. It uses background-audio
capability only so playback continues on the lock screen, standard for a radio
player.

EXTERNAL SERVICES

- Live audio stream + now-playing metadata: the station's self-hosted AzuraCast
  install at radio.wvvy.org (owned and operated by the station).
- DJ schedule: a published Google Sheet the station manager maintains (read-only;
  a static fallback ships in the app if the sheet is unreachable).
- Donations: tapping a donate option opens Venmo or PayPal in the external browser;
  no payment is processed inside the app.
- No third-party analytics, authentication, ad networks, or AI services.

REGIONAL DIFFERENCES
None. The app behaves identically in every region; the stream is globally
accessible with no geo-restrictions.

DEVICES / OS TESTED BEFORE SUBMISSION
[Fill in — e.g. "iPhone 15 Pro (iOS 18.5), iPad Air 11-inch M3 (iPadOS 18.5)".
List the real devices you tested on. Apple reviewed on an iPad Air 11-inch M3.]

SCREEN RECORDING
[Attach a recording captured on a physical device: launch the app, press play,
confirm audio starts, then walk through Schedule, Support, and About.]
