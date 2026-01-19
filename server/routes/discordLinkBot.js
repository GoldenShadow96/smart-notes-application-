// server/routes/discordLinkBot.js
import express from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { discordBotAuthRequired } from "../middleware/discordBotAuth.js";

// UWAGA: do linkowania NIE mamy jeszcze discord_links,
// więc robimy wersję middleware tylko dla bota (bez mapowania do usera).
function sha256(x) {
  return crypto.createHash("sha256").update(x).digest();
}
function unauthorized(res, msg = "Unauthorized") {
  return res.status(401).json({ error: msg });
}

async function botOnlyAuth(req, res, next) {
  const botKey = (req.header("x-bot-key") ?? "").toString();
  if (!botKey) return unauthorized(res, "Missing bot key");

  const botHash = sha256(botKey);
  const [bots] = await pool.query("SELECT id FROM bot_clients WHERE api_key_hash=? LIMIT 1", [botHash]);
  if (bots.length === 0) return unauthorized(res, "Bad bot key");

  return next();
}

export const discordLinkBotRouter = express.Router();

// POST /api/discord/bot/link  body: { code }  headers: x-bot-key, x-discord-user-id
discordLinkBotRouter.post("/bot/link", botOnlyAuth, async (req, res) => {
  const discordUserIdStr = (req.header("x-discord-user-id") ?? "").toString();
  if (!/^\d+$/.test(discordUserIdStr)) return unauthorized(res, "Missing discord user id");

  const code = (req.body?.code ?? "").toString().trim();
  if (!/^[a-f0-9]{32}$/.test(code)) return res.status(400).json({ error: "Bad code" });

  try {
    // znajdź kod, sprawdź ważność, nieużyty
    const [rows] = await pool.query(
      `
      SELECT code, user_id, expires_at, used_at
      FROM discord_link_codes
      WHERE code=?
      LIMIT 1
      `,
      [code]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Code not found" });

    const r = rows[0];
    if (r.used_at) return res.status(409).json({ error: "Code already used" });

    const expiresAt = new Date(r.expires_at);
    if (Date.now() > expiresAt.getTime()) return res.status(410).json({ error: "Code expired" });

    // oznacz jako użyty
    await pool.execute("UPDATE discord_link_codes SET used_at=NOW() WHERE code=? AND used_at IS NULL", [code]);

    // podepnij discord -> user (nadpisz jeśli istniało dla tego discord_user_id)
    await pool.execute(
      `
      INSERT INTO discord_links (discord_user_id, user_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), linked_at=CURRENT_TIMESTAMP
      `,
      [discordUserIdStr, r.user_id]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  }
});
