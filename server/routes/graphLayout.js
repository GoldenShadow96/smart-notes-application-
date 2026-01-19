// server/routes/graphLayout.js
import express from "express";

import { pool } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

export const graphLayoutRouter = express.Router();

// ---- GRAPH LAYOUT (per-user) ----

// GET /api/graph/layout?key=...
graphLayoutRouter.get("/layout", authRequired, async (req, res) => {
  const key = (req.query.key ?? "all").toString().slice(0, 128);
  try {
    const [rows] = await pool.query(
      "SELECT layout_json FROM graph_layouts WHERE user_id=? AND layout_key=? LIMIT 1",
      [req.user.id, key]
    );
    if (rows.length === 0) return res.status(204).send();
    return res.json({ layout: rows[0].layout_json });
  } catch (e) {
    console.error("Graph layout GET error:", e);
    return res.status(500).json({ error: "Database error" });
  }
});

// PUT /api/graph/layout?key=...   body: { positions: { [id]: {x,y} }, collapsed?: number[] }
graphLayoutRouter.put("/layout", authRequired, async (req, res) => {
  const key = (req.query.key ?? "all").toString().slice(0, 128);

  const positions = req.body?.positions;
  const collapsed = req.body?.collapsed;

  if (!positions || typeof positions !== "object") {
    return res.status(400).json({ error: "Bad positions" });
  }

  // minimalna walidacja + limit
  const entries = Object.entries(positions);
  if (entries.length > 5000) {
    return res.status(400).json({ error: "Too many nodes in layout" });
  }

  for (const [id, p] of entries) {
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: "Bad node id" });
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") {
      return res.status(400).json({ error: "Bad node position" });
    }
  }

  let collapsedArr = [];
  if (typeof collapsed !== "undefined") {
    if (!Array.isArray(collapsed)) return res.status(400).json({ error: "Bad collapsed" });
    collapsedArr = collapsed
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 5000);
  }

  try {
    const payload = JSON.stringify({
      positions,
      collapsed: collapsedArr,
    });

    await pool.query(
      `
      INSERT INTO graph_layouts (user_id, layout_key, layout_json)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE layout_json=VALUES(layout_json)
      `,
      [req.user.id, key, payload]
    );

    return res.status(204).send();
  } catch (e) {
    console.error("Graph layout PUT error:", e);
    return res.status(500).json({ error: "Database error" });
  }
});
