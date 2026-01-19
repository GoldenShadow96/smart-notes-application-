// server/routes/notesStream.js
import express from "express";
import { authRequired } from "../middleware/auth.js";
import { sseAddClient, sseRemoveClient } from "../utils/sseHub.js";

export const notesStreamRouter = express.Router();

notesStreamRouter.get("/stream", authRequired, (req, res) => {
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  sseAddClient(req.user.id, res);

  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);

  const ping = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    sseRemoveClient(req.user.id, res);
    res.end();
  });
});
