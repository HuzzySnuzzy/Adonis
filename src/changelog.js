'use strict';
/**
 * Wat is er nieuw: alle versies van ADONIS, nieuwste eerst. Getoond bij Instellingen → Wat is er nieuw.
 * Bij elke nieuwe versie hier bovenaan een regel toevoegen (in gewone taal, voor de gebruikers).
 */
module.exports = [
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
