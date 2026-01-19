// server/routes/feed.js
import express from "express";
import { pool } from "../db/pool.js";
import { MASTER_KEY } from "../config/env.js";
import { aesGcmDecryptText } from "../utils/crypto.js";
import { optionalAuth } from "../middleware/auth.js";

export const feedRouter = express.Router();

// GET /api/feed?q=&sort=custom|date|title
feedRouter.get("/", optionalAuth, async (req, res) => {
  const sort = (req.query.sort ?? "custom").toString();
  const allowed = new Set(["custom", "date", "title"]);
  const sortMode = allowed.has(sort) ? sort : "custom";

  const q = (req.query.q ?? "").toString().trim();
  const loggedIn = !!req.user;

  try {
    // jeśli zalogowany: wyciągnij userKey (do prywatnych)
    let userKey = null;
    let userId = null;

    if (loggedIn) {
      userId = req.user.id;

      const [uk] = await pool.query(
        "SELECT key_iv, key_tag, key_ct FROM users WHERE id=? LIMIT 1",
        [userId]
      );

      if (uk.length) {
        const userKeyHex = aesGcmDecryptText(
          MASTER_KEY,
          Buffer.from(uk[0].key_iv),
          Buffer.from(uk[0].key_ct),
          Buffer.from(uk[0].key_tag)
        );
        userKey = Buffer.from(userKeyHex, "hex");
      }
    }

    const params = [];
    let sql = "";
    let orderBy = "";

    // --- ORDER BY zależny od sortMode ---
    // dla anon: custom -> date
    if (!loggedIn) {
      if (sortMode === "title") {
        orderBy = "ORDER BY n.title ASC, n.updated_at DESC";
      } else {
        orderBy = "ORDER BY n.updated_at DESC";
      }

      sql = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
               u.username AS author
        FROM notes n
        JOIN users u ON u.id = n.user_id
        WHERE n.is_public = 1
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
        ${orderBy}
        LIMIT 1000
      `;
      if (q) params.push(q);
    } else {
      // logged in
      if (sortMode === "title") {
        orderBy = "ORDER BY n.title ASC, n.updated_at DESC";
      } else if (sortMode === "date") {
        orderBy = "ORDER BY n.updated_at DESC";
      } else {
        // custom
        orderBy = `
          ORDER BY
            (o.sort_index IS NULL) ASC,
            o.sort_index ASC,
            n.updated_at DESC
        `;
      }

      sql = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct, n.created_at, n.updated_at,
               u.username AS author,
               o.sort_index
        FROM notes n
        JOIN users u ON u.id = n.user_id
        LEFT JOIN note_orders o
          ON o.user_id = ? AND o.note_id = n.id
        WHERE (n.user_id = ? OR n.is_public = 1)
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
        ${orderBy}
        LIMIT 1000
      `;
      params.push(userId, userId);
      if (q) params.push(q);
    }

    const [rows] = await pool.query(sql, params);

    const out = rows.map((r) => {
      const isPublic = !!r.is_public;
      const owned = loggedIn && Number(r.user_id) === Number(req.user.id);

      // prywatne w feedzie są tylko moje -> userKey
      const key = isPublic ? MASTER_KEY : userKey;

      let content = "";
      try {
        content = aesGcmDecryptText(
          key,
          Buffer.from(r.content_iv),
          Buffer.from(r.content_ct),
          Buffer.from(r.content_tag)
        );
      } catch {
        content = "";
      }

      return {
        id: r.id,
        title: r.title,
        is_public: isPublic ? 1 : 0,
        author: r.author,
        _owned: owned ? 1 : 0,
        content,
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
