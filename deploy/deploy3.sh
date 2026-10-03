#!/bin/bash
# Luminus CRM — (1) email reliability fix, (2) announcements ON/OFF switch.
#   crm-mail-utils.js, crm-db.js        cleans Message-IDs, shrinks giant inline-photo emails, never rolls dates back
#   crm-inbox-reconcile.js, server.js   safety net: imports any mailbox email the live feed missed (every 5 min)
#   scripts/crm-repair-message-ids.mjs  one-time clean-up of the stored ids (a backup is saved first)
#   crm-broadcast.js, CrmBroadcast.vue  announcements master switch (default OFF)
# Backs up everything it replaces, builds the site into a side folder and swaps it in only if the build
# succeeds. Nothing in the Proposal System's own code is touched.
set -e
APP=/opt/luminus-app
PKG=/root/crm-deploy3/pkg
TS=$(date +%Y%m%d%H%M%S)
B=$APP/.deploy-backups/$TS-crm-email-fix-and-switch
mkdir -p "$B"
cd "$PKG"
# 1) back up every existing file this deploy replaces, plus .env, .gitignore and the built site
find . -type f | while read -r f; do
  if [ -e "$APP/$f" ]; then mkdir -p "$B/$(dirname "$f")"; cp -a "$APP/$f" "$B/$f"; fi
done
cp -a "$APP/.gitignore" "$B/.gitignore"
cp -a "$APP/.env" "$B/.env"
cp -a "$APP/dist" "$B/dist"
echo "backup: $B ($(find "$B" -type f | wc -l) files)"
# 2) put the new files in place
cp -a "$PKG/." "$APP/"
cd "$APP"
# 3) a runtime file that must never be committed
grep -qx 'crm-deleted-message-ids.json' .gitignore || echo 'crm-deleted-message-ids.json' >> .gitignore
# 4) turn the inbox safety net ON for this (production) server only
grep -q '^CRM_INBOX_RECONCILE=' .env || printf '\nCRM_INBOX_RECONCILE=true\n' >> .env
# 5) syntax check
for f in server.js crm-*.js scripts/crm-repair-message-ids.mjs; do node --check "$f"; done
echo "syntax OK"
# 6) build the site into a side folder, swap only if it worked
rm -rf dist-new
npx vite build --outDir dist-new --emptyOutDir 2>&1 | grep -E "built in|rror" || true
[ -f dist-new/index.html ] || { echo "BUILD FAILED — the live site was not touched (restore files from $B if needed)"; exit 1; }
mv dist dist.prev && mv dist-new dist && rm -rf dist.prev
echo "site built and swapped in"
# 7) one-time clean-up + catch-up import. Runs BEFORE the restart on purpose: the new background safety
#    net is not running yet, so nothing can import the same emails twice.
echo; echo "== cleaning old-style message ids (a backup of the old values is saved first) =="
node scripts/crm-repair-message-ids.mjs --apply || echo "!! id clean-up reported a problem — see above (safe to re-run later)"
echo; echo "== importing the emails the live feed missed (last 30 days; mail you already read stays 'read') =="
node crm-inbox-reconcile.js --days 30 --min-age 0 --max 100 || echo "!! import reported a problem — the app retries by itself every 5 minutes"
echo "$B" > /root/crm-deploy3/last-backup
echo; echo "DONE. To undo the code:  cp -a $B/. $APP/   then rebuild and restart."
