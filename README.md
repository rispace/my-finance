# Finance: Google Drive edition

The full personal-finance app, rebuilt to run with **no server**:

- **Your data lives on your device** (IndexedDB), so the app opens instantly and works offline.
- **Sync goes through your own Google Drive**, in a hidden folder that only this app can see. Whoever hosts the app never sees anyone's data.
- **It costs nothing to run.** It's static files on GitHub Pages plus Google's free Drive API. There's no build step: the files in this folder *are* the app.

Live at **https://rispace.github.io/my-finance/**

## What's in it

The same screens and math as the Django web app:

| Screen | What it does |
|---|---|
| **Overview** | Month switcher, spending vs last month, net worth, total debt and utilization, assets, a spending-by-category donut (tap for subcategories and 12-month history), a 12-month trend, the month's budget with pace marker, recent transactions, and debt and asset summaries |
| **Transactions** | Search, filter by category / subcategory / payment method / dates, 4 sort orders, totals, edit/delete, CSV export |
| **Add / edit** | Amount, description suggestions, category → subcategory, date, payment method (remembers the last one, hides archived ones), notes |
| **Budget** | Overall limit plus free-text lines ("Groceries", "Netflix, YouTube") matched by category, then subcategory, then description words; copy from a previous month |
| **Debt → Credit cards** | Balances, limits, utilization, recording charges/payments/refunds/interest/corrections, limit-change history, monthly charges-vs-payments summary, CSV |
| **Debt → Loans** | Car, mortgage, student and personal loans; payment recording that estimates interest (balance × APR × days ÷ 365, half-up to the cent) or uses your statement's figure; opening balance locks once payments exist |
| **Assets** | Car/home/savings with value history, equity against a linked loan, change since purchase; stocks/ETFs with live Finnhub prices (or a price typed by hand), cost basis, gain/loss, weights, uninvested cash |
| **Settings** | Categories and subcategories (deleting asks where to move transactions), payment methods (archive), JSON backup import/export, CSV import/export, Finnhub key, Google sign-in, and device info |

Features added because there's no admin panel any more: you can delete a card, a loan, or a single loan payment.

## Moving from the Django app

In the old app, go to **Settings → Full backup → Download**. In this app, go to **Settings → Import backup (JSON)**.

Transactions, categories, payment methods, cards, card activity, limit history, loans, payments, stocks and cash all come across. Importing again (on any device) doesn't create duplicates. The old app's backup never included **budgets or assets**, so set those up here once.

---

## Releasing a change

1. Edit the files.
2. **Bump `CACHE` in `sw.js`** (for example `finance-drive-v3`). Installed copies only pick up new files when this changes.
3. Commit and push:
   ```bash
   cd ~/finance-drive
   git add -A && git commit -m "Describe the change" && git push
   ```
4. GitHub Pages redeploys within about a minute. Open apps switch to the new version automatically (unless you're halfway through a form).

Run the tests with `node tests/calc.test.mjs && node tests/merge.test.mjs`. They need Node 18 or newer and no packages.

Run locally with `python3 -m http.server 8080`, then open <http://localhost:8080/>.

## Google setup (already done for my-finance)

The Google Cloud project has the **Drive API** enabled. It has an OAuth consent screen (External, scope `…/auth/drive.appdata`, which is *non-sensitive*), test users, and a **Web** client. The Web client's Authorized JavaScript origins and redirect URIs are:

- `http://localhost:8080` and `http://localhost:8080/`
- `https://rispace.github.io` and `https://rispace.github.io/my-finance/`

The client ID goes in `config.js`. It isn't a secret, and there is **no client secret** in this app.

**Letting friends use it:** while the consent screen is in *Testing*, add each friend's Gmail under **Google Auth Platform → Audience → Test users** (up to 100). To open it to anyone, publish the app (Audience → Publish). Because only a non-sensitive scope is used, Google asks only for basic verification (homepage, privacy policy, domain ownership), with no security assessment.

Each friend gets their own data in their own Drive. Nobody, including you, can see anyone else's.

## Stock prices

Each person pastes a free key from <https://finnhub.io/register> in **Settings → Stock prices**. The key is stored with their data, so it syncs to their other devices.

Prices refresh when older than 15 minutes. A failed refresh keeps the last price. Funds Finnhub doesn't cover (such as 401k funds) can be priced by hand.

## How sync works

```
 iPhone / laptop browser                           Your Google Drive
┌────────────────────────────────┐   1-hour pass   ┌───────────────────────┐
│ UI ─▶ IndexedDB (all your data)│ ◀────────────▶ │ appDataFolder/        │
│        ▲ instant, offline      │  merge records │   finance-data.json   │
└────────────────────────────────┘                └───────────────────────┘
```

- Every record has an `id`, an `updatedAt` time, and a `deleted` flag (tombstone). A sync downloads the Drive copy and keeps the newer version of each record. It saves the winners on the device and uploads the merged copy if Drive was behind.
- Before uploading, it checks that no other device saved in the meantime, and if one did, it starts over.
- Syncs run when the app opens, about 2 seconds after each change, when you come back to the app, and when the connection returns.
- Collections a device doesn't know yet (from a newer version on another device) are kept, not dropped.
- Sign-in uses Google's OAuth token redirect. Passes last 1 hour and renew silently (`prompt=none`) while you're signed in to Google, so you see **Tap to sync** only when they can't.
- Stock quotes are stored per symbol, separately from holdings. That way a price refresh on one device never overwrites a share-count edit made on another.

**Known limits:** the newest edit wins per record, so editing the *same* item on two offline devices keeps the later edit. Exports are CSV, which opens in Excel and Numbers, rather than `.xlsx`.

## Files

| Path | What it does |
|---|---|
| `index.html`, `styles.css` | App shell and look (the Django app's stylesheet plus a few additions) |
| `config.js` | Google client ID, **the only file with settings** |
| `js/app.js` | Start-up, routes (`#/cards`, `#/loan/…`), sync scheduling, status chip |
| `js/calc.js` | All money math, ported from the Django views (pure, tested) |
| `js/store.js`, `js/db.js` | In-memory data, and on-device storage (IndexedDB) |
| `js/sync.js`, `js/merge.js`, `js/drive.js`, `js/auth.js` | Google Drive sync and sign-in |
| `js/importer.js`, `js/csv.js`, `js/quotes.js` | Backup/CSV import and export, and Finnhub prices |
| `js/ui.js`, `js/util.js` | Sheets, toasts, donut chart, forms; formatting helpers |
| `js/views/*.js` | Screens: overview, activity, budget, debt, assets, settings |
| `sw.js`, `manifest.webmanifest` | Offline support and Add to Home Screen |
| `tests/` | Unit tests with a synthetic backup (no personal data) |
