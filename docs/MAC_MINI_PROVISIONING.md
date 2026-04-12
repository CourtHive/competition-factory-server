# Mac mini Provisioning Checklist — Arena `competition-factory-server`

This is a one-page operational checklist for bringing up a new Mac mini as
an in-arena `competition-factory-server` instance. It supports the local-first
deployment topology described in
[`Mentat/planning/EPIXODIC_BOLT_HISTORY_STORAGE.md`](../../Mentat/planning/EPIXODIC_BOLT_HISTORY_STORAGE.md)
and [`Mentat/planning/ARENA_RELAY_DEPLOYMENT.md`](../../Mentat/planning/ARENA_RELAY_DEPLOYMENT.md).

The local server is the system of record during the event window. Cloud
relay is downstream and eventually-consistent.

## 1. Hardware baseline

- [ ] Mac mini M2 or better
- [ ] 16 GB RAM minimum (32 GB recommended for multi-court arenas)
- [ ] 512 GB SSD minimum
- [ ] Wired ethernet to arena LAN switch (Wi-Fi as fallback only)
- [ ] UPS / battery backup on the power outlet

## 2. macOS base install

- [ ] Latest stable macOS
- [ ] Create a dedicated user account (`courthive`) with admin rights
- [ ] Disable sleep, screen lock, automatic updates while event is running
  - System Settings → Energy → "Prevent automatic sleeping when display is off"
  - System Settings → Lock Screen → "Never"
- [ ] Enable Remote Login (SSH) for ops access from a trusted laptop
- [ ] Install Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

## 3. Runtime dependencies

- [ ] `brew install node@22` or `nvm install 22 && nvm alias default 22`
- [ ] `brew install pnpm`
- [ ] `brew install postgresql@16 && brew services start postgresql@16`
- [ ] `brew install redis && brew services start redis`
- [ ] `brew install jq` (handy for queue inspection)
- [ ] Verify: `node -v`, `pnpm -v`, `psql --version`, `redis-cli ping`

## 4. Database bootstrap

- [ ] `createdb courthive`
- [ ] `createuser courthive --pwprompt` (set a strong password)
- [ ] `psql courthive -c "GRANT ALL PRIVILEGES ON DATABASE courthive TO courthive;"`
- [ ] Schema bootstrap is **automatic on first use** —
      `PostgresBoltHistoryStorage.ensureSchema()` runs `CREATE TABLE IF NOT EXISTS bolt_history (...)`
      lazily on the first read/write. No manual migration step required.
- [ ] Optional: pre-apply other schemas via
      `psql -d courthive -f competition-factory-server/src/storage/postgres/migrations/001-initial-schema.sql`

## 5. Repos

- [ ] `git clone <competition-factory-server>` to `/Users/courthive/competition-factory-server`
- [ ] `git clone <factory>` to `/Users/courthive/factory`
- [ ] `cd competition-factory-server && pnpm install` (manual; agents must not run install)
- [ ] `cd factory && npm install && npm run build`

## 6. Env file (`competition-factory-server/.env`)

Use `.env.example` as the template. Key vars for arena Mac mini:

```
APP_MODE=production
APP_PORT=8383
STORAGE_PROVIDER=postgres
PG_USER=courthive
PG_PASSWORD=<set>
PG_DATABASE=courthive

JWT_SECRET=<long random string>

# Arena relay
INSTANCE_ROLE=local
LOCAL_VENUE_ID=arena-<venue-name>-01
CLOUD_RELAY_URL=https://relay.courthive.com
CLOUD_RELAY_API_KEY=<bearer token issued by cloud relay admin>
CLOUD_RELAY_MAX_BATCH=50
CLOUD_RELAY_DRAIN_INTERVAL_MS=5000
```

## 7. Networking

- [ ] Assign a **static LAN IP** in System Settings → Network → Ethernet → Details → TCP/IP → Configure IPv4: Manually
- [ ] Document the IP and post it on the scorekeeper iPads for QR-code based discovery
- [ ] Verify uplink to cloud relay: `curl -I $CLOUD_RELAY_URL/api/cloud-ingest` returns 401 (auth required) — confirms reachability
- [ ] Open port 8383 on the local firewall for the LAN subnet only

## 8. Auto-start (LaunchAgent)

Create `~/Library/LaunchAgents/com.courthive.factory-server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTD/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.courthive.factory-server</string>
    <key>WorkingDirectory</key><string>/Users/courthive/competition-factory-server</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/pnpm</string>
      <string>start</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/Users/courthive/factory-server.log</string>
    <key>StandardErrorPath</key><string>/Users/courthive/factory-server.err</string>
  </dict>
</plist>
```

- [ ] `launchctl load ~/Library/LaunchAgents/com.courthive.factory-server.plist`
- [ ] Verify: `curl http://localhost:8383/health` (or whatever the health endpoint is)

## 9. LAN discovery for scorekeeper iPads (TODO)

- [ ] Print a QR code containing `http://<static-ip>:8383` and paste on each iPad
- [ ] Future: mDNS broadcast via `dns-sd -R "courthive-arena" _http._tcp local 8383`
      so iPads auto-discover without manual entry

## 10. Backup

- [ ] Crontab `pg_dump`:
  ```
  0 */2 * * * /opt/homebrew/opt/postgresql@16/bin/pg_dump -Fc courthive > /Volumes/CourtHive-Backup/courthive-$(date +\%Y\%m\%d-\%H\%M).dump
  ```
- [ ] External drive labeled `CourtHive-Backup`, FAT-formatted so a laptop can read it
- [ ] Test restore on a fresh database before the event:
  `pg_restore -d courthive_test /path/to/dump`

## 11. Health dashboard (TODO)

- [ ] LAN URL: `http://<static-ip>:8383/health`
- [ ] Should report: storage backend, queue depth, last successful cloud push, uplink status

## 12. Troubleshooting runbook

| Symptom | Likely cause | Fix |
|---|---|---|
| Scorekeeper iPad can't connect | LAN switch / Wi-Fi down | Check switch lights, restart access point |
| Bolt scoring slow | Postgres swapping | Check `top`, restart `postgresql@16` |
| Cloud relay queue growing | Uplink down or cloud-relay 5xx | Check `curl $CLOUD_RELAY_URL`, queue drains automatically on recovery |
| Queue depth ever > 10000 | Persistent uplink outage | Operator decision: delete old entries via `netLevel` admin or accept the backlog |
| LaunchAgent fails to start | Wrong path / missing env | `tail /Users/courthive/factory-server.err` |

## 13. Inspect the outbound queue

```bash
# Queue depth (server logs report it; or use a small script to call OutboundQueueService.depth())
# Or inspect via netLevel directly:
DB_HOST=localhost DB_PORT=3838 node -e "
  const nl = require('./src/services/levelDB/netLevel').default;
  nl.list('cloudRelayQueue', { all: true }).then(rows => {
    console.log('queue depth:', rows.length);
    console.log(rows.map(r => ({ key: r.key, attempts: r.value?.attempts, lastError: r.value?.lastError })));
  });
"
```
