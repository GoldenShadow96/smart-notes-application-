// static/reorder.js
(async function () {
  const notesEl = document.getElementById("notes");
  if (!notesEl) return;

  // sprawdź czy user zalogowany
  async function isLoggedIn() {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  }

  const logged = await isLoggedIn();
  if (!logged) return; // drag&drop tylko dla zalogowanego (moje notatki)

  // debounce zapisu (żeby nie spamować API)
  let t = null;
  function saveOrderDebounced() {
    clearTimeout(t);
    t = setTimeout(saveOrder, 250);
  }

  async function saveOrder() {
    const ids = Array.from(notesEl.querySelectorAll(".note[data-note-id]"))
  .map(el => Number(el.dataset.noteId))
  .filter(n => Number.isInteger(n) && n > 0);

await api("/api/notes/order", {
  method: "PUT",
  body: JSON.stringify({ order: ids }),
});

    if (ids.length === 0) return;

    try {
      const r = await fetch("/api/notes/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: ids }),
      });
      // jeśli 401/403 to znaczy, że sesja wygasła – wtedy po prostu nic nie rób
    } catch (e) {
      console.warn("Order save failed:", e);
    }
  }

  // inicjalizuj Sortable
  // Uwaga: używam całego note-header jako "handle", ale możesz zawęzić np. tylko do .toggle
  new Sortable(notesEl, {
    animation: 150,
    handle: ".note-header",
    draggable: ".note",
    onEnd: saveOrderDebounced,
  });
})();
