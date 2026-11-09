# ADONIS Werkopdrachten

Website voor het maken, bewaren en terugzoeken van werkopdrachten voor de garage.
Het formulier is een digitale kopie van het papieren werkopdrachtformulier (voor- en achterkant).

## Wat kan het?

- **Foto's en extra bladen bij werkopdrachten.** Foto's (camera of bestand) onderaan de werkopdracht; extra
  vervolgbladen (voorkant, achterkant of leeg) die meetellen in het totaal, mee worden afgedrukt en doorzoekbaar zijn.
- **Rekenhulp.** Band omrekenen (diameter, tellerafwijking, alternatieve maten), last-/snelheidsindex, DOT-leeftijd,
  bar/psi, Nm/lbf·ft, kW/pk, verbruik, arbeidsloon, BTW en meer.
- **Slim invullen.** Kenteken van een bekende klant vult de klantgegevens in en toont vorige werkopdracht, km-stand,
  olie en banden; suggesties voor onderdelen (eerdere werkopdrachten + voorraad, met prijs), werkzaamheden en banden;
  waarschuwingen bij een lagere km-stand, verlopen APK of oude banden.
- **Onderdelen aan/uit.** Bij *Systeem → Onderdelen* zet de beheerder werkopdrachten, bandenhotel, voorraad,
  APK-lijst, portaal en AI los aan of uit. Zo is ADONIS bijv. alleen een bandenhotel of alleen een voorraadbeheer.
  Uitgezette onderdelen verdwijnen uit menu's en zijn niet te openen; er wordt niets verwijderd. Klanten staan altijd aan.
- **Inloggen verplicht.** Elke monteur krijgt een eigen account. Wachtwoorden worden versleuteld (bcrypt) opgeslagen.
- **Klantenoverzicht op kenteken.** Klanten worden automatisch aangemaakt zodra een werkopdracht met een kenteken wordt opgeslagen.
  Zoeken op kenteken (met of zonder streepjes), naam, merk, plaats, klantnummer of chassisnummer.
- **Werkopdrachten per klant doorzoeken.** Zoek bijv. op `accu`, `U1F1B` of een onderdeelnummer.
  Via *Werkopdrachten* kun je in alle werkopdrachten tegelijk zoeken.
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
  Facturatie en beheerders kunnen een open (of nieuwe/geïmporteerde) werkopdracht ook **direct als gefactureerd**
  afronden – handig bij het overzetten van oude papieren werkopdrachten (zonder factuurnummer na bevestiging).
- **RDW-gegevens** (RDW Open Data, gratis): op de klantpagina APK-vervaldatum (groen/oranje/rood), merk/type,
  brandstof en vermogen, eerste toelating, tellerstandoordeel en een waarschuwing bij een openstaande terugroepactie,
  met een link naar rdw.nl. In de klantenlijst een APK-kolom. Op een nieuwe werkopdracht worden Merk/Type en
  A.p.k.-datum na het invullen van het kenteken automatisch ingevuld; de knop **RDW** naast het kenteken toont de
  details. Gegevens worden per klant bewaard en hooguit één keer per dag opnieuw opgehaald (vereist internet).
- **Bandenhotel:** de banden die je voor klanten opslaat, per set met kenteken, klant, auto, seizoen, maat, profiel
  voor/achter in mm (groen / oranje bij < 3 mm, winter < 4 mm / rood onder 1,6 mm), locatie en label. Zoeken op kenteken,
  naam of maat (`205/55R16`, `2055516`), filteren op seizoen en locatie. **Wisselen** geeft de set mee en opent meteen het
  formulier voor de set die je inslaat (auto en maat staan al ingevuld, seizoen omgedraaid). Een klant uit het
  bandenhotel komt automatisch op de **Klanten**-pagina (op kenteken; bestaande klantgegevens worden niet overschreven,
  alleen lege velden aangevuld), en op de klantpagina staan zijn banden.
  Per klant zie je ook welke banden **op de auto** staan (vastleggen op de klantpagina). **Wisselen** opent een venster:
  welke set gaat erop, welke komt eraf (de vastgelegde set, een set die als "in opslag" stond maar eigenlijk op de auto
  zat, nog onbekende banden, of niets) en waar die gaat liggen (standaard de plek die vrijkomt). De **Wissellijst** toont wie moet
  komen wisselen: klanten met banden van het komende seizoen in opslag die daar nog niet op rijden (van half september
  t/m januari naar winter, anders naar zomer; ook handmatig te kiezen). Nog niet gebelde klanten en het slechtste profiel
  op de auto staan bovenaan; met **Gebeld** houd je bij wie al is uitgenodigd. Afdrukken kan ook.
  Daarnaast is er **Overige opslag (noodbanden)** voor banden die niet bij één vaste klant horen; zoek je in de voorraad op
  een maat, dan zie je ook hoeveel sets van die maat daar liggen.
- **Voorraad met voorbeeldfoto's:** in de lijst en op de pagina van een onderdeel staat een voorbeeldfoto van de
  soort onderdeel (bougie, oliefilter, riem, remblokken...), gratis van Wikipedia; eigen foto's gaan altijd voor.
  Er wordt een vaste artikeltitel opgevraagd (gangbare garagewoorden zijn vertaald), dus nooit een willekeurig
  zoekresultaat. De knop **Afbeeldingen zoeken** zoekt foto's van precies dat onderdeel (merk + nummer) in de browser.
- **Voorraad:** onderdelen en banden die op de zaak liggen, met aantal (knoppen − en +), merk, artikelnummer,
  origineel (OE) nummer, soort en locatie. Een nummer vind je ook als het anders is getypt: `1493001` vindt `1 493 001`,
  `A0031592603` vindt `A003.159.26.03`.
- **Foto's** bij elke bandenset en elk voorraaditem: maak er een met de camera, kies er een paar, of sleep ze erop.
  Ze worden in de browser verkleind (langste zijde 1800 px) en bewaard in de map `fotos` in de datamap. In de lijsten
  staat een miniatuur; klik voor groot (met vorige/volgende). Verwijst een geïmporteerde Excel-lijst naar foto's
  (bijv. `klanten_Images/azx1.Foto.143052.jpg`), dan koppel je de hele map (of een .zip) in één keer via
  *Importeren → Foto's koppelen*; elke foto gaat op bestandsnaam naar het juiste record.
- **Klantgegevens wijzigen** op de klantpagina (*Gegevens wijzigen*): naam, adres, telefoon, merk/type, chassisnummer,
  alarmcode en kenteken. Een correctie blijft staan, ook als een oude werkopdracht opnieuw wordt opgeslagen; pas een
  *nieuwe* werkopdracht met andere gegevens werkt de klant weer bij. Een gewijzigd kenteken gaat mee naar de
  werkopdrachten en het bandenhotel.
- **Kentekenplaten** zien eruit als echte platen en zijn altijd even groot: Nederlands (geel, streepjes volgens de
  sidecode, bijv. `SB846S` → `SB-846-S`) en **Duits** (wit, `KLE JB 789` met keurmerken). Bij een Duits kenteken wordt
  de RDW niet geraadpleegd.
- **Excel importeren met Claude als meekijker** (alleen beheerders): zet bestaande lijsten (.xlsx of .csv) over naar
  het bandenhotel, de overige opslag of de voorraad. Zie [Excel-import](#excel-import).
- **Eenvoudig in gebruik.** Voor wie niet zo handig is met computers: de beheerder zet bij *Gebruikers* (of iemand zelf bij
  *Instellingen*) **Eenvoudige weergave** aan. Nieuwe gebruikers (aangemaakt bij *Gebruikers*) krijgen dit standaard; het vinkje staat op het
  formulier en kan uit. De eigenaar (eerste account) begint in de gewone weergave. Dan opent ADONIS met een **startscherm** met grote knoppen en één zoekvak,
  is alles groter en staat alleen het belangrijkste in het menu (animaties volgen gewoon *Effecten*). Voor iedereen geldt:
  - **Hulp** (vraagteken rechtsboven): uitleg in korte stappen met precies dezelfde knopnamen als op het scherm.
  - Een werkopdracht wordt tijdens het typen **op het apparaat bewaard**; na een ongeluk (pagina dicht, uitgelogd,
    opslaan mislukt) vraagt ADONIS of het **teruggezet** moet worden.
  - Weggaan met niet-opgeslagen wijzigingen vraagt eerst om bevestiging; wisselen en uitgeven van banden ook.
  - **Ingelogd blijven op dit apparaat** (standaard aan): 30 dagen na het laatste gebruik in plaats van 12 uur.
  - Foutmeldingen in gewone taal, met knoppen *Terug* en *Naar het begin*.
- **Foto van de auto** op de klantpagina (instelling, standaard aan): een voorbeeldfoto van het model (bijv. een
  Nissan Note) om de auto snel te herkennen. Gratis via Wikipedia/Wikimedia Commons; alleen merk en model worden
  opgezocht, nooit het kenteken of de klant. De foto wordt één keer opgehaald en daarna lokaal bewaard (map `autofotos`). Er wordt alleen een foto getoond als het
  Wikipedia-artikel echt over dat model gaat (typecodes zoals W639 helpen de juiste generatie te kiezen); klopt een foto
  toch niet, dan verbergt *Verkeerde auto? Verbergen* hem voor dat model.
- **APK-lijst** (*Klanten → APK-lijst*, ook op het startscherm): wie de komende 2 maanden naar de APK moet of hooguit een
  week te laat is (langer verlopen staat onder *Al verlopen*), met telefoonnummer, **Gebeld** (per APK-datum; iedereen ziet het meteen) en **+ Werkopdracht** met de klant
  al ingevuld. Nog niet gebelde klanten en de vroegste datums staan bovenaan; afdrukken kan ook. De APK-datums komen
  van de RDW; voor klanten zonder RDW-gegevens (bijv. uit het bandenhotel) worden ze rustig op de achtergrond
  opgehaald (één kenteken per 3 seconden, elke 30 dagen ververst).
- **Automatische backups** (*Systeem → Backups*, alleen beheerders): elke dag op een vast tijdstip (standaard 12:30;
  stond de computer uit, dan zodra ADONIS weer draait) één bestand `adonis-backup-JJJJ-MM-DD_UUMM.zip` met de hele
  database en alle foto's. **Kies zelf waar:** één of meer mappen, bijvoorbeeld een USB-schijf, een netwerkschijf (NAS)
  of de map van OneDrive / Google Drive / Dropbox (die zetten het dan in de cloud), plus **Backup downloaden** in de
  browser. Oude backups worden na 7–365 dagen opgeruimd (instelbaar; altijd minstens de 3 nieuwste). Mislukt een
  backup of is de laatste te oud, dan staat er voor de beheerder een rode melding bovenaan elke pagina.
  **Terugzetten** kan uit de lijst of door een backupbestand te kiezen: ADONIS controleert het bestand, maakt eerst een
  veiligheidsbackup, start opnieuw op en zet de huidige gegevens opzij in `voor-terugzetten-<tijd>` in de datamap
  (er wordt nooit iets weggegooid; de 3 nieuwste worden bewaard). Een onbereikbare map (schijf los, NAS uit) laat
  ADONIS nooit hangen.
- **Persoonlijke instellingen** (menu → tandwiel): thema *Systeem / Licht / Donker*; met de voorkeur **Geheime thema's** ook *ADONIS* (marmer, bladgoud, Egeïsch blauw), *OLED* (puur zwart; panelen zweven met een zachte gloed eronder) */ VCDS* (klassiek Windows-diagnosevenster zoals in de werkplaats: grijze vensters op een blauw bureaublad, 3D-knoppen, verzonken witte velden, groepsvakken, een blauwe titelbalk en een statusbalk; opstarten met een "verbinding maken"-venster met blokjesbalk; alleen systeemlettertypes, rustig en goed leesbaar), *Neon* en *Black Ice* (Neon: dezelfde stijl als het 2049-thema van DiscordLinked; **Black Ice** (ICE·XVIII): zwart, superionisch ijs – een kristalrooster als vloer, ionensporen die erdoorheen schieten, de gloeiende kern onderin, rijp in de hoeken en een glinstering onder de muis; beide met eigen opstartreeks). Elk thema heeft een korte opstartanimatie (eenmaal per tabblad, overslaan met een klik); *Effecten: Rustig* zet die en andere bewegingen uit, **weergave op telefoon** (Groot 100% / Normaal 90% / Compact 80% / Klein 70% / Heel klein 60%, alleen op telefoons en tablets; niet op de computer en niet in de ADONIS-app), handschrift of gewone letters
  in het formulier, startpagina na inloggen en wachtwoord wijzigen. Elke gebruiker heeft eigen instellingen, op elk
  apparaat. Met de knop naast *Nieuwe werkopdracht* wissel je snel van thema. Afdrukken is altijd licht.

- **Portaal** (menu *Portaal*, ook op het startscherm): mappen met websites, zoals pictogrammen op een bureaublad, voor
  de hele garage. Bij het toevoegen haalt ADONIS zelf de naam en het pictogram van de website op (het grootste dat de
  site aanbiedt; anders `favicon.ico` of DuckDuckGo; anders een gekleurde letter) en bewaart dat in `portaal-iconen`.
  **Importeren:** sleep snelkoppelingen (`.url`) van het bureaublad op een map, of kies een bladwijzerbestand (`.html`)
  uit Chrome/Edge/Firefox: de mappen komen mee. *Bewerken*: mappen maken, hernoemen, verplaatsen en verwijderen,
  tegels verslepen (ook naar een andere map), naam/adres wijzigen. Zoekvak + Enter opent de eerste website die past.
  In de ADONIS-app openen websites in de gewone browser.
- **Opzoeken met het kenteken:** een website in het Portaal kan een *zoekadres* krijgen: plak het adres van een
  zoekresultaat (bijv. `https://smeermiddelen.totalenergies.nl/product-advice/select?licensePlate=19slvl`) en ADONIS
  herkent het kenteken erin (ook de schrijfwijze: klein/hoofdletters, met/zonder streepjes) en maakt er een sjabloon van
  (`…?licensePlate={kenteken-klein}`). Op elke klantpagina en werkopdracht staan die websites dan bij *Opzoeken met …*,
  met het kenteken van die auto ingevuld. Zelf schrijven kan ook: `{kenteken}`, `{kenteken-klein}`, `{kenteken-streepjes}`,
  `{kenteken-streepjes-klein}`.
- **Aandachtspunten van Claude** (klantpagina, en voor beheerders *Werkopdrachten → Aandachtspunten voor alle klanten*):
  Claude leest alle werkopdrachten van een auto en zet alleen wat ertoe doet voor een volgend bezoek op de klantpagina
  (en bovenaan elke werkopdracht van die auto): tijdelijke oplossingen, geadviseerd maar niet gedaan, slijtage, gewijzigde
  codering, terugkerende storingen, met werkopdrachtnummer en datum. Monteurs vinken punten af (*Afgehandeld*); die komen
  niet terug. Namen, adressen, telefoonnummers, alarmcodes en prijzen gaan niet naar Claude. Bij nieuwe werkopdrachten
  meldt de klantpagina dat de analyse verouderd is.
- **APK-aandachtspunten per model** (klantpagina): Claude zoekt met *web search* de bekende zwakke plekken en
  APK-afkeurpunten van dat model en bouwjaar op (roestplekken, gordels, ophanging…), met bronnen; alleen bronnen die echt
  in de zoekresultaten stonden worden getoond. Opgeslagen per merk + model + bouwjaar (RDW-gegevens, anders Merk/Type),
  dus gedeeld door alle klanten met die auto. Staat web search niet aan voor de API-sleutel, dan zonder bronnen (met
  melding). Zoekkosten ($10 per 1000 zoekopdrachten) tellen mee in de schatting en het verbruik.
  Aandachtspunten en APK-punten staan in **inklapbare vakken** (open/dicht wordt onthouden).
  Op de **APK-lijst** zoekt een knop (beheerders) de punten op voor alle modellen in het getoonde tabblad die nog niet
  zijn opgezocht; per klant staat dan "n APK-punten voor dit model".
- **Geheim thema Aero:** glas in de stijl van Windows 7 (backdrop-filter in menubalk/werkbalk, glazen vensterranden via
  box-shadow, glanzende knoppen, Verkenner-selecties), eigen achtergrond `public/img/fx/sky-aero-v1.svg` en een
  "Welkom"-opstartreeks. Geen afbeeldingen van Microsoft; Segoe UI alleen als die op de pc staat.
- **Thema ADONIS** (het thema der thema's): marmer met gouden aders, bladgoud en lapisblauw, Griekse sleutelrand,
  Cinzel + EB Garamond (OFL), draaiende zonnestralen, gouden stofjes, eigen opstartreeks (zon, lauwerkrans, vergulde
  letters) en een tempel achter het inlogscherm. Tekeningen zijn eigen SVG's in `public/img/fx/*-adonis-v1.svg`.
- **Bureaubladmodus** (`/bureaublad`, voorkeur `desktop`): pagina's als versleepbare vensters (iframes van gewone pagina's;
  `early.js` herkent een venster en verbergt menubalk/voettekst, zet effecten op rustig), met taakbalk, startmenu, klok,
  minimaliseren/maximaliseren/schikken, Ctrl+klik = nieuw venster (postMessage), en de indeling per pc in localStorage.
  `X-Frame-Options: SAMEORIGIN` en `frame-ancestors 'self'`: alleen ADONIS zelf mag zijn pagina's in een venster tonen.
- **Plaknotities:** knop linksonder op elk scherm. Kleur (standaard geel), zichtbaar voor alleen de maker of voor iedereen, en
  op het scherm (elke pagina, `position: fixed`) of op een werkopdracht (scrolt mee, alleen daar zichtbaar; briefje-teken in
  de lijsten). Verslepen, inklappen, verbergen; plek per browser onthouden. Gedeelde notities live via SSE; alleen de maker
  (of een beheerder) gooit weg of wijzigt wie hem ziet.
- **AI-analyse (röntgenbeeld van een auto)** (`/ai-analyse`, tegel op het startscherm, knop op de klantpagina): kies een
  kenteken/klant of beschrijf de auto; Claude zoekt met web search alles op (generatie, motor, plaats/ligging van de motor,
  FWD/RWD/AWD, rijgedrag en comfort, verbruik, originele banden, olie, bekende problemen en APK-punten, met bronnen).
  Het resultaat is een hologram/röntgenbeeld van bovenaf (SVG) met de juiste indeling – motor voor/midden/achter, dwars of
  langs, aangedreven assen – en wijzers naar motor, aandrijving, banden, remmen, onderstel, carrosserie, interieur,
  verlichting en elektronica (kleur = ernst); klikken opent het vak met details. Opgeslagen per kenteken (of omschrijving),
  opnieuw onderzoeken kan altijd. Telt niet mee voor de daglimiet van de foto-import.
- **Inspanning kiezen met kostenschatting:** voor elke Claude-taak (foto-import, Excel-import, aandachtspunten) kiest de
  gebruiker eerst *Snel / Normaal / Grondig* (API-effort low/medium/high) en ziet vooraf een schatting in euro's en de
  duur. De werkelijke kosten staan daarna in de melding en bij Systeem. Aandachtspunten tellen niet mee voor de daglimiet
  van de foto-import (ze worden vooraf met kosten bevestigd).
- **Zoekwoorden** (*Werkopdrachten → Zoekwoorden*): woorden die hetzelfde betekenen (garagetermen, Nederlands en Engels):
  zoeken op *light* of *lampen* vindt ook *dagrijverlichting*. Elk woord moet voorkomen; per woord tellen ook de woorden uit
  dezelfde groep. Aanvullen en eigen groepen maken kan op die pagina; "aanhalingstekens" zoekt precies één woord.
- **Wat is er nieuw** (*Instellingen*, onderaan; of klik op het versienummer onderaan een pagina): alle versies met
  wat er per versie is veranderd, in gewone taal. Bijhouden in `src/changelog.js` (bij elke release bovenaan een regel).
- **Snel zoeken:** de lijsten (Klanten, Werkopdrachten, Bandenhotel, Voorraad) worden al bijgewerkt terwijl je typt.
  Een volledig kenteken + Enter opent meteen die klant. De toets `/` springt naar het zoekvak. Lange lijsten tonen eerst
  100 regels, met *Meer tonen* / *Alles tonen*. Op een laptop past de menubalk op één rij (naam en uitloggen als pictogram;
  in de eenvoudige weergave blijven het woorden).

- **Serveradres op het inlogscherm:** onderaan staat met welke server dit apparaat verbonden is (vervaagd tot je erop
  wijst of tikt). In de ADONIS-app staat ernaast **Wijzigen** (opent het scherm om een ander adres te kiezen; in oudere
  app-versies: `Ctrl + ,`).
- **Startpagina** (Instellingen) geldt bij het inloggen én telkens als je de app of de browser opent; daarna blijven
  *Klanten* en F5 gewoon op Klanten.
- **Opstartanimatie** speelt na het inloggen en één keer per venster (of bij het starten van de app). Speelt hij niet, dan zegt
  *Instellingen → Effecten* waarom (Rustig, of Windows vraagt om minder beweging) en kun je hem
  daar opnieuw bekijken.

**Navigeren:** `Esc` gaat altijd naar het startscherm (een open venster/menu sluit eerst; in een invoerveld verlaat de
eerste `Esc` het veld). De terug-links gaan naar de vorige bekeken pagina (spoor per tabblad); in de ADONIS-app ook een
terugknop in de menubalk, `Alt + ←`/`Alt + →` en de muisknoppen.

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

### ADONIS-app (Windows)

`ADONIS-app.exe` (bij elke release) is een los programma dat alleen ADONIS toont, in een eigen venster met eigen
icoon: geen tabbladen of adresbalk. Bij de eerste start vraagt de app het adres van de server en onthoudt dat (plus
inlog, venstergrootte en -positie). Links naar andere websites openen in de gewone browser.

- Vooraf instellen: zet `adonis-app.json` (`{"url": "https://adonis.voorbeeld.nl"}`) naast de .exe. ADONIS levert dit
  bestand kant-en-klaar via **Instellingen → ADONIS-app voor Windows**.
- `Ctrl + ,` adres wijzigen · `Ctrl + R` herladen · `F11` volledig scherm · `Alt` toont het menu.
- **Afdrukken met voorbeeld** (vanaf 1.24.6): *Afdrukken* of `Ctrl + P` opent een afdrukvoorbeeld (werkopdracht A4 liggend,
  met de grijze vakken) met knoppen voor afdrukken en opslaan als PDF. Het afdrukscherm van Windows zelf heeft in de app
  geen voorbeeld en staat standaard op staand.
- **Werkt zichzelf bij** (vanaf 1.24.4): de app vraagt de server welke versie daar draait (`/app-versie`) en downloadt
  precies die `ADONIS-app.exe`, alleen van de GitHub-releases van ADONIS. Rechtsonder in het venster staat de voortgang;
  daarna vraagt de app **Nu opnieuw starten** of **Later** (dan bij de volgende start). Windows houdt de draaiende
  .exe vast, dus de nieuwe versie wordt eerst ernaast gezet (`ADONIS-app.exe.nieuw`) en pas na het afsluiten op zijn
  plek gezet. Niet-opgeslagen werk wordt eerst
  gevraagd. Controle kort na het starten en daarna elke 30 seconden (een klein vraagje aan de eigen server; ook meteen nadat de server zichzelf heeft bijgewerkt); met de hand via menu (Alt) →
  *Controleren op updates*. De map van de .exe moet beschrijfbaar zijn (dus niet in `C:\Program Files`).
- Broncode in `desktop/` (Electron); gebouwd door GitHub Actions.

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
   Nieuwe versies worden automatisch geïnstalleerd, bij het starten en terwijl de server draait (elke 15 s kijken), zie [Automatisch bijwerken](#automatisch-bijwerken).
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

**Terwijl de server draait** kijkt hij elke 15 seconden (`update-check-seconds`, Pterodactyl: *Controleren op updates*)
of er een nieuwe versie is. Die wordt eerst **op de achtergrond gedownload en gecontroleerd terwijl ADONIS gewoon
doorwerkt**; pas als het nieuwe programma klaarstaat, herstart ADONIS (ongeveer een halve seconde onbereikbaar).
Loopt er net een backup of een Claude-taak voor alle klanten, dan wacht hij daar eerst op (max. 15 minuten).
Open schermen krijgen een melding en laden daarna vanzelf opnieuw, behalve als iemand iets aan het invullen is.
- GitHub telt "niets veranderd"-antwoorden (ETag/304) niet mee voor de limiet van 60 vragen per uur, dus vaak kijken kan.
  Wordt de limiet toch bereikt, dan wacht hij tot GitHub weer antwoordt.
- Het oorspronkelijke proces blijft als "bewaker" draaien en start elke nieuwe versie; er komen dus geen processen bij,
  en Pterodactyl/Docker merken de herstart niet. *Stop* in het paneel stopt de server gewoon netjes. De bewaker draait
  ook bij `npm start` en in Docker (uitzetten: omgevingsvariabele `ADONIS_NO_SUPERVISOR=1`).
- `update-check-seconds=0`: alleen bij het starten kijken (zoals vroeger).

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

### Excel-import

*Importeren → Bandenhotel / voorraad (Excel)*. Kies een .xlsx- of .csv-bestand; alle bladen worden bekeken.

1. ADONIS deelt elk blad in op basis van de kolomkoppen. Met een API-sleutel kijkt **Claude** mee: welk blad wat is
   (bandenhotel, overige opslag, onderdelen, banden of overslaan), welke kolom bij welk veld hoort (ook als de kop
   onduidelijk is), welke schrijfwijzen samen horen (`Blauwe Container` = `Blauwe container`, `ZOMER` = `Zomer`),
   hoe vrije profielnotities als `Voor 5,3 achter 48` worden gelezen (5,3 / 4,8 mm) en welke rijen je moet nakijken.
2. Op de **controlepagina** zie je alles en kun je alles aanpassen: het doel per blad, de kolomindeling, de
   schrijfwijzen, de profielen en per rij een vinkje. Rijen met een opmerking zijn gemarkeerd (filter
   *Alleen rijen met een opmerking*). Er is dan nog niets opgeslagen.
3. **Importeren bevestigen** slaat de aangevinkte rijen op. Bij het bandenhotel worden nieuwe klanten aan Klanten
   toegevoegd. Rijen die er al precies zo staan worden standaard overgeslagen; een set met een bestaand label wordt
   bijgewerkt. Kolommen zonder vaste plek (bijv. fotopaden) worden bewaard onder *Overige gegevens* bij het record.

Een beoordeling door Claude telt als één import voor `import-limit-per-day` en kost meestal enkele tientallen centen.
Is Claude niet bereikbaar, dan gaat de import gewoon door op basis van de kolomkoppen. Zonder vinkje
*Laat Claude meekijken* gaan er geen gegevens naar Anthropic.

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
- `public/css/theme-neon.css`, `public/js/neon.js` – thema Neon (lettertypen Orbitron, Oxanium en Share Tech Mono onder de SIL Open Font License, zie `public/fonts/OFL-*.txt`)
- `src/import.js` – foto-import (Claude vision + JSON-schema afgeleid van de formuliervelden), `public/js/import.js` – camera en verkleinen
