'use strict';
/**
 * Live bijwerken: elk geopend scherm houdt een verbinding open (Server-Sent Events) en krijgt
 * een seintje als een werkopdracht is aangemaakt, gewijzigd of verwijderd.
 */
const clients = new Set();

function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: niet bufferen
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n'); // na een herstart/update binnen 5 s opnieuw verbinden
  const client = { res, userId: req.user.id };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    try { c.res.write(data); } catch { clients.delete(c); }
  }
}

// Houdt verbindingen open achter proxies die stille verbindingen afsluiten.
setInterval(() => {
  for (const c of clients) {
    try { c.res.write(': ping\n\n'); } catch { clients.delete(c); }
  }
}, 25000).unref();

function count() {
  return clients.size;
}

module.exports = { subscribe, broadcast, count };
