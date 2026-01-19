function renderMarkdown(mdText) {
  const text = (mdText ?? "").toString();
  if (!window.marked || !window.DOMPurify) return text;

  const html = window.marked.parse(text, { breaks: true });
  return window.DOMPurify.sanitize(html);
}

(async () => {
  const m = location.pathname.match(/\/public\/(\d+)/);
  const id = m ? Number(m[1]) : null;

  const titleEl = document.querySelector("#pubTitle");
  const metaEl = document.querySelector("#pubMeta");
  const contentEl = document.querySelector("#pubContent");

  if (!id) {
    titleEl.textContent = "Błędny adres";
    return;
  }

  // UWAGA: to wymaga endpointu /api/public/notes/:id.
  // Jeśli go nie masz, daj znać — dopiszę Ci gotową wstawkę do server.js.
  const res = await fetch(`/api/public/notes/${id}`, { cache: "no-store" });
  if (!res.ok) {
    titleEl.textContent = "Nie znaleziono notatki";
    metaEl.textContent = "";
    contentEl.innerHTML = "";
    return;
  }

  const note = await res.json();
  titleEl.textContent = note.title ?? `#${note.id}`;
  metaEl.textContent = `@${note.author ?? "anon"} • ${new Date(note.updated_at).toLocaleString()} • publiczna`;
  contentEl.innerHTML = renderMarkdown(note.content ?? "");
})().catch(err => {
  console.error(err);
  const titleEl = document.querySelector("#pubTitle");
  titleEl.textContent = "Błąd ładowania";
});
