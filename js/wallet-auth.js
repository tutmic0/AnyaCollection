"use strict";

/**
 * Wallet connect + sign-in for the Anya dashboard.
 * Copy this into your site's js/ folder (alongside main.js) and load
 * it on whatever page has the "Connect wallet" button and the
 * check-in / wheel / upgrade UI.
 *
 * Flow: connect MetaMask -> ask our API for a one-time message ->
 * sign it (no gas, no transaction) -> send the signature back -> get a
 * session token -> use that token as a Bearer header on every
 * check-in / wheel / upgrade call afterwards.
 */

const SESSION_KEY = "living_nft_session_token";
const WALLET_KEY = "living_nft_wallet";

async function connectAndSignIn() {
  if (!window.ethereum) {
    alert("You need a wallet extension like MetaMask installed to continue.");
    return null;
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const wallet = accounts[0];

  const nonceRes = await fetch(`/api/auth/nonce?wallet=${wallet}`);
  if (!nonceRes.ok) {
    console.error("Failed to get sign-in message", await nonceRes.text());
    return null;
  }
  const { message } = await nonceRes.json();

  const signature = await window.ethereum.request({
    method: "personal_sign",
    params: [message, wallet],
  });

  const verifyRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, signature }),
  });

  if (!verifyRes.ok) {
    console.error("Sign-in verification failed", await verifyRes.text());
    return null;
  }

  const { token } = await verifyRes.json();
  sessionStorage.setItem(SESSION_KEY, token);
  sessionStorage.setItem(WALLET_KEY, wallet);
  return { wallet, token };
}

function getSession() {
  return {
    token: sessionStorage.getItem(SESSION_KEY),
    wallet: sessionStorage.getItem(WALLET_KEY),
  };
}

function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(WALLET_KEY);
}

/// Wrapper for calling check-in / wheel / upgrade endpoints once
/// signed in -- attaches the session token automatically and redirects
/// the caller to reconnect if the session expired (401).
async function callWithSession(path, options = {}) {
  const { token } = getSession();
  if (!token) {
    throw new Error("not_signed_in");
  }

  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 401) {
    signOut();
    throw new Error("session_expired");
  }

  return res;
}
