// server/middleware/auth.js
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { COOKIE_NAME, JWT_SECRET, MASTER_KEY } from "../config/env.js";
import { unauthorized } from "../utils/http.js";
import { aesGcmDecryptText, clearAuthCookie } from "../utils/crypto.js";

// ---- Auth middleware (token + user exists) ----
export async function authRequired(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return unauthorized(res);

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // ważne: sprawdź, czy user istnieje (żeby nie było pętli po resetach DB)
    const [rows] = await pool.query("SELECT id, username FROM users WHERE id=?", [payload.id]);

    if (rows.length === 0) {
      clearAuthCookie(res);
      return unauthorized(res);
    }

    req.user = { id: rows[0].id, username: rows[0].username };
    return next();
  } catch {
    clearAuthCookie(res);
    return unauthorized(res);
  }
}

// Decrypt per-user key into req.userKey (Buffer 32 bytes)
export async function loadUserKey(req, res, next) {
  try {
    const userId = req.user.id;

    const [rows] = await pool.query("SELECT key_iv, key_tag, key_ct FROM users WHERE id=?", [userId]);

    if (rows.length === 0) {
      clearAuthCookie(res);
      return unauthorized(res);
    }

    const row = rows[0];

    // u nas userKey był zapisany jako hex string (64B), zaszyfrowany MASTER_KEY
    const userKeyHex = aesGcmDecryptText(
      MASTER_KEY,
      Buffer.from(row.key_iv),
      Buffer.from(row.key_ct),
      Buffer.from(row.key_tag)
    );

    const userKey = Buffer.from(userKeyHex, "hex");
    if (userKey.length !== 32) {
      return res.status(500).json({ error: "Bad user key length" });
    }

    req.userKey = userKey;
    return next();
  } catch (e) {
    console.error("Crypto error:", e);
    return res.status(500).json({ error: "Crypto error" });
  }
}

export async function optionalAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.query("SELECT id, username FROM users WHERE id=?", [payload.id]);
    if (rows.length === 0) {
      clearAuthCookie(res);
      return next();
    }
    req.user = { id: rows[0].id, username: rows[0].username };
  } catch {
    clearAuthCookie(res);
  }
  return next();
}
