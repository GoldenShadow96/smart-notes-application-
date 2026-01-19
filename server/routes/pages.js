// server/routes/pages.js
import express from "express";
import path from "path";
import { templatesDir } from "../config/paths.js";

export const pagesRouter = express.Router();

pagesRouter.get("/", (req, res) => res.sendFile(path.join(templatesDir, "index.html")));
pagesRouter.get("/login", (req, res) => res.sendFile(path.join(templatesDir, "login.html")));
pagesRouter.get("/register", (req, res) => res.sendFile(path.join(templatesDir, "register.html")));
pagesRouter.get("/public/:id", (req, res) => res.sendFile(path.join(templatesDir, "public_note.html")));
pagesRouter.get("/graph", (req, res) => res.sendFile(path.join(templatesDir, "graph.html")));
