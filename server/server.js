// server/server.js
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { staticDir } from "./config/paths.js";

// env checks (zostają jak były, tylko w module)
import "./config/env.js";

import { pagesRouter } from "./routes/pages.js";
import { authRouter } from "./routes/auth.js";
import { publicNotesRouter } from "./routes/publicNotes.js";
import { notesRouter } from "./routes/notes.js";
import { notesStreamRouter } from "./routes/notesStream.js";
import { graphRouter } from "./routes/graph.js";
import { graphLayoutRouter } from "./routes/graphLayout.js";
import { discordLinkRouter } from "./routes/discordLink.js";
import { discordLinkBotRouter } from "./routes/discordLinkBot.js";
import { discordNotesRouter } from "./routes/discordNotes.js";
import { feedRouter } from "./routes/feed.js";
import { feedStreamRouter } from "./routes/feedStream.js";



const app = express();

app.disable("etag");
app.use((req, res, next) => {
  // nie cache'uj API, bo 304 może mieszać w auth
  if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
  next();
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Static (root/static)
app.use("/static", express.static(staticDir));

// ---- Pages ----
app.use("/", pagesRouter);

// ---- AUTH API ----
app.use("/api/auth", authRouter);

// ---- PUBLIC NOTES API (no auth) ----
app.use("/api/public", publicNotesRouter);

// ---- GRAPH ----
app.use("/api/graph", graphRouter);
app.use("/api/graph", graphLayoutRouter);

// ---- MY NOTES API (auth) ----

app.use("/api/notes", notesStreamRouter);
app.use("/api/notes", notesRouter);

app.use("/api/feed", feedStreamRouter);
app.use("/api/feed", feedRouter);

// ---- DISCORD ----
app.use("/api/discord", discordLinkRouter);      // web: generowanie kodu (auth cookie)
app.use("/api/discord", discordLinkBotRouter);   // bot: zużycie kodu
app.use("/api/discord", discordNotesRouter);     // bot: CRUD notatek usera



const port = Number(process.env.PORT ?? "5000");
app.listen(port, "0.0.0.0", () => {
  console.log(`Notes app running: http://localhost:${port}`);
});
