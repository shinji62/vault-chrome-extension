#!/usr/bin/env bash
# Runs the integration suite against a throwaway Vault dev server.
#
# Starts Vault in -dev mode (in-memory, unsealed), enables the secrets engines
# the extension needs, runs the tests, then tears the server down.
set -uo pipefail

PORT="${VAULT_TEST_PORT:-8210}"
ADDR="http://127.0.0.1:${PORT}"
TOKEN="root-integration-token"
LOG="$(mktemp -t vault-integration-XXXXXX)"

if ! command -v vault >/dev/null 2>&1; then
  echo "error: the 'vault' binary is required (brew install vault)" >&2
  exit 1
fi

vault server -dev \
  -dev-root-token-id="$TOKEN" \
  -dev-listen-address="127.0.0.1:${PORT}" \
  >"$LOG" 2>&1 &
VAULT_PID=$!

cleanup() {
  kill "$VAULT_PID" 2>/dev/null
  wait "$VAULT_PID" 2>/dev/null
  rm -f "$LOG"
}
trap cleanup EXIT

export VAULT_ADDR="$ADDR"
export VAULT_TOKEN="$TOKEN"

# Wait for the dev server to accept requests.
for _ in $(seq 1 50); do
  vault status >/dev/null 2>&1 && break
  sleep 0.2
done

if ! vault status >/dev/null 2>&1; then
  echo "error: Vault dev server failed to start; log follows:" >&2
  cat "$LOG" >&2
  exit 1
fi

vault secrets enable transit >/dev/null

# Password-policy generation is exercised by the tests, but the client has no
# policy-write method, so the policy is provisioned here.
vault write sys/policies/password/itest-policy policy=- >/dev/null <<'POLICY'
length = 24
rule "charset" {
  charset = "abcdefghijklmnopqrstuvwxyz0123456789"
  min-chars = 1
}
POLICY

echo "Vault dev server ready at $ADDR"

VAULT_TEST_ADDR="$ADDR" VAULT_TEST_TOKEN="$TOKEN" \
  npx vitest run src/api/vaultClient.integration.test.ts "$@"
