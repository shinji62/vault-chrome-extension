#!/usr/bin/env bash
# Runs the integration suite against a throwaway Vault dev server in a container.
#
# Vault runs in -dev mode (in-memory, unsealed, `secret/` premounted as KV v2).
# The engines the extension needs are provisioned over the HTTP API rather than
# with the `vault` CLI, so a container engine is the only requirement — the same
# path then runs locally and in CI, which is what keeps the two from drifting.
set -euo pipefail

IMAGE="${VAULT_TEST_IMAGE:-docker.io/hashicorp/vault:1.19.1}"
PORT="${VAULT_TEST_PORT:-8210}"
ADDR="http://127.0.0.1:${PORT}"
TOKEN="root-integration-token"
NAME="vault-integration-$$"

# CI runners ship Docker; Podman is CLI-compatible for everything used here and
# is common on developer machines.
ENGINE="${VAULT_TEST_ENGINE:-}"
if [[ -z "$ENGINE" ]]; then
  for candidate in docker podman; do
    if command -v "$candidate" >/dev/null 2>&1; then
      ENGINE="$candidate"
      break
    fi
  done
fi

if [[ -z "$ENGINE" ]]; then
  echo "error: a container engine is required (install Docker or Podman)" >&2
  exit 1
fi

if ! command -v "$ENGINE" >/dev/null 2>&1; then
  echo "error: container engine '$ENGINE' not found on PATH" >&2
  exit 1
fi

if ! "$ENGINE" info >/dev/null 2>&1; then
  echo "error: '$ENGINE' is installed but its daemon is not reachable" >&2
  exit 1
fi

cleanup() {
  "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$ENGINE" run -d --name "$NAME" \
  -p "127.0.0.1:${PORT}:8200" \
  -e "VAULT_DEV_ROOT_TOKEN_ID=${TOKEN}" \
  -e 'VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200' \
  --cap-add=IPC_LOCK \
  "$IMAGE" >/dev/null

api() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" -H "X-Vault-Token: ${TOKEN}" "${ADDR}/v1/${path}" "$@"
}

# Wait for the dev server to accept requests.
for _ in $(seq 1 60); do
  curl -sf "${ADDR}/v1/sys/health" >/dev/null 2>&1 && break
  sleep 0.5
done

if ! curl -sf "${ADDR}/v1/sys/health" >/dev/null 2>&1; then
  echo "error: Vault dev server failed to start; container log follows:" >&2
  "$ENGINE" logs "$NAME" >&2 2>&1 || true
  exit 1
fi

api POST sys/mounts/transit -d '{"type":"transit"}' >/dev/null

# Password-policy generation is exercised by the tests, but the client has no
# policy-write method, so the policy is provisioned here.
api POST sys/policies/password/itest-policy --data-binary @- >/dev/null <<'POLICY'
{
  "policy": "length = 24\nrule \"charset\" {\n  charset = \"abcdefghijklmnopqrstuvwxyz0123456789\"\n  min-chars = 1\n}\n"
}
POLICY

echo "Vault dev server ready at $ADDR (${IMAGE} via ${ENGINE})"

VAULT_TEST_ADDR="$ADDR" VAULT_TEST_TOKEN="$TOKEN" \
  npx vitest run src/api/vaultClient.integration.test.ts "$@"
