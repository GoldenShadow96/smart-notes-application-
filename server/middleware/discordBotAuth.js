// server/middleware/discordBotAuth.js
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { MASTER_KEY } from "../config/env.js";
import { aesGcmDecryptText } from "../utils/crypto.js";

function sha256(x) {
  return crypto.createHash("sha256").update(x).digest();
}

function unauthorized(res, msg = "Unauthorized") {
  return res.status(401).json({ error: msg });
}

// Wymaga:
// - header: x-bot-key
// - header: x-discord-user-id
// Ustawia:
// - req.user {id, username}
// - req.userKey (Buffer 32)
export async function discordBotAuthRequired(req, res, next) {
  const botKey = (req.header("x-bot-key") ?? "").toString();
  const discordUserIdStr = (req.header("x-discord-user-id") ?? "").toString();

  if (!botKey) return unauthorized(res, "Missing bot key");
  if (!/^\d+$/.test(discordUserIdStr)) return unauthorized(res, "Missing discord user id");

  const discordUserId = BigInt(discordUserIdStr);

  try {
    // 1) sprawdź bota
    const botHash = sha256(botKey);
    const [bots] = await pool.query(
      "SELECT id FROM bot_clients WHERE api_key_hash=? LIMIT 1",
      [botHash]
    );
    if (bots.length === 0) return unauthorized(res, "Bad bot key");

    // 2) mapowanie discord -> user + pobranie klucza usera
    const [rows] = await pool.query(
      `
      SELECT u.id, u.username, u.key_iv, u.key_tag, u.key_ct
      FROM discord_links dl
      JOIN users u ON u.id = dl.user_id
      WHERE dl.discord_user_id = ?
      LIMIT 1
      `,
      [discordUserId.toString()]
    );

    if (rows.length === 0) return unauthorized(res, "Discord not linked");

    const r = rows[0];
    req.user = { id: r.id, username: r.username };

    const userKeyHex = aesGcmDecryptText(
      MASTER_KEY,
      Buffer.from(r.key_iv),
      Buffer.from(r.key_ct),
      Buffer.from(r.key_tag)
    );

    const userKey = Buffer.from(userKeyHex, "hex");
    if (userKey.length !== 32) return res.status(500).json({ error: "Bad user key length" });

    req.userKey = userKey;
    return next();
  } catch (e) {
    console.error("discordBotAuth error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
