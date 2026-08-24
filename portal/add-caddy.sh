#!/usr/bin/env bash
# Add the WeighCore Admin Portal to the EXISTING Caddy config, safely.
# Backs up first, appends only if absent, validates, then reloads (never restarts).
set -e
CF=/etc/caddy/Caddyfile
cp -a "$CF" "${CF}.bak-weighcore-$(date +%s 2>/dev/null || echo bak)" 2>/dev/null || cp -a "$CF" "${CF}.bak-weighcore"
if grep -q 'weighcore.200-141-9-11.sslip.io' "$CF"; then
  echo "block already present — skipping append"
else
  cat >> "$CF" <<'EOF'

# ── WeighCore Admin Portal (added by setup) ─────────────────
# Unified read-only view of both weighbridges (WB1 / WB2) from the central SQL.
# Portal container listens on 127.0.0.1:8090.
weighcore.200-141-9-11.sslip.io, weighcore.2a02-4780-63-ee71--1.sslip.io {
	encode gzip
	reverse_proxy 127.0.0.1:8090 {
		header_up X-Forwarded-Proto https
		header_up X-Real-IP {remote_host}
	}
}
EOF
  echo "block appended"
fi
echo "== validating =="
caddy validate --config "$CF" --adapter caddyfile
echo "== reloading caddy =="
systemctl reload caddy
echo "== done; caddy status: $(systemctl is-active caddy) =="
