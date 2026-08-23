# WeighCore VPS sync backend

A small Express + PostgreSQL hub that both lane terminals (P5WB1, P5WB2) push to
and pull from. The desktop app is offline-first; this server just reconciles.

## Stand it up on the VPS

```bash
# 1. PostgreSQL
sudo -u postgres psql -c "CREATE USER weighcore PASSWORD 'weighcore';"
sudo -u postgres psql -c "CREATE DATABASE weighcore OWNER weighcore;"
psql "postgres://weighcore:weighcore@localhost:5432/weighcore" -f schema.sql

# 2. App
npm install
DATABASE_URL="postgres://weighcore:weighcore@localhost:5432/weighcore" \
IMAGES_DIR="/var/weighcore/uploads" PORT=4000 node server.js

# 3. Put it behind HTTPS (nginx/caddy) and run under pm2 or systemd.
```

Point each terminal's `config.json` → `sync.baseUrl` at `https://<vps>/api`, and
set `sync.apiKey` to a value that exists in the `devices` table (one row per
terminal — give each lane its own key).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness (no auth) |
| POST | `/sync/push` | receive `{changes:[…]}` from a terminal |
| GET | `/sync/pull?since=<rev>` | changes since a rev cursor |
| POST | `/images` | multipart JPEG upload |

All except `/health` require header `X-Device-Key`.

## How the hybrid model behaves

- **Offline** — terminals keep working entirely against local SQLite; every
  change is queued in a local `outbox`.
- **Reconnect** — the terminal pushes its outbox, pulls others' changes, and
  uploads pending JPEGs. Rows are keyed by client UUID, so the two lanes never
  clash; conflicts resolve last-writer-wins on `updated_at`.
- **Scale-out** — add a third lane by inserting another `devices` row and
  pointing a new terminal at the same server. Nothing else changes.

## Production notes

- Swap disk image storage for S3/MinIO by replacing the `multer` destination.
- Add TLS + a real secret per device; rotate keys from the `devices` table.
- `rev` is a global monotonic sequence — pull is O(changes), not O(table).
