const { ethers } = require("ethers");

// Robinhood Chain mainnet (Arbitrum Orbit L2). Confirmed from
// docs.robinhood.com/chain/connecting: chain ID 4663, public RPC
// https://rpc.mainnet.chain.robinhood.com (rate-limited -- fine for
// this endpoint's low call volume, but switch ROBINHOOD_RPC_URL to a
// provider endpoint, e.g. Alchemy's robinhood-mainnet.g.alchemy.com,
// if you start seeing rate-limit errors under real traffic).
const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663;

const ERC721_MINIMAL_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

function getProvider() {
  const rpcUrl = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC_URL;
  return new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID);
}

function getContract() {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) {
    throw new Error("Missing CONTRACT_ADDRESS environment variable.");
  }
  return new ethers.Contract(address, ERC721_MINIMAL_ABI, getProvider());
}

/// Returns the owner address if the token exists, or null if it
/// doesn't (ownerOf reverts for a token that was never minted).
async function getOnChainOwner(tokenId) {
  try {
    const contract = getContract();
    return await contract.ownerOf(tokenId);
  } catch (err) {
    return null;
  }
}

/// Confirms a mined transaction really was a burn of `tokenId` on our
/// contract, and returns who burned it -- used by api/burn/claim.js
/// instead of trusting anything the client claims. Looks directly at
/// the transaction's own logs (not the contract's *current* state),
/// so this works even for a token our own database has never heard of
/// before. Returns null if the tx isn't mined yet, failed, or isn't a
/// burn of our contract at all.
async function getBurnTransfer(txHash) {
  const provider = getProvider();
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) {
    throw new Error("Missing CONTRACT_ADDRESS environment variable.");
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    return null;
  }

  const iface = new ethers.Interface(ERC721_MINIMAL_ABI);
  const contractAddress = address.toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress) continue;

    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch (err) {
      continue; // not a Transfer log (or not one we know how to decode)
    }

    if (parsed && parsed.name === "Transfer" && parsed.args.to === ethers.ZeroAddress) {
      return {
        from: parsed.args.from,
        tokenId: Number(parsed.args.tokenId),
      };
    }
  }

  return null;
}

module.exports = { getProvider, getContract, getOnChainOwner, getBurnTransfer, CHAIN_ID };
