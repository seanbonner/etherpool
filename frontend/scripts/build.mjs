import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const projectRoot = resolve(frontendRoot, "..");
const dist = resolve(frontendRoot, "dist");

const chainId = Number(process.env.FRONTEND_CHAIN_ID || process.env.CHAIN_ID || "1");
const etherscanBaseUrls = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  17000: "https://holesky.etherscan.io"
};
const defaultRpcUrls = {
  1: "https://cloudflare-eth.com",
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
  ["EtherPool.json", resolve(projectRoot, "out/EtherPool.sol/EtherPool.json")],
  ["EtherPoolFactory.json", resolve(projectRoot, "out/EtherPoolFactory.sol/EtherPoolFactory.json")]
];

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "abi"), { recursive: true });

// Copy static assets but skip main.js — esbuild emits a bundled version below.
await cp(resolve(frontendRoot, "public"), dist, {
  recursive: true,
  filter: (src) => !src.endsWith("/main.js")
});

for (const [name, source] of artifacts) {
  const raw = await readFile(source, "utf8");
  const artifact = JSON.parse(raw);
  await writeFile(resolve(dist, "abi", name), JSON.stringify({ abi: artifact.abi }, null, 2));
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
