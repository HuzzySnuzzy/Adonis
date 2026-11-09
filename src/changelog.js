'use strict';
/**
 * Wat is er nieuw: alle versies van ADONIS, nieuwste eerst. Getoond bij Instellingen → Wat is er nieuw.
 * Bij elke nieuwe versie hier bovenaan een regel toevoegen (in gewone taal, voor de gebruikers).
 */
module.exports = [
  {
    version: '1.43.0', date: '2026-11-09', title: 'Foto\'s en extra bladen bij een werkopdracht',
    items: [
      'Foto\'s bij een werkopdracht: onderaan de werkopdracht "Foto maken" of "Foto\'s kiezen" (bijvoorbeeld schade, een onderdeel, het dashboard of de km-stand). Bij een nieuwe werkopdracht kan dat na het opslaan.',
      'Extra bladen: onder de achterkant "Blad toevoegen" met een vervolgblad voorkant (22 extra onderdelen en meer werkzaamheden), een vervolgblad achterkant (APK/afkeurpunten, aandachtspunten, notities) of een leeg blad met een titel. Onderdelen op een vervolgblad tellen mee in het totaal, de bladen worden mee afgedrukt en u kunt erin zoeken.',
      'Op de telefoon staat de rechterhelft van de werkopdracht (klant, auto, werkzaamheden) nu bovenaan, daarna de onderdelen.',
    ],
  },
  {
    version: '1.42.1', date: '2026-11-09', title: 'Suggesties op de telefoon',
    items: [
      'Op de telefoon viel de lijst met suggesties over het vak waarin u typte. Nu staat hij er altijd direct onder, of erboven als het toetsenbord in de weg zit, en hij schuift mee als het scherm verspringt.',
    ],
  },
  {
    version: '1.42.0', date: '2026-11-09', title: 'Rekenhulp en een slimmere werkopdracht',
    items: [
      'Nieuw: Rekenhulp in het menu. Band omrekenen (diameter, omtrek, wat de teller aangeeft en andere maten met dezelfde diameter), last- en snelheidsindex, leeftijd van een band uit de DOT-code, bar/psi/kPa, Nm/lbf·ft, kW/pk, verbruik (l/100 km, km/l, mpg), arbeidsloon, BTW, lengte, afstand, snelheid, inhoud, temperatuur en mengsmering.',
      'Werkopdracht: typ het kenteken van een bekende klant en naam, adres, telefoon, merk/type en APK-datum worden ingevuld (alleen lege vakken, geel = even nakijken). Bovenaan staat wat we al weten: vorige werkopdracht, laatste km-stand, servicebeurt, olie van vorige keer en banden in het bandenhotel.',
      'Tijdens het typen verschijnen suggesties: onderdelen uit eerdere werkopdrachten (met prijs) en uit de voorraad, werkzaamheden die vaker voorkomen, bandenmaat en -merk. Kies met de pijltjes en Enter.',
      'Knoppen "Olie van vorige keer invullen" en "Bandenmaten invullen". Een gekozen bandenmaat komt ook op het andere wiel van dezelfde as.',
      'Waarschuwingen: km-stand lager dan vorige keer, km uit lager dan km in, APK verlopen of bijna verlopen, banden ouder dan 6 jaar (DOT) en een servicebeurt die lang geleden is.',
      'RDW vult nu ook "Datum deel I" in (datum eerste toelating), en het uurtarief van de vorige werkopdracht staat al klaar.',
      'Rekenhulp kan bij Systeem → Onderdelen worden uitgezet.',
    ],
  },
  {
    version: '1.41.0', date: '2026-11-09', title: 'Onderdelen aan- of uitzetten',
    items: [
      'Bij Systeem → Onderdelen zet de beheerder Werkopdrachten, Bandenhotel, Voorraad, APK-lijst, Portaal en AI (Claude) los aan of uit. Zo kunt u ADONIS bijvoorbeeld alleen als bandenhotel of alleen voor de voorraad gebruiken.',
      'Een onderdeel dat uit staat verdwijnt voor iedereen uit het menu, het startscherm, het bureaublad, de klantpagina en de meldingen, en de pagina\'s ervan zijn niet meer te openen. Open schermen van collega\'s laden vanzelf opnieuw.',
      'De knop "+ Nieuw" past zich aan: zonder werkopdrachten wordt het "Banden inslaan" of "Nieuw onderdeel".',
      'Er wordt niets verwijderd: zet u een onderdeel weer aan, dan staat alles er nog. Klanten staan altijd aan.',
    ],
  },
  {
    version: '1.40.0', date: '2026-11-09', title: 'Opgepoetst: tientallen kleine verbeteringen',
    items: [
      'Toetsenbord en leesbaarheid: overal dezelfde zichtbare rand bij Tab (ook op links en uitklapkopjes), dezelfde pijltjes bij alle uitklapbare onderdelen, en "Uitloggen" in de menubalk ziet er net zo uit als de knoppen ernaast.',
      'Thema\'s: witte tekst op lichte accentkleuren (Neon, Black Ice) is nu donker en leesbaar, de gouden titels in ADONIS vervagen niet meer aan het eind, grijze tekst op het Aero- en Windows 98-bureaublad is beter te lezen, uitgeschakelde knoppen zien er uitgeschakeld uit, en dialoogvensters, menu\'s en plaknotitiemenu\'s volgen de stijl van het thema (hoekig in Windows 98/VCDS, zwevend in OLED, eigen vensterstijl in Neon en Black Ice).',
      'Meldingen: elke soort houdt zijn eigen kleurstreep in alle thema\'s, menu\'s en meldingen liggen altijd boven plaknotities, de dagelijkse herinnering komt één keer per dag, en de live-verbinding herstelt zich vanzelf na een onderbreking (ook als het tabblad lang verborgen was).',
      'Plaknotities: de knop staat linksonder in plaats van over de lijst, nieuwe notities liggen trapsgewijs onder de kentekenregel, en een notitie bij een verwijderde werkopdracht blijft op het scherm bewaard.',
      'Werkopdracht: de vraag "wijzigingen niet opgeslagen" verschijnt niet meer onterecht na een dialoogvenster, bedragen als 1.250 worden goed gelezen, verplichte velden die leeg bleven blijven rood omrand, en in Black Ice en Neon valt het nummer niet meer buiten het blad.',
      'Bureaublad: het rechtsklikmenu is compact in alle thema\'s, het startmenu past op kleinere schermen, pictogrammen staan vrij van de notitieknop, vensters passen bij openen altijd in het scherm, een gemaximaliseerd venster laat zich pas slepen na een duidelijke beweging, de menu\'s zijn met de pijltjestoetsen te bedienen, en een te grote eigen foto wordt vanzelf verkleind.',
      'Telefoon: de werkbalk van de werkopdracht in twee nette kolommen, de APK-tabbladen op één regel, geen zijwaarts scrollen meer op smalle schermen. Afdrukken van lijsten gebeurt zonder zoekbalk, filters en knoppen.',
      'Server: de update-bewaker draait nu ook bij Docker en npm start, een herstart voor een update wacht tot backups en lopende AI-taken klaar zijn, AI-analyses en aandachtspunten worden niet dubbel gestart als twee collega\'s tegelijk klikken, en het Portaal haalt geen adressen van de server zelf (localhost) op.',
      'Onder de motorkap: dubbele en ongebruikte stijlregels opgeruimd, kleuren, hoeken en maten als herbruikbare variabelen, en tientallen kleine verbeteringen in de code (foutafhandeling bij AI-taken, geen dubbele verzoeken, timers die netjes opruimen).',
    ],
  },
  {
    version: '1.39.0', date: '2026-11-08', title: 'Websites uit het Portaal binnen ADONIS',
    items: [
      'In de ADONIS-app openen websites uit het Portaal (en "Opzoeken met …" bij een kenteken) nu binnen ADONIS: in een eigen venster met terug, vooruit, opnieuw laden, het adres en "Openen in browser". In de bureaubladmodus als venster op het bureaublad. Shift+klik opent toch de gewone browser.',
      'Inloggen bij leveranciers blijft bewaard. De websites krijgen geen toegang tot de app (camera e.d. staat uit). In een gewone browser opent een website zoals vroeger in een nieuw tabblad.',
      'Bureaublad: bij Personaliseren kunt u nu de grootte van de vensterinhoud kiezen (60–120%), zodat er meer in een venster past.',
      'Bureaublad: meldingen staan nu boven de taakbalk in plaats van erachter.',
    ],
  },
  {
    version: '1.38.2', date: '2026-11-08', title: 'De app onthoudt volledig scherm',
    items: [
      'De ADONIS-app onthoudt nu of hij op volledig scherm (F11) stond, net als de grootte, plek en gemaximaliseerd. Bij de volgende start staat hij weer zo.',
    ],
  },
  {
    version: '1.38.1', date: '2026-11-08', title: 'Bureaublad: verslepen, personaliseren en de Ctrl-toets',
    items: [
      'Vensters hebben nu een gewone vensterkleur als achtergrond in plaats van nog eens de achtergrond van het bureaublad.',
      'Pictogrammen op het bureaublad kunt u verslepen (ze klikken vast op een raster en blijven waar u ze zet). Met de rechtermuisknop op het bureaublad: sorteren op naam of in de standaardvolgorde, vensters schikken, kleine/normale/grote pictogrammen en Personaliseren.',
      'Personaliseren: kies een achtergrond (van het thema, een kleur, een kleurverloop of een eigen foto, vullend/passend/naast elkaar/in het midden) en de grootte van de pictogrammen. Alleen voor u, op deze computer.',
      'Plaknotities liggen nu op het bureaublad zelf: vensters gaan eroverheen.',
      'Linker Ctrl los indrukken en loslaten opent het startmenu, ook terwijl u in een venster werkt (Ctrl+C, Ctrl+klik enz. werken gewoon).',
      'Escape op het bureaublad stuurt u niet meer weg van het bureaublad.',
    ],
  },
  {
    version: '1.38.0', date: '2026-11-08', title: 'Bureaubladmodus: pagina\'s als vensters',
    items: [
      'Nieuw bij Instellingen: Bureaubladmodus. ADONIS opent dan als een bureaublad met pictogrammen; elke pagina opent in een venster dat u kunt verslepen, groter/kleiner maken, minimaliseren en maximaliseren (dubbelklik op de titelbalk, of sleep naar de bovenrand). Zo staan bijv. een werkopdracht, de klant en de APK-lijst naast elkaar.',
      'Onderaan een taakbalk met een startmenu (alle onderdelen, Instellingen, "Vensters schikken", Uitloggen), een knop per open venster en een klok. Ctrl+klik of de middelste muisknop op een link of rij opent een nieuw venster.',
      'De vensters en hun plek worden onthouden. De vensters nemen de stijl van het thema over (grijs 3D in Windows 98/VCDS, glas in Aero, goud in ADONIS). Op een telefoon of tablet blijft alles gewoon.',
    ],
  },
  {
    version: '1.37.0', date: '2026-11-08', title: 'Geheim thema Windows 98',
    items: [
      'Nieuw geheim thema: Windows 98. Het groenblauwe bureaublad, grijze 3D-vensters en knoppen, titelbalken van donker- naar lichtblauw en onderaan een taakbalk met een startknop en een klok. Met een eigen opstartvenster "ADONIS 98".',
    ],
  },
  {
    version: '1.36.1', date: '2026-11-08', title: 'Beter leesbaar, en de server crasht niet meer na een update',
    items: [
      'Knoppen en labels die in sommige thema\'s slecht leesbaar waren, zijn opgelost: o.a. "Nieuwe werkopdracht" op het startscherm in Neon en Black Ice (nu donkere tekst op de lichte kleur), rode tellers in Donker/OLED, de voettekst en tellers in Aero, ADONIS, Licht en OLED, en de APK-datums in Neon/Black Ice. Alles is per thema nagemeten.',
      'Server: na een live update kon de oude versie een kwartier later vastlopen (automatische backup op een gesloten database), waarna Pterodactyl de server herstartte. Opgelost: een kleine bewaker start ADONIS, opent zelf nooit de database en start na een update gewoon de nieuwe versie.',
      'Server: het kijken naar updates gebruikt niet meer de GitHub-API (max. 60 vragen per uur, gedeeld met andere servers op hetzelfde adres), maar de gewone releasepagina. "GitHub-limiet bereikt" hoort daarmee bij het verleden.',
    ],
  },
  {
    version: '1.36.0', date: '2026-11-08', title: 'Geheim thema Aero, en de app werkt zichzelf bij terwijl hij draait',
    items: [
      'Nieuw geheim thema: Aero. Doorschijnend, wazig glas in de menubalk en rond de vensters, een blauwe hemel met lichtlinten, glanzende knoppen die blauw oplichten en selecties zoals in de Verkenner, in de stijl van Windows 7. Met een eigen "Welkom" bij het opstarten.',
      'De ADONIS-app kijkt nu elke 30 seconden of de server een nieuwere versie heeft (en meteen nadat de server is bijgewerkt), in plaats van alleen bij het starten. De nieuwe app wordt op de achtergrond gedownload; daarna verschijnt rechtsonder "Nu opnieuw starten".',
    ],
  },
  {
    version: '1.35.0', date: '2026-11-08', title: 'Meer en langere meldingen',
    items: [
      'Meldingen rechtsonder blijven nu 15 seconden staan (een streepje laat zien hoe lang nog), en blijven staan zolang de muis erop staat. Met het kruisje sluit u ze, met een klik gaat u ernaartoe.',
      'Nieuwe meldingen als een collega iets doet: werkopdracht gefactureerd of verwijderd, banden ingeslagen/gewisseld/uitgegeven, voorraad toegevoegd/gewijzigd/op, klantgegevens of kenteken gewijzigd, klant gebeld voor de APK en nieuwe gedeelde plaknotities.',
      'Herinneringen: één keer per dag hoeveel klanten gebeld moeten worden voor de APK (binnen 2 weken of net verlopen) en voor de bandenwissel. Die blijven op elke pagina staan tot u ze sluit.',
      'Bij Instellingen → Meldingen zet u elke soort aan of uit, en kunt u een voorbeeldmelding bekijken.',
    ],
  },
  {
    version: '1.34.0', date: '2026-11-08', title: 'Lijsten sorteren op kolom',
    items: [
      'Klik op een kolomkop (Nr., Status, Datum, Kenteken, Naam, Km-stand…) om de lijst daarop te sorteren, zoals in Taakbeheer. Nog een keer klikken draait de volgorde om; een derde keer zet de gewone volgorde terug.',
      'Werkt bij Werkopdrachten, Klanten, APK-lijst, Bandenhotel, Wissellijst en Voorraad. Datums en getallen sorteren goed, lege vakken komen onderaan, en de keuze blijft staan als de lijst live wordt bijgewerkt.',
    ],
  },
  {
    version: '1.33.2', date: '2026-11-08', title: 'Knoppen overal op dezelfde plek',
    items: [
      'Op elke pagina staat de titel linksboven, de knoppen rechtsboven (de blauwe hoofdknop helemaal rechts) en de zoekbalk op een eigen regel eronder. Zo zitten knoppen niet meer op de ene pagina naast de zoekbalk en op de andere onder de uitleg.',
      'Klanten en Werkopdrachten zijn even breed als APK-lijst, Bandenhotel, Voorraad en Portaal, zodat de knoppen rechts precies op dezelfde plek staan.',
      'Op de telefoon: titel, dan de zoekbalk, dan de knoppen.',
    ],
  },
  {
    version: '1.33.1', date: '2026-11-08', title: 'Alleen Systeem, Licht en Donker standaard zichtbaar',
    items: [
      'In de themalijst staan standaard alleen Systeem, Licht en Donker. ADONIS, OLED, VCDS, Neon en Black Ice verschijnen als u bij Instellingen "Geheime thema\'s" aanzet.',
      'Wie al een van die thema\'s gebruikte, houdt het gewoon (de geheime thema\'s staan dan voor u aan).',
    ],
  },
  {
    version: '1.33.0', date: '2026-11-08', title: 'Server werkt zichzelf live bij',
    items: [
      'De server (bijv. op Pterodactyl) kijkt nu elke 15 seconden of er een nieuwe versie is, ook terwijl hij draait. Instelbaar met update-check-seconds (Pterodactyl: "Controleren op updates"); 0 = alleen bij het starten.',
      'Een nieuwe versie wordt eerst gedownload en gecontroleerd terwijl ADONIS gewoon doorwerkt. Pas daarna herstart hij, en is hij ongeveer een halve seconde onbereikbaar.',
      'Loopt er net een backup of een Claude-taak voor alle klanten, dan wacht de herstart daarop. Open schermen krijgen een melding en laden daarna vanzelf opnieuw, behalve als iemand nog iets aan het invullen is.',
      'Herstarten na een update of het terugzetten van een backup stapelt geen processen meer op; Stop in het paneel stopt alles netjes.',
    ],
  },
  {
    version: '1.32.1', date: '2026-11-08', title: 'Kostenschatting bij grote lijsten',
    items: [
      'De kostenschatting voor Claude gaf een foutmelding ("maximumFractionDigits") als het bedrag € 10 of meer was, bijvoorbeeld bij APK-aandachtspunten voor alle APK-datums. Opgelost: grote bedragen staan nu in hele euro\'s.',
    ],
  },
  {
    version: '1.32.0', date: '2026-11-08', title: 'Het thema ADONIS',
    items: [
      'Nieuw thema: ADONIS, het thema der thema\'s. Griekse schoonheid: wit marmer met gouden aders, bladgoud, Egeïsch blauw, een Griekse sleutelrand onder de menubalk en klassieke letters.',
      'Zonnestralen vallen langzaam draaiend over het marmer en gouden stofjes zweven in het licht. Bij het opstarten komt de zon op, groeit een lauwerkrans rond het logo en worden de letters verguld.',
      'Het inlogscherm staat voor een Griekse tempel. Kies het thema via het themaknopje rechtsboven (het bovenste in de lijst) of bij Instellingen.',
      'Met Effecten: Rustig staan alle bewegingen stil; afdrukken blijft gewoon zwart op wit.',
    ],
  },
  {
    version: '1.31.0', date: '2026-11-08', title: 'Plaknotities',
    items: [
      'Nieuw: plaknotities, zoals gele memoblaadjes. Klik op het gele knopje links op het scherm.',
      'Bij het maken kiest u de kleur (standaard geel), of alleen u hem ziet of iedereen op deze ADONIS, en waar hij komt: op het scherm (op elke pagina) of op de werkopdracht die open staat.',
      'Notities op een werkopdracht ziet u alleen bij die werkopdracht; in de lijsten staat dan een geel briefje-teken bij het nummer.',
      'Verslepen aan de bovenrand, inklappen met –, en via ⋯ de kleur wijzigen, delen, verplaatsen of weggooien. Met het oog-knopje verbergt of toont u alle notities. Gedeelde notities worden direct bijgewerkt bij collega\'s.',
    ],
  },
  {
    version: '1.30.0', date: '2026-11-08', title: 'AI-analyse: een röntgenfoto van een auto',
    items: [
      'Nieuw op het startscherm: AI-analyse. Kies een kenteken of klant (of beschrijf de auto) en Claude zoekt alles over die auto op: motor, aandrijving, rijgedrag en comfort, verbruik, originele banden, onderhoud, bekende problemen en APK-punten, met bronnen.',
      'Daarna verschijnt een röntgenbeeld van de auto met de juiste indeling (motor voor, midden of achter; voor-, achter- of vierwielaandrijving) en wijzers naar banden, remmen, onderstel, interieur, verlichting, motor en meer. Klik op een wijzer voor de details.',
      'Bij elke klant staat een knop "AI-analyse van deze auto".',
      'Claude-knoppen hebben een eigen AI-icoon in plaats van de sterretjes.',
    ],
  },
  {
    version: '1.29.2', date: '2026-11-08', title: 'Nieuwe gebruikers beginnen eenvoudig',
    items: [
      'Nieuwe gebruikers krijgen standaard de eenvoudige weergave (startscherm met grote knoppen). Bij Gebruikers kunt u het vinkje "Eenvoudige weergave" uitzetten bij het aanmaken; later wijzigen kan ook.',
    ],
  },
  {
    version: '1.29.1', date: '2026-11-08', title: 'Escape naar Start, Terug naar waar u vandaan kwam',
    items: [
      'De Escape-toets brengt u altijd naar het startscherm. Een open venster of menu sluit eerst, en in een invoerveld verlaat de eerste Escape alleen het veld.',
      'De terug-links ("← …") gaan nu naar de pagina waar u echt vandaan kwam (bijv. van een klant terug naar de APK-lijst), ook na opslaan.',
      'De ADONIS-app heeft een terugknop links in de menubalk; Alt + ← en de terugknop van de muis werken ook (Alt + → is vooruit).',
    ],
  },
  {
    version: '1.29.0', date: '2026-11-08', title: 'Nieuw startscherm',
    items: [
      'Het startscherm is opnieuw ontworpen: een rustige kop met de datum, één grote zoekbalk en "Nieuwe werkopdracht" als duidelijke hoofdknop.',
      'Onder "Vandaag" staat met grote getallen wat er te doen is: klanten bellen voor de bandenwissel en de APK, en wat klaar is om te factureren.',
      'Onder "Snel naar" heeft elk onderdeel een eigen kleur en past alles op één regel. Op de telefoon staan de getallen naast elkaar.',
      'Opgelost: de kostenschatting voor "APK-aandachtspunten opzoeken" op de APK-lijst gaf soms "Unexpected token <".',
    ],
  },
  {
    version: '1.28.1', date: '2026-11-08', title: 'APK-aandachtspunten vanaf de APK-lijst',
    items: [
      'Op de APK-lijst staat een knop om de APK-aandachtspunten op te zoeken voor alle automodellen in de getoonde lijst (beheerders). Modellen die al zijn opgezocht worden overgeslagen; u ziet vooraf wat het kost en daarna de voortgang.',
      'In de APK-lijst staat bij een klant hoeveel APK-punten er voor dat model bekend zijn, met een link naar de klant.',
    ],
  },
  {
    version: '1.28.0', date: '2026-11-08', title: 'APK-aandachtspunten per automodel en inklapbare vakken',
    items: [
      'Nieuw op de klantpagina: APK-aandachtspunten voor het model van de auto. Claude zoekt op internet de bekende zwakke plekken op (bijv. waar het model roest, gordels, ophanging), met bronnen.',
      'Eén keer opzoeken per model en bouwjaar: alle klanten met dezelfde auto zien het resultaat, zonder extra kosten.',
      'Aandachtspunten zijn nu inklapbare vakken: één regel met het aantal en een voorproefje; klik om te openen. Elk punt klapt ook apart open. ADONIS onthoudt welke vakken u open heeft.',
      'De werkopdracht toont dezelfde vakken (ingeklapt) voor die auto.',
    ],
  },
  {
    version: '1.27.1', date: '2026-11-08', title: 'Wat is er nieuw',
    items: [
      'Bij Instellingen staat nu een overzicht van alle versies en wat er per versie is veranderd. Klik op het versienummer onderaan een pagina om er direct naartoe te gaan.',
    ],
  },
  {
    version: '1.27.0', date: '2026-11-08', title: 'Aandachtspunten van Claude, slimmer zoeken en zoeken op kenteken',
    items: [
      'Aandachtspunten: Claude leest alle werkopdrachten van een auto en zet alleen wat belangrijk is voor een volgend bezoek op de klantpagina en bovenaan de werkopdrachten van die auto (bijv. gebruikte accu geplaatst, codering aangepast, advies niet uitgevoerd). Afvinken met "Afgehandeld".',
      'Beheerders kunnen alle klanten in één keer laten analyseren, met voortgang en een stopknop.',
      'Voor elke Claude-taak kiest u eerst hoeveel moeite Claude mag doen (Snel, Normaal of Grondig) en ziet u vooraf wat het ongeveer kost.',
      'Zoekwoorden: zoeken op "light" of "lampen" vindt ook "dagrijverlichting". Eigen woorden toevoegen kan bij Werkopdrachten → Zoekwoorden.',
      'Websites in het Portaal kunnen zoeken met het kenteken: op de klantpagina en de werkopdracht staat "Opzoeken met …" met het kenteken al ingevuld.',
      'Namen, adressen, telefoonnummers, alarmcodes en prijzen gaan nooit naar Claude.',
    ],
  },
  {
    version: '1.26.1', date: '2026-11-08', title: 'Bijwerken van de app op Windows, zoeken tijdens typen',
    items: [
      'De ADONIS-app werkt zichzelf nu ook bij op Windows: de nieuwe versie wordt na het afsluiten op zijn plek gezet ("resource busy or locked" is opgelost).',
      'Startscherm: klanten verschijnen al terwijl u typt.',
      'Klantpagina: het zoeken in werkopdrachten werkt nu ook tijdens het typen.',
    ],
  },
  {
    version: '1.26.0', date: '2026-11-08', title: 'Portaal: al uw websites op één plek',
    items: [
      'Nieuwe pagina Portaal: mappen met websites (leveranciers, RDW, bank…) voor de hele garage. Pictogram en naam worden automatisch opgehaald.',
      'Snelkoppelingen van het bureaublad of bladwijzers uit de browser in één keer importeren.',
      'Tegels verslepen, mappen hernoemen en een zoekvak (Enter opent de eerste website).',
    ],
  },
  {
    version: '1.25.1', date: '2026-11-08', title: 'Voortgang bij het bijwerken van de app',
    items: [
      'De app toont rechtsonder de voortgang van een update en vraagt daarna "Nu opnieuw starten" of "Later".',
      'Afsluiten of opnieuw starten met niet-opgeslagen werk vraagt eerst om bevestiging.',
    ],
  },
  {
    version: '1.25.0', date: '2026-11-08', title: 'Wisselen met keuzevenster',
    items: [
      'Wisselen opent een venster: kies welke banden erop gaan, welke eraf komen en waar die gaan liggen.',
    ],
  },
  {
    version: '1.24.6', date: '2026-11-08', title: 'Afdrukvoorbeeld in de app',
    items: [
      'Afdrukken in de ADONIS-app toont eerst een voorbeeld (werkopdracht A4 liggend, met de grijze vakken) met knoppen voor afdrukken en opslaan als PDF.',
      'Geen schuifbalk meer op een afgedrukte werkopdracht.',
    ],
  },
  { version: '1.24.5', date: '2026-11-08', title: 'Animaties in de eenvoudige weergave', items: ['De eenvoudige weergave heeft weer gewoon animaties (volgens de instelling Effecten).'] },
  {
    version: '1.24.4', date: '2026-11-08', title: 'De app werkt zichzelf bij',
    items: ['De ADONIS-app downloadt zelf de versie die op de server draait.'],
  },
  {
    version: '1.24.3', date: '2026-11-08', title: 'Startpagina bij het openen',
    items: ['De gekozen startpagina opent nu ook bij het starten van de app of de browser.', 'Bij Instellingen staat een melding als er een nieuwere ADONIS-app is.'],
  },
  { version: '1.24.2', date: '2026-11-08', title: 'Opstartanimatie na inloggen', items: ['De opstartanimatie speelt nu ook na het inloggen.'] },
  {
    version: '1.24.1', date: '2026-11-08', title: 'Serveradres op het inlogscherm',
    items: ['Het inlogscherm toont met welke server u verbonden bent (vervaagd tot u erop wijst); in de app met de knop "Wijzigen".', 'Instellingen → Effecten vertelt waarom er geen animaties zijn, met een knop om de opstartanimatie te bekijken.'],
  },
  {
    version: '1.24.0', date: '2026-11-08', title: 'Sneller werken',
    items: [
      'Lijsten worden al bijgewerkt terwijl u typt.',
      'Een volledig kenteken + Enter opent meteen die klant.',
      'De menubalk past op een laptop op één rij; lange lijsten tonen eerst 100 regels met "Meer tonen".',
      'De toets / springt naar het zoekvak.',
    ],
  },
  { version: '1.23.1', date: '2026-11-08', title: 'APK-lijst opgeschoond', items: ["APK's die al meer dan een week verlopen zijn, staan niet meer bij \"Komende 2 maanden\" (wel bij \"Al verlopen\")."] },
  { version: '1.23.0', date: '2026-11-08', title: 'Thema VCDS', items: ['Nieuw thema in de stijl van een klassiek diagnoseprogramma: grijze vensters, 3D-knoppen en een blauwe titelbalk.'] },
  {
    version: '1.22.0', date: '2026-11-08', title: 'Automatische backups en APK-lijst',
    items: [
      'Elke dag automatisch een backup, naar zelf gekozen mappen (USB, netwerkschijf, OneDrive/Google Drive/Dropbox) of als download. Terugzetten kan ook.',
      'APK-lijst: wie moet binnenkort naar de APK, met "Gebeld" en een knop voor een nieuwe werkopdracht.',
    ],
  },
  { version: '1.21.0', date: '2026-11-07', title: "Voorbeeldfoto's van onderdelen", items: ["De voorraad toont voorbeeldfoto's van de soort onderdeel, en een knop om afbeeldingen van dat onderdeel te zoeken."] },
  { version: '1.20.1', date: '2026-11-07', title: 'Nauwkeuriger autofoto', items: ['De foto van het automodel klopt vaker; een verkeerde foto kunt u verbergen.', 'De telefoonweergave staat niet meer aan op de computer.'] },
  {
    version: '1.20.0', date: '2026-11-07', title: 'Eenvoudige weergave en hulp',
    items: [
      'Eenvoudige weergave met een startscherm met grote knoppen.',
      'Hulppagina met uitleg in stappen.',
      'Een werkopdracht wordt tijdens het typen bewaard en kan na een ongeluk worden teruggezet; ingelogd blijven op een apparaat.',
      'Een foto van het automodel op de klantpagina.',
    ],
  },
  { version: '1.19.1', date: '2026-11-07', title: 'Beter op de telefoon', items: ['Lijsten worden op de telefoon kaarten, zonder opzij te schuiven; een compactere menubalk.'] },
  { version: '1.19.0', date: '2026-11-07', title: 'Banden op de auto en wissellijst', items: ['Bijhouden welke banden op de auto staan.', 'Wissellijst: wie moet komen wisselen.', 'Weergave op de telefoon instelbaar.'] },
  { version: '1.18.0', date: '2026-11-07', title: 'Thema OLED en opstartanimaties', items: ['Nieuw thema OLED (puur zwart, alles zweeft).', 'Elk thema heeft een opstartanimatie.', 'Neon en Black Ice alleen met de voorkeur "Geheime thema\'s".'] },
  { version: '1.17.0', date: '2026-11-07', title: 'Klantgegevens wijzigen', items: ['Klantgegevens wijzigen op de klantpagina.', 'Tabellen lopen niet meer uit beeld.'] },
  { version: '1.16.0', date: '2026-11-07', title: 'Thema Black Ice', items: ['Nieuw thema Black Ice (ICE·XVIII).'] },
  { version: '1.15.0', date: '2026-11-07', title: "Foto's en kentekenplaten", items: ["Foto's bij banden en voorraad; foto's koppelen uit een Excel-import.", 'Duitse kentekens en echte kentekenplaten.'] },
  { version: '1.14.0', date: '2026-11-07', title: 'Bandenhotel, voorraad en Excel-import', items: ['Bandenhotel en voorraad.', 'Excel-lijsten importeren, met Claude als meekijker.'] },
  { version: '1.13.0', date: '2026-11-07', title: 'Themamenu', items: ['De themaknop opent een keuzemenu.'] },
  { version: '1.12.0', date: '2026-11-07', title: 'ADONIS-app voor Windows', items: ['Een eigen venster voor ADONIS, met eigen icoon in de taakbalk.'] },
  { version: '1.11.0', date: '2026-11-07', title: 'Thema Neon vernieuwd', items: ['Thema Neon in de stijl van het 2049-thema van DiscordLinked.'] },
  { version: '1.10.0', date: '2026-11-07', title: 'Vloeiende paginawissels', items: ['Vloeiende overgangen tussen pagina\'s.', 'Een werkopdracht direct als gefactureerd afronden.'] },
  { version: '1.9.1', date: '2026-11-07', title: 'Thema Neon verbeterd', items: ['Warmere stijl en vloeiender bij het aanwijzen.'] },
  { version: '1.9.0', date: '2026-11-07', title: 'Thema Neon', items: ['Nieuw futuristisch thema met animaties.'] },
  { version: '1.8.1', date: '2026-11-07', title: 'Kleine verbeteringen', items: ['Opmaak direct goed na een update; geen wachtwoord-invullen in zoekvelden.'] },
  { version: '1.8.0', date: '2026-11-07', title: 'RDW-gegevens', items: ['APK-datum, merk/type en meer van de RDW op de klantpagina en bij een nieuwe werkopdracht.'] },
  { version: '1.7.0', date: '2026-11-07', title: 'Rollen en facturatie', items: ['Rollen Monteur, Facturatie en Beheerder; werkopdrachten gaan van "klaar" naar facturatie.'] },
  { version: '1.6.1', date: '2026-11-07', title: 'Live bijwerken verbeterd', items: ['Eén verbinding per browser in plaats van per tabblad.'] },
  { version: '1.6.0', date: '2026-11-07', title: 'Online bereikbaar', items: ['ADONIS-beheerder en online bereikbaar via Cloudflare in één klik.'] },
  { version: '1.5.0', date: '2026-11-07', title: 'Live bijwerken', items: ['Wijzigingen van collega\'s verschijnen meteen op alle apparaten.'] },
  { version: '1.4.0', date: '2026-11-07', title: 'Versie onderaan', items: ['Onderaan elke pagina de versie van ADONIS en of er een update is.'] },
  { version: '1.3.3', date: '2026-11-07', title: 'Foto-import: datum', items: ['"Datum gereed" wordt gebruikt als de invoerdatum leeg of onduidelijk is.'] },
  { version: '1.3.2', date: '2026-11-07', title: 'Foto-import: datum', items: ['De datum van de papieren werkopdracht wordt overgenomen.'] },
  { version: '1.3.1', date: '2026-11-07', title: 'Foto-import betrouwbaarder', items: ['Uitlezen lukt vaker.'] },
  { version: '1.3.0', date: '2026-11-07', title: "Thema's en instellingen", items: ["Thema's Systeem, Licht en Donker; persoonlijke instellingen."] },
  { version: '1.2.0', date: '2026-11-07', title: 'Foto-import: daglimiet', items: ['Daglimiet en verbruiksoverzicht voor de foto-import.'] },
  { version: '1.1.0', date: '2026-11-07', title: 'Automatisch bijwerken', items: ['ADONIS werkt zichzelf bij vanaf nieuwe releases.'] },
  { version: '1.0.1', date: '2026-11-07', title: 'Installatie', items: ['Het programma wordt bij het starten alsnog gedownload als het ontbreekt (Pterodactyl).'] },
  {
    version: '1.0.0', date: '2026-11-07', title: 'Eerste versie',
    items: ['Inloggen, klanten per kenteken en een digitaal werkopdrachtformulier.', 'Eén programma voor Windows en Linux.', 'Foto-import: een papieren werkopdracht fotograferen en laten uitlezen.'],
  },
];
