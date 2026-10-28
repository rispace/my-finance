# Publishing Finance on Google (owner guide)

This is the one-time setup to let **anyone** sign in with Google and have the consent screen show **Finance** with its logo.

It costs nothing. Finance only uses the non-sensitive scope `drive.appdata`, so Google does **not** require the full app verification or a security assessment. Brand verification is a lighter check of your name, logo and website.

Values you'll use throughout:

| Field | Value |
|---|---|
| App name | `Finance` |
| App logo | `icons/logo-120.png` from this repo (120×120 PNG) |
| App home page | `https://rispace.github.io/my-finance/about.html` |
| Privacy policy | `https://rispace.github.io/my-finance/privacy.html` |
| Terms of service | `https://rispace.github.io/my-finance/terms.html` |
| Authorized domain | `rispace.github.io` |
| Scope | `https://www.googleapis.com/auth/drive.appdata` (non-sensitive) |
| JavaScript origin | `https://rispace.github.io` |
| Redirect URI | `https://rispace.github.io/my-finance/` |

> Push this repo first, so the three pages above are live before Google checks them.

---

## Step 1: prove you own `rispace.github.io` (Google Search Console)

Google needs proof that the website belongs to you. Use the **same Google account** that owns the Cloud project.

1. Open <https://search.google.com/search-console> and click **Add property**.
2. Choose **URL prefix**, not *Domain*: you can't change DNS for a `github.io` address. Enter `https://rispace.github.io/` and click **Continue**.
3. Pick **one** verification method.

**Method A: HTML file (recommended)**
1. Download the file Google offers, for example `google1a2b3c4d5e6f7a8b.html`.
2. Put it at the root of the **rispace.github.io** website repo (your Quarto site, *not* my-finance), so it's served at `https://rispace.github.io/google1a2b3c4d5e6f7a8b.html`.
   - **Quarto:** copy the file into the project's root folder (next to `_quarto.yml`). Add it to `_quarto.yml` so Quarto copies it into the built site:
     ```yaml
     project:
       resources:
         - google1a2b3c4d5e6f7a8b.html
     ```
     Then run `quarto render`, commit and push. If you publish from a `docs/` folder, check that the file is now in `docs/`.
3. Open that URL in your browser to confirm it loads. Then click **Verify** in Search Console.

**Method B: HTML tag**
1. Copy the `<meta name="google-site-verification" …>` tag Google shows you.
2. **Quarto:** add it to `_quarto.yml`:
   ```yaml
   format:
     html:
       include-in-header:
         text: |
           <meta name="google-site-verification" content="PASTE-THE-CODE" />
   ```
   Then run `quarto render`, commit, push and click **Verify**.

Keep the file or tag in place permanently. Google re-checks it from time to time.

---

## Step 2: fill in Branding

In [Google Cloud Console](https://console.cloud.google.com/), select your project and go to **Google Auth Platform → Branding**.

1. **App name:** `Finance`. **User support email:** your Gmail.
2. **App logo:** upload `icons/logo-120.png`.
3. **App domain:**
   - Application home page: `https://rispace.github.io/my-finance/about.html`
   - Privacy policy: `https://rispace.github.io/my-finance/privacy.html`
   - Terms of service: `https://rispace.github.io/my-finance/terms.html`
4. **Authorized domains:** add `rispace.github.io`. It should now show as verified because of Step 1.
5. **Developer contact email:** your Gmail.
6. Click **Save**.

## Step 3: check Data Access and Clients

- **Data Access:** the only scope should be `…/auth/drive.appdata`, listed under *Non-sensitive scopes*. Remove anything else.
- **Clients → your Web client:**
  - Authorized JavaScript origins: `https://rispace.github.io` (keep `http://localhost:8080` for local testing).
  - Authorized redirect URIs: `https://rispace.github.io/my-finance/` (keep `http://localhost:8080/`).

## Step 4: publish

**Google Auth Platform → Audience → Publishing status → Publish app → Confirm.**

The status changes from *Testing* to *In production*. Anyone with a Google account can now sign in, and the test-user list no longer matters.

## Step 5: submit brand verification

Back on **Branding** (or **Verification Center**), click **Verify branding** / **Submit for verification**.

- Google checks that the homepage describes the app, links the privacy policy, and sits on the verified domain, and that the logo and name are consistent.
- Watch the support email for questions and reply from the same account. The Verification Center shows the status.
- Until it's approved, sign-in still works for everyone. The consent screen may just show the domain instead of the name and logo.

---

## Afterwards

- **Changing the logo or name** later sends brand verification round again.
- **Don't add scopes** casually. A sensitive or restricted scope would require full verification.
- **Quota:** the Drive API is free. Each user's sync uses *their own* Drive storage and only a handful of API calls per sync.
- **If something breaks after a change:** check *Clients* (origins and redirect URI must match exactly, including the trailing `/`), then Search Console (the verification file or tag must still be live).
