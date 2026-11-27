#!/usr/bin/env bash
# Runs every API test file of one source tree against its own fresh database copy, one file at a time,
# and writes one summary line per file: file | tests | pass | fail | connection-refused errors (localhost:5000).
#
#   bash apps/api/scripts/test-per-file.sh <tree root> <label> <backup.dump> <ml port>
# Writes $TMPDIR/suite_<label>/summary.txt and one log per file. Only *_verify databases are created/dropped.
# FILES="test_a.mjs test_b.mjs" limits the run to those files.
# The ML service of that same tree is started on <ml port> for test_ml_persistence / test_ml_shadow_e2e
# (written for Git Bash on Windows: the service is stopped with netstat + taskkill).
set -u
ROOT=$(cd "$1" && pwd); LABEL=$2; DUMP=$3; MLPORT=$4
# The ML service's Python (the project's .venv; override with ML_PYTHON)
PY=${ML_PYTHON:-"$ROOT/apps/ml-service/.venv/Scripts/python.exe"}
[ -x "$PY" ] || PY="$ROOT/apps/ml-service/.venv/bin/python"
OUT="${TMPDIR:-${TEMP:-/tmp}}/suite_$LABEL"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT/apps/api"
url=$(grep '^DATABASE_URL=' "$ROOT/apps/api/.env" | cut -d= -f2- | tr -d '"'); U="${url%/*}"
DB="ticketledger_${LABEL}_verify"   # the name ends in _verify, as the writing tests require
psql "$U/postgres" -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
pg_restore --no-owner -d "$U/$DB" "$DUMP"
DATABASE_URL="$U/$DB" npx prisma migrate deploy > "$OUT/migrate.log" 2>&1
(cd "$ROOT/apps/ml-service" && ML_SERVICE_TOKEN=e2e-token ML_ENV=production "$PY" -m uvicorn main:app --port "$MLPORT" > "$OUT/mlsvc.log" 2>&1) &
for i in $(seq 1 30); do curl -s -m 2 "http://127.0.0.1:$MLPORT/health" >/dev/null && break; sleep 1; done
for f in $(ls ${FILES:-test_*.mjs} | sort); do
  DATABASE_URL="$U/$DB" ML_E2E_URL="http://127.0.0.1:$MLPORT" ML_E2E_TOKEN=e2e-token timeout 600 node --test --test-concurrency=1 "$f" > "$OUT/$f.log" 2>&1
  t=$(grep -E '^ℹ tests' "$OUT/$f.log" | awk '{print $3}'); p=$(grep -E '^ℹ pass' "$OUT/$f.log" | awk '{print $3}'); x=$(grep -E '^ℹ fail' "$OUT/$f.log" | awk '{print $3}')
  echo "$f|${t:-0}|${p:-0}|${x:-0}|$(grep -c 'ECONNREFUSED' "$OUT/$f.log")" >> "$OUT/summary.txt"
done
for pid in $(netstat -ano | grep -E "127.0.0.1:$MLPORT .*LISTENING" | awk '{print $NF}' | sort -u); do taskkill //F //T //PID "$pid" >/dev/null 2>&1; done
psql "$U/postgres" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
awk -F'|' '{t+=$2; p+=$3; f+=$4} END {print "TOTAL tests="t" pass="p" fail="f}' "$OUT/summary.txt"
