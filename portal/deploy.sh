#!/usr/bin/env bash
set -e
cd /root/weighcore-portal
docker build -t weighcore-portal . 2>&1 | tail -3
docker rm --force weighcore-portal 2>/dev/null || true
docker run -d --name weighcore-portal --network weighcore-net --restart unless-stopped -e SQL_SERVER=weighcore-sql -e SQL_PORT=1433 -e SQL_DB=svt_weighbridge -e SQL_USER=weighcore -e SQL_PASSWORD="WeighCoreApp!2026" -e SESSION_SECRET="wc-portal-7b3d91a2f" -p 127.0.0.1:8090:8080 weighcore-portal >/dev/null
sleep 5
CJ=/tmp/cj_portal
curl -s -c "$CJ" -o /dev/null --data-urlencode "username=superadmin" --data-urlencode "password=Admin@123" http://127.0.0.1:8090/login
B=http://127.0.0.1:8090
for url in "$B/" "$B/transactions" "$B/transactions?site=P5WB2&status=Complete" "$B/masters" "$B/masters?tab=products" "$B/reports" "$B/slip/P5WB2/101"; do
  code=$(curl -s -b "$CJ" -o /dev/null -w "%{http_code}" "$url")
  echo "$code  $url"
done
