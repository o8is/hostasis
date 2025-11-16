#!/bin/bash
# Script to update frontend ABI after contract changes

set -e

echo "🔨 Building Solidity contracts..."
forge build --silent

echo "📋 Extracting ABI..."
cat out/PostageYieldManagerUpgradeable.sol/PostageYieldManagerUpgradeable.json | \
  jq '.abi' > hostasis-frontend/src/contracts/abis/PostageYieldManager.json

echo "✅ Frontend ABI updated successfully!"
echo ""
echo "📝 Don't forget to update the contract address in:"
echo "   hostasis-frontend/src/contracts/addresses.ts"
echo ""
echo "🧪 Run TypeScript check:"
echo "   cd hostasis-frontend && npx tsc --noEmit"
