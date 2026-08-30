const jwt = require("jsonwebtoken");

const SESSION_TTL = "24h";

function getSecret() {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_JWT_SECRET environment variable.");
  }
  return secret;
}

/// Issued right after a wallet proves control via signature (see
/// api/auth/verify.js). This token is what the browser sends back on
/// every check-in / wheel / upgrade call -- it proves "this request
/// really comes from wallet X" without asking for a fresh signature
/// every single time (that would be a terrible UX for a daily-use
/// feature). 24h expiry means a holder re-signs about once a day.
function issueSessionToken(wallet) {
  return jwt.sign({ wallet: wallet.toLowerCase() }, getSecret(), {
    expiresIn: SESSION_TTL,
  });
}

/// Throws if the token is missing, malformed, or expired. Returns the
/// lowercased wallet address it was issued for.
function requireSession(req) {
  const header = req.headers["authorization"] || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    const err = new Error("missing_session");
    err.statusCode = 401;
    throw err;
  }

  try {
    const payload = jwt.verify(token, getSecret());
    return payload.wallet;
  } catch (err) {
    const wrapped = new Error("invalid_session");
    wrapped.statusCode = 401;
    throw wrapped;
  }
}

module.exports = { issueSessionToken, requireSession };
