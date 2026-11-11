'use strict';
/**
 * Wie heeft welke werkopdracht open, en in welk veld zit diegene? Alleen in het geheugen: na een herstart melden
 * de schermen zich vanzelf opnieuw (elke 20 seconden). Per tabblad, zodat twee vensters van één persoon allebei tellen.
 */
const events = require('./events');

const STALE_MS = 50 * 1000;
const orders = new Map(); // orderId -> Map(tab -> { userId, name, field, t })

function list(orderId) {
  const m = orders.get(Number(orderId));
  return m ? [...m.entries()].map(([tab, p]) => ({ tab, userId: p.userId, name: p.name, field: p.field })) : [];
}
function announce(orderId) {
  events.broadcast({ type: 'order-presence', id: Number(orderId), people: list(orderId) });
}
/** Een scherm meldt zich (of geeft een ander veld door); gone: het scherm gaat weg. */
function update(orderId, user, { tab, field, gone }) {
  const id = Number(orderId);
  tab = String(tab || '').slice(0, 40);
  if (!id || !tab) return [];
  field = String(field || '').slice(0, 120);
  let m = orders.get(id);
  const before = m && m.get(tab);
  if (gone) {
    if (m && m.delete(tab)) { if (!m.size) orders.delete(id); announce(id); }
    return list(id);
  }
  if (!m) { m = new Map(); orders.set(id, m); }
  m.set(tab, { userId: user.id, name: user.name, field, t: Date.now() });
  if (!before || before.field !== field) announce(id);
  return list(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, m] of orders) {
    let changed = false;
    for (const [tab, p] of m) if (now - p.t > STALE_MS) { m.delete(tab); changed = true; }
    if (!m.size) orders.delete(id);
    if (changed) announce(id);
  }
}, 10 * 1000).unref();

module.exports = { update, list };
