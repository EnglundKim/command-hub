# 5th Marine Regiment Command Hub — Beginner's Guide

This guide assumes you've never built or deployed a website before. Follow it top to bottom the first time; after that, you'll mostly only need **Part 5** (using the Admin panel) and occasionally **Part 7** (pushing a code update).

---

## What's in this project

```
command-hub/
├── src/
│   └── worker.js                  The backend: login, sessions, admin API, page gating
├── public/                        Everything served to browsers
│   ├── chain-of-command.html, activity-report.html, server-stats.html,
│   │   login.html, setup.html, reset-password.html, admin.html
│   └── assets/                    CSS, JS, images shared by every page
├── db/
│   └── schema.sql                 Database structure (officers, sessions, roster, history)
├── GUIDE.md                       This file
└── README.md                      Short project overview
```

Unlike the very first version of this site, the roster is **not** a file you hand-edit anymore — it lives in a real database (Cloudflare D1), and Regimental Command edits it through the **Admin** page in a browser.

---

## Part 1 — Install two free programs

1. **Git** — [git-scm.com/downloads](https://git-scm.com/downloads), install with default options.
2. **Node.js** — [nodejs.org](https://nodejs.org/) (LTS version). This gives you `npx`, which runs Cloudflare's `wrangler` tool without a separate install.

---

## Part 2 — Local development with `wrangler dev`

The old `python -m http.server` trick no longer works, because pages now require login and a database. Instead:

```
npx wrangler d1 execute 5thmr-command-hub-db --local --file=db/schema.sql
npx wrangler dev --local
```

The first command sets up a local practice database (completely separate from your real one — nothing you do locally touches live data). The second starts the site at **http://localhost:8787**.

First time only: open **http://localhost:8787/setup.html** and create your Regimental Command account. After that, use **/login.html** like normal.

---

## Part 3 — Get the code onto GitHub

1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Create a new repository (**+** icon → **New repository**), name it `command-hub`, leave every checkbox unchecked, click **Create repository**.
3. In your terminal, in the `command-hub` folder:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/your-username/command-hub.git
   git push -u origin main
   ```

(If you're picking this project back up and it's already on GitHub, skip to Part 4.)

---

## Part 4 — Deploy to Cloudflare

### 4a. Create the production database
This only needs to happen once, ever:
```
npx wrangler d1 create 5thmr-command-hub-db
```
Cloudflare gives you a `database_id` — it's already filled in for you in `wrangler.toml`. Then load the table structure into it:
```
npx wrangler d1 execute 5thmr-command-hub-db --remote --file=db/schema.sql
```

### 4b. Set the email secret
Password resets are sent via [Resend](https://resend.com) (free account). Create an account, grab an API key, then:
```
npx wrangler secret put RESEND_API_KEY
```
Paste the key when prompted. This is stored securely by Cloudflare — it never goes into your code or GitHub.

### 4c. Connect the repo in the Cloudflare dashboard
1. **Workers & Pages** → **Create** → connect your GitHub repo (same as before).
2. Build settings: **Build command** empty, **Deploy command** `npx wrangler deploy` (this is usually the default already).
3. Deploy.

### 4d. First-time setup on the live site
Visit `https://<your-site>/setup.html` **once** and create your Regimental Command account — same as you did locally, but now for real. This page permanently disables itself the moment one officer account exists, so don't worry about anyone else finding it later.

---

## Part 5 — Using the Admin panel (day-to-day)

Log in, click **Admin** in the nav (only visible to Regimental Command).

**Officers**
- Add an officer: username, email, tier (Company Command / Battalion Command / Regimental Command) → a temporary password is shown once. Share it with them directly (Discord DM, etc.) — it's not emailed automatically.
- Remove an officer: click Remove next to their row.

**Chain of Command Editor**
- Every rank row has Rank / Title / Status / Name fields. Status is `filled` (shows the name), `vacant` (shows a red "Open"), or `closed` (shows a red "Closed").
- **+ Add Position** adds a row to a unit. **+ Add Company** / **+ Add Battalion** add new units. **Remove** deletes a row or an entire unit.
- Nothing is saved until you click **Save Changes** at the bottom. If you navigate away first, your edits are lost.

Every save is recorded in a history table (`hierarchy_history`) with who made the change and when, even though there's no user-facing screen for it yet.

---

## Part 6 — How officers reset a forgotten password

1. **reset-password.html** → enter their email → they get an email with a link (valid 1 hour).
2. Clicking the link lets them set a new password directly.
3. This also logs them out everywhere else, as a security measure.

If Resend's free sending domain (`onboarding@resend.dev`) starts landing in spam folders, that's the known trade-off of not using your own domain for sending — see the note in Part 4b's linked Resend docs about verifying a custom domain if this becomes a problem.

---

## Part 7 — Making code changes going forward

Edit files locally, test with `npx wrangler dev --local`, then:
```
git add .
git commit -m "describe what changed"
git push
```
Cloudflare redeploys automatically. Database content (officers, roster) is untouched by code deploys — only `db/schema.sql` changes require a manual `wrangler d1 execute ... --remote` step, and only if you add new tables/columns.

---

## Part 8 — Troubleshooting

| Problem | Likely cause |
|---|---|
| Redirected to login in a loop | Cookies blocked, or testing over plain `http://` in production (cookies require `https://` there) |
| "Setup has already been completed" but you never ran it | Someone else got there first, or a stray test account exists — remove it from the Admin panel, or delete all rows from the `officers` table and try again |
| Admin edits don't show up on the roster page | Make sure you clicked **Save Changes** — nothing autosaves |
| Reset email never arrives | Check spam; confirm `RESEND_API_KEY` is set (`npx wrangler secret list`); check the Resend dashboard's logs |
| Local `wrangler dev` can't find the database | Run the `d1 execute --local --file=db/schema.sql` command from Part 2 first |

---

## What's next

Same pattern as before applies to future pages: reuse `assets/css/variables.css`, `base.css`, `layout.css` for consistent styling, and `assets/js/nav.js` + `assets/js/api.js` for consistent login-aware navigation.
