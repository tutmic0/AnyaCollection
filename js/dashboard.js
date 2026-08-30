"use strict";

/**
 * Wires up dashboard.html to the backend. Depends on wallet-auth.js
 * being loaded first (connectAndSignIn, getSession, callWithSession).
 */

let currentTokenId = null;
let heldTokenIds = [];

const el = {
  connectBtn: document.getElementById("connect-btn"),
  walletLabel: document.getElementById("wallet-label"),
  tokenIdInput: document.getElementById("token-id-input"),
  loadTokenBtn: document.getElementById("load-token-btn"),
  sidebar: document.getElementById("nft-sidebar"),
  sidebarList: document.getElementById("sidebar-list"),
  sidebarEmpty: document.getElementById("sidebar-empty"),
  dashboard: document.getElementById("dashboard"),
  portrait: document.getElementById("token-portrait"),
  tokenIdBadge: document.getElementById("token-id-badge"),
  pointsBalance: document.getElementById("points-balance"),
  checkinBtn: document.getElementById("checkin-btn"),
  wheelBtn: document.getElementById("wheel-btn"),
  statusMessage: document.getElementById("status-message"),
};

function showStatus(message, isError) {
  el.statusMessage.textContent = message;
  el.statusMessage.hidden = false;
  el.statusMessage.classList.toggle("error", Boolean(isError));
}

function clearStatus() {
  el.statusMessage.hidden = true;
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

/// Fetches every Anya this wallet holds (straight from the chain, see
/// lib/holdings.js) and renders the sidebar. If nothing is loaded yet,
/// auto-loads the first one found so connecting is a one-click path
/// into the shop, not a second step of typing a token ID.
async function loadHoldings() {
  try {
    const res = await callWithSession("/api/holdings", { method: "GET" });
    if (!res.ok) return;
    const body = await res.json();
    heldTokenIds = body.tokenIds || [];
    renderSidebar();

    if (heldTokenIds.length > 0 && currentTokenId === null) {
      currentTokenId = heldTokenIds[0];
      el.tokenIdInput.value = currentTokenId;
      clearStatus();
      await refresh();
      highlightSidebar();
    }
  } catch (err) {
    // Best-effort -- typing a token ID by hand still works if this fails.
  }
}

function renderSidebar() {
  el.sidebar.hidden = false;
  el.sidebarEmpty.hidden = heldTokenIds.length > 0;
  el.sidebarList.innerHTML = "";

  for (const tokenId of heldTokenIds) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar-item";
    btn.textContent = `Anya #${tokenId}`;
    btn.dataset.tokenId = String(tokenId);
    btn.addEventListener("click", async () => {
      currentTokenId = tokenId;
      el.tokenIdInput.value = tokenId;
      clearStatus();
      await refresh();
      highlightSidebar();
    });
    li.appendChild(btn);
    el.sidebarList.appendChild(li);
  }

  highlightSidebar();
}

function highlightSidebar() {
  el.sidebarList.querySelectorAll(".sidebar-item").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.tokenId) === currentTokenId);
  });
}

async function loadTokenState(tokenId) {
  const res = await callWithSession(`/api/state?tokenId=${tokenId}`, { method: "GET" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request_failed_${res.status}`);
  }
  return res.json();
}

function renderState(state) {
  el.dashboard.hidden = false;
  el.pointsBalance.textContent = state.pointsBalance;

  if (state.imageUrl) {
    el.portrait.src = state.imageUrl;
  }
  el.tokenIdBadge.textContent = `#${state.tokenId}`;

  el.wheelBtn.disabled = state.spunToday;
  el.wheelBtn.textContent = state.spunToday ? "Spun today" : "Spin the wheel";

  for (const [slot, items] of Object.entries(state.slots)) {
    const list = document.querySelector(`.item-list[data-slot="${slot}"]`);
    if (!list) continue;
    list.innerHTML = "";

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "item-row";
      if (item.equipped) li.classList.add("is-equipped");

      const name = document.createElement("span");
      name.className = "item-name";
      name.textContent = item.name;
      li.appendChild(name);

      if (item.equipped) {
        const badge = document.createElement("span");
        badge.className = "item-badge";
        badge.textContent = "Equipped";
        li.appendChild(badge);
      } else if (item.equippedOnTokenId) {
        // Owned, but currently worn by a different Anya in this wallet
        // -- see api/shop/equip.js's exclusivity rule. Free it up by
        // equipping something else on that other Anya first.
        const badge = document.createElement("span");
        badge.className = "item-badge item-badge-elsewhere";
        badge.textContent = `On Anya #${item.equippedOnTokenId}`;
        li.appendChild(badge);
      } else if (item.owned) {
        const btn = document.createElement("button");
        btn.className = "btn btn-item btn-equip";
        btn.textContent = "Equip";
        btn.addEventListener("click", () => handleEquip(slot, item.tier));
        li.appendChild(btn);
      } else {
        const btn = document.createElement("button");
        btn.className = "btn btn-item btn-buy";
        btn.textContent = `Buy — ${item.price} pts`;
        btn.disabled = state.pointsBalance < item.price;
        btn.addEventListener("click", () => handleBuy(slot, item.tier));
        li.appendChild(btn);
      }

      list.appendChild(li);
    }
  }
}

async function refresh() {
  if (currentTokenId === null) return;
  try {
    const state = await loadTokenState(currentTokenId);
    renderState(state);
  } catch (err) {
    showStatus(`Could not load token #${currentTokenId}: ${err.message}`, true);
  }
}

async function handleLoadToken() {
  const tokenId = Number(el.tokenIdInput.value);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    showStatus("Enter a valid token ID first.", true);
    return;
  }
  if (!getSession().token) {
    showStatus("Connect your wallet before loading a token.", true);
    return;
  }
  currentTokenId = tokenId;
  clearStatus();
  await refresh();
  highlightSidebar();
}

/// Checks in EVERY Anya this wallet currently holds in one click --
/// see api/checkin.js. Not gated on the currently-loaded token's own
/// checked-in state, since other Anyas in the wallet may still be
/// eligible even if this one already checked in today.
async function handleCheckin() {
  el.checkinBtn.disabled = true;
  try {
    const res = await callWithSession("/api/checkin", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const body = await res.json();
    if (!res.ok) {
      if (body.error === "already_checked_in") {
        showStatus("Every Anya in this wallet has already checked in today.", true);
      } else {
        showStatus(`Check-in failed: ${body.error}`, true);
      }
      return;
    }
    const plural = body.checkedInCount === 1 ? "" : "s";
    showStatus(`+${body.pointsAwarded} points -- checked in ${body.checkedInCount} Anya${plural}.`);
    await refresh();
  } finally {
    el.checkinBtn.disabled = false;
  }
}

async function handleWheelSpin() {
  el.wheelBtn.disabled = true;
  try {
    const res = await callWithSession("/api/wheel/spin", {
      method: "POST",
      body: JSON.stringify({ tokenId: currentTokenId }),
    });
    const body = await res.json();
    if (!res.ok) {
      showStatus(`Spin failed: ${body.error}`, true);
      return;
    }
    const sign = body.delta >= 0 ? "+" : "";
    showStatus(`Wheel result: ${body.outcome} (${sign}${body.delta} points).`);
    await refresh();
  } finally {
    el.wheelBtn.disabled = false;
  }
}

/// Permanently unlocks one item FOR THE WHOLE WALLET, not just the
/// token currently loaded -- if this wallet holds more than one Anya,
/// every one of them can equip it. Buying never equips it automatically
/// -- that keeps the two actions (spend points / change what's shown)
/// clearly separate, and matches the server, which treats them as two
/// different calls too.
async function handleBuy(slot, tier) {
  clearStatus();
  try {
    const res = await callWithSession("/api/shop/buy", {
      method: "POST",
      body: JSON.stringify({ slot, tier }),
    });
    const body = await res.json();
    if (!res.ok) {
      showStatus(`Purchase failed: ${body.error}`, true);
      return;
    }
    showStatus(`Bought for ${body.cost} points. Click Equip to wear it.`);
    await refresh();
  } catch (err) {
    showStatus(`Purchase failed: ${err.message}`, true);
  }
}

/// Switches which owned item THIS token shows. Free, no points
/// involved -- equipping is per-Anya even though ownership is shared
/// wallet-wide. Can fail with "item_in_use" if a different Anya in
/// this wallet currently has it on (see api/shop/equip.js).
async function handleEquip(slot, tier) {
  clearStatus();
  try {
    const res = await callWithSession("/api/shop/equip", {
      method: "POST",
      body: JSON.stringify({ tokenId: currentTokenId, slot, tier }),
    });
    const body = await res.json();
    if (!res.ok) {
      if (body.error === "item_in_use") {
        showStatus(
          `That item is currently worn by Anya #${body.equippedOnTokenId} -- equip something else there first to free it up.`,
          true
        );
      } else {
        showStatus(`Could not equip that: ${body.error}`, true);
      }
      return;
    }
    const artNote =
      body.imageStatus === "pending"
        ? " Art for this exact look is still being generated -- it'll show up once it's ready."
        : "";
    showStatus(`Equipped.${artNote}`);
    await refresh();
  } catch (err) {
    showStatus(`Could not equip that: ${err.message}`, true);
  }
}

el.connectBtn.addEventListener("click", handleConnect);
el.loadTokenBtn.addEventListener("click", handleLoadToken);
el.checkinBtn.addEventListener("click", handleCheckin);
el.wheelBtn.addEventListener("click", handleWheelSpin);

// If a session from an earlier visit is still valid (same tab session),
// reflect the connected state immediately instead of showing "Connect".
(function restoreSessionUI() {
  const { wallet } = getSession();
  if (wallet) {
    el.connectBtn.hidden = true;
    el.walletLabel.hidden = false;
    el.walletLabel.textContent = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
    loadHoldings();
  }
})();
