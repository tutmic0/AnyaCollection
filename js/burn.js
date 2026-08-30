"use strict";

/**
 * Wires up burn.html. Depends on wallet-auth.js being loaded first
 * (connectAndSignIn, getSession, callWithSession, getInjectedProvider).
 *
 * Burning is a REAL on-chain transaction -- unlike check-in/wheel/shop,
 * which are just signed API calls, this one costs a little gas and the
 * holder has to confirm it in their wallet. The flow is:
 *   1. Build the calldata for the contract's burn(tokenId) call.
 *   2. Send it via the injected wallet provider and get a txHash back.
 *   3. Poll for the receipt until it's mined.
 *   4. Tell our backend the txHash -- it independently verifies (by
 *      reading the transaction's own logs, see lib/chain.js's
 *      getBurnTransfer) that this really was a burn of this token by
 *      this wallet, then pays out the points exactly once.
 */

let heldTokenIds = [];

const el = {
  connectBtn: document.getElementById("connect-btn"),
  walletLabel: document.getElementById("wallet-label"),
  pointsBalance: document.getElementById("points-balance"),
  burnList: document.getElementById("burn-list"),
  burnEmpty: document.getElementById("burn-empty"),
  statusMessage: document.getElementById("status-message"),
};

// Must match the CONTRACT_ADDRESS env var on the server -- this is
// public information (any block explorer shows it), not a secret.
const CONTRACT_ADDRESS = "0x315d9078a5f905606d4807eff665abba9e049d3d";
const CHAIN_ID_HEX = "0x1237"; // 4663 decimal -- Robinhood Chain mainnet

// keccak256("burn(uint256)").slice(0, 4) -- OpenZeppelin's
// ERC721Burnable.burn(uint256) selector. Deterministic from the
// function signature text alone, same on every contract that has it.
const BURN_SELECTOR = "42966c68";

function showStatus(message, isError) {
  el.statusMessage.textContent = message;
  el.statusMessage.hidden = false;
  el.statusMessage.classList.toggle("error", Boolean(isError));
}

function clearStatus() {
  el.statusMessage.hidden = true;
}

function encodeBurnCalldata(tokenId) {
  const hex = BigInt(tokenId).toString(16).padStart(64, "0");
  return "0x" + BURN_SELECTOR + hex;
}

async function handleConnect() {
  el.connectBtn.disabled = true;
  try {
    const session = await connectAndSignIn();
    if (!session) {
      showStatus("Could not sign in with that wallet. See console for details.", true);
      return;
    }
    el.connectBtn.hidden = true;
    el.walletLabel.hidden = false;
    el.walletLabel.textContent = `${session.wallet.slice(0, 6)}…${session.wallet.slice(-4)}`;
    await loadHoldings();
  } finally {
    el.connectBtn.disabled = false;
  }
}

async function loadHoldings() {
  try {
    const res = await callWithSession("/api/holdings", { method: "GET" });
    if (!res.ok) return;
    const body = await res.json();
    heldTokenIds = body.tokenIds || [];
    el.pointsBalance.textContent = body.pointsBalance;
    renderList();
  } catch (err) {
    showStatus("Could not load your Anyas. Try reloading the page.", true);
  }
}

function renderList() {
  el.burnList.innerHTML = "";
  el.burnEmpty.hidden = heldTokenIds.length > 0;

  for (const tokenId of heldTokenIds) {
    const li = document.createElement("li");
    li.className = "burn-row";

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = `Anya #${tokenId}`;
    li.appendChild(name);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-item btn-danger";
    btn.textContent = "Burn";
    btn.addEventListener("click", () => handleBurnClick(tokenId, li, btn));
    li.appendChild(btn);

    el.burnList.appendChild(li);
  }
}

async function ensureCorrectChain(provider) {
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (typeof currentChainId === "string" && currentChainId.toLowerCase() === CHAIN_ID_HEX) {
    return;
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    throw new Error("Please switch your wallet to Robinhood Chain and try again.");
  }
}

async function waitForReceipt(provider, txHash) {
  for (let i = 0; i < 40; i++) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("Transaction reverted on-chain.");
      }
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Timed out waiting for confirmation -- check your wallet's activity tab, it may still confirm.");
}

async function handleBurnClick(tokenId, rowEl, btnEl) {
  const confirmed = window.confirm(
    `Burn Anya #${tokenId}? This destroys it permanently and cannot be undone. You'll receive points in return.`
  );
  if (!confirmed) return;

  clearStatus();

  const provider = getInjectedProvider();
  if (!provider) {
    showStatus("You need a wallet extension like OKX Wallet or MetaMask installed to continue.", true);
    return;
  }

  const { wallet } = getSession();
  if (!wallet) {
    showStatus("Connect your wallet first.", true);
    return;
  }

  btnEl.disabled = true;
  try {
    await ensureCorrectChain(provider);

    showStatus(`Confirm the burn for Anya #${tokenId} in your wallet…`);
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: wallet, to: CONTRACT_ADDRESS, data: encodeBurnCalldata(tokenId) }],
    });

    showStatus(`Waiting for the burn to confirm on-chain (${txHash.slice(0, 10)}…)`);
    await waitForReceipt(provider, txHash);

    showStatus("Burn confirmed on-chain -- recording it and awarding points…");
    const res = await callWithSession("/api/burn/claim", {
      method: "POST",
      body: JSON.stringify({ tokenId, txHash }),
    });
    const body = await res.json();

    if (!res.ok) {
      showStatus(
        `Anya #${tokenId} was burned on-chain, but claiming points failed (${body.error}). Contact support with tx ${txHash} -- your NFT is gone, don't burn again.`,
        true
      );
      return;
    }

    showStatus(`Anya #${tokenId} burned. +${body.pointsAwarded} points.`);
    el.pointsBalance.textContent = body.balance;
    heldTokenIds = heldTokenIds.filter((id) => id !== tokenId);
    rowEl.remove();
    el.burnEmpty.hidden = heldTokenIds.length > 0;
  } catch (err) {
    showStatus(`Burn failed: ${err.message || err}`, true);
    btnEl.disabled = false;
  }
}

el.connectBtn.addEventListener("click", handleConnect);

(function restoreSessionUI() {
  const { wallet } = getSession();
  if (wallet) {
    el.connectBtn.hidden = true;
    el.walletLabel.hidden = false;
    el.walletLabel.textContent = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
    loadHoldings();
  }
})();
