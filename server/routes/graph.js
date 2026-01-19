// server/routes/graph.js
import express from "express";

import { pool } from "../db/pool.js";
import { MASTER_KEY } from "../config/env.js";
import { aesGcmDecryptText } from "../utils/crypto.js";
import { optionalAuth } from "../middleware/auth.js";

export const graphRouter = express.Router();

// GET /api/graph  (anon: tylko publiczne, zalogowany: swoje + publiczne)
// Zwraca excerpt (krótki fragment treści) dla “note-cardów”
graphRouter.get("/", optionalAuth, async (req, res) => {
  const q = (req.query.q ?? "").toString().trim();
  const loggedIn = !!req.user;

  try {
    // jeśli zalogowany -> wyciągnij userKey (do prywatnych)
    let userKey = null;
    if (loggedIn) {
      const [uk] = await pool.query("SELECT key_iv, key_tag, key_ct FROM users WHERE id=? LIMIT 1", [
        req.user.id,
      ]);
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

    // Nodes: potrzebujemy też content_iv/tag/ct do excerpt
    let nodesQuery = "";
    let nodesParams = [];

    if (!loggedIn) {
      nodesQuery = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct,
               n.updated_at,
               u.username AS author
        FROM notes n
        JOIN users u ON u.id = n.user_id
        WHERE n.is_public = 1
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
      `;
      nodesParams = q ? [q] : [];
    } else {
      nodesQuery = `
        SELECT n.id, n.title, n.is_public, n.user_id,
               n.content_iv, n.content_tag, n.content_ct,
               n.updated_at,
               u.username AS author
        FROM notes n
        JOIN users u ON u.id = n.user_id
        WHERE (n.user_id = ? OR n.is_public = 1)
        ${q ? "AND n.title LIKE CONCAT('%', ?, '%')" : ""}
      `;
      nodesParams = q ? [req.user.id, q] : [req.user.id];
    }

    const [nodeRows] = await pool.query(nodesQuery, nodesParams);

    const nodeSet = new Set(nodeRows.map((r) => Number(r.id)));

    const nodes = nodeRows.map((r) => {
      const isPublic = !!r.is_public;
      const owned = loggedIn && Number(r.user_id) === Number(req.user.id);

      // dobór klucza:
      // - publiczne zawsze MASTER_KEY
      // - prywatne tylko jeśli owned -> userKey
      let key = MASTER_KEY;
      if (!isPublic) {
        if (owned && userKey && userKey.length === 32) key = userKey;
        else {
          // nie powinno się zdarzyć, bo prywatnych cudzych nie zwracamy w SQL
          key = null;
        }
      }

      let excerpt = "";
      if (key) {
        try {
          const content = aesGcmDecryptText(
            key,
            Buffer.from(r.content_iv),
            Buffer.from(r.content_ct),
            Buffer.from(r.content_tag)
          );
          excerpt = (content ?? "")
            .toString()
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180);
        } catch {
          excerpt = "";
        }
      }

      return {
        id: Number(r.id),
        title: r.title,
        is_public: isPublic ? 1 : 0,
        author: r.author,
        owned: owned ? 1 : 0,
        excerpt,
      };
    });

    // Edges: tylko takie, gdzie oba końce w nodeSet
    const [edgeRows] = await pool.query(`
      SELECT from_note_id AS \`from\`, to_note_id AS \`to\`
      FROM note_links
      LIMIT 10000
    `);

    const edges = edgeRows
      .map((e) => ({ from: Number(e.from), to: Number(e.to) }))
      .filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));

    return res.json({ nodes, edges });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database/Crypto error" });
  }
});
