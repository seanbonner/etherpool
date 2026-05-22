# EtherPool

Live: [etherpool.app](https://etherpool.app)

Mainnet factory: [`0x23265146B86076bD416Ab7573Bdfa09Fe3F5d301`](https://etherscan.io/address/0x23265146b86076bd416ab7573bdfa09fe3f5d301)

EtherPool creates simple ETH payment pools: if the total due is reached by the due date, the recipient gets paid; otherwise senders can claim their ETH back.

## How It Works

1. Create a pool through `EtherPoolFactory.createPool(totalDue, dueDate, recipient)`.
2. Send ETH to the pool address directly, or call `contribute()`.
3. If the pool reaches `totalDue` by `dueDate`, anyone can call `complete()`.
4. `complete()` sends exactly `totalDue` to the immutable recipient.
5. If the pool expires underfunded, contributors can call `claimContribution()`.
6. If someone overpays, or sends after completion or after the due date, that sender can call `claimExcess()`.

## V1 Constraints

- Each pool is its own ETH-receiving contract address.
- Pool terms are immutable: `totalDue`, `dueDate`, `recipient`, `factory`, and `creator`.
- Recipients must be EOAs, not contracts, Safes, multisigs, or smart wallets.
- Claims are keyed to `msg.sender`; do not send from exchanges or custodial wallets unless that sending address can later claim funds.
- Claims never expire.
- There are no admin controls, no dev fee, no sweep, no marketplace logic, no NFT logic, and no governance.

## Contracts

- `src/EtherPool.sol`: the immutable payment pool contract.
- `src/EtherPoolFactory.sol`: deploys and indexes EtherPool contracts.

## Frontend

The static frontend lives in `frontend/` and is prepared for Cloudflare Pages. It has no backend dependency for v1 and reads Foundry-generated ABI artifacts copied from `out/`.

Frontend config is static. `npm run build` writes `frontend/dist/config.js` from these environment variables:

- `FRONTEND_FACTORY_ADDRESS`
- `FRONTEND_CHAIN_ID`
- `FRONTEND_ETHERSCAN_BASE_URL` optional; if omitted, the build script uses a known Etherscan URL for mainnet, Sepolia, or Holesky.
- `FRONTEND_RPC_URL` optional; if omitted, the build script uses a public RPC for mainnet, Sepolia, or Holesky. This is read-only and lets the frontend display pools without a wallet connected.

### Runtime dependencies

The frontend uses [viem](https://viem.sh), bundled at build time by
[esbuild](https://esbuild.github.io) into a single self-contained
`frontend/dist/main.js`. The deployed site has no third-party CDN dependency at
runtime. Build deps (`viem`, `esbuild`) are devDependencies in
`frontend/package.json` and installed by `npm install`.

Build the contracts first, then build the frontend:

```sh
forge build
cd frontend
npm run build
```

The frontend build copies these artifacts into `frontend/dist/abi/`:

- `out/EtherPool.sol/EtherPool.json`
- `out/EtherPoolFactory.sol/EtherPoolFactory.json`

## Deployment

Install dependencies:

```sh
forge --version
node --version
```

This repo currently vendors the minimal Solidity libraries it uses and the frontend has no package dependencies.

Create local environment values:

```sh
cp .env.example .env
```

Fill in `.env` without committing real secrets, then export the values in your shell:

```sh
set -a
source .env
set +a
```

Run tests:

```sh
forge test -vvv
```

Deploy and verify the factory:

```sh
forge script script/DeployEtherPoolFactory.s.sol --rpc-url $RPC_URL --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

### Pool verification on Etherscan

Each `createPool` call deploys a brand-new `EtherPool` contract, so each pool address is its own deployment that Etherscan tracks separately from the factory.

Once any single pool is verified on Etherscan, every other pool with matching bytecode automatically picks up "Similar Match Source Code" status — the source is viewable on each pool's Etherscan page even without re-running verification. So in practice you only need to verify one pool per chain.

If a specific pool isn't picking up the similar-match verification, run:

```sh
./script/verify-pool.sh 0xPoolAddressHere
```

(Pass `sepolia` as a second argument for a Sepolia pool; defaults to mainnet.)

Set frontend deployment values after deployment:

```sh
export FRONTEND_FACTORY_ADDRESS=<deployed_factory_address>
export FRONTEND_CHAIN_ID=$CHAIN_ID
```

Build the frontend:

```sh
forge build
cd frontend
npm run build
```

Cloudflare Pages settings:

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`

Post-deploy checks:

- Create a tiny test pool.
- Send a tiny amount to the pool address.
- Confirm the pool appears in the frontend.
- Test failed-pool claim on testnet before mainnet.
- Test completion flow on testnet before mainnet.

## Test

```sh
forge fmt
forge test -vvv
```
