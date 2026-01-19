// server/routes/notes.js
import express from "express";

import { pool } from "../db/pool.js";
import { MASTER_KEY } from "../config/env.js";
import { aesGcmDecryptText, aesGcmEncryptText } from "../utils/crypto.js";
import { badRequest, notFound } from "../utils/http.js";
import { extractNoteLinks, replaceLinksForNote } from "../utils/links.js";
import { authRequired, loadUserKey } from "../middleware/auth.js";
import { sseSend, sseBroadcast } from "../utils/sseHub.js";

export const notesRouter = express.Router();

// PUT /api/notes/order  (router jest pod /api/notes, więc tu jest "/order")
notesRouter.put("/order", authRequired, async (req, res) => {
  const order = req.body?.order;

  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: "Bad order" });
  }

  const ids = order.map(Number);
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ error: "Bad note ids" });
  }

  // usuń duplikaty zachowując kolejność
  const seen = new Set();
  const unique = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
  `SELECT id FROM notes
   WHERE (user_id=? OR is_public=1)
     AND id IN (${unique.map(() => "?").join(",")})`,
  [req.user.id, ...unique]
);


    if (rows.length !== unique.length) {
      await conn.rollback();
      return res.status(403).json({ error: "Some notes are not yours" });
    }

    // wyczyść stare i wstaw nowe (1..N) => "uzupełnianie luk"
    await conn.execute("DELETE FROM note_orders WHERE user_id=?", [req.user.id]);

    const values = unique.map((noteId, i) => [req.user.id, noteId, i + 1]);
    await conn.query("INSERT INTO note_orders (user_id, note_id, sort_index) VALUES ?", [values]);

    await conn.commit();
    sseSend(req.user.id, "notes_reordered", { order: unique });

    return res.status(204).send();
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  } finally {
    conn.release();
  }
});

// GET /api/notes?q=  (zalogowany: tylko swoje)
notesRouter.get("/", authRequired, loadUserKey, async (req, res) => {
  const q = (req.query.q ?? "").toString().trim();
  const userId = req.user.id;

  try {
    const [rows] = await pool.query(
  q
    ? `
      SELECT n.id, n.title, n.is_public, n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at
      FROM notes n
      LEFT JOIN note_orders o
        ON o.user_id = n.user_id AND o.note_id = n.id
      WHERE n.user_id = ? AND n.title LIKE CONCAT('%', ?, '%')
      ORDER BY
        (o.sort_index IS NULL) ASC,
        o.sort_index ASC,
        n.updated_at DESC
    `
    : `
      SELECT n.id, n.title, n.is_public, n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at
      FROM notes n
      LEFT JOIN note_orders o
        ON o.user_id = n.user_id AND o.note_id = n.id
      WHERE n.user_id = ?
      ORDER BY
        (o.sort_index IS NULL) ASC,
        o.sort_index ASC,
        n.updated_at DESC
    `,
  q ? [userId, q] : [userId]
);


    const out = rows.map((r) => {
      const key = r.is_public ? MASTER_KEY : req.userKey;
      return {
        id: r.id,
        title: r.title,
        is_public: r.is_public ? 1 : 0,
        author: req.user.username,
        content: aesGcmDecryptText(
          key,
          Buffer.from(r.content_iv),
          Buffer.from(r.content_ct),
          Buffer.from(r.content_tag)
        ),
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });

    return res.json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});

// GET /api/notes/:id/backlinks
notesRouter.get("/:id/backlinks", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  try {
    // tylko właściciel może pytać o backlinki swojej notatki
    const [t] = await pool.query("SELECT id FROM notes WHERE id=? AND user_id=? LIMIT 1", [
      id,
      req.user.id,
    ]);
    if (t.length === 0) return res.status(404).json({ error: "Not found" });

    const [rows] = await pool.query(
      `
      SELECT n.id, n.title, n.is_public, n.updated_at, u.username AS author, n.user_id
      FROM note_links l
      JOIN notes n ON n.id = l.from_note_id
      JOIN users u ON u.id = n.user_id
      WHERE l.to_note_id = ?
        AND (n.is_public = 1 OR n.user_id = ?)   -- <- KLUCZ
      ORDER BY n.updated_at DESC
      LIMIT 50
      `,
      [id, req.user.id]
    );

    // tu zwracamy też is_public, bo zalogowany może widzieć np. link z jego prywatnej notatki
    return res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        is_public: r.is_public ? 1 : 0,
        updated_at: r.updated_at,
      }))
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  }
});

// GET /api/notes/:id
notesRouter.get("/:id", authRequired, loadUserKey, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  try {
    const [rows] = await pool.query(
      `
      SELECT id, title, is_public, content_iv, content_tag, content_ct, created_at, updated_at
      FROM notes
      WHERE id = ? AND user_id = ?
      LIMIT 1
      `,
      [id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const r = rows[0];
    const key = r.is_public ? MASTER_KEY : req.userKey;

    const content = aesGcmDecryptText(
      key,
      Buffer.from(r.content_iv),
      Buffer.from(r.content_ct),
      Buffer.from(r.content_tag)
    );

    return res.json({
      id: r.id,
      title: r.title,
      is_public: r.is_public ? 1 : 0,
      author: req.user.username,
      content,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});

// POST /api/notes
notesRouter.post("/", authRequired, loadUserKey, async (req, res) => {
  const userId = req.user.id;
  const title = (req.body?.title ?? "").toString().trim() || "Nowa notatka";
  const content = (req.body?.content ?? "").toString();
  const isPublic = !!req.body?.is_public;

  try {
    const key = isPublic ? MASTER_KEY : req.userKey;
    const enc = aesGcmEncryptText(key, content);

    const [result] = await pool.execute(
      "INSERT INTO notes (user_id, title, is_public, content_iv, content_tag, content_ct) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, title, isPublic ? 1 : 0, enc.iv, enc.tag, enc.ct]
    );

    const newId = result.insertId;
    const links = extractNoteLinks(content);
    await replaceLinksForNote(pool, newId, links);

    const [rows] = await pool.query(
      "SELECT id, title, is_public, created_at, updated_at FROM notes WHERE id=? AND user_id=?",
      [result.insertId, userId]
    );

    const payload = {
      ...rows[0],
      author: req.user.username,
      content,
    };

    sseSend(userId, "note_created", payload);

    if (payload.is_public) {
      sseBroadcast("feed_changed", { type: "note_created", id: payload.id });
    }


    return res.status(201).json(payload);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});

// PUT /api/notes/:id  (zmiana public/private powoduje przeszyfrowanie treści)
notesRouter.put("/:id", authRequired, loadUserKey, async (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, "Invalid id");

  const title = (req.body?.title ?? "").toString().trim();
  const content = (req.body?.content ?? "").toString();
  const isPublic = !!req.body?.is_public;

  if (!title) return badRequest(res, "Title cannot be empty");

  try {
    const [exists] = await pool.query(
      "SELECT id, is_public FROM notes WHERE id=? AND user_id=?",
      [id, userId]
    );
    if (exists.length === 0) return notFound(res, "Note not found");
    const wasPublic = !!exists[0].is_public;

    const key = isPublic ? MASTER_KEY : req.userKey;
    const enc = aesGcmEncryptText(key, content);

    await pool.execute(
      "UPDATE notes SET title=?, is_public=?, content_iv=?, content_tag=?, content_ct=? WHERE id=? AND user_id=?",
      [title, isPublic ? 1 : 0, enc.iv, enc.tag, enc.ct, id, userId]
    );

    const links = extractNoteLinks(content);
    await replaceLinksForNote(pool, id, links);

    const [rows] = await pool.query(
      "SELECT id, title, is_public, created_at, updated_at FROM notes WHERE id=? AND user_id=?",
      [id, userId]
    );

    const payload = {
      ...rows[0],
      author: req.user.username,
      content,
    };

    sseSend(userId, "note_updated", payload);

    if (wasPublic || !!payload.is_public) {
      sseBroadcast("feed_changed", { type: "note_updated", id: payload.id });
    }

    return res.json(payload);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});

// DELETE /api/notes/:id
notesRouter.delete("/:id", authRequired, async (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, "Invalid id");

  try {
  const [prev] = await pool.query(
  "SELECT is_public FROM notes WHERE id=? AND user_id=? LIMIT 1",
  [id, userId]
);
const wasPublic = prev.length ? !!prev[0].is_public : false;

const [result] = await pool.execute(
  "DELETE FROM notes WHERE id=? AND user_id=?",
  [id, userId]
);

if (result.affectedRows > 0) {
  sseSend(userId, "note_deleted", { id });

  if (wasPublic) {
    sseBroadcast("feed_changed", { type: "note_deleted", id });
  }
}
return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  }

});

