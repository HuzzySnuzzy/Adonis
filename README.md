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
- **Foto importeren:** maak met de telefoon een foto van een papieren werkopdracht (voor- en achterkant). De handgeschreven
  tekst wordt uitgelezen en in het formulier gezet. Je controleert alles naast de foto, verbetert wat nodig is en klikt op
  *Bevestigen en opslaan*, of *Annuleren*. Twijfelachtige waarden worden apart genoemd. Zie [Foto-import](#foto-import).
- **Datum invoer** wordt automatisch ingevuld met de datum waarop de werkopdracht is aangemaakt.
- **Werkopdrachtnummer** loopt automatisch op en kan zo nodig worden aangepast.
- **Afdrukken** op A4 liggend: pagina 1 is de voorkant, pagina 2 de achterkant.
- Waarschuwing als iemand anders de werkopdracht tegelijk heeft gewijzigd, zodat er niets wordt overschreven.
- Beheerders kunnen gebruikers toevoegen en verwijderen, wachtwoorden opnieuw instellen en werkopdrachten verwijderen.

Sneltoetsen in het formulier: `Ctrl+S` slaat op, `Enter` springt naar het volgende vak.

## Installeren – één bestand

Werkopdrachten is **één los programma**, net als een Minecraft-server: zet het in een eigen map en start het.
Bij de eerste start worden ernaast aangemaakt:

```
Werkopdrachten/
├── werkopdrachten.exe        ← het programma (Linux: werkopdrachten-linux-x64)
├── config.properties         ← instellingen (poort, eerste werkopdrachtnummer, ...)
└── data/
    └── werkopdrachten.db     ← alle klanten, werkopdrachten en accounts  ← BACK-UP MAKEN!
```

Er hoeft niets anders geïnstalleerd te worden (geen Node.js, geen database), en er is geen internet nodig.

De bestanden staan bij elke [release](../../releases) (`werkopdrachten.exe`, `werkopdrachten-linux-x64`,
`werkopdrachten-linux-arm64`) of maak ze zelf, zie [Zelf bouwen](#zelf-bouwen).

### Windows (lokaal in de werkplaats)

1. Maak een map, bijv. `C:\Werkopdrachten`, en zet `werkopdrachten.exe` erin.
2. Dubbelklik op `werkopdrachten.exe`. De eerste keer:
   - Windows kan waarschuwen dat het programma onbekend is → *Meer informatie* → *Toch uitvoeren*.
   - Windows Firewall vraagt toegang → sta **Privénetwerken** toe, dan kunnen andere pc's/tablets in de werkplaats ook verbinden.
3. De browser opent vanzelf. Maak het eerste (beheerders)account aan.
4. **Laat het zwarte venster open** zolang de site gebruikt wordt. Typ `stop` (of sluit het venster) om af te sluiten.

Het venster toont ook het adres voor andere apparaten, bijv. `http://192.168.1.20:3000`.
Automatisch starten met Windows: zet een snelkoppeling naar de .exe in de map `shell:startup`.

### Linux

```bash
chmod +x werkopdrachten-linux-x64
./werkopdrachten-linux-x64
```

Werkt op gewone Linux-distributies (Debian, Ubuntu, ...; niet op Alpine). Als achtergronddienst kun je bijv.
een systemd-service gebruiken die dit bestand start.

### Pterodactyl

1. Importeer `pterodactyl/egg-werkopdrachten.json` (Admin → Nests → Import Egg).
2. Maak een server met deze egg. Bij installatie wordt `werkopdrachten-linux-x64` gedownload van de nieuwste release.
   Is de repository privé, of lukt de download niet? Upload het bestand dan zelf via de bestandsbeheerder.
3. Start de server; de poort komt automatisch van de toegewezen allocatie (`SERVER_PORT`).
   Ontbreekt het programma (bijv. omdat de download bij de installatie mislukte), dan wordt het bij het starten alsnog gedownload.
   Bijwerken naar een nieuwe versie: *Settings → Reinstall Server* (`data/` en `config.properties` blijven bewaard).
4. Maak het eerste account aan via `/setup`, of typ in de console:
   `create-user collin "Collin" <wachtwoord> --admin`

### Console-opdrachten

In het venster / de Pterodactyl-console kun je typen:

| Opdracht | |
|---|---|
| `help` | overzicht |
| `users` | gebruikers tonen |
| `create-user <gebruiker> "<naam>" <wachtwoord> [--admin]` | gebruiker aanmaken |
| `reset-password <gebruiker> <nieuw wachtwoord>` | wachtwoord vergeten? zo stel je een nieuw in |
| `make-admin <gebruiker>` | gebruiker beheerder maken |
| `stop` | netjes afsluiten |

Dezelfde opdrachten werken ook los, bijv. `werkopdrachten.exe reset-password collin` (vraagt dan om het wachtwoord).

### Instellingen

`config.properties` (wordt bij de eerste start aangemaakt; herstart na wijzigen):

| Instelling | Standaard | Uitleg |
|---|---|---|
| `port` | `3000` | Poort van de website |
| `host` | `0.0.0.0` | `0.0.0.0` = ook bereikbaar vanaf andere apparaten in het netwerk; `127.0.0.1` = alleen deze pc |
| `data-dir` | `data` | Map voor de database. **Maak hier regelmatig een back-up van** (bijv. kopie naar USB-stick of NAS). |
| `start-order-number` | `1` | Eerste werkopdrachtnummer, bijv. `4449` om verder te tellen na de papieren boekjes |
| `open-browser` | `true` | Browser automatisch openen bij het starten (Windows) |
| `secure-cookies` | `false` | `true` als de site via HTTPS bereikbaar is |
| `trust-proxy` | `false` | `true` achter een reverse proxy (nginx, Caddy, Cloudflare) |
| `timezone` | `Europe/Amsterdam` | Tijdzone voor “Datum invoer” |
| `anthropic-api-key` | leeg | API-sleutel voor foto-import; leeg = uit |

Nieuwe instellingen na een update worden automatisch onderaan `config.properties` toegevoegd.
Alles kan ook als opdrachtregeloptie (`--port 8080`) of omgevingsvariabele (`SERVER_PORT`/`PORT`, `DATA_DIR`,
`START_ORDER_NUMBER`, `APP_TIMEZONE`, `COOKIE_SECURE`, `TRUST_PROXY`, `ANTHROPIC_API_KEY`). Volgorde: opdrachtregel > omgeving > config.properties.

### Foto-import

Handschrift uitlezen gebeurt met Claude (Anthropic, model `claude-opus-5-5`) en heeft daarom **internet en een API-sleutel** nodig.
De rest van de site werkt gewoon offline.

1. Maak een sleutel aan op <https://console.anthropic.com> (betaald per gebruik; een foto uitlezen kost enkele centen).
2. Zet hem in `config.properties`: `anthropic-api-key=sk-ant-...` (Pterodactyl: de variabele *Anthropic API-sleutel*).
3. Herstart. In het venster staat dan `Foto-import: aan`.

Werkt op elke telefoon via het netwerk (http is genoeg; de camera wordt via de gewone bestandskiezer geopend).
De foto's gaan voor het uitlezen naar Anthropic; ze worden hier alleen bewaard zolang de import nog niet is bevestigd
of geannuleerd (en maximaal 3 dagen). Bij een (onterechte) weigering van het model probeert de API automatisch een ander
Claude-model (`fallbacks: "default"`).

### Beveiliging

Lokaal in de werkplaats gaat het verkeer onversleuteld (http) over het eigen netwerk; dat is prima voor een
afgeschermd bedrijfsnetwerk. **Zet de site niet zomaar open op internet.** Wil je er van buitenaf bij, gebruik dan
HTTPS via een reverse proxy (bijv. Caddy of Cloudflare Tunnel) en zet `secure-cookies=true` en `trust-proxy=true`.

### Docker

```bash
docker build -t werkopdrachten .
docker run -d -p 3000:3000 -v werkopdrachten-data:/data werkopdrachten
```

## Zelf bouwen

Vereist Node.js 22.13 of nieuwer.

```bash
npm install
npm start                    # ontwikkelen: draait direct vanuit de broncode
npm run build                # maakt dist/werkopdrachten.exe, dist/werkopdrachten-linux-x64 en -linux-arm64
npm run build -- win-x64     # alleen Windows
```

Het bouwscript bundelt alle code, templates, css en het lettertype tot één bestand en zet dat in een officiële
Node.js-binary (Node “Single Executable Application”). Dit kan vanaf elk besturingssysteem voor elk doel.

GitHub Actions bouwt en test de bestanden automatisch bij elke push. Een release maken:
`git tag v1.0.0 && git push --tags` → de bestanden verschijnen bij de release.

## Techniek

- Node.js + Express, server-side templates (EJS), SQLite (`node:sqlite`), verpakt als Node Single Executable Application
- `src/main.js` – opstarten, config.properties, console-opdrachten · `src/server.js` – routes · `src/assets.js` – ingebakken bestanden
- `scripts/build.js` – bouwt de losse executables · `src/orders.js` – werkopdracht-velden en opslag · `src/auth.js` – inloggen, CSRF-bescherming, rate limiting
- `views/order.ejs` + `public/css/werkopdracht.css` – het formulier
- `src/import.js` – foto-import (Claude vision + JSON-schema afgeleid van de formuliervelden), `public/js/import.js` – camera en verkleinen
