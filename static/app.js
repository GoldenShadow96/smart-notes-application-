// static/app.js

const notesEl = document.querySelector("#notes");
const emptyEl = document.querySelector("#empty");
const tpl = document.querySelector("#noteTemplate");
const newBtn = document.querySelector("#newNote");
const toggleAllBtn = document.querySelector("#toggleAll");
const searchInput = document.querySelector("#search");

const whoamiEl = document.querySelector("#whoami");
const loginLink = document.querySelector("#loginLink");
const registerLink = document.querySelector("#registerLink");
const logoutBtn = document.querySelector("#logoutBtn");

// Modal: wstaw link
const linkModal = document.querySelector("#linkModal");
const linkBackdrop = linkModal.querySelector(".modal-backdrop");
const linkCloseBtn = document.querySelector("#linkCloseBtn");
const linkSearch = document.querySelector("#linkSearch");
const linkList = document.querySelector("#linkList");

const sortDateBtn = document.querySelector("#sortDate");
const sortTitleBtn = document.querySelector("#sortTitle");
const sortCustomBtn = document.querySelector("#sortCustom");

let sortMode = localStorage.getItem("sortMode") || "custom"; // custom|date|title

let currentUser = null;
let notes = [];
let debounceTimer = null;

// --- Realtime (SSE) ---
let notesSse = null;
let feedSse = null;

// Blokada auto-refreshu (żeby SSE nie zrywało edycji / trybu edycji po create)
let suppressAutoRefreshUntil = 0;
let deferredRefreshTimer = null;

function beginLocalMutation(ms = 1500) {
  suppressAutoRefreshUntil = Math.max(suppressAutoRefreshUntil, Date.now() + ms);
}

function isUserEditingNow() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = (a.tagName || "").toLowerCase();
  if (tag !== "textarea" && tag !== "input") return false;

  // search nie blokuje odświeżania
  if (a === searchInput) return false;

  return true;
}


function runRefreshWhenSafe(refreshFn) {
  clearTimeout(deferredRefreshTimer);

  const tick = () => {
    const now = Date.now();
    const waitForMutation = Math.max(0, suppressAutoRefreshUntil - now);

    if (waitForMutation > 0) {
      deferredRefreshTimer = setTimeout(tick, waitForMutation + 50);
      return;
    }

    if (isUserEditingNow()) {
      deferredRefreshTimer = setTimeout(tick, 600);
      return;
    }

    refreshFn();
  };

  tick();
}

// notatki z niezapisanymi zmianami (żeby SSE nie robiło reloadu i nie nadpisywało edycji)
const dirtyIds = new Set();
let pendingRemoteRefresh = false;

function markDirtyGlobal(noteId) {
  const id = Number(noteId);
  if (Number.isInteger(id) && id > 0) dirtyIds.add(id);
}

function clearDirtyGlobal(noteId) {
  const id = Number(noteId);
  if (Number.isInteger(id) && id > 0) dirtyIds.delete(id);

  if (dirtyIds.size === 0 && pendingRemoteRefresh) {
    pendingRemoteRefresh = false;
    runRefreshWhenSafe(() => load((searchInput?.value ?? "").trim()));
  }
}

function stopNotesStream() {
  if (!notesSse) return;
  try {
    notesSse.close();
  } catch {}
  notesSse = null;
}

function ensureNotesStream() {
  if (!currentUser) {
    stopNotesStream();
    return;
  }
  if (notesSse) return;

  // Debounce, żeby seria eventów nie robiła wielu fetchy
  const refresh = debounce(() => {
    load((searchInput?.value ?? "").trim());
  }, 200);

  // Jedno miejsce z logiką "czy można reloadować"
  const requestRefresh = (reason = "sse") => {
    if (!currentUser) return;

    // jeśli użytkownik ma niezapisane zmiany – odłóż
    if (dirtyIds.size > 0) {
      pendingRemoteRefresh = true;
      return;
    }

    // jeśli trwa lokalna mutacja / edycja – odłóż do momentu, gdy będzie bezpiecznie
    runRefreshWhenSafe(() => refresh());
  };

  notesSse = new EventSource("/api/notes/stream");

  const trigger = (name) => (e) => {
    if (name !== "ping") {
      console.log(`SSE ${name}`, e?.data ?? "");
      requestRefresh(name);
    } else {
      // ping tylko do diagnostyki, bez reloadu
      console.log("SSE ping", e?.data ?? "");
    }
  };

  notesSse.addEventListener("note_created", trigger("note_created"));
  notesSse.addEventListener("note_updated", trigger("note_updated"));
  notesSse.addEventListener("note_deleted", trigger("note_deleted"));
  notesSse.addEventListener("notes_reordered", trigger("notes_reordered"));

  // hello możesz traktować jako "pierwszy sync"
  notesSse.addEventListener("hello", (e) => {
    console.log("SSE hello", e?.data ?? "");
    requestRefresh("hello");
  });

  notesSse.addEventListener("ping", trigger("ping"));

  notesSse.onerror = async () => {
    // EventSource sam próbuje się wznawiać; jeśli sesja wygasła – zamknij
    await fetchMe();
    if (!currentUser) {
      stopNotesStream();
    }
  };
}

function stopFeedStream() {
  if (!feedSse) return;
  try { feedSse.close(); } catch {}
  feedSse = null;
}

function ensureFeedStream() {
  if (feedSse) return;

  const refresh = debounce(() => {
    load((searchInput?.value ?? "").trim());
  }, 200);

  feedSse = new EventSource("/api/feed/stream");

  feedSse.addEventListener("feed_changed", () => {
    // anon nie edytuje, zalogowany może — więc użyj bezpiecznika tylko gdy ma sens
    if (currentUser) runRefreshWhenSafe(() => refresh());
    else refresh();
  });

  // opcjonalnie diagnostyka:
  // feedSse.addEventListener("hello", (e) => console.log("FEED hello", e.data));
  // feedSse.addEventListener("ping", () => {});
}


// Mapowanie ID->info (do zamiany [[#id]] na tytuły)
let noteIndex = new Map(); // id -> { title, is_public, owned }

// Kontekst modala (do której notatki wstawiamy link)
let linkCtx = {
  fromNoteId: null,
  textarea: null,
  ensureEditMode: null,
};

// Cache kandydatów do linkowania
let linkCandidates = [];
let linkCandidatesLoaded = false;
let expandAll = true; // start: wszystko rozwinięte

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED");

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---------- internal navigation (#note-123) ----------
function scrollToNote(id) {
  const target = document.getElementById(`note-${id}`);
  if (!target) return false;

  // rozwiń, jeśli zwinięte
  const body = target.querySelector(".note-body");
  const toggle = target.querySelector(".toggle");
  if (body && body.classList.contains("hidden") && toggle) toggle.click();

  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("note-flash");
  setTimeout(() => target.classList.remove("note-flash"), 650);
  return true;
}

function bindInternalNoteLinks(containerEl) {
  const anchors = containerEl.querySelectorAll('a[href^="#note-"]');
  anchors.forEach((a) => {
    if (a.dataset.bound === "1") return;
    a.dataset.bound = "1";

    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const href = a.getAttribute("href") || "";
      const idStr = href.replace("#note-", "");
      const id = Number(idStr);
      if (!Number.isInteger(id) || id <= 0) return;
      scrollToNote(id);
    });
  });
}

// --- Wiki link -> link (Markdown) ---
function escapeMdLabel(s) {
  return (s ?? "").toString().replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function linkifyWikiLinks(mdText) {
  const text = (mdText ?? "").toString();

  // [[#123]] -> link (tytuł jeśli znamy)
  return text.replace(/\[\[#(\d+)\]\]/g, (_, num) => {
    const id = Number(num);
    if (!Number.isInteger(id) || id <= 0) return `[[#${num}]]`;

    const info = noteIndex.get(id);
    const label = info?.title ? escapeMdLabel(info.title) : `#${id}`;

    // jeśli notatka jest w aktualnym widoku -> link wewnętrzny
    if (info) {
      return `[${label}](#note-${id})`;
    }

    // fallback: public deep-link
    return `[${label}](/public/${id})`;
  });
}

function renderMarkdown(mdText) {
  const pre = linkifyWikiLinks(mdText);

  if (!window.marked || !window.DOMPurify) {
    return pre
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  const html = window.marked.parse(pre, { breaks: true });
  return window.DOMPurify.sanitize(html);
}

function setEmptyState() {
  if (notes.length === 0) emptyEl.classList.remove("hidden");
  else emptyEl.classList.add("hidden");
}

function setAuthUI() {
  if (currentUser) {
    whoamiEl.textContent = `👤 ${currentUser.username}`;
    logoutBtn.classList.remove("hidden");
    loginLink.classList.add("hidden");
    registerLink.classList.add("hidden");
    newBtn.classList.remove("hidden");
  } else {
    whoamiEl.textContent = "🌍 publiczne notatki";
    logoutBtn.classList.add("hidden");
    loginLink.classList.remove("hidden");
    registerLink.classList.remove("hidden");
    newBtn.classList.add("hidden");
  }
}

async function fetchMe() {
  try {
    const r = await api("/api/auth/me");
    currentUser = r.user;
  } catch {
    currentUser = null;
  }
  setAuthUI();
}

logoutBtn?.addEventListener("click", async () => {
  stopNotesStream();
  stopFeedStream();
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
});

function mergeAndSortNotes(myNotes, publicNotes) {
  const myIdSet = new Set(myNotes.map((n) => n.id));

  const mine = myNotes.map((n) => ({
    ...n,
    _owned: true,
    author: currentUser?.username ?? n.author,
  }));

  const others = publicNotes
    .filter((n) => !myIdSet.has(n.id))
    .map((n) => ({ ...n, _owned: false }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return [...mine, ...others];
}

// ---------- Link modal helpers ----------
function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;

  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);

  textarea.value = before + text + after;

  const pos = start + text.length;
  textarea.setSelectionRange(pos, pos);

  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function renderLinkCandidates(q) {
  const query = (q ?? "").trim().toLowerCase();

  const items = linkCandidates
    .filter((x) => x.id !== linkCtx.fromNoteId)
    .filter((x) => !query || x.title.toLowerCase().includes(query))
    .slice(0, 80);

  linkList.innerHTML = "";

  if (items.length === 0) {
    linkList.innerHTML = `<div class="modal-empty">Brak wyników.</div>`;
    return;
  }

  for (const it of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "modal-item";
    btn.innerHTML = `
      <div class="modal-item-title">${escapeHtml(it.title)}</div>
      <div class="modal-item-sub">
        #${it.id}
        ${it.owned ? " • moje" : it.author ? ` • @${escapeHtml(it.author)}` : ""}
        ${it.is_public ? " • publiczna" : " • prywatna"}
      </div>
    `;

    btn.addEventListener("click", () => {
      if (!linkCtx.textarea) return;
      if (typeof linkCtx.ensureEditMode === "function") linkCtx.ensureEditMode();

      insertAtCursor(linkCtx.textarea, `[[#${it.id}]]`);
      closeLinkModal();
    });

    linkList.appendChild(btn);
  }
}

function openLinkModal({ fromNoteId, textarea, ensureEditMode }) {
  linkCtx = { fromNoteId, textarea, ensureEditMode };

  linkModal.classList.remove("hidden");
  linkSearch.value = "";
  linkSearch.focus();

  (async () => {
    if (!currentUser) return;

    if (!linkCandidatesLoaded) {
      const [myNotes, publicNotes] = await Promise.all([api("/api/notes"), api("/api/public/notes")]);

      const merged = mergeAndSortNotes(myNotes, publicNotes);

      linkCandidates = merged
        .filter((x) => x.id !== fromNoteId)
        .map((x) => ({
          id: x.id,
          title: x.title ?? `(bez tytułu)`,
          owned: !!x._owned,
          author: x.author ?? "",
          is_public: !!x.is_public,
        }));

      linkCandidatesLoaded = true;
    }

    renderLinkCandidates("");
  })().catch((err) => {
    console.error(err);
    linkList.innerHTML = `<div class="modal-empty">Nie udało się pobrać notatek do linkowania.</div>`;
  });
}

function closeLinkModal() {
  linkModal.classList.add("hidden");
  linkCtx = { fromNoteId: null, textarea: null, ensureEditMode: null };
}

linkBackdrop.addEventListener("click", () => closeLinkModal());
linkCloseBtn.addEventListener("click", () => closeLinkModal());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !linkModal.classList.contains("hidden")) closeLinkModal();
});
linkSearch.addEventListener("input", () => renderLinkCandidates(linkSearch.value));

// ---------- Reply helper ----------
async function createReply(toNote) {
  if (!currentUser) return (window.location.href = "/login");

  beginLocalMutation(2500);

  const baseTitle = (toNote?.title ?? "Notatka").toString().trim();
  const replyTitle = baseTitle ? `Re: ${baseTitle}` : "Re: Notatka";

  const isPublic = !!toNote?.is_public;

  try {
    const created = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        title: replyTitle,
        content: `[[#${toNote.id}]]\n\n`,
        is_public: isPublic,
      }),
    });

    linkCandidatesLoaded = false;

    notes.unshift({ ...created, _owned: true, author: currentUser.username });
    render();

    openNoteInEdit(created.id);

    const first = notesEl.querySelector(".note");
    if (first) {
      first.querySelector(".toggle")?.click();
      const ta = first.querySelector(".content");
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  } catch (e) {
    if (e.message === "UNAUTHORIZED") return (window.location.href = "/login");
    alert("Nie udało się utworzyć odpowiedzi: " + e.message);
  }
}

// ---------- Main render ----------
function rebuildNoteIndex() {
  noteIndex = new Map();
  for (const n of notes) {
    noteIndex.set(Number(n.id), {
      title: (n.title ?? "").toString(),
      is_public: !!n.is_public,
      owned: !!n._owned,
    });
  }
}

function render() {
  notesEl.innerHTML = "";
  setEmptyState();

  rebuildNoteIndex();

  for (const n of notes) {
    const node = tpl.content.cloneNode(true);

    const card = node.querySelector(".note");
    card.dataset.noteId = n.id;
    card.classList.toggle("owned", !!n._owned);
    card.classList.toggle("public-other", !n._owned && !!n.is_public);

    const toggle = node.querySelector(".toggle");
    const body = node.querySelector(".note-body");

    const title = node.querySelector(".title");
    const content = node.querySelector(".content");
    const preview = node.querySelector(".preview");
    const meta = node.querySelector(".meta");

    const status = node.querySelector(".status");
    const saveBtn = node.querySelector(".save");
    const delBtn = node.querySelector(".delete");

    const isPublicCheckbox = node.querySelector(".is-public");
    const pubSwitch = node.querySelector(".pub-switch");

    const replyBtn = node.querySelector(".replyBtn");
    const previewBtn = node.querySelector(".previewBtn");
    const insertLinkBtn = node.querySelector(".insertLink");

    const backlinksBox = node.querySelector(".backlinks");
    const backlinksList = node.querySelector(".backlinks-list");

    card.id = `note-${n.id}`;

    let expanded = false;
    let dirty = false;
    let previewMode = false;
    let backlinksLoaded = false;

    async function loadBacklinks() {
      if (backlinksLoaded) return;
      backlinksLoaded = true;

      const url = n._owned ? `/api/notes/${n.id}/backlinks` : `/api/public/notes/${n.id}/backlinks`;

      try {
        const items = await api(url);
        if (!items || items.length === 0) {
          backlinksBox.classList.add("hidden");
          return;
        }

        backlinksList.innerHTML = "";
        for (const b of items) {
          const a = document.createElement("a");
          a.className = "backlink";

          const isMineBacklink = !!currentUser && b.author === currentUser.username;
          const blue = n._owned || isMineBacklink;
          if (blue) a.classList.add("blue");

          const inView = noteIndex.has(Number(b.id));
          const internalHref = `#note-${b.id}`;
          const publicHref = `/public/${b.id}`;

          if (n._owned) {
            if (b.is_public) {
              a.href = inView ? internalHref : publicHref;

              const arrow = document.createElement("span");
              arrow.className = "arrow";
              arrow.textContent = "↳";

              const text = document.createElement("span");
              text.textContent = `${b.title} • publiczna`;

              a.appendChild(arrow);
              a.appendChild(text);
            } else {
              a.href = "#";
              a.title = "Prywatna notatka";

              const arrow = document.createElement("span");
              arrow.className = "arrow";
              arrow.textContent = "↳";

              const text = document.createElement("span");
              text.textContent = `${b.title} • prywatna`;

              a.appendChild(arrow);
              a.appendChild(text);
            }
          } else {
            a.href = inView ? internalHref : publicHref;

            const arrow = document.createElement("span");
            arrow.className = "arrow";
            arrow.textContent = "↳";

            const text = document.createElement("span");
            text.textContent = `${b.title} • @${b.author}`;

            a.appendChild(arrow);
            a.appendChild(text);
          }

          backlinksList.appendChild(a);
        }

        bindInternalNoteLinks(backlinksList);
        backlinksBox.classList.remove("hidden");
      } catch {
        backlinksBox.classList.add("hidden");
      }
    }

    const setExpanded = (v) => {
      expanded = v;
      toggle.textContent = expanded ? "▾" : "▸";
      body.classList.toggle("hidden", !expanded);
      if (expanded) loadBacklinks();
    };

    const setStatus = (text, kind = "") => {
      status.textContent = text;
      status.className = "status " + kind;
    };

    const updateMeta = () => {
      if (n._owned) {
        meta.textContent = `#${n.id} • edytowano: ${fmtDate(n.updated_at)} • ${n.is_public ? "publiczna" : "prywatna"}`;
      } else {
        meta.textContent = `@${n.author ?? "anon"} • ${fmtDate(n.updated_at)} • publiczna`;
      }
    };

    const setPreviewMode = (on) => {
      previewMode = on;

      if (previewMode) {
        preview.innerHTML = renderMarkdown(content.value);
        preview.classList.remove("hidden");
        content.classList.add("hidden");
        if (n._owned) previewBtn.textContent = "Edytuj";
        bindInternalNoteLinks(preview);
      } else {
        preview.classList.add("hidden");
        content.classList.remove("hidden");
        previewBtn.textContent = "Podgląd";
      }
    };

    updateMeta();

    title.value = n.title ?? "";
    content.value = n.content ?? "";
    isPublicCheckbox.checked = !!n.is_public;

    if (!currentUser) replyBtn.classList.add("hidden");
    replyBtn.addEventListener("click", () => createReply(n));

    if (!n._owned) {
      title.readOnly = true;
      content.readOnly = true;

      saveBtn.classList.add("hidden");
      delBtn.classList.add("hidden");
      pubSwitch.classList.add("hidden");
      status.classList.add("hidden");

      previewBtn.classList.add("hidden");
      insertLinkBtn.classList.add("hidden");

      setPreviewMode(true);
    } else {
      previewBtn.addEventListener("click", () => setPreviewMode(!previewMode));

      insertLinkBtn.addEventListener("click", () => {
        setExpanded(true);
        const ensureEditMode = () => setPreviewMode(false);
        ensureEditMode();

        openLinkModal({
          fromNoteId: n.id,
          textarea: content,
          ensureEditMode,
        });
      });

      const markDirty = () => {
        dirty = true;
        markDirtyGlobal(n.id);
        setStatus("Niezapisane zmiany", "warn");
        saveBtn.disabled = false;
      };

      title.addEventListener("input", markDirty);
      content.addEventListener("input", () => {
        markDirty();
        if (previewMode) {
          preview.innerHTML = renderMarkdown(content.value);
          bindInternalNoteLinks(preview);
        }
      });
      isPublicCheckbox.addEventListener("change", markDirty);

      saveBtn.disabled = true;

      saveBtn.addEventListener("click", async () => {
        const newTitle = title.value.trim();
        const newContent = content.value;
        const newIsPublic = isPublicCheckbox.checked;

        if (!newTitle) {
          setStatus("Tytuł nie może być pusty", "err");
          title.focus();
          return;
        }

        beginLocalMutation(1500);

        saveBtn.disabled = true;
        setStatus("Zapisywanie…");

        try {
          const updated = await api(`/api/notes/${n.id}`, {
            method: "PUT",
            body: JSON.stringify({
              title: newTitle,
              content: newContent,
              is_public: newIsPublic,
            }),
          });

          n.title = updated.title;
          n.content = updated.content;
          n.updated_at = updated.updated_at;
          n.is_public = updated.is_public ? 1 : 0;

          dirty = false;
          clearDirtyGlobal(n.id);
          updateMeta();
          setStatus("Zapisano ✅", "ok");

          setPreviewMode(true);

          setTimeout(() => {
            if (!dirty) setStatus("");
          }, 1200);
        } catch (e) {
          if (e.message === "UNAUTHORIZED") return (window.location.href = "/login");
          saveBtn.disabled = false;
          setStatus("Błąd zapisu: " + e.message, "err");
        }
      });

      delBtn.addEventListener("click", async () => {
        if (!confirm(`Usunąć notatkę #${n.id}?`)) return;

        beginLocalMutation(1500);

        try {
          await api(`/api/notes/${n.id}`, { method: "DELETE" });
          clearDirtyGlobal(n.id);
          notes = notes.filter((x) => x.id !== n.id);
          render();
        } catch (e) {
          if (e.message === "UNAUTHORIZED") return (window.location.href = "/login");
          setStatus("Błąd usuwania: " + e.message, "err");
        }
      });

      setPreviewMode(true);
    }

    toggle.addEventListener("click", () => setExpanded(!expanded));

    card.addEventListener("click", (ev) => {
      const tag = ev.target.tagName.toLowerCase();
      if (["input", "textarea", "button", "a", "label"].includes(tag)) return;
      setExpanded(true);
    });

    setExpanded(expandAll);
    notesEl.appendChild(node);
  }

  if (sortMode === "custom") initSortableIfNeeded();
  else destroySortable();
}

async function load(q = "") {
  try {
    const url = new URL("/api/feed", window.location.origin);

    if (q) url.searchParams.set("q", q);

    if (typeof sortMode !== "undefined" && sortMode) {
      url.searchParams.set("sort", sortMode);
    }

    notes = await api(url.pathname + url.search);

    notes = notes.map((n) => ({ ...n, _owned: !!n._owned }));

    render();
  } catch (e) {
    if (e.message === "UNAUTHORIZED") {
      currentUser = null;
      setAuthUI();
      stopNotesStream();
      stopFeedStream();
      return load(q);
    }
    throw e;
  }
}

function updateSortButtons() {
  sortDateBtn?.classList.toggle("active", sortMode === "date");
  sortTitleBtn?.classList.toggle("active", sortMode === "title");
  sortCustomBtn?.classList.toggle("active", sortMode === "custom");
}

function setSortMode(mode) {
  sortMode = mode;
  localStorage.setItem("sortMode", sortMode);
  updateSortButtons();

  if (sortMode !== "custom") destroySortable();

  load(searchInput.value.trim());
}

sortDateBtn?.addEventListener("click", () => setSortMode("date"));
sortTitleBtn?.addEventListener("click", () => setSortMode("title"));
sortCustomBtn?.addEventListener("click", () => setSortMode("custom"));

newBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  beginLocalMutation(2500);

  try {
    const created = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Nowa notatka", content: "", is_public: 0 }),
    });

    linkCandidatesLoaded = false;

    notes.unshift({ ...created, _owned: true, author: currentUser.username });
    render();

    requestAnimationFrame(() => {
      const card = document.querySelector(`#note-${created.id}`) || notesEl.querySelector(".note");
      if (!card) return;

      const body = card.querySelector(".note-body");
      const toggle = card.querySelector(".toggle");
      if (body) body.classList.remove("hidden");
      if (toggle) toggle.textContent = "▾";

      const textarea = card.querySelector(".content");
      const preview = card.querySelector(".preview");
      const previewBtn = card.querySelector(".previewBtn");

      if (preview) preview.classList.add("hidden");
      if (textarea) textarea.classList.remove("hidden");
      if (previewBtn) previewBtn.textContent = "Podgląd";

      if (textarea) {
        textarea.focus();
        try {
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        } catch {}
      }

      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  } catch (e) {
    if (e.message === "UNAUTHORIZED") return (window.location.href = "/login");
    alert("Nie udało się utworzyć notatki: " + e.message);
  }
});

function openNoteInEdit(noteId) {
  requestAnimationFrame(() => {
    const card = document.querySelector(`#note-${noteId}`);
    if (!card) return;

    const body = card.querySelector(".note-body");
    const toggle = card.querySelector(".toggle");
    if (body?.classList.contains("hidden")) toggle?.click();

    const textarea = card.querySelector(".content");
    const previewBtn = card.querySelector(".previewBtn");

    if (textarea?.classList.contains("hidden")) {
      previewBtn?.click();
    }

    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      try {
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      } catch {}
    });
  });
}

searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    load(searchInput.value.trim());
  }, 250);
});

toggleAllBtn?.addEventListener("click", () => {
  expandAll = !expandAll;

  toggleAllBtn.textContent = expandAll ? "Zwiń wszystko" : "Rozwiń wszystko";

  const cards = document.querySelectorAll(".note");
  for (const card of cards) {
    const body = card.querySelector(".note-body");
    const toggle = card.querySelector(".toggle");
    if (!body || !toggle) continue;

    body.classList.toggle("hidden", !expandAll);
    toggle.textContent = expandAll ? "▾" : "▸";
  }
});

let sortable = null;
let saveOrderTimer = null;

function destroySortable() {
  if (sortable) {
    try {
      sortable.destroy();
    } catch {}
    sortable = null;
  }
}

function initSortableIfNeeded() {
  if (!currentUser || !window.Sortable) return;
  if (sortMode !== "custom") return;

  destroySortable();

  sortable = new Sortable(notesEl, {
    animation: 150,
    handle: ".note-header",
    draggable: ".note.owned", // tylko moje
    onEnd: () => {
      clearTimeout(saveOrderTimer);
      saveOrderTimer = setTimeout(saveOrder, 250);
    },
  });
}

async function saveOrder() {
  if (!currentUser) return;
  if (sortMode !== "custom") return;

  beginLocalMutation(1200);

  const ids = Array.from(notesEl.querySelectorAll(".note.owned[data-note-id]"))
    .map((el) => Number(el.dataset.noteId))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) return;

  try {
    await api("/api/notes/order", {
      method: "PUT",
      body: JSON.stringify({ order: ids }),
    });
  } catch (e) {
    console.warn("Order save failed:", e.message);
  }
}

// debounce
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

(async () => {
  if (toggleAllBtn) toggleAllBtn.textContent = "Zwiń wszystko";

  await fetchMe();
  ensureFeedStream();
  ensureNotesStream();

  updateSortButtons();
  await load();

  const params = new URLSearchParams(window.location.search);
  const focusId = Number(params.get("focus"));
  if (Number.isInteger(focusId) && focusId > 0) {
    const el = document.getElementById(`note-${focusId}`);
    if (el) {
      const toggle = el.querySelector(".toggle");
      const body = el.querySelector(".note-body");
      if (body && body.classList.contains("hidden") && toggle) toggle.click();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("note-flash");
      setTimeout(() => el.classList.remove("note-flash"), 650);
    }
  }
})().catch((err) => {
  console.error(err);
  alert("Błąd aplikacji: " + err.message);
});
