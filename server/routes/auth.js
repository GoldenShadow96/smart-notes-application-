// server/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";

import { pool } from "../db/pool.js";
import { badRequest, unauthorized } from "../utils/http.js";
import { MASTER_KEY } from "../config/env.js";
import {
  aesGcmEncryptText,
  signToken,
  setAuthCookie,
  clearAuthCookie,
} from "../utils/crypto.js";
import { authRequired } from "../middleware/auth.js";

export const authRouter = express.Router();

// POST /api/auth/register {username, password}
authRouter.post("/register", async (req, res) => {
  const username = (req.body?.username ?? "").toString().trim();
  const password = (req.body?.password ?? "").toString();

  if (username.length < 3 || username.length > 64) {
    return badRequest(res, "Username must be 3-64 chars");
  }
  if (password.length < 8) {
    return badRequest(res, "Password must be at least 8 chars");
  }

  try {
    const password_hash = await bcrypt.hash(password, 12);

    // per-user key (32 bytes) -> przechowujemy jako hex string i wrap MASTER_KEY
    const userKeyHex = crypto.randomBytes(32).toString("hex"); // 64 chars
    const wrapped = aesGcmEncryptText(MASTER_KEY, userKeyHex);

    const [result] = await pool.execute(
      "INSERT INTO users (username, password_hash, key_iv, key_tag, key_ct) VALUES (?, ?, ?, ?, ?)",
      [username, password_hash, wrapped.iv, wrapped.tag, wrapped.ct]
    );

    const user = { id: result.insertId, username };
    const token = signToken(user);
    setAuthCookie(res, token);

    return res.status(201).json({ user });
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Username already exists" });
    }
    console.error("Register DB error:", e?.code, e?.message);
    return res.status(500).json({ error: "Database error" });
  }
});

// POST /api/auth/login {username, password}
authRouter.post("/login", async (req, res) => {
  const username = (req.body?.username ?? "").toString().trim();
  const password = (req.body?.password ?? "").toString();

  if (!username || !password) return badRequest(res, "Missing credentials");

  try {
    const [rows] = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username=?",
      [username]
    );

    if (rows.length === 0) return unauthorized(res, "Invalid username or password");

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return unauthorized(res, "Invalid username or password");

    const user = { id: u.id, username: u.username };
    const token = signToken(user);
    setAuthCookie(res, token);

    return res.json({ user });
  } catch (e) {
    console.error("Login DB error:", e?.code, e?.message);
    return res.status(500).json({ error: "Database error" });
  }
});

// POST /api/auth/logout
authRouter.post("/logout", (req, res) => {
  clearAuthCookie(res);
  return res.status(204).send();
});

// GET /api/auth/me
authRouter.get("/me", authRequired, (req, res) => {
  return res.json({ user: { id: req.user.id, username: req.user.username } });
});
