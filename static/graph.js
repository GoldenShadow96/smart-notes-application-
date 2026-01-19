//graph.js
const graphEl = document.querySelector("#graph");
const fitBtn = document.querySelector("#fitBtn");
const clusterToggleBtn = document.querySelector("#clusterToggleBtn");
const freezeBtn = document.querySelector("#freezeBtn");
const reloadBtn = document.querySelector("#reloadBtn");
const qInput = document.querySelector("#q");

// drawer
const drawer = document.querySelector("#drawer");
const dTitle = document.querySelector("#dTitle");
const dMeta = document.querySelector("#dMeta");
const dClose = document.querySelector("#dClose");

const dOpen = document.querySelector("#dOpen");
const dReply = document.querySelector("#dReply");
const dNew = document.querySelector("#dNew");

const dOwnerActions = document.querySelector("#dOwnerActions");
const dToggleEdit = document.querySelector("#dToggleEdit");
const dSave = document.querySelector("#dSave");
const dDelete = document.querySelector("#dDelete");
const dIsPublic = document.querySelector("#dIsPublic");
const dStatus = document.querySelector("#dStatus");

const dView = document.querySelector("#dView");
const dEdit = document.querySelector("#dEdit");

let network = null;
let dataSetNodes = null;
let dataSetEdges = null;

let clustered = false;
let frozen = true; // start: po stabilizacji zamrażamy (domyślnie ON)
let selected = null; // {id, owned, is_public}

let lastPositions = null; // cache wszystkich pozycji (także ukrytych) do merge przy zapisie

// ------------------------------
// Thread collapse state (per session)
// "children" = odpowiedzi do notatki, czyli krawędzie child(from) -> parent(to)
// ------------------------------
let childrenById = new Map();     // parentId -> [childId, ...]
let collapsed = new Set();        // ids of nodes with collapsed subtree
let hiddenByCollapse = new Set(); // all nodes currently hidden because an ancestor is collapsed

function esc(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderMarkdown(mdText) {
  const text = (mdText ?? "").toString();
  if (!window.marked || !window.DOMPurify) return esc(text).replaceAll("\n", "<br/>");
  const html = window.marked.parse(text, { breaks: true });
  return window.DOMPurify.sanitize(html);
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

// ------------------------------
// Layout persistence (per-user DB / fallback localStorage)
// ------------------------------
let me = null;

async function fetchMe() {
  try {
    const r = await api("/api/auth/me");
    me = r.user; // {id, username}
  } catch {
    me = null;
  }
}

function layoutKeyFor(_q) {
  // Najprościej i najczytelniej: jeden układ na użytkownika
  return "all";
}

function normalizeLayoutPayload(lay) {
  if (!lay || typeof lay !== "object") return { positions: null, collapsed: [] };

  // nowy format
  if (Object.prototype.hasOwnProperty.call(lay, "positions")) {
    return {
      positions: lay.positions && typeof lay.positions === "object" ? lay.positions : null,
      collapsed: Array.isArray(lay.collapsed) ? lay.collapsed : [],
    };
  }

  // stary format: sam obiekt positions
  return { positions: lay, collapsed: [] };
}

async function loadLayout(key) {
  // jeśli zalogowany -> DB
  if (me?.id) {
    const res = await fetch(`/api/graph/layout?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (res.status === 204) return normalizeLayoutPayload(null); // ✅ FIX: zawsze zwracaj znormalizowany obiekt
    if (res.ok) {
      const data = await res.json();
      const lay = data?.layout ?? null;

      // Czasem mysql2 zwraca JSON jako string:
      if (typeof lay === "string") {
        try { return normalizeLayoutPayload(JSON.parse(lay)); } catch { return normalizeLayoutPayload(null); }
      }

      return normalizeLayoutPayload(lay);
    }
    return normalizeLayoutPayload(null);
  }

  // fallback: localStorage
  try {
    const raw = localStorage.getItem(`graphLayout:${key}`);
    return normalizeLayoutPayload(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeLayoutPayload(null);
  }
}

let __saveT = null;

async function saveLayout(key, positions, collapsedArr) {
  if (!positions) return;

  const payload = {
    positions,
    collapsed: Array.isArray(collapsedArr) ? collapsedArr : [],
  };

  if (me?.id) {
    try {
      await api(`/api/graph/layout?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } catch {}
  } else {
    try {
      localStorage.setItem(`graphLayout:${key}`, JSON.stringify(payload));
    } catch {}
  }
}

function saveLayoutDebounced(key) {
  clearTimeout(__saveT);
  __saveT = setTimeout(() => {
    if (!network || clustered) return;

    // pozycje z network (czasem bez hidden nodes)
    const current = network.getPositions();

    // ✅ merge: zachowujemy też pozycje ukrytych (z poprzedniego layoutu)
    const merged = {
      ...(lastPositions && typeof lastPositions === "object" ? lastPositions : {}),
      ...(current && typeof current === "object" ? current : {}),
    };

    // update cache, żeby kolejne zapisy miały pełny stan
    lastPositions = merged;

    saveLayout(key, merged, Array.from(collapsed));
  }, 350);
}


// ------------------------------
// Graph utils
// ------------------------------
function computeComponents(nodes, edges) {
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from).push(e.to);
    adj.get(e.to).push(e.from);
  }

  const comp = new Map();
  let cid = 0;

  for (const n of nodes) {
    if (comp.has(n.id)) continue;
    cid++;
    const stack = [n.id];
    comp.set(n.id, cid);

    while (stack.length) {
      const v = stack.pop();
      for (const u of adj.get(v) ?? []) {
        if (!comp.has(u)) {
          comp.set(u, cid);
          stack.push(u);
        }
      }
    }
  }
  return comp;
}

// ile notatek jest w wątku pod tym node (liczone jako liczba potomków w poddrzewie)
function computeSubtreeSizes(childrenMap) {
  const memo = new Map(); // id -> countDescendants

  function dfs(id, visiting = new Set()) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0; // zabezpieczenie na cykle (na wszelki wypadek)
    visiting.add(id);

    const kids = childrenMap.get(id) ?? [];
    let sum = 0;
    for (const k of kids) sum += 1 + dfs(k, visiting);

    visiting.delete(id);
    memo.set(id, sum);
    return sum;
  }

  // policz dla wszystkich znanych rodziców i dzieci
  const allIds = new Set();
  for (const [p, kids] of childrenMap.entries()) {
    allIds.add(Number(p));
    for (const k of kids) allIds.add(Number(k));
  }
  for (const id of allIds) dfs(id);

  return memo; // map: id -> liczba potomków
}

function sizeStyleForThread(descCount) {
  const t = Math.min(80, Math.max(0, Number(descCount) || 0));

  // szybciej niż sqrt: t^0.6
  const k = Math.pow(t, 1); // 0..~13

  const minW = Math.round(200 + k * 18); // 10->~272, 25->~330, 80->~434
  const maxW = Math.round(290 + k * 24); // 10->~386, 25->~450, 80->~602
  const margin = Math.round(12 + k * 1.4); // 10->~20, 25->~24, 80->~30
  const fontSize = Math.round(14 + k * 0.45); // 10->~17, 25->~19, 80->~20

  return { minW, maxW, margin, fontSize };
}



function buildChildrenIndex(nodes, edges) {
  const nodeSet = new Set(nodes.map(n => Number(n.id)));
  const map = new Map();

  for (const e of edges) {
    const from = Number(e.from);
    const to = Number(e.to);

    if (!nodeSet.has(from) || !nodeSet.has(to)) continue;

    // from = reply, to = parent
    if (!map.has(to)) map.set(to, []);
    map.get(to).push(from);
  }

  return map;
}

function computeHiddenByCollapse() {
  const hidden = new Set();

  const stack = [];
  for (const root of collapsed) stack.push(root);

  while (stack.length) {
    const parent = stack.pop();
    const kids = childrenById.get(parent) ?? [];

    for (const child of kids) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      stack.push(child);
    }
  }

  return hidden;
}

function arrowForNode(id) {
  const kids = childrenById.get(id) ?? [];
  const count = kids.length;
  if (count === 0) return "   "; // brak dzieci => brak strzałki

  const sym = collapsed.has(id) ? "▸" : "▾";
  return `${sym}${count}`; // np. ▾3 albo ▸12
}

function truncate(s, max) {
  const t = (s ?? "").toString().trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

function makeCardLabel(n, arrow = "  ") {
  const title = truncate(n.title || `#${n.id}`, 38);
  const meta =
    `${n.author ? "@" + truncate(n.author, 18) + " • " : ""}` +
    `${n.is_public ? "publiczna" : "prywatna"}${n.owned ? " • moja" : ""}`;

  // ✅ większy snippet => więcej linii => większa wysokość
  const snippet = truncate(
    (n.excerpt ?? "").toString().replace(/\s+/g, " ").trim(),
    560 // było ~120 — podbij do 220–320 zależnie od gustu
  );

  // ✅ dodatkowa pusta linia stabilizuje "wysokość" (działa, bo label ma \n)
  return `${arrow} ${title}\n${meta}\n\n${snippet}`;
}

function applyCollapseVisibility() {
  if (!dataSetNodes || !dataSetEdges) return;

  hiddenByCollapse = computeHiddenByCollapse();

  const allNodes = dataSetNodes.get();
  const nodeUpdates = [];

  for (const n of allNodes) {
    const id = Number(n.id);
    const shouldHide = hiddenByCollapse.has(id);

    nodeUpdates.push({
      id,
      hidden: shouldHide,
      label: makeCardLabel(n, arrowForNode(id)),

      // ✅ zachowaj kolory
      color: n.color,
      shadow: n.shadow,
      shapeProperties: n.shapeProperties,
      font: n.font,
      widthConstraint: n.widthConstraint,
      margin: n.margin,
      shape: n.shape,
    });
  }

  dataSetNodes.update(nodeUpdates);

  const allEdges = dataSetEdges.get();
  const edgeUpdates = allEdges.map((e) => {
    const from = Number(e.from);
    const to = Number(e.to);
    const hide = hiddenByCollapse.has(from) || hiddenByCollapse.has(to);
    return { id: e.id, hidden: hide };
  });

  dataSetEdges.update(edgeUpdates);
}

async function fetchGraph(q = "") {
  const url = q ? `/api/graph?q=${encodeURIComponent(q)}` : "/api/graph";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Graph API: ${res.status}`);
  return res.json(); // { nodes, edges }
}

function setClusterBtnLabel() {
  clusterToggleBtn.textContent = clustered ? "Klastry: ON" : "Klastry: OFF";
}

function setFreezeBtnLabel() {
  freezeBtn.textContent = frozen ? "Zamroź: ON" : "Zamroź: OFF";
}

function setPhysics(enabled) {
  if (!network) return;
  network.setOptions({ physics: { enabled } });
}

function fit() {
  if (!network) return;
  network.fit({ animation: { duration: 300 } });
}

function applyClustering() {
  if (!network || !dataSetNodes) return;

  const allNodes = dataSetNodes.get();
  const byGroup = new Map();
  for (const n of allNodes) {
    const g = n.group ?? 0;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(n.id);
  }

  for (const [g, ids] of byGroup.entries()) {
    if (ids.length <= 1) continue;

    network.cluster({
      joinCondition: (nodeOptions) => nodeOptions.group === g,
      clusterNodeProperties: {
        id: `cluster-${g}`,
        label: `Klaster ${g}\n(${ids.length})`,
        shape: "box",
        margin: 14,
        widthConstraint: { minimum: 200, maximum: 260 },
        shapeProperties: { borderRadius: 16 },
        color: {
          background: "rgba(15,22,34,0.92)",
          border: "rgba(255,255,255,0.18)",
          highlight: { background: "rgba(15,22,34,0.98)", border: "rgba(255,255,255,0.30)" },
          hover: { background: "rgba(15,22,34,0.98)", border: "rgba(255,255,255,0.25)" },
        },
        font: {
          size: 15,
          color: "#e7eefc",
          align: "left",
          strokeWidth: 2,
          strokeColor: "rgba(11,15,23,0.65)",
        },
        shadow: {
          enabled: true,
          color: "rgba(0,0,0,0.35)",
          size: 14,
          x: 0,
          y: 7,
        },
      },
    });
  }
}

async function toggleClusteringImpl() {
  clustered = !clustered;
  setClusterBtnLabel();

  if (!clustered) {
    await build();
    fit();
    return;
  }

  applyClustering();
  fit();
}

// ------------------------------
// Drawer: zachowanie jak index.html
// ------------------------------
function setDrawerStatus(text, kind = "") {
  dStatus.textContent = text;
  dStatus.className = "status " + kind;
}

function forceEditMode() {
  dEdit.classList.remove("hidden");
  dView.classList.add("hidden");
  dToggleEdit.textContent = "Podgląd";
  dEdit.focus();
  try {
    dEdit.setSelectionRange(dEdit.value.length, dEdit.value.length);
  } catch {}
}

async function createNewNoteAndOpen() {
  try {
    if (network) network.setOptions({ physics: { enabled: false } });

    const created = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Nowa notatka", content: "", is_public: 0 }),
    });

    await build();

    network.selectNodes([created.id]);
    network.focus(created.id, { animation: { duration: 250 }, scale: 1.1 });

    const newNode = dataSetNodes?.get(created.id);
    await loadNoteDetails({
      id: created.id,
      owned: true,
      is_public: !!created.is_public,
      title: newNode?.title ?? created.title ?? `#${created.id}`,
    });

    forceEditMode();

    if (frozen && network) network.setOptions({ physics: { enabled: false } });
  } catch (e) {
    if (e.message === "UNAUTHORIZED") return alert("Zaloguj się, aby tworzyć notatki.");
    alert("Nie udało się utworzyć notatki: " + e.message);
  }
}

async function loadNoteDetails(node) {
  selected = node;

  setDrawerStatus("");
  dOwnerActions.classList.toggle("hidden", !node.owned);

  const titleFallback = `#${node.id}`;
  dTitle.textContent = node.title ? node.title : titleFallback;

  dToggleEdit.onclick = null;
  dSave.onclick = null;
  dDelete.onclick = null;
  dEdit.oninput = null;
  dIsPublic.onchange = null;

  dSave.disabled = true;

  let dirty = false;
  let saving = false;

  const setSaveEnabled = (enabled) => {
    dSave.disabled = !enabled;
  };

  const markDirty = () => {
    if (!node.owned) return;
    if (saving) return;
    dirty = true;
    setDrawerStatus("Niezapisane zmiany", "warn");
    setSaveEnabled(true);
  };

  const clearStatusLater = () => {
    setTimeout(() => {
      if (!dirty && !saving) setDrawerStatus("");
    }, 1200);
  };

  try {
    const url = node.owned ? `/api/notes/${node.id}` : `/api/public/notes/${node.id}`;
    const note = await api(url);

    dTitle.textContent = note.title ?? titleFallback;
    dMeta.textContent = `${note.author ? "@" + note.author + " • " : ""}${new Date(note.updated_at).toLocaleString()} • ${
      note.is_public ? "publiczna" : "prywatna"
    }${node.owned ? " • moja" : ""}`;

    dView.innerHTML = renderMarkdown(note.content ?? "");

    dEdit.value = (note.content ?? "").toString();
    dIsPublic.checked = !!note.is_public;

    dEdit.classList.add("hidden");
    dView.classList.remove("hidden");
    dToggleEdit.textContent = "Edytuj";

    dirty = false;
    saving = false;
    setSaveEnabled(false);
    setDrawerStatus("");

    dOpen.onclick = () => (window.location.href = `/?focus=${encodeURIComponent(node.id)}`);

    dReply.onclick = async () => {
      try {
        const baseTitle = (note.title ?? "Notatka").toString().trim();
        const replyTitle = baseTitle ? `Re: ${baseTitle}` : "Re: Notatka";
        const isPublic = !!note.is_public;

        const targetId = node.id;

        if (network) network.setOptions({ physics: { enabled: false } });

        const created = await api("/api/notes", {
          method: "POST",
          body: JSON.stringify({
            title: replyTitle,
            content: `[[#${targetId}]]\n\n`,
            is_public: isPublic,
          }),
        });

        await build();

        network.selectNodes([created.id]);
        network.focus(created.id, { animation: { duration: 250 }, scale: 1.1 });

        const newNode = dataSetNodes?.get(created.id);
        await loadNoteDetails({
          id: created.id,
          owned: true,
          is_public: !!created.is_public,
          title: newNode?.title ?? created.title ?? `#${created.id}`,
        });

        forceEditMode();

        if (frozen && network) network.setOptions({ physics: { enabled: false } });
      } catch (e) {
        if (e.message === "UNAUTHORIZED") return alert("Zaloguj się, aby odpowiadać.");
        alert("Nie udało się utworzyć odpowiedzi: " + e.message);
      }
    };

    dNew.onclick = () => createNewNoteAndOpen();

    if (node.owned) {
      dToggleEdit.onclick = () => {
        const editing = !dEdit.classList.contains("hidden");
        if (editing) {
          dView.innerHTML = renderMarkdown(dEdit.value);
          dEdit.classList.add("hidden");
          dView.classList.remove("hidden");
          dToggleEdit.textContent = "Edytuj";
        } else {
          dEdit.classList.remove("hidden");
          dView.classList.add("hidden");
          dToggleEdit.textContent = "Podgląd";
          dEdit.focus();
        }
      };

      dEdit.oninput = () => {
        markDirty();
        if (!dView.classList.contains("hidden")) {
          dView.innerHTML = renderMarkdown(dEdit.value);
        }
      };

      dIsPublic.onchange = () => {
        markDirty();
      };

      dSave.onclick = async () => {
        if (!dirty || saving) return;

        const newTitle = (note.title ?? "").toString().trim() || "Notatka";
        const newContent = dEdit.value;
        const newIsPublic = !!dIsPublic.checked;

        saving = true;
        setSaveEnabled(false);
        setDrawerStatus("Zapisywanie…");

        try {
          const updated = await api(`/api/notes/${node.id}`, {
            method: "PUT",
            body: JSON.stringify({
              title: newTitle,
              content: newContent,
              is_public: newIsPublic,
            }),
          });

          dirty = false;
          saving = false;

          setDrawerStatus("Zapisano ✅", "ok");
          setSaveEnabled(false);
          clearStatusLater();

          await build();
          fit();

          note.title = updated.title;
          note.is_public = updated.is_public;
          note.updated_at = updated.updated_at;

          dMeta.textContent = `${note.author ? "@" + note.author + " • " : ""}${new Date(note.updated_at).toLocaleString()} • ${
            note.is_public ? "publiczna" : "prywatna"
          } • moja`;

          dView.innerHTML = renderMarkdown(dEdit.value);
          dEdit.classList.add("hidden");
          dView.classList.remove("hidden");
          dToggleEdit.textContent = "Edytuj";
        } catch (e) {
          saving = false;
          setDrawerStatus("Błąd zapisu: " + e.message, "err");
          setSaveEnabled(true);
        }
      };

      dDelete.onclick = async () => {
        if (!confirm(`Usunąć notatkę #${node.id}?`)) return;
        try {
          await api(`/api/notes/${node.id}`, { method: "DELETE" });
          setDrawerStatus("Usunięto ✅", "ok");
          setSaveEnabled(false);

          await build();
          fit();

          selected = null;
          dTitle.textContent = "Kliknij notatkę na grafie";
          dMeta.textContent = "";
          dView.innerHTML = "";
          dEdit.value = "";
          dOwnerActions.classList.add("hidden");
        } catch (e) {
          setDrawerStatus("Błąd usuwania: " + e.message, "err");
        }
      };
    }
  } catch (e) {
    dView.innerHTML = `<div class="auth-error">Nie udało się załadować notatki: ${esc(e.message)}</div>`;
  }
}

// ------------------------------
// BUILD GRAPH (with layout restore/save)
// ------------------------------
async function build() {
  const q = (qInput.value ?? "").trim();
  const payload = await fetchGraph(q);

  // children index (reply->parent)
  childrenById = buildChildrenIndex(payload.nodes, payload.edges);

  const subtreeSizes = computeSubtreeSizes(childrenById); // id -> liczba potomków

  // layout: per-user (DB) lub localStorage
  const layoutKey = layoutKeyFor(q);
  const savedLayoutObj = await loadLayout(layoutKey); // {positions, collapsed}
  const savedPositions = savedLayoutObj?.positions ?? null;

  // ✅ ustaw cache pozycji od razu po wczytaniu (żeby merge miał bazę)
  lastPositions = savedPositions && typeof savedPositions === "object" ? savedPositions : null;

  collapsed = new Set(
    (savedLayoutObj?.collapsed ?? [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
  );

  const useLayout = !!savedPositions && !clustered;

  // normalizacja 0/1 przychodzących jako number/string/bool
  const toBool01 = (v) => v === true || v === 1 || v === "1";

  const nodes = payload.nodes.map((raw) => {
    const owned = toBool01(raw.owned);
    const is_public = toBool01(raw.is_public);
    const isOtherPublic = !owned && is_public;

    const n = {
      id: Number(raw.id),
      title: raw.title ?? "",
      is_public,
      owned,
      author: raw.author ?? "",
      excerpt: raw.excerpt ?? "",
    };

    const descCount = subtreeSizes.get(Number(raw.id)) ?? 0;
    const sz = sizeStyleForThread(descCount);

    const node = {
  ...n,

  // --- LABEL ---
  baseLabel: makeCardLabel(n, " "),
  label: makeCardLabel(n, arrowForNode(Number(raw.id))),

  // --- SHAPE ---
  shape: "box",

  // 🔹 skalowanie paddingu
  margin: sz.margin,

  // 🔹 skalowanie szerokości (to faktycznie powiększa node)
  widthConstraint: {
    minimum: sz.minW,
    maximum: sz.maxW,
  },

  // --- KOLORY (BEZ ZMIAN) ---
  color: owned
    ? {
        background: "rgba(20,30,46,0.96)",
        border: "rgba(106,167,255,0.40)",
        highlight: { background: "rgba(20,30,46,0.99)", border: "rgba(106,167,255,0.70)" },
        hover: { background: "rgba(20,30,46,0.99)", border: "rgba(106,167,255,0.55)" },
      }
    : isOtherPublic
    ? {
        background: "rgba(10,14,22,0.82)",
        border: "rgba(255,255,255,0.10)",
        highlight: { background: "rgba(10,14,22,0.90)", border: "rgba(255,255,255,0.20)" },
        hover: { background: "rgba(10,14,22,0.90)", border: "rgba(255,255,255,0.16)" },
      }
    : {
        background: "rgba(18,26,39,0.88)",
        border: "rgba(255,255,255,0.14)",
        highlight: { background: "rgba(18,26,39,0.96)", border: "rgba(255,255,255,0.28)" },
        hover: { background: "rgba(18,26,39,0.96)", border: "rgba(255,255,255,0.22)" },
      },

  // --- FONT (tylko size się skaluje) ---
  font: {
    size: sz.fontSize,
    color: "#e7eefc",
    face: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    align: "left",
    strokeWidth: 2,
    strokeColor: "rgba(11,15,23,0.65)",
  },

  // --- CIEŃ / ZAOKRĄGLENIA ---
  shadow: {
    enabled: true,
    color: "rgba(0,0,0,0.35)",
    size: 12,
    x: 0,
    y: 6,
  },

  shapeProperties: {
    borderRadius: 14,
  },
};


    // wstrzyknięcie zapisanego layoutu (x,y)
    if (useLayout) {
      const p = savedPositions?.[String(n.id)];
      if (p && typeof p.x === "number" && typeof p.y === "number") {
        node.x = p.x;
        node.y = p.y;
      }
    }

    return node;
  });

  const ownedById = new Map(nodes.map((n) => [n.id, n.owned]));

  const edges = payload.edges.map((e) => {
    const from = Number(e.from);
    const to = Number(e.to);

    const fromOwned = ownedById.get(from) === true;
    const toOwned = ownedById.get(to) === true;

    const highlight = fromOwned || toOwned;

    return {
      from,
      to,
      color: { color: highlight ? "rgba(106,167,255,0.55)" : "rgba(255,255,255,0.14)" },
      width: highlight ? 2 : 1,
    };
  });

  const compMap = computeComponents(nodes, edges);
  for (const n of nodes) n.group = compMap.get(n.id) ?? 0;

  dataSetNodes = new vis.DataSet(nodes);
  dataSetEdges = new vis.DataSet(edges);

  // zastosuj aktualny stan zwinięć
  applyCollapseVisibility();

  const data = { nodes: dataSetNodes, edges: dataSetEdges };

  const options = {
    physics: {
      enabled: useLayout ? false : true,
      solver: "forceAtlas2Based",
      forceAtlas2Based: {
        gravitationalConstant: -45,
        centralGravity: 0.012,
        springLength: 160,
        springConstant: 0.08,
        damping: 0.65,
        avoidOverlap: 1,
      },
      stabilization: { iterations: 160 },
    },
    interaction: {
      hover: true,
      multiselect: false,
      keyboard: true,
      dragNodes: true,
    },
    nodes: {
      font: {
        size: 14,
        color: "#e7eefc",
        face: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        align: "left",
        strokeWidth: 2,
        strokeColor: "rgba(11,15,23,0.65)",
      },
      borderWidth: 1,
    },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.6 } },
      smooth: { type: "dynamic" },
    },
  };

  network = new vis.Network(graphEl, data, options);

  // ✅ FIX: NIE zapisuj layoutu po stabilizacji (to potrafi zapisać losowy układ).
  network.once("stabilizationIterationsDone", () => {
    if (frozen) setPhysics(false);
    // saveLayoutDebounced(layoutKey); // ❌ usunięte
  });

  // ✅ zapis tylko po realnym przesunięciu node'ów
  network.on("dragEnd", () => saveLayoutDebounced(layoutKey));

  network.on("click", (params) => {
    const id = params?.nodes?.[0];
    if (!id) return;
    if (String(id).startsWith("cluster-")) return;

    const n = dataSetNodes.get(id);
    if (!n) return;

    const nid = Number(id);
    const hasKids = (childrenById.get(nid) ?? []).length > 0;

    const src = params?.event?.srcEvent;
    if (hasKids && src?.shiftKey) {
      if (collapsed.has(nid)) collapsed.delete(nid);
      else collapsed.add(nid);

      applyCollapseVisibility();

      const layoutKeyNow = layoutKeyFor((qInput.value ?? "").trim());
      saveLayoutDebounced(layoutKeyNow);

      network.unselectAll();
      return;
    }

    try {
      const box = network.getBoundingBox(nid);
      const p = params.pointer?.canvas;

      if (hasKids && box && p) {
        const arrowZone =
          p.x >= box.left && p.x <= box.left + 60 &&
          p.y >= box.top  && p.y <= box.top  + 44;

        if (arrowZone) {
          if (collapsed.has(nid)) collapsed.delete(nid);
          else collapsed.add(nid);

          applyCollapseVisibility();

          const layoutKeyNow = layoutKeyFor((qInput.value ?? "").trim());
          saveLayoutDebounced(layoutKeyNow);

          network.unselectAll();
          return;
        }
      }
    } catch (e) {
      console.warn("[graph] arrowZone error:", e);
    }

    loadNoteDetails({ id: n.id, owned: !!n.owned, is_public: !!n.is_public, title: n.title });
  });

  if (clustered) applyClustering();
  setClusterBtnLabel();
  setFreezeBtnLabel();

  if (!frozen) setPhysics(true);
}

// ------------------------------
// UI events
// ------------------------------
reloadBtn.addEventListener("click", () => {
  build().then(fit).catch((err) => alert("Błąd grafu: " + err.message));
});

fitBtn.addEventListener("click", fit);

clusterToggleBtn.addEventListener("click", () => {
  toggleClusteringImpl().catch((err) => alert("Błąd klastrów: " + err.message));
});

freezeBtn.addEventListener("click", () => {
  frozen = !frozen;
  setFreezeBtnLabel();
  setPhysics(!frozen);
});

qInput.addEventListener("input", () => {
  clearTimeout(window.__gdeb);
  window.__gdeb = setTimeout(() => reloadBtn.click(), 250);
});

dClose.addEventListener("click", () => {
  selected = null;
  dTitle.textContent = "Kliknij notatkę na grafie";
  dMeta.textContent = "";
  dView.innerHTML = "";
  dEdit.value = "";
  dOwnerActions.classList.add("hidden");
  setDrawerStatus("");
  dSave.disabled = true;
});

// ------------------------------
// Init
// ------------------------------
setClusterBtnLabel();
setFreezeBtnLabel();

(async () => {
  await fetchMe();
  await build();
  dNew.onclick = () => createNewNoteAndOpen();
  fit();
})().catch((err) => {
  console.error(err);
  alert("Błąd grafu: " + err.message);
});
