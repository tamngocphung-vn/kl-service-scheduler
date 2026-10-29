#!/usr/bin/env bash
# Walks through the core booking flow against a running server (npm run seed && npm start).
# Usage: scripts/demo.sh [base-url] [local-date]
set -euo pipefail

BASE="${1:-http://localhost:3000}"
# Default to the next Monday so the London dealership is open and the date is in the future.
DATE="${2:-$(node -e 'const d=new Date();d.setUTCDate(d.getUTCDate()+((8-d.getUTCDay())%7||7));console.log(d.toISOString().slice(0,10))')}"
PRETTY="cat"; command -v jq >/dev/null && PRETTY="jq ."

step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
call() {
  echo "\$ curl $*"
  local out; out=$(curl -s -w '\n%{http_code}' "$@")
  echo "${out%$'\n'*}" | $PRETTY
  echo "HTTP ${out##*$'\n'}"
}

book() {
  local customer=$1 vehicle=$2 service=$3 start=$4; shift 4
  call -X POST "$BASE/v1/appointments" -H 'content-type: application/json' "$@" \
    -d "{\"dealershipId\":\"dlr-london\",\"customerId\":\"$customer\",\"vehicleId\":\"$vehicle\",\"serviceTypeId\":\"$service\",\"startTime\":\"${DATE}T${start}\"}"
}

step "Reference data"
call "$BASE/v1/service-types"

step "Availability for an EV battery check on $DATE (only Chen is qualified)"
AVAIL="$BASE/v1/dealerships/dlr-london/availability?serviceTypeId=svc-ev&date=$DATE"
echo "\$ curl $AVAIL"
if command -v jq >/dev/null; then
  curl -s "$AVAIL" | jq '{timezone, durationMinutes, slotCount: (.slots | length), firstSlots: .slots[:3]}'
else
  curl -s "$AVAIL"; echo
fi

step "Book Jane's Leaf for an EV check at 09:00 (with an Idempotency-Key)"
book cust-jane veh-jane-leaf svc-ev 09:00:00Z -H 'idempotency-key: demo-jane-ev'

step "Retry the same request: returns the original booking (HTTP 200), no duplicate"
book cust-jane veh-jane-leaf svc-ev 09:00:00Z -H 'idempotency-key: demo-jane-ev'

step "Maria wants an EV check at 09:30: Chen is busy until 10:30, so 409"
book cust-maria veh-maria-model3 svc-ev 09:30:00Z

step "Fill both bays at 13:00 with oil changes (Alice, then Bob)"
book cust-jane veh-jane-golf svc-oil 13:00:00Z
book cust-raj veh-raj-civic svc-oil 13:00:00Z

step "Maria's EV check at 13:00: Chen is free but no bay is, so 409 NO_BAY_AVAILABLE"
book cust-maria veh-maria-model3 svc-ev 13:00:00Z

step "Booking that would run past closing (17:30 + 60 min): 422"
book cust-maria veh-maria-model3 svc-oil 17:30:00Z

step "Today's schedule at London"
call "$BASE/v1/dealerships/dlr-london/appointments?date=$DATE"

step "Booking metrics"
curl -s "$BASE/metrics" | grep '^appointment_booking_attempts_total'
