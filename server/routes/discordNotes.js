// server/routes/discordNotes.js
import express from "express";
import { pool } from "../db/pool.js";
import { MASTER_KEY } from "../config/env.js";
import { aesGcmEncryptText, aesGcmDecryptText } from "../utils/crypto.js";
import { extractNoteLinks, replaceLinksForNote } from "../utils/links.js";
import { discordBotAuthRequired } from "../middleware/discordBotAuth.js";

export const discordNotesRouter = express.Router();

// Wszystko tu wymaga bota + zlinkowanego discord usera
discordNotesRouter.use(discordBotAuthRequired);

// GET /api/discord/notes/list?scope=all|mine|public|private&q=
discordNotesRouter.get("/notes/list", async (req, res) => {
  const scope = (req.query.scope ?? "all").toString();
  const q = (req.query.q ?? "").toString().trim();
  const userId = req.user.id;

  const allowed = new Set(["all", "mine", "public", "private"]);
  if (!allowed.has(scope)) return res.status(400).json({ error: "Bad scope" });

  try {
    let sql = "";
    let params = [];

    if (scope === "all") {
      sql = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
               u.username AS author
        FROM notes n
        JOIN users u ON u.id = n.user_id
        WHERE (n.user_id = ? OR n.is_public = 1)
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
        ORDER BY n.updated_at DESC
        LIMIT 500
      `;
      params = q ? [userId, q] : [userId];
    } else if (scope === "mine") {
      sql = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
               u.username AS author
        FROM notes n
        JOIN users u ON u.id = n.user_id
        WHERE n.user_id = ?
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
        ORDER BY n.updated_at DESC
        LIMIT 500
      `;
      params = q ? [userId, q] : [userId];
    } else if (scope === "public") {
      sql = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
               u.username AS author
        FROM notes n
        JOIN users u ON u.id = n.user_id
        WHERE n.user_id = ? AND n.is_public = 1
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
        ORDER BY n.updated_at DESC
        LIMIT 500
      `;
      params = q ? [userId, q] : [userId];
    } else {
      // private
      sql = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
               u.username AS author
        FROM notes n
        JOIN users u ON u.id = n.user_id
        WHERE n.user_id = ? AND n.is_public = 0
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
        ORDER BY n.updated_at DESC
        LIMIT 500
      `;
      params = q ? [userId, q] : [userId];
    }

    const [rows] = await pool.query(sql, params);

    const out = rows.map((r) => {
      const isPublic = !!r.is_public;
      const key = isPublic ? MASTER_KEY : req.userKey;

      return {
        id: r.id,
        title: r.title,
        is_public: isPublic ? 1 : 0,
        author: r.author,
        owned: Number(r.user_id) === Number(userId) ? 1 : 0,
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

// GET /api/discord/notes?q=
discordNotesRouter.get("/notes", async (req, res) => {
  const q = (req.query.q ?? "").toString().trim();
  const userId = req.user.id;

  try {
    const [rows] = await pool.query(
      q
        ? `
          SELECT id, title, is_public, content_iv, content_tag, content_ct, created_at, updated_at
          FROM notes
          WHERE user_id = ? AND title LIKE CONCAT('%', ?, '%')
          ORDER BY updated_at DESC
        `
        : `
          SELECT id, title, is_public, content_iv, content_tag, content_ct, created_at, updated_at
          FROM notes
          WHERE user_id = ?
          ORDER BY updated_at DESC
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

// GET /api/discord/notes/:id
discordNotesRouter.get("/notes/:id", async (req, res) => {
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

// POST /api/discord/notes  {title, content, is_public}
discordNotesRouter.post("/notes", async (req, res) => {
  const title = (req.body?.title ?? "").toString().trim() || "Nowa notatka";
  const content = (req.body?.content ?? "").toString();
  const isPublic = !!req.body?.is_public;

  try {
    const key = isPublic ? MASTER_KEY : req.userKey;
    const enc = aesGcmEncryptText(key, content);

    const [result] = await pool.execute(
      "INSERT INTO notes (user_id, title, is_public, content_iv, content_tag, content_ct) VALUES (?, ?, ?, ?, ?, ?)",
      [req.user.id, title, isPublic ? 1 : 0, enc.iv, enc.tag, enc.ct]
    );

    const newId = result.insertId;
    const links = extractNoteLinks(content);
    await replaceLinksForNote(pool, newId, links);

    const [rows] = await pool.query(
      "SELECT id, title, is_public, created_at, updated_at FROM notes WHERE id=? AND user_id=?",
      [newId, req.user.id]
    );

    return res.status(201).json({
      ...rows[0],
      author: req.user.username,
      content,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});

// PUT /api/discord/notes/:id  {title, content, is_public}
discordNotesRouter.put("/notes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const title = (req.body?.title ?? "").toString().trim();
  const content = (req.body?.content ?? "").toString();
  const isPublic = !!req.body?.is_public;

  if (!title) return res.status(400).json({ error: "Title cannot be empty" });

  try {
    const [exists] = await pool.query(
      "SELECT id FROM notes WHERE id=? AND user_id=?",
      [id, req.user.id]
    );
    if (exists.length === 0) return res.status(404).json({ error: "Not found" });

    const key = isPublic ? MASTER_KEY : req.userKey;
    const enc = aesGcmEncryptText(key, content);

    await pool.execute(
      "UPDATE notes SET title=?, is_public=?, content_iv=?, content_tag=?, content_ct=? WHERE id=? AND user_id=?",
      [title, isPublic ? 1 : 0, enc.iv, enc.tag, enc.ct, id, req.user.id]
    );

    const links = extractNoteLinks(content);
    await replaceLinksForNote(pool, id, links);

    const [rows] = await pool.query(
      "SELECT id, title, is_public, created_at, updated_at FROM notes WHERE id=? AND user_id=?",
      [id, req.user.id]
    );

    return res.json({
      ...rows[0],
      author: req.user.username,
      content,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});

// DELETE /api/discord/notes/:id
discordNotesRouter.delete("/notes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  try {
    await pool.execute("DELETE FROM notes WHERE id=? AND user_id=?", [id, req.user.id]);
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  }
});
