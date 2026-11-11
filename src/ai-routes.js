'use strict';
/**
 * Claude-functies met kostenschatting vooraf (aandachtspunten per klant) en de zoekwoorden.
 */
const { db, plateKey } = require('./db');
const auth = require('./auth');
const ai = require('./ai');
const events = require('./events');
const importer = require('./import');
const bulletins = require('./bulletins');
const synonyms = require('./synonyms');
const modelBulletins = require('./model-bulletins');
const vehicle = require('./vehicle-analysis');
const rdw = require('./rdw');

module.exports = function register(app, { flash, wrap }) {
  const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

  /* ================= kostenschatting vooraf ================= */
  // Voor het venster "Hoeveel moeite mag Claude doen?": per inspanningsniveau een bedrag en tijd.
  app.get('/ai/schatting', (req, res) => {
    try { estimateRoute(req, res); } catch (err) {
      console.error('Kostenschatting:', err);
      res.status(500).json({ error: 'De kostenschatting lukte niet (' + err.message + '). Probeer het opnieuw.' });
    }
  });
  function estimateRoute(req, res) {
    if (!importer.isConfigured()) return res.status(400).json({ error: 'Claude is niet ingesteld: vul anthropic-api-key in config.properties in.' });
    const taak = String(req.query.taak || '');
    let levels; let detail = ''; let aanbevolen = 'normaal';
    if (taak === 'foto') {
      const n = Math.min(Math.max(parseInt(req.query.n, 10) || 1, 1), importer.MAX_IMAGES);
      levels = ai.estimate({ input: 1200 + n * 2600, answer: [1200, 3500] });
      detail = `${n} foto${n === 1 ? '' : "'s"} van een werkopdracht uitlezen.`;
      aanbevolen = 'hoog'; // handschrift: grondig loont
    } else if (taak === 'excel') {
      const bytes = Math.max(parseInt(req.query.bytes, 10) || 0, 0);
      const input = Math.min(Math.max(Math.round(bytes / 3), 4000), 52000);
      levels = ai.estimate({ input, answer: [800, 4000] });
      detail = 'Een Excel-lijst laten beoordelen (ruwe schatting op basis van de bestandsgrootte).';
      aanbevolen = 'hoog';
    } else if (taak === 'klant') {
      const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.query.id);
      if (!c) return res.status(404).json({ error: 'Deze klant bestaat niet (meer).' });
      const n = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(c.id).n;
      if (!n) return res.status(400).json({ error: 'Deze klant heeft nog geen werkopdrachten.' });
      levels = bulletins.estimateFor([c]);
      detail = `Alle ${n} werkopdracht${n === 1 ? '' : 'en'} van ${c.kenteken} laten doorlezen voor aandachtspunten.`;
    } else if (taak === 'model') {
      const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.query.id);
      if (!c) return res.status(404).json({ error: 'Deze klant bestaat niet (meer).' });
      const m = modelBulletins.modelOf(c);
      if (!m) return res.status(400).json({ error: 'Het merk en model van deze auto zijn niet bekend. Vul Merk/Type in of haal de RDW-gegevens op.' });
      levels = modelBulletins.estimate();
      const n = modelBulletins.customersWith(m.key);
      detail = `Bekende zwakke plekken en APK-afkeurpunten van de ${m.label} opzoeken op internet, met bronnen.`
        + (n > 1 ? ` Het resultaat geldt voor alle ${n} klanten met deze auto.` : ' Het resultaat geldt ook voor latere klanten met dezelfde auto.');
    } else if (taak === 'voertuig') {
      const k = vehicle.keyFor({ kenteken: req.query.kenteken, omschrijving: req.query.omschrijving });
      if (!k) return res.status(400).json({ error: 'Vul een kenteken of een omschrijving van de auto in.' });
      levels = vehicle.estimate();
      detail = 'Claude zoekt op internet alles over deze auto op: motor en aandrijving, rijgedrag en comfort, originele banden, onderhoud, bekende problemen en APK-punten, met bronnen.';
    } else if (taak === 'apk-modellen') {
      const todo = modelBulletins.missingModels(apkCustomers(req));
      if (!todo.length) return res.status(400).json({ error: 'Alle automodellen in deze lijst zijn al opgezocht.' });
      levels = modelBulletins.estimate().map((l) => ({ ...l, eurMin: l.eurMin * todo.length, eurMax: l.eurMax * todo.length, seconds: Math.round(l.seconds * todo.length / 2) }));
      detail = `Voor ${todo.length} automodel${todo.length === 1 ? '' : 'len'} uit deze lijst de bekende zwakke plekken en APK-afkeurpunten opzoeken op internet. `
        + 'Modellen die al zijn opgezocht, worden overgeslagen. Het resultaat geldt voor alle klanten met die auto.';
    } else if (taak === 'alle') {
      const todo = bulletins.staleCustomers();
      if (!todo.length) return res.status(400).json({ error: 'Alle klanten met werkopdrachten zijn al geanalyseerd en er is niets nieuws.' });
      levels = bulletins.estimateFor(todo);
      detail = `${todo.length} klant${todo.length === 1 ? '' : 'en'} met nieuwe of gewijzigde werkopdrachten laten doorlezen voor aandachtspunten.`;
    } else {
      return res.status(400).json({ error: 'Onbekende taak.' });
    }
    res.json({
      detail, aanbevolen,
      levels: levels.map((l) => ({ ...l, prijs: '≈ ' + ai.formatRange(l.eurMin, l.eurMax), tijd: l.seconds < 90 ? `± ${Math.max(5, Math.round(l.seconds / 5) * 5)} seconden` : `± ${Math.round(l.seconds / 60)} minuten` })),
    });
  }

  // Klanten in de getoonde APK-lijst (zelfde tabbladen als op /apk).
  function apkCustomers(req) {
    const rows = req.app.get('apkRows')();
    const wanted = (req.query && req.query.toon) || (req.body && req.body.toon); // GET heeft geen body
    const toon = ['verlopen', 'binnenkort', 'alles'].includes(wanted) ? wanted : 'binnenkort';
    const pick = { verlopen: (r) => r.days < 0, binnenkort: (r) => r.days <= 60 && r.days >= -7, alles: () => true }[toon];
    return rows.filter(pick);
  }
  app.post('/apk/modelpunten', auth.requireAdmin, (req, res) => {
    try {
      const st = modelBulletins.startAll(apkCustomers(req), {
        effort: req.body.effort, userId: req.user.id,
        onProgress: (job) => { if (!job.running) events.broadcast({ type: 'data', area: 'apk' }); },
      });
      res.json({ ok: true, job: st });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/apk/modelpunten/stoppen', auth.requireAdmin, (req, res) => { modelBulletins.stopAll(); res.json({ ok: true }); });
  app.get('/apk/modelpunten/taak', (req, res) => {
    const job = modelBulletins.jobStatus();
    res.json({ job: job && { ...job, eurText: ai.formatEur(job.eur) } });
  });

  /* ================= aandachtspunten ================= */
  app.post('/klant/:id/aandachtspunten', auth.requireAi, wrap(async (req, res) => {
    try {
      const r = await bulletins.analyze(Number(req.params.id), { effort: req.body.effort, userId: req.user.id });
      events.broadcast({ type: 'data', area: 'klanten', id: Number(req.params.id), by: req.user.name, byId: req.user.id });
      const msg = r.count ? `Claude heeft ${r.count} aandachtspunt${r.count === 1 ? '' : 'en'} gevonden (kosten ${ai.formatEur(r.eur)}).`
        : `Claude vond niets dat extra aandacht nodig heeft (kosten ${ai.formatEur(r.eur)}).`;
      flash(req, 'ok', msg); // ook bij de knop (JSON): de pagina herlaadt en toont dan deze melding
      if (wantsJson(req)) return res.json({ ok: true, message: msg, ...r });
      res.redirect(`/klant/${req.params.id}#aandachtspunten`);
    } catch (err) {
      if (!(err instanceof bulletins.BulletinError || err instanceof importer.ImportError)) console.error(err);
      const msg = err instanceof bulletins.BulletinError || err instanceof importer.ImportError ? err.message : 'Er ging iets mis bij het analyseren.';
      if (wantsJson(req)) return res.status(400).json({ error: msg });
      flash(req, 'err', msg);
      res.redirect(`/klant/${req.params.id}#aandachtspunten`);
    }
  }));
  // APK-aandachtspunten voor het model van deze auto (gedeeld met alle klanten met dezelfde auto).
  app.post('/klant/:id/apk-model', auth.requireAi, wrap(async (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    try {
      if (!c) throw new modelBulletins.ModelBulletinError('Deze klant bestaat niet (meer).');
      const r = await modelBulletins.analyze(c, { effort: req.body.effort, userId: req.user.id });
      events.broadcast({ type: 'data', area: 'klanten', by: req.user.name, byId: req.user.id });
      const msg = `${r.count} APK-aandachtspunt${r.count === 1 ? '' : 'en'} voor de ${r.label} gevonden${r.web ? '' : ' (zonder internetbronnen: web search staat niet aan voor deze API-sleutel)'} – kosten ${ai.formatEur(r.eur)}.`;
      flash(req, 'ok', msg);
      if (wantsJson(req)) return res.json({ ok: true, message: msg, ...r });
      res.redirect(`/klant/${req.params.id}#apk-model`);
    } catch (err) {
      const known = err instanceof modelBulletins.ModelBulletinError || err instanceof importer.ImportError;
      if (!known) console.error(err);
      const msg = known ? err.message : 'Er ging iets mis bij het opzoeken.';
      if (wantsJson(req)) return res.status(400).json({ error: msg });
      flash(req, 'err', msg);
      res.redirect(`/klant/${req.params.id}#apk-model`);
    }
  }));
  app.post('/aandachtspunt/:id/afgehandeld', (req, res) => {
    const customerId = bulletins.toggleDone(Number(req.params.id), req.user.id);
    if (customerId) events.broadcast({ type: 'data', area: 'klanten', id: customerId, by: req.user.name, byId: req.user.id });
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(customerId ? `/klant/${customerId}#aandachtspunten` : '/');
  });
  // Alle klanten: op de achtergrond (alleen beheerders, kost meer).
  let lastBroadcast = 0;
  app.post('/aandachtspunten/alles', auth.requireAdmin, (req, res) => {
    try {
      const st = bulletins.startAll({
        effort: req.body.effort, userId: req.user.id,
        onProgress: (job) => {
          if (Date.now() - lastBroadcast > 4000 || !job.running) { lastBroadcast = Date.now(); events.broadcast({ type: 'data', area: 'aandachtspunten' }); }
        },
      });
      res.json({ ok: true, job: st });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/aandachtspunten/stoppen', auth.requireAdmin, (req, res) => { bulletins.stopAll(); res.json({ ok: true }); });
  app.get('/aandachtspunten/taak', (req, res) => {
    const job = bulletins.jobStatus();
    res.json({ job: job && { ...job, eurText: ai.formatEur(job.eur) } });
  });

  /* ================= AI-analyse van een voertuig ================= */
  const INRICHTING = [[/hatch/i, 'hatchback'], [/sedan|saloon/i, 'sedan'], [/station|combi|estate/i, 'stationwagen'], [/mpv/i, 'mpv'],
    [/terrein|suv/i, 'suv'], [/gesloten opbouw|bestel|kast/i, 'bestelwagen'], [/cabrio/i, 'cabrio'], [/coup/i, 'coupe']];
  async function vehicleFacts(q) {
    const kenteken = String(q.kenteken || '').trim().toUpperCase().slice(0, 20);
    const omschrijving = String(q.omschrijving || '').trim().slice(0, 160);
    const key = vehicle.keyFor({ kenteken, omschrijving });
    const pk = plateKey(kenteken);
    const customer = pk ? db.prepare('SELECT * FROM customers WHERE plate_key = ?').get(pk) : null;
    let info = null;
    try { info = customer && customer.rdw_json ? JSON.parse(customer.rdw_json) : null; } catch { /* geen */ }
    if (!info && pk && require('./plates').rdwApplicable(kenteken)) { try { info = await rdw.lookup(kenteken); } catch { /* RDW onbereikbaar */ } }
    const found = info && info.found !== false;
    const facts = { kenteken: kenteken || undefined, omschrijving: omschrijving || undefined };
    if (found) Object.assign(facts, { merk: info.merk, model: info.handelsbenaming, carrosserie: info.inrichting, eerste_toelating: info.eersteToelating,
      brandstof: info.brandstof, vermogen_kw: info.vermogenKw, cilinderinhoud_cc: info.cilinderinhoud, massa_leeg_kg: info.massaLeeg, zitplaatsen: info.zitplaatsen, emissie: info.emissie });
    if (customer && customer.merk_type) facts.merk_type_garage = customer.merk_type;
    const label = found ? `${info.merk} ${info.handelsbenaming}`.trim() + (info.eersteToelating ? ` (${info.eersteToelating.slice(0, 4)})` : '') : (customer && customer.merk_type) || omschrijving || kenteken;
    const guess = { carrosserie: (INRICHTING.find(([re]) => re.test((info && info.inrichting) || '')) || [null, 'hatchback'])[1], motor_plaats: 'voor', motor_ligging: 'dwars', aandrijving: 'voor' };
    return { key, kenteken, omschrijving, customer, info: found ? info : null, facts, label, guess };
  }
  const running = new Map(); // key -> { error }
  app.get('/ai-analyse', wrap(async (req, res) => {
    const v = (req.query.kenteken || req.query.omschrijving) ? await vehicleFacts(req.query) : null;
    res.render('ai-analysis', {
      title: 'AI-analyse', v, result: v ? vehicle.get(v.key) : null, busy: v ? running.has(v.key) : false,
      recent: vehicle.recent(), ZONES: vehicle.ZONES, aiConfigured: importer.isConfigured(), canAi: req.user.can_ai,
      customers: db.prepare('SELECT kenteken, merk_type FROM customers ORDER BY updated_at DESC LIMIT 400').all(),
    });
  }));
  app.post('/ai-analyse', auth.requireAi, wrap(async (req, res) => {
    const v = await vehicleFacts(req.body);
    if (!v.key) return res.status(400).json({ error: 'Vul een kenteken of een omschrijving van de auto in.' });
    const cur = running.get(v.key);
    if (!cur || cur.error) { // (een blijven staan foutmelding telt niet als "bezig")
      const active = [...running.values()].filter((r) => !r.error).length;
      if (active >= 3) return res.status(409).json({ error: 'Er lopen al 3 AI-analyses tegelijk. Wacht tot er een klaar is.' });
      const userId = req.user.id; const by = req.user.name;
      running.set(v.key, { error: null, byId: userId });
      vehicle.analyze(v, { effort: req.body.effort, userId })
        .then((r) => {
          running.delete(v.key);
          // Bericht voor wie het startte (bij de volgende pagina); verloopt vanzelf als die het niet komt ophalen.
          const k = `${userId}:${v.key}`;
          lastDone.set(k, `Analyse van ${r.label} klaar${r.web ? '' : ' (zonder internetbronnen: web search staat niet aan)'} – kosten ${ai.formatEur(r.eur)}.`);
          setTimeout(() => lastDone.delete(k), 10 * 60 * 1000).unref();
          events.broadcast({ type: 'data', area: 'ai-analyse', by, byId: userId });
        })
        .catch((err) => {
          if (!(err instanceof vehicle.VehicleError || err instanceof importer.ImportError)) console.error('AI-analyse:', err);
          running.set(v.key, { error: err.message || 'Er ging iets mis.', byId: userId });
          setTimeout(() => { const r = running.get(v.key); if (r && r.error) running.delete(v.key); }, 10 * 60 * 1000).unref();
        });
    }
    res.json({ ok: true, key: v.key });
  }));
  const lastDone = new Map();
  app.get('/ai-analyse/status', (req, res) => {
    const key = String(req.query.key || '');
    const r = running.get(key);
    // Een fout ziet iedereen die kijkt; alleen wie de analyse startte ruimt hem op (anders blijft hij 10 minuten staan).
    if (r && r.error) { if (r.byId === req.user.id) running.delete(key); return res.json({ done: true, error: r.error }); }
    if (r) return res.json({ done: false });
    const k = `${req.user.id}:${key}`;
    const msg = lastDone.get(k); lastDone.delete(k);
    if (msg) flash(req, 'ok', msg);
    res.json({ done: true });
  });

  /* ================= zoekwoorden ================= */
  app.get('/zoekwoorden', (req, res) => {
    res.render('synonyms', { title: 'Zoekwoorden', groups: synonyms.list(), BUILTIN: synonyms.BUILTIN });
  });
  app.get('/zoekwoorden/test', (req, res) => {
    res.json({ parts: synonyms.expand(String(req.query.q || '').slice(0, 200)) });
  });
  app.post('/zoekwoorden', (req, res) => {
    try { synonyms.saveGroup(null, { name: req.body.name, words: req.body.words }); flash(req, 'ok', 'Zoekwoorden opgeslagen.'); } catch (err) { flash(req, 'err', err.message); }
    res.redirect('/zoekwoorden');
  });
  app.post('/zoekwoorden/:id', (req, res) => {
    try { synonyms.saveGroup(Number(req.params.id), { name: req.body.name, words: req.body.words }); flash(req, 'ok', 'Zoekwoorden opgeslagen.'); } catch (err) { flash(req, 'err', err.message); }
    res.redirect(`/zoekwoorden#groep-${req.params.id}`);
  });
  app.post('/zoekwoorden/:id/verwijderen', (req, res) => { synonyms.deleteGroup(Number(req.params.id)); res.redirect('/zoekwoorden'); });
  app.post('/zoekwoorden/:id/standaard', (req, res) => { synonyms.resetGroup(Number(req.params.id)); res.redirect(`/zoekwoorden#groep-${req.params.id}`); });
};
