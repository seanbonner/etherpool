# EtherPool Deployment Checklist

- Confirm target chain and `CHAIN_ID`.
- Confirm deployer wallet and funded balance.
- Confirm no real secrets are committed.
- Run `forge test -vvv`.
- Deploy `EtherPoolFactory`.
- Verify `EtherPoolFactory`.
- Configure frontend factory address and chain ID.
- Deploy Cloudflare Pages.
- Point `etherpool.app` DNS at Cloudflare Pages.
- Run smoke test.

## Smoke Test

- Create a tiny test pool.
- Send a tiny amount to the pool address.
- Confirm the pool appears in the frontend.
- Test failed-pool claim on testnet before mainnet.
- Test completion flow on testnet before mainnet.
