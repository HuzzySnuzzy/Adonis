'use strict';
/** Routes: banden importeren met foto's van de labels (zie tyre-photos.js). Vóór /bandenhotel/:id geregistreerd. */
const express = require('express');
const auth = require('./auth');
const events = require('./events');
const importer = require('./import');
const tyrePhotos = require('./tyre-photos');

module.exports = function register(app, { flash }) {
  const res0 = (req) => req.res.locals.feat || {};
  /* ================= Banden importeren met foto's van de labels ================= */
  const tpOn = (req) => { const F = res0(req); return F.ai && F.bandenhotel; };
  app.get('/bandenhotel/foto-import', (req, res) => {
    if (!tpOn(req)) return res.redirect('/bandenhotel');
    res.render('tyre-photo-import', { title: "Banden importeren met foto's", item: null, aiConfigured: importer.isConfigured(), canAi: req.user.can_ai, max: tyrePhotos.MAX_PHOTOS,
      locaties: require('./inventory').distinct('tyre_storage', 'locatie', "AND soort = 'klant'") });
  });
  app.post('/bandenhotel/foto-import', auth.requireAi, express.json({ limit: '60mb' }), (req, res) => {
    if (!tpOn(req)) return res.status(404).json({ error: 'Niet beschikbaar.' });
    let id;
    try { id = tyrePhotos.create({ images: (req.body || {}).images, effort: (req.body || {}).effort, userId: req.user.id }); } catch (err) {
      if (!(err instanceof tyrePhotos.TyrePhotoError)) throw err;
      return res.status(400).json({ error: err.message });
    }
    tyrePhotos.run(id);
    res.json({ ok: true, id, url: `/bandenhotel/foto-import/${id}` });
  });
  app.get('/bandenhotel/foto-import/:id/status', (req, res) => res.set('Cache-Control', 'no-store').json(tyrePhotos.status(Number(req.params.id)) || { status: 'weg' }));
  app.get('/bandenhotel/foto-import/kenteken', (req, res) => {
    const m = tyrePhotos.match({ kenteken: String(req.query.kenteken || ''), naam: String(req.query.naam || '') });
    res.json(m);
  });
  app.get('/bandenhotel/foto-import/:id/foto/:n', (req, res) => {
    const buf = tyrePhotos.image(Number(req.params.id), Number(req.params.n), req.query.klein === '1');
    if (!buf) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).send(buf);
  });
  app.get('/bandenhotel/foto-import/:id', (req, res) => {
    const item = tyrePhotos.get(Number(req.params.id));
    if (!item || item.status === 'verwerkt') return res.redirect('/bandenhotel/foto-import');
    res.render('tyre-photo-import', { title: "Banden importeren met foto's", item, aiConfigured: importer.isConfigured(), canAi: req.user.can_ai, max: tyrePhotos.MAX_PHOTOS,
      locaties: require('./inventory').distinct('tyre_storage', 'locatie', "AND soort = 'klant'") });
  });
  app.post('/bandenhotel/foto-import/:id', (req, res) => {
    const id = Number(req.params.id);
    const rows = Object.values((req.body && req.body.r) || {}).filter((r) => r && r.mee === 'on');
    if (!rows.length) { flash(req, 'err', 'Vink eerst aan welke sets u wilt toevoegen.'); return res.redirect(`/bandenhotel/foto-import/${id}`); }
    try {
      const r = tyrePhotos.apply(id, rows, { locatie: req.body.locatie, userId: req.user.id });
      events.broadcast({ type: 'data', area: 'banden', by: req.user.name, byId: req.user.id });
      flash(req, 'ok', `${r.ids.length} set${r.ids.length === 1 ? '' : 's'} toegevoegd aan het bandenhotel${r.nieuw ? `; ${r.nieuw} nieuwe klant${r.nieuw === 1 ? '' : 'en'} toegevoegd aan Klanten` : ''}.`);
      res.redirect(`/bandenhotel?bijgewerkt=${r.ids.join(',')}`);
    } catch (err) {
      if (!(err instanceof tyrePhotos.TyrePhotoError)) throw err;
      flash(req, 'err', err.message); res.redirect('/bandenhotel/foto-import');
    }
  });
  app.post('/bandenhotel/foto-import/:id/annuleren', (req, res) => {
    tyrePhotos.remove(Number(req.params.id));
    res.redirect('/bandenhotel');
  });

};
