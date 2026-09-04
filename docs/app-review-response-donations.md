# App Review response — WVVY 1.0.1 (8), Guideline 3.1.1 donations

Working notes for clearing the **3.1.1 Business – Payments – In-App Purchase**
rejection of build **1.0.1 (8)**. Submission ID `34f943af-37a0-4134-a9ed-9007cbded584`,
reviewed 2026-09-04 on iPad Air 11-inch (M3). Not committed (global gitignore, like
CLAUDE.md and `app-review-response.md`).

## What Apple flagged

The Support tab collects donations (Venmo, PayPal, mailed check) via a mechanism
other than In-App Purchase. The reviewer quoted 3.1.1's gift clause — a donation
"associated with receiving digital content or services" must use IAP — because the
app streams radio (digital content).

Apple offered a **bug-fix approval**: reply that the build includes bug fixes and
they'll approve 1.0.1 now, with the donation issue addressed in a later update.

## Strategy

Reply making the **nonprofit-donation argument** (3.1.1 permits collecting
donations for approved nonprofits outside IAP), which can get the issue dropped
outright — AND accept the bug-fix approval offer as a guaranteed floor. The stream
is free and open (no account, paywall, or premium tier), so the donation is a gift
to the nonprofit, not a payment for digital content.

## 1. Evidence to attach in App Review Information

From the private ops repo `~/workspace/git/wvvy/wvvy-ops`:

- [ ] `licensing/fcc/WVVY-LP-license-renewal-2022.pdf` — current FCC license,
      licensee **Martha's Vineyard Community Radio, Inc.**, active to 2030.
- [ ] `licensing/fcc/WVVY-LP-license-to-cover-2015-96.7MHz.pdf` — the 96.7 facility.
- [ ] `licensing/letter-of-authorization-apple.pdf` — signed letter on the
      nonprofit's letterhead (James A. Glavin, Treasurer); asserts 501(c)(3) status
      and authorizes the app.

**Nonprofit identifiers (cite these in the reply — they let Apple verify directly):**

- **EIN: 04-3502710** — Martha's Vineyard Community Radio.
- **IRS Tax-Exempt Organization Search / Publication 78: confirmed (verified
  2026-09-04).** On the Pub 78 Data List = Yes; **Deductibility Code PC = public
  charity**, i.e. a 501(c)(3) public charity eligible to receive tax-deductible
  contributions. This is public, IRS-hosted confirmation — no determination letter
  needed. Anyone (Apple included) can re-verify at
  apps.irs.gov/app/eos with the EIN above.

The earlier caveat (990-N alone didn't prove the specific 501(c)(3) subsection) is
resolved: Pub 78's PC code is the confirmation.

## 2. Reply to the reviewer (paste into the Resolution Center message thread)

Hello, and thank you for the review.

We'd like to provide context that we believe resolves this under Guideline 3.1.1's
provision for donations to nonprofit organizations.

WVVY is the official app of a single FCC-licensed nonprofit community radio
station — WVVY 96.7 LPFM (call sign WVVY-LP), operated by Martha's Vineyard
Community Radio, Inc., a registered 501(c)(3) nonprofit (Tisbury, Massachusetts, on
air since 2007). The donations collected in the Support tab are charitable,
tax-deductible contributions to this nonprofit, not payments for digital content or
services.

The two conditions in 3.1.1 for collecting donations outside of In-App Purchase are
both met:

1. The recipient is an approved nonprofit. The station is a 501(c)(3) public
   charity (EIN 04-3502710), listed in IRS Publication 78 as eligible to receive
   tax-deductible contributions — verifiable via the IRS Tax-Exempt Organization
   Search. The app's Support screen already discloses this and offers a donation
   receipt. We are also attaching the FCC license and the licensee's authorization
   letter in the App Review Information section.
2. The donations are collected outside the app, in the browser. Tapping Venmo or
   PayPal opens the station's donation page in the browser — no payment is entered
   or processed inside the app. The mailed-check option involves no digital
   transaction at all.

Critically, the donations are not associated with receiving digital content or
services. The live stream is completely free and open: there is no account, login,
paywall, subscription, or premium tier, and donating unlocks nothing. Every
listener hears the identical broadcast whether or not they ever give. The
contribution is a gift to the nonprofit, not a purchase.

We understand this build (1.0.1) also contains bug fixes. Per your note, we would
appreciate having it approved now, and we're glad to further refine the donation
presentation in an upcoming update if that would help. Please let us know if any
additional documentation about the station's nonprofit status would be useful.

Thank you.

## 3. Before you send

- Attach the three PDFs above in the App Review Information section (in the
  browser — this cannot be done from the CLI).
- The reply asserts "bug fixes." Confirm 1.0.1 (8) genuinely carries fixes over the
  last approved build (the native-audio work suggests yes). Apple's own message
  invited the bug-fix framing, so it's fine as long as it's true.

## 4. Next-update fix (insurance for 1.0.2)

The donate buttons currently open via Capacitor's in-app browser
(`Browser.open`, an SFSafariViewController popover). Switching the donation links to
the system browser (true Safari, out of the app) makes "collected outside the app"
literally unambiguous. ~5-line change in `src/lib/native.ts` / the support page.
