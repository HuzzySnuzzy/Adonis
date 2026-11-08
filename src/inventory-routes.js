'use strict';
/**
 * Pagina's voor het bandenhotel, de voorraad en de Excel-import.
 */
const express = require('express');
const { db, plateKey } = require('./db');
const auth = require('./auth');
const inv = require('./inventory');
const sheets = require('./sheet-import');
const importer = require('./import');
const events = require('./events');
const orders = require('./orders');
const photos = require('./photos');
const carimage = require('./carimage');

module.exports = function register(app, { flash, wrap }) {
  const announce = (req, area, extra = {}) =>
    events.broadcast({ type: 'data', area, by: req.user.name, byId: req.user.id, ...extra });
  const notFound = (res, what) => res.status(404).render('error', { title: 'Niet gevonden', message: `${what} bestaat niet (meer).` });
  const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

  /* ================= bandenhotel ================= */
  app.get('/bandenhotel', (req, res) => {
    const soort = inv.TYRE_SOORTEN[req.query.soort] ? req.query.soort : 'klant';
    const q = String(req.query.q || '').trim();
    const status = ['opgeslagen', 'op_auto', 'uitgegeven', 'alle'].includes(req.query.status) ? req.query.status : 'opgeslagen';
    const seizoen = String(req.query.seizoen || '');
    const locatie = String(req.query.locatie || '');
    res.render('tyres', {
      title: soort === 'opslag' ? 'Overige bandenopslag' : 'Bandenhotel', soort, q, status, seizoen, locatie, SOORTEN: inv.TYRE_SOORTEN,
      tyres: inv.searchTyres({ soort, q, status, seizoen, locatie }), fotos: photos.firstPhotos('tyre'),
      counts: inv.tyreCounts(soort),
      locaties: inv.distinct('tyre_storage', 'locatie', `AND status = 'opgeslagen' AND soort = '${soort}'`),
      seizoenen: inv.distinct('tyre_storage', 'seizoen', `AND soort = '${soort}'`),
    });
  });

  function renderTyre(res, { tyre, data, error, status }) {
    res.status(status || 200).render('tyre', {
      title: tyre ? `Bandenhotel – ${tyre.kenteken || tyre.klant_naam || 'set ' + tyre.id}` : 'Banden inslaan',
      tyre, d: data, error, VELGEN: inv.VELGEN, SEASONS: inv.SEASONS, STATUSES: inv.TYRE_STATUSES, SOORTEN: inv.TYRE_SOORTEN,
      locaties: inv.distinct('tyre_storage', 'locatie'),
      extra: inv.parseExtra(data.extra),
      customer: data.plate_key ? db.prepare('SELECT id, naam FROM customers WHERE plate_key = ?').get(data.plate_key) : null,
      others: data.plate_key ? inv.tyresForPlate(data.plate_key).filter((t) => !tyre || t.id !== tyre.id) : [],
      photoList: tyre ? photos.list('tyre', tyre.id) : [], photoOwner: tyre ? { type: 'tyre', id: tyre.id } : null, fotos: photos.firstPhotos('tyre'),
    });
  }

  app.get('/bandenhotel/nieuw', (req, res) => {
    const d = inv.normalizeTyre({ datum_in: orders.todayISO(), soort: req.query.soort });
    let c = null;
    if (req.query.klant) c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.query.klant);
    else if (req.query.kenteken) c = db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(plateKey(req.query.kenteken));
    if (c) Object.assign(d, { kenteken: c.kenteken, plate_key: c.plate_key, klant_naam: c.naam, telefoon: c.tel_prive || c.tel_zaak, auto: c.merk_type });
    else if (req.query.kenteken) Object.assign(d, { kenteken: String(req.query.kenteken).toUpperCase().slice(0, 20), plate_key: plateKey(req.query.kenteken) });
    // "Wisselen": de vorige set is net uitgegeven; neem auto en maat alvast over.
    if (req.query.van) {
      const prev = inv.getTyre(req.query.van);
      if (prev) {
        for (const k of ['soort', 'kenteken', 'plate_key', 'klant_naam', 'telefoon', 'auto', 'maat', 'locatie']) d[k] = (k !== 'soort' && d[k]) || prev[k];
        d.seizoen = /winter/i.test(prev.seizoen) ? 'Zomer' : /zomer/i.test(prev.seizoen) ? 'Winter' : '';
        d.soort = prev.soort;
      }
    }
    renderTyre(res, { tyre: null, data: d });
  });

  // Wissellijst: wie moet komen wisselen (er ligt een set van het komende seizoen in opslag)?
  app.get('/bandenhotel/wissellijst', (req, res) => {
    const target = ['winter', 'zomer'].includes(req.query.naar) ? req.query.naar : inv.swapTarget();
    const list = inv.swapList(target);
    res.render('swaplist', {
      title: 'Wissellijst', list, target, auto: inv.swapTarget(), SEASON_LABEL: inv.SEASON_LABEL,
      show: ['wisselen', 'klaar', 'controleren'].includes(req.query.toon) ? req.query.toon : 'wisselen',
    });
  });

  // Klantgegevens bij een kenteken (formulier vult lege velden aan).
  app.get('/bandenhotel/klant/:kenteken', (req, res) => {
    const c = db.prepare('SELECT naam, tel_prive, tel_zaak, merk_type, kenteken FROM customers WHERE plate_key = ?').get(plateKey(req.params.kenteken));
    const stored = inv.tyresForPlate(plateKey(req.params.kenteken)).filter((t) => t.status === 'opgeslagen');
    const pi = require('./plates').plateInfo(req.params.kenteken);
    res.json({ country: pi.country, formatted: pi.country ? pi.parts.join('-') : '', found: Boolean(c), naam: c ? c.naam : '', telefoon: c ? c.tel_prive || c.tel_zaak : '', auto: c ? c.merk_type : '', kenteken: c ? c.kenteken : '', opgeslagen: stored.length });
  });

  app.post('/bandenhotel', (req, res) => {
    const data = inv.normalizeTyre(req.body.t);
    if (!data.klant_naam && !data.kenteken) {
      return renderTyre(res, { tyre: null, data, error: 'Vul een kenteken of de naam van de klant in.', status: 400 });
    }
    const id = inv.saveTyre({ data, userId: req.user.id });
    const klant = inv.ensureCustomer(data);
    announce(req, 'bandenhotel');
    flash(req, 'ok', `Banden${data.kenteken ? ' van ' + data.kenteken : ''} opgeslagen in ${data.soort === 'opslag' ? 'de overige opslag' : 'het bandenhotel'}${data.locatie ? ' (' + data.locatie + ')' : ''}.` +
      (klant === 'nieuw' ? ` ${data.kenteken} is ook toegevoegd aan Klanten.` : ''));
    res.redirect(`/bandenhotel/${id}`);
  });

  app.get('/bandenhotel/:id', (req, res) => {
    const tyre = inv.getTyre(req.params.id);
    if (!tyre) return notFound(res, 'Deze bandenset');
    renderTyre(res, { tyre, data: tyre });
  });

  app.post('/bandenhotel/:id', (req, res) => {
    const tyre = inv.getTyre(req.params.id);
    if (!tyre) return notFound(res, 'Deze bandenset');
    const data = inv.normalizeTyre({ soort: tyre.soort, ...req.body.t, status: tyre.status, datum_uit: tyre.datum_uit, extra: tyre.extra });
    let error = null;
    if (!data.klant_naam && !data.kenteken) error = 'Vul een kenteken of de naam van de klant in.';
    else if (req.body.versie !== tyre.updated_at) {
      error = `${tyre.updated_by_name || 'Iemand anders'} heeft deze set intussen gewijzigd. Jouw wijzigingen staan hieronder nog ingevuld maar zijn NIET opgeslagen; open de set opnieuw om de laatste versie te zien.`;
    }
    if (error) return renderTyre(res, { tyre, data, error, status: 400 });
    inv.saveTyre({ id: tyre.id, data, userId: req.user.id });
    const klant = inv.ensureCustomer(data);
    announce(req, 'bandenhotel', { id: tyre.id });
    flash(req, 'ok', 'Opgeslagen.' + (klant === 'nieuw' ? ` ${data.kenteken} is ook toegevoegd aan Klanten.` : ''));
    res.redirect(`/bandenhotel/${tyre.id}`);
  });

  // Wisselen: deze set gaat op de auto; de set die eraf komt gaat de opslag in (op dezelfde plek).
  app.post('/bandenhotel/:id/wissel', (req, res) => {
    const tyre = inv.getTyre(req.params.id);
    if (!tyre) return notFound(res, 'Deze bandenset');
    const r = inv.swapOnto(tyre.id, req.user.id);
    if (r.error) { flash(req, 'err', r.error); return res.redirect(`/bandenhotel/${tyre.id}`); }
    announce(req, 'bandenhotel', { id: tyre.id });
    const on = (tyre.seizoen || 'de').toLowerCase();
    if (r.off) {
      const offSz = (r.off.seizoen || '').toLowerCase();
      flash(req, 'ok', `Gewisseld: ${on === 'de' ? 'de set' : on + 'banden'} op de auto, de ${/^(zomer|winter)$/.test(offSz) ? offSz + 'set' : 'andere set'} ligt nu in ${r.off.locatie || 'de opslag'}. Werk het profiel bij als dat nodig is.`);
      return res.redirect(`/bandenhotel/${r.off.id}`);
    }
    flash(req, 'ok', `De ${/^(zomer|winter)$/.test(on) ? on + 'set' : 'set'} staat nu op de auto. Vul hieronder de banden in die eraf kwamen (die gaan de opslag in).`);
    res.redirect(`/bandenhotel/nieuw?van=${tyre.id}`);
  });
  // Gebeld/uitgenodigd om te komen wisselen (aan/uit).
  app.post('/bandenhotel/:id/gebeld', (req, res) => {
    const at = inv.toggleInvited(req.params.id, req.user.id);
    announce(req, 'bandenhotel', { id: Number(req.params.id) });
    if (wantsJson(req)) return res.json({ ok: true, uitgenodigd_at: at });
    const back = req.get('referer') && /\/bandenhotel/.test(req.get('referer')) ? req.get('referer') : `/bandenhotel/${req.params.id}`;
    res.redirect(back);
  });

  app.post('/bandenhotel/:id/status', (req, res) => {
    const tyre = inv.getTyre(req.params.id);
    if (!tyre) return notFound(res, 'Deze bandenset');
    const status = ['uitgegeven', 'op_auto', 'opgeslagen'].includes(req.body.status) ? req.body.status : 'opgeslagen';
    inv.setTyreStatus(tyre.id, status, req.user.id);
    announce(req, 'bandenhotel', { id: tyre.id });
    if (status === 'uitgegeven' && req.body.wisselen === '1') {
      flash(req, 'ok', `${tyre.seizoen || 'De'} set van ${tyre.kenteken || tyre.klant_naam} is uitgegeven. Vul nu de set in die je inslaat.`);
      return res.redirect(`/bandenhotel/nieuw?van=${tyre.id}`);
    }
    flash(req, 'ok', status === 'uitgegeven'
      ? (tyre.soort === 'opslag' ? 'De banden zijn als uitgegeven gemarkeerd (gebruikt of meegegeven).' : 'De banden zijn als uitgegeven gemarkeerd (meegegeven aan de klant).')
      : status === 'op_auto' ? 'De banden staan nu als "op de auto".' : 'De banden staan weer in de opslag.');
    res.redirect(`/bandenhotel/${tyre.id}`);
  });

  app.post('/bandenhotel/:id/verwijderen', auth.requireAdmin, (req, res) => {
    const tyre = inv.getTyre(req.params.id);
    if (tyre) {
      photos.removeFor('tyre', tyre.id);
      inv.deleteTyre(tyre.id);
      announce(req, 'bandenhotel', { id: tyre.id });
      flash(req, 'ok', 'De bandenset is verwijderd.');
    }
    res.redirect(tyre && tyre.soort === 'opslag' ? '/bandenhotel?soort=opslag' : '/bandenhotel');
  });

  /* ================= voorraad ================= */
  app.get('/voorraad', (req, res) => {
    const soort = inv.SOORTEN[req.query.soort] ? req.query.soort : 'onderdeel';
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || '');
    const locatie = String(req.query.locatie || '');
    const alleen = req.query.alleen === '1';
    const items = inv.searchStock({ soort, q, type, locatie, alleen });
    res.render('stock', {
      title: soort === 'band' ? 'Voorraad banden' : 'Voorraad onderdelen', soort, q, type, locatie, alleen,
      items, fotos: photos.firstPhotos('stock'),
      // Voorbeeldfoto per soort onderdeel: al bekend (meteen tonen), "zoeken" (de pagina haalt hem op) of niets.
      partSamples: soort === 'onderdeel' && req.user.prefs.partimg !== 'off' ? (() => {
        const out = {};
        for (const t of new Set(items.slice(0, res.locals.shownLimit).map((i) => i.type).filter(Boolean))) {
          const hit = carimage.cachedPart(t);
          out[t] = hit ? hit : carimage.partTarget(t) ? 'zoeken' : null;
        }
        return out;
      })() : {},
      counts: inv.stockCounts(), SOORTEN: inv.SOORTEN,
      // Bij banden: ook laten zien hoeveel sets met deze zoekterm in de overige opslag liggen (noodbanden).
      opslagMatches: soort === 'band' && q ? inv.searchTyres({ soort: 'opslag', q, status: 'opgeslagen' }).length : 0,
      types: inv.distinct('stock_items', soort === 'band' ? 'seizoen' : 'type', `AND soort = '${soort}'`),
      locaties: inv.distinct('stock_items', 'locatie', `AND soort = '${soort}'`),
    });
  });

  function renderStock(res, { item, data, error, status }) {
    res.status(status || 200).render('stock-item', {
      title: item ? (data.soort === 'band' ? `Band ${item.maat || item.merk}` : `Onderdeel ${item.nummer || item.oe_nummer || item.type || item.id}`)
        : data.soort === 'band' ? 'Band toevoegen' : 'Onderdeel toevoegen',
      item, d: data, error, SEASONS: inv.SEASONS, SOORTEN: inv.SOORTEN, extra: inv.parseExtra(data.extra),
      photoList: item ? photos.list('stock', item.id) : [], photoOwner: item ? { type: 'stock', id: item.id } : null,
      partSample: item && data.soort === 'onderdeel' && data.type && res.req.user.prefs.partimg !== 'off'
        ? (carimage.cachedPart(data.type) || (carimage.partTarget(data.type) ? 'zoeken' : null)) : null,
      webSearch: item ? 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(
        (data.soort === 'band' ? [data.merk, data.type, data.maat] : [data.merk, data.nummer || data.oe_nummer, data.nummer ? '' : data.type]).filter(Boolean).join(' ')) : '',
      types: inv.distinct('stock_items', 'type', `AND soort = '${data.soort}'`),
      merken: inv.distinct('stock_items', 'merk', `AND soort = '${data.soort}'`),
      locaties: inv.distinct('stock_items', 'locatie'),
    });
  }
  app.get('/voorraad/nieuw', (req, res) => {
    const data = inv.normalizeStock({ datum: orders.todayISO() }, req.query.soort === 'band' ? 'band' : 'onderdeel');
    renderStock(res, { item: null, data });
  });
  app.post('/voorraad', (req, res) => {
    const data = inv.normalizeStock(req.body.s, req.body.s && req.body.s.soort);
    if (!data.nummer && !data.oe_nummer && !data.type && !data.omschrijving && !data.maat) {
      return renderStock(res, { item: null, data, error: 'Vul minstens een nummer, soort, maat of omschrijving in.', status: 400 });
    }
    const id = inv.saveStock({ data, userId: req.user.id });
    announce(req, 'voorraad');
    flash(req, 'ok', 'Toegevoegd aan de voorraad.');
    res.redirect(req.body.nog_een === '1' ? `/voorraad/nieuw?soort=${data.soort}` : `/voorraad?soort=${data.soort}`);
  });
  app.get('/voorraad/:id', (req, res) => {
    const item = inv.getStock(req.params.id);
    if (!item) return notFound(res, 'Dit voorraaditem');
    renderStock(res, { item, data: item });
  });
  app.post('/voorraad/:id', (req, res) => {
    const item = inv.getStock(req.params.id);
    if (!item) return notFound(res, 'Dit voorraaditem');
    const data = inv.normalizeStock({ ...req.body.s, extra: item.extra }, item.soort);
    let error = null;
    if (!data.nummer && !data.oe_nummer && !data.type && !data.omschrijving && !data.maat) error = 'Vul minstens een nummer, soort, maat of omschrijving in.';
    else if (req.body.versie !== item.updated_at) error = `${item.updated_by_name || 'Iemand anders'} heeft dit intussen gewijzigd (bijvoorbeeld het aantal). Open het opnieuw om de laatste versie te zien; jouw wijzigingen zijn NIET opgeslagen.`;
    if (error) return renderStock(res, { item, data, error, status: 400 });
    inv.saveStock({ id: item.id, data, userId: req.user.id });
    announce(req, 'voorraad', { id: item.id });
    flash(req, 'ok', 'Opgeslagen.');
    res.redirect(`/voorraad?soort=${item.soort}`);
  });
  // Aantal snel ophogen/verlagen (knoppen − en + in de lijst).
  app.post('/voorraad/:id/aantal', (req, res) => {
    const item = inv.getStock(req.params.id);
    if (!item) return wantsJson(req) ? res.status(404).json({ error: 'Niet gevonden' }) : res.redirect('/voorraad');
    const delta = Math.max(-100, Math.min(100, parseInt(req.body.delta, 10) || 0));
    const updated = inv.adjustStock(item.id, delta, req.user.id);
    announce(req, 'voorraad', { id: item.id, aantal: updated.aantal });
    if (wantsJson(req)) return res.json({ ok: true, aantal: updated.aantal, beschikbaar: updated.beschikbaar });
    res.redirect(req.get('referer') && /\/voorraad/.test(req.get('referer')) ? req.get('referer') : `/voorraad?soort=${item.soort}`);
  });
  app.post('/voorraad/:id/verwijderen', auth.requireAdmin, (req, res) => {
    const item = inv.getStock(req.params.id);
    if (item) {
      photos.removeFor('stock', item.id);
      inv.deleteStock(item.id);
      announce(req, 'voorraad', { id: item.id });
      flash(req, 'ok', 'Verwijderd uit de voorraad.');
    }
    res.redirect(`/voorraad?soort=${item ? item.soort : 'onderdeel'}`);
  });

  /* ================= foto's ================= */
  // Vóór de upload-route: anders vangt /fotos/:type/:id ook /fotos/12/verwijderen af.
  app.post('/fotos/:id/verwijderen', (req, res) => {
    const p = photos.remove(req.params.id);
    if (p) announce(req, p.owner_type === 'tyre' ? 'bandenhotel' : 'voorraad', { id: p.owner_id });
    if (wantsJson(req)) return res.json({ ok: Boolean(p) });
    flash(req, 'ok', 'Foto verwijderd.');
    res.redirect(p ? (p.owner_type === 'tyre' ? `/bandenhotel/${p.owner_id}` : `/voorraad/${p.owner_id}`) : '/');
  });

  // Uploaden: de browser verkleint de foto en stuurt een grote en een kleine versie (JSON met data-URL's).
  app.post('/fotos/:type/:id', express.json({ limit: '14mb' }), (req, res) => {
    const { type } = req.params;
    const id = Number(req.params.id);
    try {
      const b = req.body || {};
      const r = photos.add({ type, id, full: b.full, thumb: b.thumb, name: b.name, ref: b.ref, width: b.width, height: b.height, userId: req.user.id });
      if (!r.existed) announce(req, type === 'tyre' ? 'bandenhotel' : 'voorraad', { id, foto: r.id });
      res.json({ ok: true, id: r.id, existed: r.existed });
    } catch (err) {
      if (!(err instanceof photos.PhotoError)) console.error(err);
      res.status(400).json({ error: err instanceof photos.PhotoError ? err.message : 'De foto kon niet worden opgeslagen.' });
    }
  });
  app.get('/fotos/:id/:size', (req, res) => {
    const p = photos.get(req.params.id);
    if (!p || !['full', 'thumb'].includes(req.params.size)) return res.status(404).end();
    let buf;
    try { buf = require('node:fs').readFileSync(photos.filePath(p, req.params.size)); } catch { return res.status(404).end(); }
    // Een foto verandert nooit (nieuwe foto = nieuw nummer): lang bewaren mag.
    res.set({ 'Content-Type': p.media_type, 'Cache-Control': 'private, max-age=31536000, immutable' });
    if (req.query.download) res.attachment(p.name || `foto-${p.id}.jpg`);
    res.send(buf);
  });
  // Foto's die bij een Excel-lijst horen (bijv. de map klanten_Images) in één keer koppelen.
  app.get('/importeren/fotos', auth.requireAdmin, (req, res) => {
    const r = photos.references();
    res.render('import-photos', { title: "Foto's koppelen", total: r.total, done: r.done, files: Object.keys(r.refs).length, stats: photos.stats() });
  });
  app.get('/importeren/fotos/verwijzingen', auth.requireAdmin, (req, res) => res.json(photos.references()));

  /* ================= Excel-import ================= */
  app.get('/importeren/excel', auth.requireAdmin, (req, res) => {
    res.render('import-excel', {
      title: 'Excel importeren', configured: importer.isConfigured(), usage: importer.usage(), maxMb: sheets.MAX_FILE / 1024 / 1024,
    });
  });
  app.post('/importeren/excel', auth.requireAdmin, express.raw({ type: () => true, limit: sheets.MAX_FILE + 1024 }), wrap(async (req, res) => {
    try {
      const filename = decodeURIComponent(String(req.get('x-filename') || 'bestand.xlsx')).replace(/[\\/]/g, '_');
      const id = await sheets.createDraft({ buffer: req.body, filename, userId: req.user.id, useClaude: req.query.claude !== '0' });
      res.json({ redirect: `/importeren/excel/${id}` });
    } catch (err) {
      const known = err instanceof sheets.SheetImportError || err instanceof importer.ImportError;
      if (!known) console.error(err);
      res.status(400).json({ error: known ? err.message : 'Er ging iets mis bij het inlezen van het bestand.' });
    }
  }));

  function loadSheetDraft(req, res) {
    const draft = sheets.getDraft(req.params.id);
    if (!draft) {
      res.status(404).render('error', { title: 'Niet gevonden', message: 'Deze import bestaat niet (meer). Misschien is hij al bevestigd of geannuleerd.' });
      return null;
    }
    return draft;
  }
  app.get('/importeren/excel/:id', auth.requireAdmin, (req, res) => {
    const draft = loadSheetDraft(req, res);
    if (!draft) return;
    res.render('import-excel-review', {
      title: 'Excel-import controleren', draft, previews: sheets.preview(draft),
      TARGETS: sheets.TARGETS, DOELEN: sheets.DOELEN, SPECIAL: sheets.SPECIAL, fmtMm: inv.fmtMm, treadClass: inv.treadClass,
    });
  });
  app.post('/importeren/excel/:id/voorbeeld', auth.requireAdmin, (req, res) => {
    const draft = loadSheetDraft(req, res);
    if (!draft) return;
    sheets.savePlan(draft.id, sheets.updatePlanFromForm(draft, req.body));
    const anchor = /^\d+$/.test(String(req.body.anker || '')) ? `#blad-${req.body.anker}` : '';
    res.redirect(`/importeren/excel/${draft.id}${anchor}`);
  });
  app.post('/importeren/excel/:id/bevestigen', auth.requireAdmin, (req, res) => {
    const draft = loadSheetDraft(req, res);
    if (!draft) return;
    draft.plan = sheets.updatePlanFromForm(draft, req.body);
    const r = sheets.commit(draft, req.user.id);
    sheets.deleteDraft(draft.id);
    const parts = [];
    if (r.bandenhotel) parts.push(`${r.bandenhotel} set${r.bandenhotel === 1 ? '' : 's'} in het bandenhotel`);
    if (r.bandenopslag) parts.push(`${r.bandenopslag} set${r.bandenopslag === 1 ? '' : 's'} in de overige bandenopslag`);
    if (r.klantenNieuw) parts.push(`${r.klantenNieuw} nieuwe klant${r.klantenNieuw === 1 ? '' : 'en'} toegevoegd aan Klanten`);
    if (r.klantenAangevuld) parts.push(`${r.klantenAangevuld} bestaande klant${r.klantenAangevuld === 1 ? '' : 'en'} aangevuld`);
    if (r.bijgewerkt) parts.push(`${r.bijgewerkt} bestaande set${r.bijgewerkt === 1 ? '' : 's'} bijgewerkt`);
    if (r.onderdelen) parts.push(`${r.onderdelen} onderdelen`);
    if (r.banden) parts.push(`${r.banden} banden op voorraad`);
    if (r.bandenhotel || r.bandenopslag || r.bijgewerkt) announce(req, 'bandenhotel');
    if (r.klantenNieuw || r.klantenAangevuld) events.broadcast({ type: 'data', area: 'klanten', by: req.user.name, byId: req.user.id });
    if (r.onderdelen || r.banden) announce(req, 'voorraad');
    const refs = photos.references();
    const fotoHint = refs.total > refs.done ? ` Deze lijst verwijst naar ${refs.total - refs.done} foto's: koppel ze via Importeren → Foto's koppelen.` : '';
    flash(req, 'ok', (parts.length ? `Import voltooid: ${parts.join(', ')}.` : 'Er is niets geïmporteerd (geen rijen aangevinkt).') + fotoHint);
    res.redirect(r.bandenhotel || r.bijgewerkt ? '/bandenhotel' : r.bandenopslag ? '/bandenhotel?soort=opslag' : r.banden && !r.onderdelen ? '/voorraad?soort=band' : r.onderdelen ? '/voorraad' : '/importeren/excel');
  });
  app.post('/importeren/excel/:id/annuleren', auth.requireAdmin, (req, res) => {
    sheets.deleteDraft(req.params.id);
    flash(req, 'ok', 'Import geannuleerd – er is niets opgeslagen.');
    res.redirect('/importeren/excel');
  });
};
