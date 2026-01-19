// server/config/env.js
export const JWT_SECRET = process.env.JWT_SECRET;
export const MASTER_KEY_HEX = process.env.MASTER_KEY_HEX;

if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET in .env");
  process.exit(1);
}
if (!MASTER_KEY_HEX || MASTER_KEY_HEX.length !== 64) {
  console.error("Missing/invalid MASTER_KEY_HEX (must be 64 hex chars / 32 bytes)");
  process.exit(1);
}

export const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, "hex");

export const COOKIE_NAME = "notes_token";
export const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? "false").toLowerCase() === "true";
