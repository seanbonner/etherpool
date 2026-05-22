import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const projectRoot = resolve(frontendRoot, "..");
const dist = resolve(frontendRoot, "dist");
const vendoredAbiDir = resolve(frontendRoot, "abi");

const chainId = Number(process.env.FRONTEND_CHAIN_ID || process.env.CHAIN_ID || "1");
const etherscanBaseUrls = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  17000: "https://holesky.etherscan.io"
};
const defaultRpcUrls = {
  1: "https://ethereum-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  17000: "https://ethereum-holesky-rpc.publicnode.com"
};

const config = {
  factoryAddress: process.env.FRONTEND_FACTORY_ADDRESS || "",
  chainId,
  etherscanBaseUrl: process.env.FRONTEND_ETHERSCAN_BASE_URL || etherscanBaseUrls[chainId] || "https://etherscan.io",
  rpcUrl: process.env.FRONTEND_RPC_URL || defaultRpcUrls[chainId] || ""
};

const artifacts = [
  {
    name: "EtherPool.json",
    forgeOut: resolve(projectRoot, "out/EtherPool.sol/EtherPool.json"),
    vendored: resolve(vendoredAbiDir, "EtherPool.json")
  },
  {
    name: "EtherPoolFactory.json",
    forgeOut: resolve(projectRoot, "out/EtherPoolFactory.sol/EtherPoolFactory.json"),
    vendored: resolve(vendoredAbiDir, "EtherPoolFactory.json")
  }
];

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "abi"), { recursive: true });
await mkdir(vendoredAbiDir, { recursive: true });

// Copy static assets but skip main.js — esbuild emits a bundled version below.
await cp(resolve(frontendRoot, "public"), dist, {
  recursive: true,
  filter: (src) => !src.endsWith("/main.js")
});

for (const { name, forgeOut, vendored } of artifacts) {
  // Prefer fresh Foundry output if present (local dev after `forge build`).
  // Fall back to the vendored copy that ships in the repo (so the frontend
  // builds on Cloudflare Pages or anywhere else without Foundry installed).
  // When using forge output, keep the vendored copy in sync so the next
  // commit naturally captures any ABI changes.
  const hasForge = await fileExists(forgeOut);
  const hasVendored = await fileExists(vendored);

  let abi;
  if (hasForge) {
    const raw = await readFile(forgeOut, "utf8");
    abi = JSON.parse(raw).abi;
    await writeFile(vendored, `${JSON.stringify({ abi }, null, 2)}\n`);
  } else if (hasVendored) {
    const raw = await readFile(vendored, "utf8");
    abi = JSON.parse(raw).abi;
  } else {
    throw new Error(
      `Missing ABI for ${name}. Run \`forge build\` from the repo root, or commit a vendored copy to frontend/abi/${name}.`
    );
  }

  await writeFile(resolve(dist, "abi", name), `${JSON.stringify({ abi }, null, 2)}\n`);
}

await writeFile(resolve(dist, "config.js"), `window.ETHERPOOL_CONFIG = ${JSON.stringify(config, null, 2)};\n`);

await esbuild.build({
  entryPoints: [resolve(frontendRoot, "public/main.js")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  outfile: resolve(dist, "main.js"),
  legalComments: "none"
});
