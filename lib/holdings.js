const { ethers } = require("ethers");
const { getProvider } = require("./chain");

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

// getLogs range limit -- most RPC providers cap how many blocks a
// single eth_getLogs call can cover. This project's whole history
// (mint + occasional transfers + burns, max 8888 tokens) is tiny, so
// scanning in chunks from block 0 is fine for now. If this ever gets
// slow as activity grows, cache the result with a short TTL instead of
// re-scanning from genesis on every call.
const CHUNK_SIZE = 40000;

/// Replays every Transfer event the contract has ever emitted (a mint
/// is a Transfer from the zero address, a burn is one to the zero
/// address) and keeps whichever transfer happened last for each
/// tokenId. This is the ONLY reliable way to answer "what does this
/// wallet hold right now" -- the contract isn't ERC721Enumerable, and
/// our own `tokens.owner_wallet` column is just a display cache that
/// goes stale the moment a token changes hands (see lib/tokens.js).
/// Returns a Map<tokenIdNumber, ownerAddress> with burned tokens
/// already removed.
async function getCurrentOwners() {
  const provider = getProvider();
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) {
    throw new Error("Missing CONTRACT_ADDRESS environment variable.");
  }

  const latest = await provider.getBlockNumber();
  const owners = new Map();

  for (let from = 0; from <= latest; from += CHUNK_SIZE + 1) {
    const to = Math.min(from + CHUNK_SIZE, latest);
    const logs = await provider.getLogs({
      address,
      topics: [TRANSFER_TOPIC],
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      // Transfer(address indexed from, address indexed to, uint256
      // indexed tokenId) -- all three are indexed, so all three live in
      // topics (topics[0] is the event signature itself).
      const to_ = ethers.getAddress("0x" + log.topics[2].slice(26));
      const tokenId = Number(BigInt(log.topics[3]));

      if (to_ === ethers.ZeroAddress) {
        owners.delete(tokenId); // burned
      } else {
        owners.set(tokenId, to_);
      }
    }
  }

  return owners;
}

/// Every tokenId currently held by `wallet`, sorted ascending. Powers
/// both the dashboard's "your Anyas" sidebar and the equip-exclusivity
/// check (an owned item can only be worn by one of the wallet's tokens
/// at a time -- see api/shop/equip.js).
async function getWalletTokenIds(wallet) {
  const owners = await getCurrentOwners();
  const target = wallet.toLowerCase();
  const ids = [];
  for (const [tokenId, owner] of owners.entries()) {
    if (owner.toLowerCase() === target) {
      ids.push(tokenId);
    }
  }
  ids.sort((a, b) => a - b);
  return ids;
}

module.exports = { getCurrentOwners, getWalletTokenIds };
