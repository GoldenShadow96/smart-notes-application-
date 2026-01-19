// server/utils/http.js
export function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}
export function unauthorized(res, msg = "Unauthorized") {
  return res.status(401).json({ error: msg });
}
export function notFound(res, msg) {
  return res.status(404).json({ error: msg });
}
