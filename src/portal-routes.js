'use strict';
/**
 * Pagina's van het Portaal: mappen met snelkoppelingen naar websites.
 */
const express = require('express');
const events = require('./events');
const portal = require('./portal');

module.exports = function register(app, { flash, wrap }) {
  const announce = (req) => events.broadcast({ type: 'data', area: 'portaal', by: req.user.name, byId: req.user.id });
  const wantsJson = (req) => (req.get('accept') || '').includes('application/json');
  // Ophalen van naam/pictogram even afwachten (dan staat het er meteen), maar nooit langer dan 10 seconden.
  const settle = (p) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
  const fail = (req, res, err, to = '/portaal') => {
    if (!(err instanceof portal.PortalError)) throw err;
    if (wantsJson(req)) return res.status(400).json({ error: err.message });
    flash(req, 'err', err.message);
    res.redirect(to);
  };

  app.get('/portaal', (req, res) => {
    res.render('portal', { title: 'Portaal', folders: portal.listAll(), colorIndex: portal.colorIndex, hostTitle: portal.hostTitle });
  });

  /* ----- mappen ----- */
  app.post('/portaal/map', (req, res) => {
    try {
      const id = portal.addFolder(req.body.name);
      announce(req);
      res.redirect(`/portaal?bewerken=1#map-${id}`);
    } catch (err) { fail(req, res, err, '/portaal?bewerken=1'); }
  });
  app.post('/portaal/map/:id/naam', (req, res) => {
    try {
      portal.renameFolder(req.params.id, req.body.name);
      announce(req);
      res.redirect(`/portaal?bewerken=1#map-${req.params.id}`);
    } catch (err) { fail(req, res, err, '/portaal?bewerken=1'); }
  });
  app.post('/portaal/map/:id/verwijderen', (req, res) => {
    const f = portal.getFolder(req.params.id);
    if (f) { portal.deleteFolder(f.id); announce(req); flash(req, 'ok', `Map "${f.name}" is verwijderd.`); }
    res.redirect('/portaal?bewerken=1');
  });
  for (const [dir, step] of [['omhoog', -1], ['omlaag', 1]]) {
    app.post(`/portaal/map/:id/${dir}`, (req, res) => {
      portal.moveFolder(req.params.id, step);
      announce(req);
      res.redirect(`/portaal?bewerken=1#map-${req.params.id}`);
    });
  }

  /* ----- snelkoppelingen ----- */
  app.post('/portaal/map/:id/link', wrap(async (req, res) => {
    try {
      const r = portal.addLink(req.params.id, { url: req.body.url, title: req.body.title }, req.user.id);
      if (!r.duplicate) await settle(portal.fetchMeta(r.id));
      announce(req);
      if (wantsJson(req)) return res.json({ ok: true, id: r.id, duplicate: r.duplicate });
      if (r.duplicate) flash(req, 'ok', 'Deze website stond al in deze map.');
      res.redirect(`/portaal?bewerken=1#link-${r.id}`);
    } catch (err) { fail(req, res, err, `/portaal?bewerken=1#map-${req.params.id}`); }
  }));
  app.post('/portaal/link/:id', wrap(async (req, res) => {
    try {
      const r = portal.updateLink(req.params.id, { title: req.body.title, url: req.body.url, folderId: req.body.folder });
      if (r.urlChanged || req.body.icoon === '1') await settle(portal.fetchMeta(Number(req.params.id), { force: true }));
      announce(req);
      if (wantsJson(req)) return res.json({ ok: true });
      res.redirect(`/portaal?bewerken=1#link-${req.params.id}`);
    } catch (err) { fail(req, res, err, '/portaal?bewerken=1'); }
  }));
  app.post('/portaal/link/:id/verwijderen', (req, res) => {
    portal.deleteLink(req.params.id);
    announce(req);
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect('/portaal?bewerken=1');
  });
  // Slepen: nieuwe volgorde (en eventueel een andere map).
  app.post('/portaal/volgorde', express.json({ limit: '200kb' }), (req, res) => {
    portal.reorder(req.body && req.body.folders);
    announce(req);
    res.json({ ok: true });
  });

  /* ----- importeren: snelkoppelingen (.url) van het bureaublad of bladwijzers uit de browser ----- */
  app.post('/portaal/importeren', express.json({ limit: '2mb' }), (req, res) => {
    const body = req.body || {};
    const groups = Array.isArray(body.folders) ? body.folders.slice(0, 200) : [];
    const target = body.folderId && portal.getFolder(body.folderId) ? Number(body.folderId) : null;
    let added = 0; let dup = 0; let bad = 0;
    const ids = [];
    for (const g of groups) {
      const links = Array.isArray(g && g.links) ? g.links.slice(0, 1000) : [];
      if (!links.length) continue;
      const fid = target || portal.findOrAddFolder(g.name);
      for (const l of links) {
        try {
          const r = portal.addLink(fid, { url: l && l.url, title: l && l.title }, req.user.id);
          if (r.duplicate) dup++; else { added++; ids.push(r.id); }
        } catch { bad++; }
        if (added + dup + bad >= 2000) break;
      }
    }
    announce(req);
    // Pictogrammen op de achtergrond; als alles klaar is, zien collega's (en dit scherm) ze verschijnen.
    portal.enqueue(ids, () => events.broadcast({ type: 'data', area: 'portaal' })); // zonder afzender: ook dit scherm ververst
    res.json({ ok: true, added, dup, bad });
  });

  /* ----- pictogrammen ----- */
  app.get('/portaal/icoon/:id', (req, res) => {
    const l = portal.getLink(req.params.id);
    const p = portal.iconPath(l);
    if (!p) {
      if (l && l.icon_status === 'ok') portal.enqueue([l.id]); // bestand kwijt (bijv. na een backup): opnieuw ophalen
      return res.status(404).end();
    }
    const type = { png: 'image/png', ico: 'image/x-icon', gif: 'image/gif', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[p.split('.').pop()];
    // Ook een SVG van een vreemde website mag hier nooit scripts uitvoeren.
    res.set({ 'Content-Type': type || 'application/octet-stream', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=604800' });
    res.sendFile(p);
  });

  // Na het starten: ontbrekende pictogrammen (nieuwe import, teruggezette backup) rustig aanvullen.
  setTimeout(() => {
    try { portal.enqueue(portal.repairMissing(), () => events.broadcast({ type: 'data', area: 'portaal' })); } catch { /* volgende start */ }
  }, 30 * 1000).unref();
};
