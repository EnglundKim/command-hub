# 5th Marine Regiment Command Hub

Website for the 5th Marine Discord mil-sim community. Cloudflare Worker + D1 database, hosted free on Cloudflare.

**New here?** See [GUIDE.md](GUIDE.md) for a full beginner walkthrough: local dev, deployment, and using the Admin panel.

## Pages
- `public/chain-of-command.html` — Regiment → Battalion → Company org chart, plus standalone Warrant Officer and Reserves rosters. Data comes from Cloudflare D1 via `/api/hierarchy`. This is the landing page after login; the site root `/` redirects here (or to login if signed out).
- `public/activity-report.html` — weekly officer activity ratings
- `public/server-stats.html` — Discord join/leave analytics
- `public/login.html`, `public/setup.html`, `public/reset-password.html` — officer authentication
- `public/admin.html` — Regimental Command only: manage officer accounts and edit the chain of command

## Quick start (local)
```
npx wrangler d1 execute 5thmr-command-hub-db --local --file=db/schema.sql
npx wrangler dev --local
```
Then open http://localhost:8787/setup.html to create the first account.
