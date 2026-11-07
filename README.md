# Werkopdrachten

Website voor het maken, bewaren en terugzoeken van werkopdrachten voor de garage.
Het formulier is een digitale kopie van het papieren werkopdrachtformulier (voor- en achterkant).

## Wat kan het?

- **Inloggen verplicht.** Elke monteur krijgt een eigen account. Wachtwoorden worden versleuteld (bcrypt) opgeslagen.
- **Klantenoverzicht op kenteken.** Klanten worden automatisch aangemaakt zodra een werkopdracht met een kenteken wordt opgeslagen.
  Zoeken op kenteken (met of zonder streepjes), naam, merk, plaats, klantnummer of chassisnummer.
- **Werkopdrachten per klant doorzoeken.** Zoek bijv. op `accu`, `U1F1B` of een onderdeelnummer.
  Via *Alle werkopdrachten* kun je in alle werkopdrachten tegelijk zoeken.
- **Werkopdracht maken en wijzigen** in een formulier dat eruitziet als het papieren formulier:
  - links: onderdelen (22 regels), vloeistoffen en diversen
  - rechts: kop (monteur, datum, kenteken, km-stand, …), werkzaamheden met code/tijd, factuurnummer en uren
  - achterkant: bandenprofiel per band (kleurt geel onder 3 mm, rood onder 1,6 mm), A.p.k./afkeurpunten, aandachtspunten en notities
- **Datum invoer** wordt automatisch ingevuld met de datum waarop de werkopdracht is aangemaakt.
- **Werkopdrachtnummer** loopt automatisch op en kan zo nodig worden aangepast.
- **Afdrukken** op A4 liggend: pagina 1 is de voorkant, pagina 2 de achterkant.
- Waarschuwing als iemand anders de werkopdracht tegelijk heeft gewijzigd, zodat er niets wordt overschreven.
- Beheerders kunnen gebruikers toevoegen en verwijderen, wachtwoorden opnieuw instellen en werkopdrachten verwijderen.

Sneltoetsen in het formulier: `Ctrl+S` slaat op, `Enter` springt naar het volgende vak.

## Starten

Vereist **Node.js 22.13 of nieuwer** (de ingebouwde SQLite-database van Node wordt gebruikt; geen aparte database nodig).

```bash
npm install
npm start
```

Open daarna <http://localhost:3000>. Zolang er nog geen accounts zijn, wordt `/setup` getoond om het eerste
(beheerders)account aan te maken. Maak dit account direct aan, of maak het vooraf aan via de commandoregel:

```bash
npm run create-user -- collin "Collin" --admin
```

Andere monteurs voeg je toe via **Gebruikers** in het menu.

### Instellingen (omgevingsvariabelen)

| Variabele | Standaard | Uitleg |
|---|---|---|
| `PORT` | `3000` | Poort van de webserver |
| `DATA_DIR` | `./data` | Map voor de database (`werkopdrachten.db`). **Maak hier regelmatig een back-up van.** |
| `START_ORDER_NUMBER` | `1` | Eerste werkopdrachtnummer, bijv. `4449` om verder te gaan na de papieren boekjes |
| `NODE_ENV` | – | Zet op `production` op de server (alleen beveiligde cookies via HTTPS) |
| `SESSION_SECRET` | automatisch | Geheime sleutel voor sessies; wordt anders automatisch aangemaakt in `DATA_DIR` |
| `TRUST_PROXY` | – | Zet op `true` als de site achter een reverse proxy (bijv. nginx, Caddy) draait |
| `COOKIE_SECURE` | – | Overschrijft of cookies alleen via HTTPS gaan (`true`/`false`) |
| `TZ` | `Europe/Amsterdam` | Tijdzone voor “Datum invoer” |

### Docker

```bash
docker build -t werkopdrachten .
docker run -d -p 3000:3000 -v werkopdrachten-data:/app/data \
  -e START_ORDER_NUMBER=4449 werkopdrachten
```

### Online zetten

Zet de site altijd achter **HTTPS** (bijv. met Caddy of een hostingpartij die HTTPS regelt) en gebruik
`NODE_ENV=production` en `TRUST_PROXY=true`. Zonder HTTPS gaan wachtwoorden onversleuteld over het internet.

## Techniek

- Node.js + Express, server-side templates (EJS), SQLite (`node:sqlite`)
- `src/server.js` – routes · `src/orders.js` – werkopdracht-velden en opslag · `src/auth.js` – inloggen, CSRF-bescherming, rate limiting
- `views/order.ejs` + `public/css/werkopdracht.css` – het formulier
