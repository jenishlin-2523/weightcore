-- WeighCore VPS backend schema (PostgreSQL)
-- One shared database for all lanes (P5WB1, P5WB2, ...). Each row keeps the
-- client UUID as its primary key so lanes never collide, plus a monotonic
-- server-assigned `rev` that drives incremental pull.

CREATE SEQUENCE IF NOT EXISTS rev_seq;

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,
  ticket_no   BIGINT,
  site_code   TEXT,
  scale_id    TEXT,
  vehicle_no  TEXT,
  party       TEXT,
  material    TEXT,
  gross       DOUBLE PRECISION,
  tare        DOUBLE PRECISION,
  net         DOUBLE PRECISION,
  status      TEXT,
  mode        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ,
  rev         BIGINT DEFAULT nextval('rev_seq')
);

CREATE TABLE IF NOT EXISTS weighments (
  id          TEXT PRIMARY KEY,
  txn_id      TEXT,
  seq         INTEGER,
  weight      DOUBLE PRECISION,
  kind        TEXT,
  manual      INTEGER,
  captured_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ,
  rev         BIGINT DEFAULT nextval('rev_seq')
);

CREATE TABLE IF NOT EXISTS vehicles (
  id          TEXT PRIMARY KEY,
  vehicle_no  TEXT,
  tare        DOUBLE PRECISION,
  active      INTEGER,
  updated_at  TIMESTAMPTZ,
  rev         BIGINT DEFAULT nextval('rev_seq')
);

CREATE TABLE IF NOT EXISTS images (
  id          TEXT PRIMARY KEY,
  txn_id      TEXT,
  camera_id   TEXT,
  seq         INTEGER,
  file        TEXT,           -- server-side stored path / object key
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  key         TEXT PRIMARY KEY,   -- X-Device-Key
  scale_id    TEXT,
  label       TEXT,
  last_seen   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_txn_rev  ON transactions(rev);
CREATE INDEX IF NOT EXISTS ix_wgh_rev  ON weighments(rev);
CREATE INDEX IF NOT EXISTS ix_veh_rev  ON vehicles(rev);

-- seed one device key (change it, and set the same value in the client config.sync.apiKey)
INSERT INTO devices(key, scale_id, label, last_seen)
VALUES ('CHANGE-ME-DEVICE-TOKEN', 'P5WB2', 'Lane 2 terminal', now())
ON CONFLICT (key) DO NOTHING;
