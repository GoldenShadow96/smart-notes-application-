// server/utils/crypto.js
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { COOKIE_NAME, COOKIE_SECURE, JWT_SECRET } from "../config/env.js";

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res) {
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    expires: new Date(0),
    path: "/",
  });
}

// ---- Crypto helpers (AES-256-GCM) ----
export function aesGcmEncryptText(key32, plaintextUtf8) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key32, iv);
  const ct = Buffer.concat([cipher.update(plaintextUtf8, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ct, tag };
}

export function aesGcmDecryptText(key32, iv, ct, tag) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key32, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
