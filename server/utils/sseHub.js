// server/utils/sseHub.js
const clientsByUser = new Map(); // userId -> Set(res)
const allClients = new Set();    // wszyscy klienci (do broadcastu)

function isValidUserId(x) {
  const n = Number(x);
  return Number.isInteger(n) && n > 0;
}

export function sseAddClient(userId, res) {
  // do broadcastu zawsze
  allClients.add(res);

  // do per-user tylko jeśli mamy userId
  if (isValidUserId(userId)) {
    const uid = Number(userId);
    let set = clientsByUser.get(uid);
    if (!set) {
      set = new Set();
      clientsByUser.set(uid, set);
    }
    set.add(res);
  }
}

export function sseRemoveClient(userId, res) {
  allClients.delete(res);

  if (isValidUserId(userId)) {
    const uid = Number(userId);
    const set = clientsByUser.get(uid);
    if (set) {
      set.delete(res);
      if (set.size === 0) clientsByUser.delete(uid);
    }
  }
}

export function sseSend(userId, event, payload) {
  if (!isValidUserId(userId)) return;
  const uid = Number(userId);
  const set = clientsByUser.get(uid);
  if (!set || set.size === 0) return;

  const msg = `event: ${event}\n` + `data: ${JSON.stringify(payload ?? null)}\n\n`;
  for (const res of set) {
    try { res.write(msg); } catch {}
  }
}

export function sseBroadcast(event, payload) {
  if (allClients.size === 0) return;

  const msg = `event: ${event}\n` + `data: ${JSON.stringify(payload ?? null)}\n\n`;
  for (const res of allClients) {
    try { res.write(msg); } catch {}
  }
}
