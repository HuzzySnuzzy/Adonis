'use strict';
/**
 * Claude-functies met kostenschatting vooraf (aandachtspunten per klant) en de zoekwoorden.
 */
const { db } = require('./db');
const auth = require('./auth');
const ai = require('./ai');
const events = require('./events');
const importer = require('./import');
const bulletins = require('./bulletins');
const synonyms = require('./synonyms');
const modelBulletins = require('./model-bulletins');

module.exports = function register(app, { flash, wrap }) {
  const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

  /* ================= kostenschatting vooraf ================= */
  // Voor het venster "Hoeveel moeite mag Claude doen?": per inspanningsniveau een bedrag en tijd.
  app.get('/ai/schatting', (req, res) => {
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
  });

  /* ================= aandachtspunten ================= */
  app.post('/klant/:id/aandachtspunten', wrap(async (req, res) => {
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
  app.post('/klant/:id/apk-model', wrap(async (req, res) => {
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
