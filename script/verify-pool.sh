#!/usr/bin/env bash
# Verify a single deployed EtherPool contract on Etherscan.
#
# Usage:
#   ./script/verify-pool.sh <pool_address> [chain]
#
# `chain` is the forge --chain value (default: mainnet). Example: sepolia.
#
# Requires RPC_URL and ETHERSCAN_API_KEY in the environment (or in .env).
#
# In practice, Etherscan auto-marks new pools as "Similar Match Source Code"
# once any pool with matching bytecode is verified, so most pools won't need
# this. Use this script if a specific pool isn't picking up the similar-match
# verification for some reason.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <pool_address> [chain]" >&2
  exit 1
fi

POOL=$1
CHAIN=${2:-mainnet}

if [[ -z "${RPC_URL:-}" || -z "${ETHERSCAN_API_KEY:-}" ]]; then
  if [[ -f .env ]]; then
    set -a; source .env; set +a
  fi
fi

if [[ -z "${RPC_URL:-}" || -z "${ETHERSCAN_API_KEY:-}" ]]; then
  echo "RPC_URL and ETHERSCAN_API_KEY must be set (in env or .env)." >&2
  exit 1
fi

TD=$(cast call "$POOL" "totalDue()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
DD=$(cast call "$POOL" "dueDate()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
RCP=$(cast call "$POOL" "recipient()(address)" --rpc-url "$RPC_URL" | awk '{print $1}')
CRT=$(cast call "$POOL" "creator()(address)" --rpc-url "$RPC_URL" | awk '{print $1}')

echo "Pool:      $POOL"
echo "Chain:     $CHAIN"
echo "totalDue:  $TD"
echo "dueDate:   $DD"
echo "recipient: $RCP"
echo "creator:   $CRT"

ARGS=$(cast abi-encode "constructor(uint256,uint256,address,address)" "$TD" "$DD" "$RCP" "$CRT")

exec forge verify-contract "$POOL" src/EtherPool.sol:EtherPool \
  --chain "$CHAIN" \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args "$ARGS" \
  --compiler-version v0.8.24+commit.e11b9ed9 \
  --num-of-optimizations 200 \
  --watch
