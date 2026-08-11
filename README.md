# Crash2Claim — Landing Page + Qualification Survey

A single-page, mobile-first lead generation site for Crash2Claim, a consumer
accident-assistance and connection service. Visitors answer a 5-question
survey; the site classifies each submission as `qualified` or `unqualified`
and prepares a JSON lead payload for delivery to a webhook/CRM.

Crash2Claim is **not** a law firm and does not provide legal advice. See
`js/config.js` for the placeholder disclaimer copy used throughout the site.

## Tech stack

Plain HTML/CSS/JavaScript — no framework, no build step, no dependencies.
This keeps the page fast-loading and easy for any developer to read top to
bottom. If the project later needs a bundler, templating, or a component
framework, everything here maps cleanly onto that migration since concerns
are already split into separate files.

```
index.html            Page shell + SEO/OG metadata
privacy.html           Placeholder Privacy Policy route
terms.html              Placeholder Terms & Conditions route
css/styles.css         All styling (mobile-first, desktop enhancement at the bottom)
js/config.js            *** Branding, webhook URL, consent copy, qualification
                         rules, allowed states, tracking IDs — edit this file first ***
js/qualification.js    Pure qualification logic, no DOM code
js/attribution.js      Captures + persists UTM/subid/click-ID params
js/validation.js        Field validators (email, US phone, ZIP, etc.)
js/payload.js            Builds the final JSON lead payload + posts it to the webhook
js/app.js                 Survey UI state machine (renders steps, binds events)
example-payload.json Sample qualified + unqualified lead payloads
```

## 1. Run it locally

No install step required. From the project folder:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000` in a browser. Opening `index.html` directly
via `file://` also works for a quick look, but a local server is recommended
so `fetch()` calls behave like they will in production.

## 2. Where qualification rules live

`js/config.js` → `CONFIG.QUALIFYING_RULES`. Each rule is a simple boolean
switch (except `excludedTreatmentTimings`, a list):

```js
QUALIFYING_RULES: {
  requireInjury: true,
  requireAtFaultOther: true,
  requireInsurance: true,
  disqualifyIfHasAttorney: true,
  excludedTreatmentTimings: ["never"],
}
```

The actual evaluation happens in `js/qualification.js` (`evaluateQualification`),
which is intentionally decoupled from the UI — you can change the rules above,
or rewrite the function entirely for a new buyer's criteria, without touching
`index.html` or `js/app.js`. Every submission is still saved regardless of
outcome, tagged `qualification_status: "qualified"` or `"unqualified"` — no
lead is ever discarded.

## 3. Where consent language is changed

`js/config.js` → `CONFIG.CONSENT_DISCLOSURE`. The current value is a labeled
placeholder:

> PLACEHOLDER — FINAL CONSENT LANGUAGE MUST BE APPROVED BEFORE LAUNCH.

Replace this string with attorney-approved TCPA/consent language before
launch. The checkbox itself (in `js/app.js`, Question 5 / `step5Template`)
is unchecked by default and required to submit — that behavior doesn't need
to change when the copy does.

## 4. Where the webhook is configured

`js/config.js` → `CONFIG.WEBHOOK_URL` points at this site's own Netlify
Function: `/.netlify/functions/submit-lead` (source at
`netlify/functions/submit-lead.js`). That function runs server-side on
Netlify, authenticates to the Google Sheets API as a service account, and
appends one row per submission to the master lead spreadsheet. Credentials
(`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
`GOOGLE_SHEET_ID`) live only in Netlify's environment variables — nothing
is hard-coded in this repo or ever sent to the browser.

`js/payload.js` (`buildLeadPayload`) is where the final JSON shape is
assembled — see `example-payload.json` for sample output, including a
`test_lead_example`. Adding `?test=1` to the URL marks a submission as a
test lead (`test_lead: true` in the payload, logged as "TEST" instead of
"LIVE" in the Sheet) so test runs never get mistaken for real leads.

Consent evidence (`consent_given`, `consent_disclosure_shown`,
`consent_timestamp`) is captured at the moment the checkbox is checked and
included in every submission, alongside the qualification result,
attribution/UTM data, and click IDs — see `example-payload.json` for the
full field list.

## 5. Where branding is configured

`js/config.js` → `CONFIG.BRAND_NAME`, `CONFIG.DOMAIN`, `CONFIG.TAGLINE`,
`CONFIG.CONTACT_PHONE`. The wordmark markup itself lives at the top of
`index.html` (`.wordmark`) and in `js/app.js` (`heroTemplate`) — update the
text there if the brand name ever changes; colors live in `css/styles.css`
under the `:root` CSS variables (`--navy`, `--coral`, `--teal`, etc.).

## 6. How attribution parameters are captured

`js/attribution.js` reads these URL parameters on page load and merges them
into `sessionStorage` so they persist across all 5 steps (and a refresh
mid-survey): `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term`, `subid`, `subid2`, `fbclid`, `gclid`. Whatever is present gets
merged into the final payload in `js/payload.js`. Example:

```
https://crash2claim.com/?utm_source=facebook&utm_medium=paid_social&subid=aff123
```

produces `utm_source`, `utm_medium`, and `subid` fields in the submitted
lead JSON; any keys not present on the URL are simply omitted.

## 7. Build for production

There is no build step — `index.html`, `css/`, and `js/` are already
production-ready static assets. To deploy:

1. Upload the project folder as-is to any static host (Netlify, Vercel,
   Cloudflare Pages, S3 + CloudFront, GitHub Pages, etc.).
2. Set `CONFIG.WEBHOOK_URL` to the real lead-delivery endpoint before going
   live.
3. Replace `CONFIG.CONSENT_DISCLOSURE` with approved legal copy.
4. Fill in real values in `CONFIG.TRACKING_SETTINGS` (GA4, Meta Pixel,
   Google Ads, TrustedForm, Jornaya, Retreaver) as each integration is
   ready — `js/app.js` (`maybeInitTrackingScripts`) is the single place
   those script tags should be conditionally injected.

## 8. Pointing Crash2Claim.com at the deployed site

Once deployed to a static host, point the domain's DNS at that host
(an `A`/`ALIAS` record to the host's IP, or a `CNAME` for a subdomain,
per that host's instructions) and attach `Crash2Claim.com` as a custom
domain in the hosting provider's dashboard. No server-side code or database
is required for the site itself — only the webhook endpoint it posts to.

## Testing notes

Qualified flow, each unqualified path (no other vehicle / at-fault / not
injured / has attorney), back-button state retention, required-field
validation, invalid email/phone/ZIP handling, UTM + subid capture, JSON
payload shape, and duplicate-submit protection were all exercised against
this build — see the delivery notes in chat for the specific cases run and
their results.

## Still needed before production launch

- Approved TCPA/consent language to replace `CONSENT_DISCLOSURE`
- Real Privacy Policy and Terms & Conditions content (`privacy.html`, `terms.html`)
- Real support/intake phone number (`CONTACT_PHONE`)
- GA4 / Meta Pixel / Google Ads IDs, if used
- TrustedForm / Jornaya / Retreaver decision + credentials, if used
- Final call on `restrictToAllowedStates` / any state exclusions
- A production `og-image.png` for social sharing previews
- DNS cutover for Crash2Claim.com to the chosen host
