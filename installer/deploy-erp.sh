#!/usr/bin/env bash
# WeighCore central ERP — one-shot VPS deployment (run as root on the VPS).
# Expects alongside it: weighcore-schema.sql, central-migration.sql,
# setup-tunnel-user.sh, and the portal/ folder. Idempotent.
set -e
SA_PASSWORD='WeighCore!SVT2026'
APP_LOGIN='weighcore'
APP_PASSWORD='WeighCoreApp!2026'
DB='svt_weighbridge'
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== [1/6] Docker =="
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
docker network inspect weighcore-net >/dev/null 2>&1 || docker network create weighcore-net

echo "== [2/6] Central SQL Server (container weighcore-sql) =="
if ! docker ps -a --format '{{.Names}}' | grep -qx weighcore-sql; then
  docker run -d --name weighcore-sql --network weighcore-net --restart unless-stopped \
    -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$SA_PASSWORD" -e MSSQL_PID=Express \
    -v weighcore-sqldata:/var/opt/mssql \
    -p 127.0.0.1:1433:1433 \
    mcr.microsoft.com/mssql/server:2022-latest
fi
docker start weighcore-sql >/dev/null

SQLCMD="/opt/mssql-tools18/bin/sqlcmd -C"
docker exec weighcore-sql sh -c "test -x /opt/mssql-tools18/bin/sqlcmd" || SQLCMD="/opt/mssql-tools/bin/sqlcmd"
echo "waiting for SQL to accept logins..."
for i in $(seq 1 60); do
  docker exec weighcore-sql $SQLCMD -S localhost -U sa -P "$SA_PASSWORD" -Q "SELECT 1" >/dev/null 2>&1 && break
  sleep 3
done
docker exec weighcore-sql $SQLCMD -S localhost -U sa -P "$SA_PASSWORD" -Q "SELECT @@VERSION" | head -1

echo "== [3/6] Database, login, schema =="
docker exec weighcore-sql $SQLCMD -S localhost -U sa -P "$SA_PASSWORD" -Q "IF DB_ID('$DB') IS NULL CREATE DATABASE [$DB];"
docker exec weighcore-sql $SQLCMD -S localhost -U sa -P "$SA_PASSWORD" -Q "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='$APP_LOGIN') CREATE LOGIN [$APP_LOGIN] WITH PASSWORD='$APP_PASSWORD', CHECK_POLICY=OFF;"
docker exec weighcore-sql $SQLCMD -S localhost -U sa -P "$SA_PASSWORD" -d "$DB" -Q "IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='$APP_LOGIN') CREATE USER [$APP_LOGIN] FOR LOGIN [$APP_LOGIN]; ALTER ROLE db_owner ADD MEMBER [$APP_LOGIN];"
docker cp "$HERE/weighcore-schema.sql" weighcore-sql:/tmp/schema.sql
docker cp "$HERE/central-migration.sql" weighcore-sql:/tmp/migration.sql
docker exec weighcore-sql $SQLCMD -S localhost -U sa -P "$SA_PASSWORD" -d "$DB" -i /tmp/schema.sql
docker exec weighcore-sql $SQLCMD -S localhost -U sa -P "$SA_PASSWORD" -d "$DB" -i /tmp/migration.sql
echo "schema + migration applied"

echo "== [4/6] Tunnel user (wctunnel, port-forward only) =="
bash "$HERE/setup-tunnel-user.sh"

echo "== [5/6] ERP portal =="
mkdir -p /root/weighcore-portal
cp -r "$HERE/portal/." /root/weighcore-portal/
bash /root/weighcore-portal/deploy.sh

echo "== [6/6] HTTPS (Caddy) =="
bash /root/weighcore-portal/add-caddy.sh || echo "NOTE: caddy step reported an issue — portal still reachable on 127.0.0.1:8090"

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "DONE. Portal: https://weighcore.$(echo "$IP" | tr . -).sslip.io  (login per handover sheet)"
echo "Weighbridge PCs: set vpsSql.ssh.host=\"$IP\" in %ProgramData%\\WeighCore\\config.json and restart the app."
