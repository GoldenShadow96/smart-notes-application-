// server/routes/feedStream.js
import express from "express";
import { sseAddClient, sseRemoveClient } from "../utils/sseHub.js";

export const feedStreamRouter = express.Router();

// GET /api/feed/stream  (publiczny - bez auth)
feedStreamRouter.get("/stream", (req, res) => {
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // rejestrujemy klienta bez userId (tylko broadcast)
  sseAddClient(null, res);

  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);

  const ping = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    sseRemoveClient(null, res);
    res.end();
  });
});
