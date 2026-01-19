// server/routes/discordLink.js
import express from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

export const discordLinkRouter = express.Router();

// POST /api/discord/link-code  (user zalogowany w web)
// -> { code }
discordLinkRouter.post("/link-code", authRequired, async (req, res) => {
  try {
    const code = crypto.randomBytes(16).toString("hex"); // 32 chars
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await pool.execute(
      "INSERT INTO discord_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)",
      [code, req.user.id, expires]
    );

    return res.json({ code, expires_at: expires.toISOString() });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  }
});
