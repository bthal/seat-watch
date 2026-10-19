# seat-watch

Checks the ASB Berlin RettSan course page on HiOrg every ~5 minutes
(<https://www.hiorg-server.de/kurse_extern.php?ov=bks&kt=43910>) and sends a push via [ntfy](https://ntfy.sh)
when a seat frees up.

- **Free seat:** urgent push on every run (every ~5 min) while it's free. Tap opens the signup form.
- **Also pushes:** a seat gets taken again, a new course date appears, a date disappears, 3 failed checks in a row.
- **State** (last seen status per date) is kept between runs in the Actions cache, so no commits are made.

## Setup
1. Install the ntfy app and subscribe to a random topic name (it acts as a password).
2. Repo → Settings → Secrets and variables → Actions → New secret `NTFY_TOPIC` = that topic name.
3. Actions → seat-watch → Run workflow (test ✓) → you get a test push.

## Stop
Actions → seat-watch → ⋯ → Disable workflow. GitHub can start scheduled runs 5–30 min late.

## Local test
```
DRY_RUN=1 node check.mjs                 # live page, print instead of push
HTML_FILE=page.html DRY_RUN=1 node check.mjs
```
