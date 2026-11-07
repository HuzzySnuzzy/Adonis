# ADONIS Werkopdrachten

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

- **Rollen en facturatie:** een beheerder geeft iedereen een rol (*Monteur*, *Facturatie* of *Beheerder*).
  De monteur klikt **Klaar → naar facturatie**; de werkopdracht verschijnt dan bij **Facturatie** (met teller in het
  menu en een melding). Facturatie vult het factuurnummer in en klikt **Afronden**: de werkopdracht is dan vergrendeld.
  Terughalen, terugsturen en heropenen kan ook; de geschiedenis laat zien wie wat wanneer deed.
- **Persoonlijke instellingen** (menu → tandwiel): thema *Systeem / Licht / Donker*, handschrift of gewone letters
  in het formulier, startpagina na inloggen en wachtwoord wijzigen. Elke gebruiker heeft eigen instellingen, op elk
  apparaat. Met de knop naast *Nieuwe werkopdracht* wissel je snel van thema. Afdrukken is altijd licht.

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
   Nieuwe versies worden automatisch geïnstalleerd bij het (her)starten, zie [Automatisch bijwerken](#automatisch-bijwerken).
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
| `set-role <gebruiker> <rol>` | rol instellen: `monteur`, `facturatie` of `beheerder` |
| `update` | nu naar een nieuwe versie zoeken (daarna herstarten) |
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
| `auto-update` | `true` | Bij het starten automatisch bijwerken naar de nieuwste release |
| `update-repo` | `huzzysnuzzy/adonis` | GitHub-repository waar updates vandaan komen |
| `import-limit-per-day` | `30` | Maximaal aantal foto-imports per dag; 0 = geen limiet |
| `anthropic-api-key` | leeg | API-sleutel voor foto-import; leeg = uit |

Nieuwe instellingen na een update worden automatisch onderaan `config.properties` toegevoegd.
Alles kan ook als opdrachtregeloptie (`--port 8080`) of omgevingsvariabele (`SERVER_PORT`/`PORT`, `DATA_DIR`,
`START_ORDER_NUMBER`, `APP_TIMEZONE`, `COOKIE_SECURE`, `TRUST_PROXY`, `ANTHROPIC_API_KEY`, `AUTO_UPDATE`, `IMPORT_LIMIT_PER_DAY`). Volgorde: opdrachtregel > omgeving > config.properties.

### Automatisch bijwerken

Bij elke start kijkt het programma op GitHub of er een nieuwere release is. Zo ja, dan wordt die gedownload,
gecontroleerd (juiste grootte en versie) en geïnstalleerd, en start meteen de nieuwe versie. `data/` en
`config.properties` blijven gewoon staan. Zonder internet of bij een fout start gewoon de huidige versie.

- Uitzetten: `auto-update=false` in `config.properties` (Pterodactyl: variabele *Automatisch bijwerken*).
- Handmatig zoeken terwijl het draait: typ `update` in de console en herstart daarna.
- Een nieuwe versie uitbrengen: op GitHub *Actions → Build executables → Run workflow* met een nieuwe tag
  (bijv. `v1.2.0`). Het versienummer in het programma komt uit die tag.
- Windows: het oude bestand blijft even staan als `werkopdrachten.exe.old` en wordt bij de volgende start opgeruimd.

### Foto-import

Handschrift uitlezen gebeurt met Claude (Anthropic, model `claude-opus-5-5`) en heeft daarom **internet en een API-sleutel** nodig.
De rest van de site werkt gewoon offline.

1. Maak een sleutel aan op <https://console.anthropic.com>. Gebruik bij voorkeur een aparte workspace met een
   maandelijkse bestedingslimiet, of prepaid tegoed zonder automatisch opwaarderen.
2. Zet hem in `config.properties`: `anthropic-api-key=sk-ant-...` (Pterodactyl: de variabele *Anthropic API-sleutel*).
3. Herstart. In het venster staat dan `Foto-import: aan`.

**Kosten:** je betaalt per gebruik aan Anthropic (los van een eventueel Claude Pro/Max-abonnement). Eén import kost naar
schatting **$0,10–0,25** (1–2 foto's), maximaal ongeveer $0,40. Ook een import die je daarna annuleert is betaald;
een import die mislukt doordat er geen verbinding is niet. Om onverwachte kosten te voorkomen:

- `import-limit-per-day` (standaard 30) begrenst het aantal imports per dag; 0 = geen limiet.
- Op de importpagina staat hoeveel imports er vandaag zijn gedaan; beheerders zien ook het aantal en de geschatte
  kosten van deze maand. De exacte bedragen staan in de Anthropic Console.

Werkt op elke telefoon via het netwerk (http is genoeg; de camera wordt via de gewone bestandskiezer geopend).
De foto's gaan voor het uitlezen naar Anthropic; ze worden hier alleen bewaard zolang de import nog niet is bevestigd
of geannuleerd (en maximaal 3 dagen). Bij een (onterechte) weigering van het model probeert de API automatisch een ander
Claude-model (`fallbacks: "default"`).

### Online bereikbaar via Cloudflare (één klik)

Het eerste account is de **ADONIS-beheerder** (eigenaar): kan niet worden verwijderd of gedegradeerd en ziet als enige
het menu **Systeem**. Daar zet je ADONIS met één klik online op je eigen domein, bijv. `https://adonis.revnet.nl`:

1. Je domein moet in je Cloudflare-account staan.
2. Maak in Cloudflare een API-token (*My Profile → API Tokens → Create Custom Token*) met:
   Account → Cloudflare Tunnel → Edit, Zone → DNS → Edit en Zone → Zone → Read.
3. Vul in ADONIS het adres en de token in en klik **Installeren**.

ADONIS maakt dan de tunnel en het DNS-record aan, downloadt `cloudflared` (in `data/bin/`) en houdt de verbinding in
stand, ook na een herstart. Er hoeven geen poorten open te staan (werkt dus ook in Pterodactyl), het https-certificaat
regelt Cloudflare, en de API-token wordt niet bewaard. Bezoeken via https krijgen automatisch beveiligde cookies;
het gewone adres in de werkplaats (http) blijft werken. Liever zelf een tunnel maken in het Cloudflare-dashboard?
Dan kun je ook alleen de tunnelsleutel plakken.

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
