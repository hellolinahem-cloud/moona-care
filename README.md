# Moona Care

Free baby care tracker for families in Cambodia. Khmer and English. By MoonaBaby.

Feeds, sleep, nappies, medicine, growth, the Cambodian national vaccine schedule, and a
breast milk store where every bag gets a number, a day-or-night mark, and a use-by date.

---

## 1. Set up Supabase (15 minutes, free)

1. Create an account at supabase.com and start a new project. Choose the **Singapore**
   region — it is the closest to Cambodia, so the app feels faster.
2. Open **SQL Editor**, paste the whole of `schema.sql`, press **Run**. It creates every
   table, locks them with row-level security, and adds the two join functions.
   Then run `schema-nssf.sql` (ប.ស.ស benefit schedule) and `schema-delete.sql`
   (account deletion) the same way.
3. Open **Project Settings → API** and copy two values:
   - Project URL
   - `anon` public key
4. Open `index.html`, find the CONFIG block near the top of the script, and paste them in:

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

The anon key is safe to ship publicly. It is row-level security, not the key, that keeps
each family's records private — a signed-in parent can only ever read rows belonging to a
family they are a member of.

5. Under **Authentication → Providers → Email**, decide whether to require email
   confirmation. Confirmation on is safer; confirmation off is much easier for parents who
   only use Facebook and Telegram. If you turn it off, note it in your privacy policy.

## 2. Put it online

Any static host works. GitHub Pages is free:

```bash
git init && git add . && git commit -m "Moona Care"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/moona-care.git
git push -u origin main
```

Then **Settings → Pages → Deploy from branch → main / root**. Your app is live at
`https://YOUR-NAME.github.io/moona-care/`.

HTTPS is required for the service worker and for install-to-home-screen. GitHub Pages gives
you that automatically. When you are ready, point `care.moonababy.com` at it.

## 3. Google Play

Play accepts a wrapped PWA, so this is the easy one.

1. Go to **pwabuilder.com**, paste your live URL, and let it score the app.
2. Package for Android. Use package ID `com.moonababy.care`.
3. Download the zip. It contains the signed `.aab` and an `assetlinks.json`.
4. Upload `assetlinks.json` to `/.well-known/assetlinks.json` on your site, otherwise the app
   opens with a browser address bar showing.
5. Google Play Console costs **US$25 once**. Create the listing, upload the `.aab`, fill in the
   Data Safety form, add a privacy policy URL, and submit.

Play requires a real privacy policy because you collect email addresses and child health
information. Write it in Khmer and English and host it on moonababy.com.

## 4. App Store

Harder and not free. Apple charges **US$99 per year**, you need a Mac to build and submit,
and Apple rejects apps that are only a website in a shell — guideline 4.2 "Minimum
Functionality". A wrapped PWA usually fails on the first try.

To pass, the iOS build needs things a website cannot do: local notifications for the next
feed and the next vaccine, Face ID lock, an offline mode that genuinely works. That means
wrapping with **Capacitor** and adding native plugins:

```bash
npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "Moona Care" com.moonababy.care --web-dir=.
npx cap add ios && npx cap open ios
```

My honest advice: **launch on Play and the web first.** Get real Cambodian mothers using it,
find out what breaks, then spend the $99 and the Mac time on iOS once the app has earned it.
Android is the overwhelming majority of phones in Cambodia anyway.

## 5. What it costs you to run

- Supabase free tier: 500 MB database, 50,000 monthly active users, and it pauses a project
  after 7 days of no activity. For a first launch that is plenty. Text records are tiny —
  thousands of families fit inside 500 MB.
- If it grows past the free tier, Supabase Pro is US$25/month.
- Google Play: US$25 once. Apple: US$99/year.

So "free for all parents in Cambodia" is realistic. Your only certain cost is the $25 Play fee.

## 6. Fill in the legal pages

`privacy.html` and `terms.html` are written in Khmer and English and ready to host next to
the app. Before you publish, search both files for the highlighted placeholders and replace
every one:

| Placeholder | What to put |
|---|---|
| `[DATE]` | The date you publish |
| `[LEGAL NAME]` | The registered name that operates the app |
| `[ADDRESS]` | Your business address |
| `[EMAIL]` | A real address you will actually answer within 30 days |
| `[REGION]` | The Supabase region you chose, e.g. Singapore |

Then give Google Play the privacy policy URL, e.g.
`https://YOUR-NAME.github.io/moona-care/privacy.html`.

**I am not a lawyer and these are not legal advice.** They are a careful draft written for
this specific app. Have a Cambodian lawyer read them before you take real users, especially
the NSSF and medical disclaimer sections — those are the ones that protect you if a parent
misses a payment or a vaccination and blames the app.

The Khmer in both documents was written by an AI. Legal wording is exactly where a machine
translation goes wrong quietly. Have a Khmer speaker read it before launch.

## 7. Before you launch publicly

- **Privacy policy and terms**, in Khmer and English. Required by both stores.
- **A medical disclaimer.** The vaccine dates and milk storage times are guidance, not medical
  advice. Say so in the app and in the listing. Tell parents to follow the yellow card from
  their health centre.
- **Check the vaccine schedule with a Cambodian paediatrician or your local health centre**
  before you ship it to thousands of families. The schedule in this build follows the national
  routine programme, but you should have a professional confirm it, and you will need a way to
  update it when the Ministry of Health changes something.
- **Backups.** Turn on Supabase point-in-time recovery when you can afford it. Parents will be
  upset if a year of records disappears.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app |
| `schema.sql` | Database tables, security policies, join functions |
| `manifest.json` | Makes it installable |
| `sw.js` | Offline shell |
| `icon-*.png` | App icons — sage disc, gold crescent |

## Not built yet

Push notifications, more than one baby per family, an offline write queue,
growth charts against WHO percentiles, and a Khmer translation review by a native speaker
(the Khmer strings in the app were written by an AI and should be checked by a person before
launch).
