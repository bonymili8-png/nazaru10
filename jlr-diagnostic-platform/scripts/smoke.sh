#!/usr/bin/env bash
# End-to-end smoke test against a running stack (default: docker compose on :8080).
# Requires ALLOW_DEV_AUTH=true on the API (the compose default) and python3.
set -euo pipefail
BASE="${1:-http://localhost:8080}/api/v1"
json() { python3 -c "import sys, json; d = json.load(sys.stdin); print($1)"; }

TOKEN=$(curl -sf -X POST "$BASE/auth/dev" -H 'Content-Type: application/json' -d '{}' | json 'd["access_token"]')
AUTH="Authorization: Bearer $TOKEN"
curl -sf "$BASE/ready" | json 'd["database"] + " / gateway reachable=" + str(d["gateway"]["reachable"])'

VEHICLE=$(curl -sf -X POST "$BASE/vehicles/connect" -H "$AUTH")
VID=$(echo "$VEHICLE" | json 'd["vehicle"]["id"]')
echo "Connected: $(echo "$VEHICLE" | json 'd["vehicle"]["display_name"] + " " + d["vehicle"]["vin"]')"

SCAN=$(curl -sf -X POST "$BASE/vehicles/$VID/scan" -H "$AUTH")
echo "Scan: $(echo "$SCAN" | json "'%d ECUs, %d DTCs in %d ms' % (len(d['ecus']), len(d['dtcs']), d['duration_ms'])")"
[[ $(echo "$SCAN" | json 'len(d["ecus"])') -gt 0 ]]

IDS=$(curl -sf "$BASE/vehicles/$VID/live-data/parameters" -H "$AUTH" | json 'json.dumps([p["id"] for p in d["parameters"]][:5])')
LIVE=$(curl -sf -X POST "$BASE/vehicles/$VID/live-data" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"parameter_ids\": $IDS}")
echo "Live: $(echo "$LIVE" | json "', '.join('%s=%s %s' % (v['name'], v['value'], v['unit']) for v in d['values'])")"
[[ $(echo "$LIVE" | json 'sum(v["status"] == "OK" for v in d["values"])') -gt 0 ]]
echo "Smoke test passed."
