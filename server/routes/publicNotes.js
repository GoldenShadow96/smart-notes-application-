// server/routes/publicNotes.js
import express from "express";

import { pool } from "../db/pool.js";
import { MASTER_KEY } from "../config/env.js";
import { aesGcmDecryptText } from "../utils/crypto.js";

export const publicNotesRouter = express.Router();

// ---- PUBLIC NOTES API (no auth) ----

publicNotesRouter.get("/notes", async (req, res) => {
  const q = (req.query.q ?? "").toString().trim();

  try {
    const [rows] = await pool.query(
      q
        ? `
          SELECT n.id, n.title, n.is_public, n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
                 u.username AS author
          FROM notes n
          JOIN users u ON u.id = n.user_id
          WHERE n.is_public = 1 AND n.title LIKE CONCAT('%', ?, '%')
          ORDER BY n.updated_at DESC
        `
        : `
          SELECT n.id, n.title, n.is_public, n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
                 u.username AS author
          FROM notes n
          JOIN users u ON u.id = n.user_id
          WHERE n.is_public = 1
          ORDER BY n.updated_at DESC
        `,
      q ? [q] : []
    );

    const out = rows.map((r) => ({
      id: r.id,
      title: r.title,
      is_public: 1,
      author: r.author,
      content: aesGcmDecryptText(
        MASTER_KEY,
        Buffer.from(r.content_iv),
        Buffer.from(r.content_ct),
        Buffer.from(r.content_tag)
      ),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return res.json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});

publicNotesRouter.get("/notes/:id/backlinks", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  try {
    // upewnij się, że target jest publiczny
    const [t] = await pool.query("SELECT id FROM notes WHERE id=? AND is_public=1 LIMIT 1", [id]);
    if (t.length === 0) return res.status(404).json({ error: "Not found" });

    const [rows] = await pool.query(
      `
      SELECT n.id, n.title, n.is_public, n.updated_at, u.username AS author
      FROM note_links l
      JOIN notes n ON n.id = l.from_note_id
      JOIN users u ON u.id = n.user_id
      WHERE l.to_note_id = ?
        AND (n.is_public = 1 OR n.user_id = ?)
      ORDER BY n.updated_at DESC
      LIMIT 50
      `,
      [id, req.user.id]
    );

    return res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        updated_at: r.updated_at,
      }))
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  }
});

publicNotesRouter.get("/notes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  try {
    const [rows] = await pool.query(
      `
      SELECT n.id, n.title, n.is_public, n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
             u.username AS author
      FROM notes n
      JOIN users u ON u.id = n.user_id
      WHERE n.id = ? AND n.is_public = 1
      LIMIT 1
      `,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const r = rows[0];
    const content = aesGcmDecryptText(
      MASTER_KEY,
      Buffer.from(r.content_iv),
      Buffer.from(r.content_ct),
      Buffer.from(r.content_tag)
    );

    return res.json({
      id: r.id,
      title: r.title,
      is_public: 1,
      author: r.author,
      content,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});
