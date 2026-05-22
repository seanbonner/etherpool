async function loadAbiStatus(path, elementId) {
  const element = document.getElementById(elementId);

  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const artifact = await response.json();
    const count = Array.isArray(artifact.abi) ? artifact.abi.length : 0;
    element.textContent = `${count} ABI entries available`;
  } catch {
    element.textContent = "Run forge build, then npm run build to copy ABI files";
  }
}

const config = window.ETHERPOOL_CONFIG || {};
const factoryAddressElement = document.getElementById("factory-address-status");
const chainElement = document.getElementById("chain-status");

if (config.factoryAddress) {
  const explorer = config.etherscanBaseUrl
    ? `${config.etherscanBaseUrl}/address/${config.factoryAddress}`
    : "";
  factoryAddressElement.innerHTML = explorer
    ? `<a href="${explorer}" rel="noreferrer">${config.factoryAddress}</a>`
    : config.factoryAddress;
} else {
  factoryAddressElement.textContent = "Set FRONTEND_FACTORY_ADDRESS before build";
}

chainElement.textContent = config.chainId ? String(config.chainId) : "Set FRONTEND_CHAIN_ID before build";

await Promise.all([
  loadAbiStatus("./abi/EtherPool.json", "pool-abi-status"),
  loadAbiStatus("./abi/EtherPoolFactory.json", "factory-abi-status")
]);
