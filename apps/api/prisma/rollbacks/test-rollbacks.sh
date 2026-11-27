#!/usr/bin/env bash
# Tests rollback scripts on throwaway databases (never on the app's own database).
#
# For each migration M given (default: the five gate migrations):
#   1. db  = a new database with every migration up to and including M (prisma migrate deploy)
#   2. ref = a new database with every migration BEFORE M
#   3. run rollbacks/M.down.sql on db (ON_ERROR_STOP) -> its schema must equal ref's schema
#   4. prisma migrate deploy on db must re-apply M          -> its schema must equal a fresh deploy up to M
# Then the whole chain: a database with every listed migration, all down scripts newest first, must equal
# the schema before the oldest one, and must re-apply cleanly.
#
# Usage (from apps/api):  ADMIN_URL=postgresql://user:pass@localhost:5433 bash prisma/rollbacks/test-rollbacks.sh [M ...]
# ADMIN_URL defaults to DATABASE_URL in .env without its database name. Test databases are prefixed rbtest_.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -z "${ADMIN_URL:-}" ]; then
  url=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
  ADMIN_URL="${url%/*}"
fi
MIGS=("$@")
[ ${#MIGS[@]} -eq 0 ] && MIGS=(20261118120000_gate_device_tokens 20261118140000_gate_sync_idempotency 20261118160000_gate_scan_conflicts 20261118180000_gate_diagnostics 20261118200000_gate_security)
ALL=($(ls prisma/migrations | grep -v '.toml$' | LC_ALL=C sort))
WORK=$(mktemp -d)
FAILS=0

mkdb() { psql "$ADMIN_URL/postgres" -qAtc "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" >/dev/null; }
dropdb_() { psql "$ADMIN_URL/postgres" -qAtc "DROP DATABASE IF EXISTS $1" >/dev/null; }
# deploy_upto DB LAST_INDEX(exclusive) : migrations ALL[0..n-1]
deploy_upto() {
  local db=$1 n=$2 dir="$WORK/m_$1_$2"
  rm -rf "$dir"; mkdir -p "$dir/migrations"
  cp prisma/schema.prisma "$dir/"; cp prisma/migrations/migration_lock.toml "$dir/migrations/"
  for ((i = 0; i < n; i++)); do cp -r "prisma/migrations/${ALL[$i]}" "$dir/migrations/"; done
  DATABASE_URL="$ADMIN_URL/$db" npx prisma migrate deploy --schema "$dir/schema.prisma" >"$WORK/deploy.log" 2>&1 \
    || { echo "    deploy failed:"; grep -iE "error|P30" "$WORK/deploy.log" | head -5 | sed 's/^/      /'; return 1; }
}
schema() { pg_dump -s --no-owner -d "$ADMIN_URL/$1" -T _prisma_migrations | grep -vE '^(--|\\restrict|\\unrestrict)' | sed '/^$/d'; }
idx() { for i in "${!ALL[@]}"; do [ "${ALL[$i]}" = "$1" ] && { echo "$i"; return; }; done; echo "unknown migration $1" >&2; exit 2; }
check() { if [ "$1" = ok ]; then echo "    PASS  $2"; else echo "    FAIL  $2"; FAILS=$((FAILS + 1)); fi; }
same() { if diff <(schema "$1") <(schema "$2") >"$WORK/diff" 2>&1; then echo ok; else echo bad; fi; }

for m in "${MIGS[@]}"; do
  k=$(idx "$m")
  echo "== $m"
  mkdb rbtest_db; mkdb rbtest_ref; mkdb rbtest_fresh
  deploy_upto rbtest_db $((k + 1)); deploy_upto rbtest_ref "$k"; deploy_upto rbtest_fresh $((k + 1))
  if psql -v ON_ERROR_STOP=1 -q -d "$ADMIN_URL/rbtest_db" -f "prisma/rollbacks/$m.down.sql" >"$WORK/down.log" 2>&1; then
    check ok "down script runs"
    r=$(same rbtest_db rbtest_ref); check "$r" "schema after rollback = schema before the migration"
    [ "$r" = ok ] || head -20 "$WORK/diff" | sed 's/^/      /'
    if deploy_upto rbtest_db $((k + 1)); then
      check ok "prisma migrate deploy re-applies it"
      r=$(same rbtest_db rbtest_fresh); check "$r" "schema after re-apply = fresh deploy"
      [ "$r" = ok ] || head -20 "$WORK/diff" | sed 's/^/      /'
    else
      check bad "prisma migrate deploy re-applies it"
    fi
  else
    check bad "down script runs"; sed 's/^/      /' "$WORK/down.log" | head -5
  fi
done

if [ ${#MIGS[@]} -gt 1 ]; then
  first=$(idx "${MIGS[0]}"); last=$(idx "${MIGS[-1]}")
  echo "== whole chain ${MIGS[0]} .. ${MIGS[-1]} (newest first)"
  mkdb rbtest_db; mkdb rbtest_ref; mkdb rbtest_fresh
  deploy_upto rbtest_db $((last + 1)); deploy_upto rbtest_ref "$first"; deploy_upto rbtest_fresh $((last + 1))
  ok=ok
  for ((j = ${#MIGS[@]} - 1; j >= 0; j--)); do
    psql -v ON_ERROR_STOP=1 -q -d "$ADMIN_URL/rbtest_db" -f "prisma/rollbacks/${MIGS[$j]}.down.sql" >"$WORK/down.log" 2>&1 \
      || { ok=bad; echo "    ${MIGS[$j]} down failed:"; sed 's/^/      /' "$WORK/down.log" | head -3; break; }
  done
  check $ok "all down scripts run"
  if [ $ok = ok ]; then
    r=$(same rbtest_db rbtest_ref); check "$r" "schema = before ${MIGS[0]}"
    if deploy_upto rbtest_db $((last + 1)); then r=$(same rbtest_db rbtest_fresh); check "$r" "re-applied chain = fresh deploy"; else check bad "re-apply chain"; fi
  fi
fi

if printf '%s\n' "${MIGS[@]}" | grep -qx 20261118200000_gate_security; then
  echo "== gate_security refuses while TAMPERED quarantined scans exist"
  k=$(idx 20261118200000_gate_security)
  mkdb rbtest_db; deploy_upto rbtest_db $((k + 1))
  psql -q -d "$ADMIN_URL/rbtest_db" -c "INSERT INTO \"QuarantinedScan\" (id, \"companyId\", \"eventId\", \"deviceKey\", \"submittedById\", reason, payload) VALUES ('t1','c','e','d','u','TAMPERED','{}')"
  before=$(schema rbtest_db)
  if psql -v ON_ERROR_STOP=1 -q -d "$ADMIN_URL/rbtest_db" -f prisma/rollbacks/20261118200000_gate_security.down.sql >"$WORK/down.log" 2>&1; then
    check bad "down script refuses"
  else
    check ok "down script refuses ($(grep -o 'TAMPERED exist[^:]*' "$WORK/down.log" | head -1))"
    [ "$before" = "$(schema rbtest_db)" ] && r=ok || r=bad; check $r "nothing changed"
    n=$(psql -Atq -d "$ADMIN_URL/rbtest_db" -c "SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261118200000_gate_security'")
    [ "$n" = 1 ] && r=ok || r=bad; check $r "migration record kept"
  fi
fi

dropdb_ rbtest_db; dropdb_ rbtest_ref; dropdb_ rbtest_fresh; rm -rf "$WORK"
echo; [ $FAILS -eq 0 ] && echo "All rollback checks passed" || echo "$FAILS rollback check(s) failed"
exit $((FAILS > 0))
