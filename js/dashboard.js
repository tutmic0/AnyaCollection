"use strict";

/**
 * Wires up dashboard.html to the backend. Depends on wallet-auth.js
 * being loaded first (connectAndSignIn, getSession, callWithSession).
 */

let currentTokenId = null;

const el = {
  connectBtn: document.getElementById("connect-btn"),
  walletLabel: document.getElementById("wallet-label"),
  tokenIdInput: document.getElementById("token-id-input"),
  loadTokenBtn: document.getElementById("load-token-btn"),
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
  } finally {
    el.connectBtn.disabled = false;
  }
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

  el.checkinBtn.disabled = state.checkedInToday;
  el.checkinBtn.textContent = state.checkedInToday
    ? "Checked in today"
    : "Daily check-in";

  el.wheelBtn.disabled = state.spunToday;
  el.wheelBtn.textContent = state.spunToday ? "Spun today" : "Spin the wheel";

  for (const [slot, info] of Object.entries(state.slots)) {
    const card = document.querySelector(`.slot-card[data-slot="${slot}"]`);
    if (!card) continue;

    card.querySelector(".current-name").textContent = info.currentName;

    const nextLine = card.querySelector(".next-line");
    const upgradeBtn = card.querySelector(".btn-upgrade");

    if (info.maxed) {
      nextLine.textContent = "Max tier reached";
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = "Maxed out";
    } else {
      nextLine.textContent = `Next: ${info.nextName} — ${info.cost} pts`;
      upgradeBtn.disabled = state.pointsBalance < info.cost;
      upgradeBtn.textContent = `Upgrade (${info.cost} pts)`;
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
}

async function handleCheckin() {
  el.checkinBtn.disabled = true;
  try {
    const res = await callWithSession("/api/checkin", {
      method: "POST",
      body: JSON.stringify({ tokenId: currentTokenId }),
    });
    const body = await res.json();
    if (!res.ok) {
      showStatus(`Check-in failed: ${body.error}`, true);
      return;
    }
    showStatus(`+${body.pointsAwarded} points from today's check-in.`);
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

async function handleUpgrade(slot) {
  const btn = document.querySelector(`.btn-upgrade[data-slot="${slot}"]`);
  btn.disabled = true;
  try {
    const res = await callWithSession("/api/upgrade", {
      method: "POST",
      body: JSON.stringify({ tokenId: currentTokenId, slot }),
    });
    const body = await res.json();
    if (!res.ok) {
      showStatus(`Upgrade failed: ${body.error}`, true);
      return;
    }
    const artNote =
      body.imageStatus === "pending"
        ? " Art for this exact look is still being generated -- it'll show up once it's ready."
        : "";
    showStatus(`${slot} upgraded to tier ${body.newTier} for ${body.cost} points.${artNote}`);
    await refresh();
  } finally {
    btn.disabled = false;
  }
}

el.connectBtn.addEventListener("click", handleConnect);
el.loadTokenBtn.addEventListener("click", handleLoadToken);
el.checkinBtn.addEventListener("click", handleCheckin);
el.wheelBtn.addEventListener("click", handleWheelSpin);

document.querySelectorAll(".btn-upgrade").forEach((btn) => {
  btn.addEventListener("click", () => handleUpgrade(btn.dataset.slot));
});

// If a session from an earlier visit is still valid (same tab session),
// reflect the connected state immediately instead of showing "Connect".
(function restoreSessionUI() {
  const { wallet } = getSession();
  if (wallet) {
    el.connectBtn.hidden = true;
    el.walletLabel.hidden = false;
    el.walletLabel.textContent = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  }
})();
