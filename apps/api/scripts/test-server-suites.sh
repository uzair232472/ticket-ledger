#!/usr/bin/env bash
# Runs the 14 HTTP test suites (they call a running API on localhost:5000, some also the ML service on
# localhost:8000) against a SANDBOXED full server: its own fresh *_verify database copy, no real e-mail, no
# blockchain, no Stripe, no Cloudinary, its own Redis database. Nothing here touches the main development
# database or any external service on purpose; see docs/ml-step5-data-readiness.md section 10.
#
#   bash apps/api/scripts/test-server-suites.sh <backup.dump> [label]
#
# Safety (each one is checked; the run stops if any fails):
#   - the database is a fresh copy named ticketledger_<label>_verify, restored from <backup.dump>;
#   - ports 5000 and 8000 must be free (otherwise the tests would talk to some other server);
#   - the server gets explicit sandbox values that override apps/api/.env (dotenv never overrides variables
#     already set): SMTP host/user "mock" -> nodemailer's in-memory JSON transport (nothing is sent);
#     no NFT minter key and NODE_ENV=development -> minting "simulation" (no chain call, no transaction);
#     a mock Stripe key -> no Stripe client; no Cloudinary keys -> local file storage; no admin e-mail list;
#     Redis database 15 (not the development one);
#   - the server log must say "minting mode: simulation" before any test runs;
#   - after the run the log is searched for SMTP or chain activity and the database copy is dropped.
# Not covered: outbound network is not blocked at the OS level. The values above are what prevent sending.
set -u
DUMP=$1; LABEL=${2:-server}
HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PY=${ML_PYTHON:-"$ROOT/apps/ml-service/.venv/Scripts/python.exe"}
[ -x "$PY" ] || PY="$ROOT/apps/ml-service/.venv/bin/python"
OUT="${TMPDIR:-${TEMP:-/tmp}}/server_suites_$LABEL"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$HERE"
url=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"'); U="${url%/*}"
DB="ticketledger_${LABEL}_verify"
case "$DB" in *_verify) ;; *) echo "refusing: database name must end in _verify"; exit 2 ;; esac
for port in 5000 8000; do
  if netstat -ano 2>/dev/null | grep -qE "[:.]$port .*LISTENING"; then echo "refusing: port $port is in use (stop that server first)"; exit 2; fi
done

psql "$U/postgres" -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1 || { echo "could not create $DB"; exit 2; }
pg_restore --no-owner -d "$U/$DB" "$DUMP" 2> "$OUT/restore.log"
DATABASE_URL="$U/$DB" npx prisma migrate deploy > "$OUT/migrate.log" 2>&1 || { echo "migrate failed (see $OUT/migrate.log)"; exit 2; }

TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
export DATABASE_URL="$U/$DB"
SANDBOX=(
  NODE_ENV=development PORT=5000
  SMTP_HOST=mock-smtp SMTP_USER=mock_user SMTP_PASS= ADMIN_NOTIFY_EMAILS=
  NFT_MINTER_PRIVATE_KEY= POLYGON_PRIVATE_KEY= POLYGON_AMOY_RPC=http://127.0.0.1:1
  STRIPE_SECRET_KEY=sk_test_mock_sandbox STRIPE_PUBLISHABLE_KEY=pk_test_mock_sandbox STRIPE_WEBHOOK_SECRET= STRIPE_MODE=test
  CLOUDINARY_CLOUD_NAME= CLOUDINARY_API_KEY= CLOUDINARY_API_SECRET=
  REDIS_URL=redis://localhost:6379/15
  ML_SERVICE_URL=http://127.0.0.1:8000 ML_SERVICE_TOKEN=$TOKEN
)

stop() {
  for port in 5000 8000; do
    for pid in $(netstat -ano | grep -E "127.0.0.1:$port .*LISTENING|0.0.0.0:$port .*LISTENING|\[::\]:$port .*LISTENING" | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$pid" >/dev/null 2>&1; done
  done
}
trap stop EXIT

(cd "$ROOT/apps/ml-service" && ML_SERVICE_TOKEN=$TOKEN ML_ENV=production "$PY" -m uvicorn main:app --port 8000 > "$OUT/mlsvc.log" 2>&1) &
env "${SANDBOX[@]}" node src/server.js > "$OUT/server.log" 2>&1 &
for i in $(seq 1 60); do curl -s -m 2 http://localhost:5000/api/health >/dev/null && curl -s -m 2 http://127.0.0.1:8000/health >/dev/null && break; sleep 1; done
grep -q "minting mode: simulation" "$OUT/server.log" || { echo "refusing: server did not report minting mode simulation (see $OUT/server.log)"; exit 3; }

FILES=${FILES:-"test_abandoned_intent_dashboard.mjs test_admin_dashboard.mjs test_ai_anti_scalping.mjs test_behavior_system.mjs test_booking.mjs test_digital_wallet.mjs test_fastapi_ml_service.mjs test_final_master_suite.mjs test_nft_minting.mjs test_notification_system.mjs test_prelaunch_demand_forecast.mjs test_purchase_intent_analytics.mjs test_resale.mjs test_transfer_resale.mjs"}
for f in $FILES; do
  # The tests that also open the database directly use the same sandbox copy (and the same mail/chain values)
  env "${SANDBOX[@]}" timeout 600 node --test --test-concurrency=1 "$f" > "$OUT/$f.log" 2>&1
  t=$(grep -E '^ℹ tests' "$OUT/$f.log" | awk '{print $3}'); p=$(grep -E '^ℹ pass' "$OUT/$f.log" | awk '{print $3}'); x=$(grep -E '^ℹ fail' "$OUT/$f.log" | awk '{print $3}')
  echo "$f|${t:-0}|${p:-0}|${x:-0}|$(grep -c 'ECONNREFUSED' "$OUT/$f.log")" >> "$OUT/summary.txt"
done
stop
# Evidence that nothing was sent: a real SMTP transport or a chain call would show up in the server log
grep -niE "smtp\.gmail|EAUTH|535 |minting mode: live|eth_sendRawTransaction" "$OUT/server.log" > "$OUT/side_effects.txt" && echo "WARNING: possible external activity, see $OUT/side_effects.txt"
psql "$U/postgres" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
awk -F'|' '{t+=$2; p+=$3; f+=$4} END {print "TOTAL tests="t" pass="p" fail="f}' "$OUT/summary.txt"
echo "logs: $OUT"
