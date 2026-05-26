import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
  parseEther,
  isAddress,
  getAddress,
  getContract,
  decodeEventLog
} from "viem";
import { mainnet, sepolia, holesky } from "viem/chains";

const config = window.ETHERPOOL_CONFIG || {};
const STATUS_LABELS = ["Active", "Funded", "Completed", "Failed"];
const GROUP_ORDER = [1, 0, 2, 3];
const GROUP_LABELS = {
  0: "Active",
  1: "Funded — Ready to Complete",
  2: "Completed",
  3: "Failed"
};
const KNOWN_CHAINS = { 1: mainnet, 11155111: sepolia, 17000: holesky };

const el = (id) => document.getElementById(id);
const expectedChain = KNOWN_CHAINS[config.chainId];

const state = {
  publicClient: null,
  walletClient: null,
  account: null,
  walletChainId: null,
  factory: null,
  poolAbi: null,
  factoryAbi: null,
  pools: [],
  selectedPool: null
};

function showError(message) {
  el("setup-error").hidden = false;
  el("setup-error-message").textContent = message;
}

function setStatus(message, tone) {
  const banner = el("status-message");
  if (!message) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.className = "banner";
  if (tone === "error") banner.classList.add("banner-error");
  else if (tone === "warn") banner.classList.add("banner-warn");
  else if (tone === "ok") banner.classList.add("banner-ok");
  el("status-message-text").textContent = message;
}

function shortAddress(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function explorerUrl(kind, value) {
  if (!config.etherscanBaseUrl || !value) return null;
  return `${config.etherscanBaseUrl}/${kind}/${value}`;
}

function formatDate(unixSeconds) {
  const ms = Number(unixSeconds) * 1000;
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

function describeError(err) {
  if (!err) return "Unknown error";
  if (err.shortMessage) return err.shortMessage;
  if (err.details) return err.details;
  if (err.message) return err.message;
  return String(err);
}

async function fetchAbi(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  const data = await response.json();
  if (!Array.isArray(data.abi)) throw new Error(`Invalid ABI in ${path}`);
  return data.abi;
}

function buildPublicClient() {
  if (!config.rpcUrl && !window.ethereum) {
    return null;
  }
  if (config.rpcUrl) {
    return createPublicClient({
      chain: expectedChain,
      transport: http(config.rpcUrl)
    });
  }
  return createPublicClient({
    chain: expectedChain,
    transport: custom(window.ethereum)
  });
}

async function init() {
  el("expected-chain").textContent = config.chainId ? String(config.chainId) : "—";
  el("factory-display").textContent = config.factoryAddress
    ? shortAddress(config.factoryAddress)
    : "not set";

  if (!config.factoryAddress) {
    showError(
      "Factory address is not configured. Set FRONTEND_FACTORY_ADDRESS before building."
    );
    return;
  }
  if (!isAddress(config.factoryAddress)) {
    showError("Configured factoryAddress is not a valid EVM address.");
    return;
  }
  if (config.chainId && !expectedChain) {
    showError("Unsupported chain configured. Add this chain to the frontend chain list.");
    return;
  }

  try {
    [state.poolAbi, state.factoryAbi] = await Promise.all([
      fetchAbi("./abi/EtherPool.json"),
      fetchAbi("./abi/EtherPoolFactory.json")
    ]);
  } catch (err) {
    showError(`Could not load ABIs. ${describeError(err)} Run forge build then npm run build.`);
    return;
  }

  state.publicClient = buildPublicClient();
  if (!state.publicClient) {
    setStatus(
      "Connect a wallet to load pool data — no read-only RPC is configured.",
      "warn"
    );
  } else {
    state.factory = getContract({
      address: getAddress(config.factoryAddress),
      abi: state.factoryAbi,
      client: state.publicClient
    });
    await refreshPools();
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No injected wallet detected. Install a browser wallet to continue.", "error");
    return;
  }
  try {
    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    state.account = getAddress(account);
    state.walletClient = createWalletClient({
      chain: expectedChain,
      transport: custom(window.ethereum)
    });
    const hexChainId = await window.ethereum.request({ method: "eth_chainId" });
    state.walletChainId = Number(hexChainId);

    if (!state.publicClient) {
      state.publicClient = createPublicClient({
        chain: expectedChain,
        transport: custom(window.ethereum)
      });
      state.factory = getContract({
        address: getAddress(config.factoryAddress),
        abi: state.factoryAbi,
        client: state.publicClient
      });
    }

    window.ethereum.on?.("accountsChanged", (accounts) => {
      state.account = accounts[0] ? getAddress(accounts[0]) : null;
      updateWalletBar();
      if (state.selectedPool) renderDetail();
    });
    window.ethereum.on?.("chainChanged", (hex) => {
      state.walletChainId = Number(hex);
      updateWalletBar();
    });

    updateWalletBar();
    setStatus("Wallet connected.", "ok");
    await refreshPools();
  } catch (err) {
    setStatus(`Could not connect wallet. ${describeError(err)}`, "error");
  }
}

function updateWalletBar() {
  el("wallet-address").textContent = state.account
    ? shortAddress(state.account)
    : "Not connected";
  el("wallet-chain").textContent = state.walletChainId != null ? String(state.walletChainId) : "—";
  el("connect-btn").textContent = state.account ? "Reconnect" : "Connect Wallet";

  const chainWarn = el("chain-warning");
  if (
    state.walletChainId != null &&
    config.chainId &&
    Number(state.walletChainId) !== Number(config.chainId)
  ) {
    chainWarn.hidden = false;
    el("chain-warning-message").textContent =
      `Wallet is on chain ${state.walletChainId}, but EtherPool here expects ${config.chainId}. Switch network before sending transactions.`;
  } else {
    chainWarn.hidden = true;
  }
}

async function readPool(address) {
  const client = state.publicClient;
  const abi = state.poolAbi;
  const calls = [
    "totalDue",
    "dueDate",
    "recipient",
    "totalContributed",
    "completedAt",
    "status",
    "amountRemaining",
    "canComplete"
  ].map((fn) => client.readContract({ address, abi, functionName: fn }));

  const [
    totalDue,
    dueDate,
    recipient,
    totalContributed,
    completedAt,
    status,
    amountRemaining,
    canComplete
  ] = await Promise.all(calls);

  return {
    address,
    totalDue,
    dueDate,
    recipient,
    totalContributed,
    completedAt,
    status: Number(status),
    amountRemaining,
    canComplete
  };
}

async function readClaimables(poolAddress, account) {
  if (!account) return { contribution: 0n, excess: 0n };
  const [contribution, excess] = await Promise.all([
    state.publicClient.readContract({
      address: poolAddress,
      abi: state.poolAbi,
      functionName: "claimableContribution",
      args: [account]
    }),
    state.publicClient.readContract({
      address: poolAddress,
      abi: state.poolAbi,
      functionName: "claimableExcess",
      args: [account]
    })
  ]);
  return { contribution, excess };
}

async function refreshPools() {
  if (!state.factory) return;
  setStatus("Loading pools…", "info");
  try {
    const addresses = await state.factory.read.allPools();
    el("pools-count").textContent = `${addresses.length} total`;
    const pools = await Promise.all(addresses.map(readPool));
    state.pools = pools;
    if (state.selectedPool) {
      const updated = pools.find((p) => p.address.toLowerCase() === state.selectedPool.address.toLowerCase());
      state.selectedPool = updated || null;
    }
    renderPools();
    if (state.selectedPool) await renderDetail();
    setStatus("", null);
  } catch (err) {
    setStatus(`Could not load pools. ${describeError(err)}`, "error");
  }
}

function progressPercent(pool) {
  if (pool.totalDue === 0n) return 0;
  const num = (pool.totalContributed * 10000n) / pool.totalDue;
  return Math.min(100, Number(num) / 100);
}

function renderPools() {
  const groupsEl = el("pool-groups");
  const emptyEl = el("pools-empty");
  groupsEl.innerHTML = "";
  if (state.pools.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const grouped = { 0: [], 1: [], 2: [], 3: [] };
  for (const pool of state.pools) grouped[pool.status].push(pool);

  for (const status of GROUP_ORDER) {
    const list = grouped[status];
    if (list.length === 0) continue;
    const groupEl = document.createElement("div");
    groupEl.className = "group";
    const heading = document.createElement("h3");
    heading.textContent = `${GROUP_LABELS[status]} (${list.length})`;
    groupEl.appendChild(heading);

    const cards = document.createElement("div");
    cards.className = "cards";
    for (const pool of list) cards.appendChild(buildCard(pool));
    groupEl.appendChild(cards);
    groupsEl.appendChild(groupEl);
  }
}

function buildCard(pool) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card";
  if (state.selectedPool && state.selectedPool.address === pool.address) {
    card.classList.add("selected");
  }
  card.addEventListener("click", () => selectPool(pool));

  const header = document.createElement("div");
  header.className = "card-header";
  const addr = document.createElement("span");
  addr.textContent = shortAddress(pool.address);
  const badge = document.createElement("span");
  badge.className = `badge badge-${STATUS_LABELS[pool.status].toLowerCase()}`;
  badge.textContent = STATUS_LABELS[pool.status];
  header.appendChild(addr);
  header.appendChild(badge);
  card.appendChild(header);

  const recipientRow = document.createElement("div");
  recipientRow.className = "card-row";
  recipientRow.innerHTML = `<span>Recipient</span><span>${shortAddress(pool.recipient)}</span>`;
  card.appendChild(recipientRow);

  const dueRow = document.createElement("div");
  dueRow.className = "card-row";
  dueRow.innerHTML = `<span>Total due</span><span>${formatEther(pool.totalDue)} ETH</span>`;
  card.appendChild(dueRow);

  const contributedRow = document.createElement("div");
  contributedRow.className = "card-row";
  contributedRow.innerHTML = `<span>Contributed</span><span>${formatEther(pool.totalContributed)} ETH</span>`;
  card.appendChild(contributedRow);

  const remainingRow = document.createElement("div");
  remainingRow.className = "card-row";
  remainingRow.innerHTML = `<span>Remaining</span><span>${formatEther(pool.amountRemaining)} ETH</span>`;
  card.appendChild(remainingRow);

  const dateRow = document.createElement("div");
  dateRow.className = "card-row";
  dateRow.innerHTML = `<span>Due</span><span>${formatDate(pool.dueDate)}</span>`;
  card.appendChild(dateRow);

  const pct = progressPercent(pool);
  const progress = document.createElement("div");
  progress.className = "progress";
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  bar.style.width = `${pct}%`;
  progress.appendChild(bar);
  card.appendChild(progress);

  const pctRow = document.createElement("div");
  pctRow.className = "card-row";
  pctRow.innerHTML = `<span>${pct.toFixed(1)}% funded</span><span></span>`;
  card.appendChild(pctRow);

  return card;
}

async function selectPool(pool) {
  state.selectedPool = pool;
  renderPools();
  el("detail-section").hidden = false;
  await renderDetail();
  el("detail-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function renderDetail() {
  const pool = state.selectedPool;
  if (!pool) return;
  const body = el("detail-body");
  body.innerHTML = "";

  const address = document.createElement("div");
  address.className = "detail-address";
  address.textContent = pool.address;
  body.appendChild(address);

  const buttons = document.createElement("div");
  buttons.className = "detail-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "secondary";
  copyBtn.textContent = "Copy address";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pool.address);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy address"), 1500);
    } catch {
      copyBtn.textContent = "Copy failed";
    }
  });
  buttons.appendChild(copyBtn);

  const explorerLink = explorerUrl("address", pool.address);
  if (explorerLink) {
    const link = document.createElement("a");
    link.href = explorerLink;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View on explorer";
    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "secondary";
    linkBtn.textContent = "View on explorer";
    linkBtn.addEventListener("click", () => window.open(explorerLink, "_blank", "noopener"));
    buttons.appendChild(linkBtn);
  }
  body.appendChild(buttons);

  const sendInstr = document.createElement("p");
  sendInstr.innerHTML = "<strong>Send ETH directly to this address.</strong>";
  body.appendChild(sendInstr);

  const exchangeWarn = document.createElement("p");
  exchangeWarn.className = "warn";
  exchangeWarn.textContent =
    "Do not send from an exchange. Use a wallet you control, or you may not be able to claim refunds or excess ETH.";
  body.appendChild(exchangeWarn);

  const rows = document.createElement("div");
  function addDetailRow(label, value) {
    const r = document.createElement("div");
    r.className = "detail-row";
    const k = document.createElement("span");
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "mono";
    if (value instanceof Node) v.appendChild(value);
    else v.textContent = value;
    r.appendChild(k);
    r.appendChild(v);
    rows.appendChild(r);
  }
  addDetailRow("Status", STATUS_LABELS[pool.status]);
  addDetailRow("Recipient", pool.recipient);
  addDetailRow("Total due", `${formatEther(pool.totalDue)} ETH`);
  addDetailRow("Total contributed", `${formatEther(pool.totalContributed)} ETH`);
  addDetailRow("Amount remaining", `${formatEther(pool.amountRemaining)} ETH`);
  addDetailRow("Due date", formatDate(pool.dueDate));
  if (pool.status === 2) {
    addDetailRow("Completed at", formatDate(pool.completedAt));
  }
  body.appendChild(rows);

  if (pool.status === 1) {
    const note = document.createElement("p");
    note.className = "warn";
    note.textContent =
      "This pool is funded but not completed. Anyone can call Complete to send the exact total due to the recipient.";
    body.appendChild(note);
  }

  if (!state.account) {
    const connect = document.createElement("p");
    connect.className = "muted";
    connect.textContent = "Connect a wallet to complete the pool or claim ETH.";
    body.appendChild(connect);
    return;
  }

  let claims;
  try {
    claims = await readClaimables(pool.address, state.account);
  } catch (err) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `Could not read your claimables. ${describeError(err)}`;
    body.appendChild(note);
    return;
  }

  const claimSection = document.createElement("div");
  claimSection.style.marginTop = "16px";
  const claimHeader = document.createElement("h3");
  claimHeader.textContent = "Your wallet";
  claimSection.appendChild(claimHeader);

  const yourRows = document.createElement("div");
  function row(label, value) {
    const r = document.createElement("div");
    r.className = "detail-row";
    const k = document.createElement("span");
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "mono";
    v.textContent = value;
    r.appendChild(k);
    r.appendChild(v);
    yourRows.appendChild(r);
  }
  row("Address", state.account);
  row("Claimable contribution", `${formatEther(claims.contribution)} ETH`);
  row("Claimable excess", `${formatEther(claims.excess)} ETH`);
  claimSection.appendChild(yourRows);

  const actions = document.createElement("div");
  actions.className = "detail-actions";

  if (pool.canComplete) {
    const completeBtn = document.createElement("button");
    completeBtn.type = "button";
    completeBtn.textContent = "Complete pool";
    completeBtn.addEventListener("click", () => sendPoolTx(pool, "complete", completeBtn));
    actions.appendChild(completeBtn);
  }

  if (claims.contribution > 0n) {
    const claimContribBtn = document.createElement("button");
    claimContribBtn.type = "button";
    claimContribBtn.textContent = `Claim contribution (${formatEther(claims.contribution)} ETH)`;
    claimContribBtn.addEventListener("click", () =>
      sendPoolTx(pool, "claimContribution", claimContribBtn)
    );
    actions.appendChild(claimContribBtn);
  }

  if (claims.excess > 0n) {
    const claimExcessBtn = document.createElement("button");
    claimExcessBtn.type = "button";
    claimExcessBtn.textContent = `Claim excess (${formatEther(claims.excess)} ETH)`;
    claimExcessBtn.addEventListener("click", () =>
      sendPoolTx(pool, "claimExcess", claimExcessBtn)
    );
    actions.appendChild(claimExcessBtn);
  }

  if (actions.children.length === 0) {
    const none = document.createElement("p");
    none.className = "muted";
    none.textContent = "Nothing to claim or complete for this address.";
    claimSection.appendChild(none);
  } else {
    claimSection.appendChild(actions);
  }

  body.appendChild(claimSection);
}

async function sendPoolTx(pool, functionName, button) {
  if (!state.walletClient || !state.account) {
    setStatus("Connect a wallet first.", "error");
    return;
  }
  if (state.walletChainId !== Number(config.chainId)) {
    setStatus(
      `Switch your wallet to chain ${config.chainId} before sending transactions.`,
      "error"
    );
    return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const hash = await state.walletClient.writeContract({
      address: pool.address,
      abi: state.poolAbi,
      functionName,
      account: state.account
    });
    setStatus(`Transaction sent (${shortAddress(hash)}). Waiting for confirmation…`, "info");
    await state.publicClient.waitForTransactionReceipt({ hash });
    setStatus(`Transaction confirmed.`, "ok");
    await refreshPools();
  } catch (err) {
    setStatus(`Transaction failed. ${describeError(err)}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleCreate(event) {
  event.preventDefault();
  if (!state.walletClient || !state.account) {
    setStatus("Connect a wallet to create a pool.", "error");
    return;
  }
  if (state.walletChainId !== Number(config.chainId)) {
    setStatus(
      `Switch your wallet to chain ${config.chainId} before creating a pool.`,
      "error"
    );
    return;
  }
  const form = event.target;
  const fd = new FormData(form);
  const totalDueStr = String(fd.get("totalDue") || "").trim();
  const dueDateStr = String(fd.get("dueDate") || "").trim();
  const recipientStr = String(fd.get("recipient") || "").trim();

  if (!totalDueStr || Number(totalDueStr) <= 0) {
    setStatus("Total due must be greater than 0.", "error");
    return;
  }
  let totalDueWei;
  try {
    totalDueWei = parseEther(totalDueStr);
  } catch {
    setStatus("Total due is not a valid ETH amount.", "error");
    return;
  }
  if (!dueDateStr) {
    setStatus("Pick a due date.", "error");
    return;
  }
  const dueDateMs = new Date(dueDateStr).getTime();
  if (!Number.isFinite(dueDateMs)) {
    setStatus("Due date is invalid.", "error");
    return;
  }
  const dueDateUnix = Math.floor(dueDateMs / 1000);
  if (dueDateUnix <= Math.floor(Date.now() / 1000)) {
    setStatus("Due date must be in the future.", "error");
    return;
  }
  if (!isAddress(recipientStr)) {
    setStatus("Recipient is not a valid EVM address.", "error");
    return;
  }
  const recipient = getAddress(recipientStr);

  if (state.publicClient) {
    try {
      const code = await state.publicClient.getBytecode({ address: recipient });
      if (code && code !== "0x") {
        setStatus(
          "Recipient appears to be a contract address. EtherPool v1 only supports normal EOA wallets.",
          "error"
        );
        return;
      }
    } catch (err) {
      setStatus(
        `Could not verify recipient is an EOA. ${describeError(err)} Proceeding will still revert on-chain if recipient is a contract.`,
        "warn"
      );
    }
  }

  // Creating a pool deploys a fresh contract (~800k gas), so it costs far more
  // than a normal transfer. Wallets reserve gasLimit * maxFeePerGas up front,
  // which can sit just above a thin balance and make the wallet fail with an
  // opaque "Failed"/internal error. Pre-check here so the user gets a clear
  // message instead. Skip silently on RPC hiccups — the wallet still guards.
  if (state.publicClient) {
    try {
      const [gas, fees, balance] = await Promise.all([
        state.publicClient.estimateContractGas({
          address: getAddress(config.factoryAddress),
          abi: state.factoryAbi,
          functionName: "createPool",
          args: [totalDueWei, BigInt(dueDateUnix), recipient],
          account: state.account
        }),
        state.publicClient.estimateFeesPerGas(),
        state.publicClient.getBalance({ address: state.account })
      ]);
      // Mirror wallet behaviour: pad the gas limit and floor the max fee, since
      // wallets keep headroom for base-fee spikes even when the base fee is tiny
      // (the exact case that fails with a low balance and a near-zero base fee).
      const paddedGas = (gas * 3n) / 2n;
      const minMaxFee = 2_000_000_000n; // 2 gwei floor
      const maxFee =
        fees.maxFeePerGas && fees.maxFeePerGas > minMaxFee ? fees.maxFeePerGas : minMaxFee;
      const reservation = paddedGas * maxFee;
      if (balance < reservation) {
        setStatus(
          `Not enough ETH for gas. Creating a pool deploys a contract, and your wallet ` +
            `reserves up to ~${formatEther(reservation)} ETH for gas, but this account ` +
            `holds ${formatEther(balance)} ETH. Add a little more ETH and try again.`,
          "error"
        );
        return;
      }
    } catch {
      // Estimation can fail on flaky RPCs; don't block — the wallet will still
      // surface a real revert or funds error at confirmation time.
    }
  }

  const submitBtn = el("create-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating…";
  el("create-status").textContent = "Confirm in your wallet…";

  try {
    const hash = await state.walletClient.writeContract({
      address: getAddress(config.factoryAddress),
      abi: state.factoryAbi,
      functionName: "createPool",
      args: [totalDueWei, BigInt(dueDateUnix), recipient],
      account: state.account
    });
    el("create-status").textContent = "Waiting for confirmation…";
    const receipt = await state.publicClient.waitForTransactionReceipt({ hash });

    let newPoolAddress = null;
    const factoryAddressLower = config.factoryAddress.toLowerCase();
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== factoryAddressLower) continue;
      try {
        const decoded = decodeEventLog({
          abi: state.factoryAbi,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "PoolCreated" && decoded.args?.pool) {
          newPoolAddress = getAddress(decoded.args.pool);
          break;
        }
      } catch {
        // Skip logs that don't match the factory ABI; refreshPools will still
        // surface the new pool even if we cannot decode the event here.
      }
    }

    const result = el("create-result");
    result.hidden = false;
    result.innerHTML = "";
    const ok = document.createElement("p");
    ok.innerHTML = "<strong>Pool created.</strong>";
    result.appendChild(ok);
    if (newPoolAddress) {
      const addrP = document.createElement("p");
      addrP.className = "mono";
      addrP.textContent = newPoolAddress;
      result.appendChild(addrP);

      const link = document.createElement("button");
      link.type = "button";
      link.className = "secondary";
      link.textContent = "Open in details";
      link.addEventListener("click", async () => {
        await refreshPools();
        const target = state.pools.find(
          (p) => p.address.toLowerCase() === newPoolAddress.toLowerCase()
        );
        if (target) await selectPool(target);
      });
      result.appendChild(link);
    }

    form.reset();
    setStatus("Pool created.", "ok");
    await refreshPools();
  } catch (err) {
    const detail = describeError(err);
    const lower = detail.toLowerCase();
    if (
      lower.includes("insufficient funds") ||
      lower.includes("max fee per gas") ||
      lower.includes("upfront cost")
    ) {
      setStatus(
        "Could not create pool — this account doesn't have enough ETH to cover gas. " +
          "Creating a pool deploys a contract, so add a little more ETH and try again.",
        "error"
      );
    } else {
      setStatus(`Could not create pool. ${detail}`, "error");
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Create Pool";
    el("create-status").textContent = "";
  }
}

el("connect-btn").addEventListener("click", connectWallet);
el("refresh-btn").addEventListener("click", () => refreshPools());
el("create-form").addEventListener("submit", handleCreate);
el("detail-close").addEventListener("click", () => {
  state.selectedPool = null;
  el("detail-section").hidden = true;
  renderPools();
});

await init();
