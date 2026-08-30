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

module.exports = { getProvider, getContract, getOnChainOwner, CHAIN_ID };
