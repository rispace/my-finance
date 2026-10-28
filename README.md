# Finance (Google Drive edition): proof of concept

A personal-finance web app with **no server**. It runs entirely in your browser:

- **Your data lives on your device** (IndexedDB), so the app opens instantly and works offline.
- **Sync goes through your own Google Drive**, in a hidden folder that only this app can see. The developer never sees anyone's data.
- **It costs nothing to run.** It's static files on GitHub Pages plus Google's free Drive API.

This proof of concept covers adding, editing and deleting transactions, the monthly activity list, search, importing the Django app's JSON backup, and syncing between devices. Cards, loans, budgets, assets and charts come after the experiment.

---

## 1. Try it locally (no Google needed)

```bash
cd finance-drive
python3 -m http.server 8080
```

Open <http://localhost:8080/>, go to **Settings → Import backup**, and pick your `finance-backup-YYYY-MM-DD.json`.
Everything works except sync until you finish step 2.

## 2. Google setup (one time, free, about 10 minutes)

1. Go to <https://console.cloud.google.com/>, then **Select a project → New project**. Name it `Finance`.
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **Google Auth Platform → Get started**:
   - App name: `Finance`. User support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Then agree and **Create**.
4. **Google Auth Platform → Data Access → Add or remove scopes**: add
   `https://www.googleapis.com/auth/drive.appdata` (shown as "See, create, and delete its own configuration data in your Google Drive"). Click **Save**.
   This is a *non-sensitive* scope, so no security review is needed.
5. **Google Auth Platform → Audience → Test users → Add users**: add your Gmail, plus your friends' Gmails later (up to 100 while the app is in Testing).
6. **Google Auth Platform → Clients → Create client**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**:
     - `http://localhost:8080`
     - `https://rispace.github.io`
   - **Authorized redirect URIs** (must match exactly, including the trailing `/`):
     - `http://localhost:8080/`
     - `https://rispace.github.io/finance-drive/`
7. Copy the **Client ID** (`…apps.googleusercontent.com`) into `config.js`.
   The client ID isn't a secret, so it's fine to commit. There is **no client secret** in this app.

## 3. Put it on your iPhone (GitHub Pages, free)

1. Create a GitHub repo named `finance-drive` and push this folder to it. GitHub Pages is free for public repos.
2. In the repo, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then **Save**.
3. After a minute it's live at `https://rispace.github.io/finance-drive/`.
4. On the iPhone, open that address in **Safari**, then **Share → Add to Home Screen**.
5. Open it from the home screen and go to **Settings → Sign in with Google**.

> After you change any file, bump `CACHE` in `sw.js` (for example `finance-drive-v2`). Phones that already installed the app pick up the new version on the next launch after that.

---

## The experiment: what to check

**Settings → Experiment numbers** shows the figures below.

| Question | How to check |
|---|---|
| How fast does it open? | *App ready in* should be a few hundred ms, offline too (try airplane mode). |
| Does silent renewal work on iPhone? | Open the app, close it, wait more than 1 hour, then open it again. You should see a brief flash through Google and *Synced just now*, with no taps. *Last silent renewal* shows whether it worked and how long it took. |
| What happens when it can't? | The chip says **Tap to sync**. One tap signs in again. |
| Does sync work both ways? | Add a transaction on the laptop, then open the phone. It shows up within a few seconds, and the reverse works too. Deleting on one device removes it on the other. |
| Offline edits | Add something in airplane mode. The chip shows *Offline · will sync later*. Reconnect and it syncs. |

You can turn off **Settings → Renew sign-in automatically** to compare it with the tap-to-sync behavior.

## How it works

```
 iPhone / laptop browser                           Your Google Drive
┌────────────────────────────────┐   1-hour pass   ┌───────────────────────┐
│ UI ─▶ IndexedDB (all your data)│ ◀────────────▶ │ appDataFolder/        │
│        ▲ instant, offline      │  merge records │   finance-data.json   │
└────────────────────────────────┘                └───────────────────────┘
```

- Every record has an `id`, an `updatedAt` time, and a `deleted` flag (tombstone). A sync downloads the Drive copy and keeps the newer version of each record. It saves the winners on the device and uploads the merged copy if Drive was behind. Before uploading, it checks that no other device saved in the meantime, and if one did, it starts over.
- Syncs run on open, about 2 s after each change, when you return to the app, and when the connection comes back.
- Sign-in uses Google's OAuth token redirect with only the `drive.appdata` scope. Tokens last 1 hour. Renewal uses `prompt=none`, so if you're still signed in to Google there's no screen to click through.
- Importing the same backup twice, or on two devices, doesn't create duplicates. Records keep ids based on the web app's ids (`tx-123`).

## Known limits of the proof of concept

- Only transactions, categories, subcategories and payment methods so far.
- The whole dataset is one JSON file in Drive. That's fine for many years of transactions (about 0.3 KB each).
- If two devices sync for the very first time at the same moment, two Drive files can appear. The app uses the newest one.
- The newest edit wins per record. Editing the *same* transaction on two offline devices keeps only the later edit.

## Files

| File | What it does |
|---|---|
| `index.html`, `styles.css` | Page and look (same palette as the Django app) |
| `config.js` | Your Google client ID |
| `js/app.js` | Screens, sync scheduling, status chip |
| `js/db.js` | On-device storage (IndexedDB) |
| `js/merge.js` | Record-by-record merge (pure, unit-tested) |
| `js/sync.js` | One sync round against Drive |
| `js/drive.js` | Tiny Google Drive client (hidden app folder only) |
| `js/auth.js` | Google sign-in and silent renewal |
| `js/importer.js` | Import of the Django app's JSON backup |
| `sw.js`, `manifest.webmanifest` | Offline support and "Add to Home Screen" |
