// server/utils/links.js
export function extractNoteLinks(content) {
  // wspieramy [[#123]]
  const text = (content ?? "").toString();
  const re = /\[\[#(\d+)\]\]/g;

  const ids = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return Array.from(ids);
}

export async function replaceLinksForNote(connOrPool, fromId, toIds) {
  // usuń stare
  await connOrPool.execute("DELETE FROM note_links WHERE from_note_id=?", [fromId]);

  if (!toIds || toIds.length === 0) return;

  // wstaw nowe (ignoruj link do siebie)
  const values = toIds
    .filter((t) => t !== fromId)
    .map((t) => [fromId, t]);

  if (values.length === 0) return;

  // multi-insert
  await connOrPool.query(
    "INSERT IGNORE INTO note_links (from_note_id, to_note_id) VALUES ?",
    [values]
  );
}
