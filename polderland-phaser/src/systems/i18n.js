/**
 * Two languages, one dictionary.
 *
 * Every player-visible string in the game lives here. Scenes ask for a key and
 * get back a string in the language currently selected; nothing outside this
 * file hard-codes prose. Keys are dotted paths grouped by where they appear.
 *
 * Placeholders are written `{name}` and filled from the params object, so word
 * order can differ between languages without the call sites caring.
 *
 * Dutch is the game's own subject matter, so the translation uses the real
 * vocabulary of water management — gemaal, boezem, kruin, maaiveld — rather
 * than a literal rendering of the English.
 */

export const LANGS = ['en', 'nl'];

/** What the language buttons say. Each language names itself. */
export const LANG_NAMES = { en: 'ENGLISH', nl: 'NEDERLANDS' };

const STRINGS = {
  en: {
    /* ---- Boot ---- */
    'boot.status': 'Draining the polder',
    'boot.step.land': 'Raising the land',
    'boot.updated': 'Updated to the latest version',

    /* ---- Menu ---- */
    'menu.tagline': 'KEEP THE SEA OUT',
    'menu.continue': 'CONTINUE - {name}',
    'menu.play': 'PLAY',
    'menu.locked': 'LOCKED',
    'menu.lockedHint': 'Locked - finish {name}',
    'menu.completed': 'Completed - best {score}',
    'menu.best': 'Best {score} (day {days})',
    'menu.settingsTip': 'Sound, vibration and language',
    'menu.howTo': 'HOW TO PLAY',
    'help.title': 'HOW TO PLAY',
    'help.back': 'BACK',
    'help.next': 'NEXT',
    'help.start': 'GOT IT',
    'help.close': 'CLOSE',
    'help.polder.title': 'A POLDER SITS BELOW THE SEA',
    'help.polder.body': 'Your fields lie lower than the water around them. Rain falls on them and has nowhere to run to. Everything else in the game follows from that one fact.',
    'help.dike.title': 'THE RING DIKE HOLDS THE SEA OUT',
    'help.dike.body': 'Storms grind it down. Watch the stress on a stretch and raise it before it gives, because a breach lets the sea in faster than any mill can take it out.',
    'help.canal.title': 'DITCHES HOLD THE WATER',
    'help.canal.body': 'The canal network is where the mills put what they lift. It is storage, not a drain: dig more and the same water stands lower in it, which makes it empty to sea more slowly, not faster.',
    'help.mill.title': 'MILLS LIFT WATER OFF THE LAND',
    'help.mill.body': 'A mill drains the wet fields around it into the ditch. It needs a ditch within two tiles to reach, and it stops dead the moment the canal is full.',
    'help.outlet.title': 'THE OUTLET IS THE WAY OUT',
    'help.outlet.body': 'It empties the canal into the sea whatever the tide is doing, and lets it run out by gravity for free whenever the tide is low. Too little outlet and every mill in the polder stalls at once.',
    'help.money.title': 'DRY LAND PAYS',
    'help.money.body': 'Rough ground earns nothing. Keep a parcel dry for a fortnight and it is broken in as pasture or field, and pays every day after. Let it go under and it falls back to rushes, so the polder you keep dry is the polder that pays for the next mill.',
    'menu.hintTouch': 'Drag to pan  -  pinch to zoom  -  tap a tile to build',
    'menu.hintKeys': 'Drag to pan  -  1-4 build  -  Space pause  -  Tab fast forward',
    'menu.settings': 'SETTINGS',
    'menu.music': 'Music',
    'menu.effects': 'Effects',
    'menu.language': 'Language',
    'menu.haptics': 'Vibration',
    'menu.on': 'ON',
    'menu.off': 'OFF',
    'menu.saveNote': 'Progress is saved on this device.',

    /* ---- Scenarios ---- */
    'level.beemster.subtitle': 'A calm spring in a young polder',
    'level.winter.subtitle': 'Gales, mostly from the north-west',
    'level.brief.title': 'PREPARE',
    'level.winter.brief': 'First gale in about {days} days. Most blow from the north-west.',
    'level.haarlemmermeer.subtitle': 'Steam drains the lake; coal costs money',
    'level.dollard.subtitle': 'Win land from the sea, without end',
    'level.dollard.brief': 'Use the Dike tool on the mud to stake fences. When the marsh by the dike has grown, click it to dike the whole stretch in as new polder. Raise the sea dike before gales. First one in about {days} days.',
    'build.enclose': 'Dike in',
    'insp.old': 'Old land',
    'insp.flat': 'Tidal flat',
    'insp.marsh': 'Salt marsh',
    'insp.toMarsh': 'To marsh',
    'insp.fenced': 'Fenced: silting fast',
    'insp.unfenced': 'No fence: silting slowly',
    'insp.drowned': 'Under the storm tide: washing away',
    'insp.drownedHeld': 'Under the storm tide: silting stopped',
    'klink.title': 'NEW POLDER SINKING',
    'klink.body': 'young clay is settling toward the canal: dig canals and build pumps',
    'ripe.title': 'MARSH READY',
    'ripe.body': 'click it with the Dike tool to dike it in',
    'build.dike.tip.wadden': 'Raise the sea defence: build on a dike\nto raise it. On the mud, the same tool\nstakes a brushwood fence: silt settles\non that tile and it grows into salt\nmarsh. Click marsh by the dike and the\nwhole stretch is diked in at once:\nnew dike in front, new polder behind.',
    'build.fence': 'Fence',
    'build.fence.tip': 'A brushwood fence on the tidal flat.\nThe tide slows over it and drops its\nsilt: this tile rises to salt marsh.\nMarsh by the dike can be diked in.',
    'no.fence.flat': 'Fences go on the tidal flat off the dike',
    'dike.join': 'This marsh does not reach the dike yet',
    'dike.narrow': 'Too narrow: the marsh has to lie along the dike, two tiles or more',
    'enclosed.title': 'NEW POLDER',
    'enclosed.body': 'the sea has given up {ha} ha so far',
    'era.title': 'A NEW ERA',
    'era.engine': 'electric pumping stations can now be built',
    'era.steam': 'steam pumping stations can now be built',
    'level.delta.subtitle': 'The long emergency',

    /* ---- Build bar ---- */
    'build.dike': 'Dike',
    'build.canal': 'Canal',
    'build.pump': 'Pump',
    'build.outlet': 'Outlet',
    'build.mill': 'Mill',
    'build.engine': 'Pump',
    'build.steam': 'Steam',
    'build.steam.tip': 'A steam pumping station: lifts twice\nwhat a mill does off the land within\n{radius} tiles, but burns coal every day it\nruns. Needs a canal within {range} tiles.',
    'build.outlet.tip.steam': 'A steam engine that lifts the canal\nto sea whatever the tide is doing.\nEach one costs more than the last.',
    'build.dike.tip': 'Raise the sea defence.\nCoastal ring only. Build on an\nexisting dike to raise it.',
    'build.canal.tip': 'Storage and conduit for the\nwater your pumps lift.\nEach one costs more than the last.',
    'build.pump.tip': 'An electric pumping station: lifts\nstanding water off the land within\n{radius} tiles. Needs a canal within\n{range} tiles to discharge into.',
    'build.mill.tip': 'A poldermolen: lifts standing water\noff the land within {radius} tiles. Needs a\ncanal within {range} tiles to discharge into.',
    'build.outlet.tip': 'Electric pumps that lift the canal\nto sea whatever the tide is doing.\nEach one costs more than the last.',
    'build.outlet.tip.mill': 'A mill that lifts the canal\nto sea whatever the tide is doing.\nEach one costs more than the last.',

    /* ---- Top bar ---- */
    'hud.perDay': '{sign}{n}/day',
    'hud.day': 'Day {n}   {speed}',
    'hud.tip.fit': 'Show the whole polder  [Home]',
    'hud.tip.fast': 'Fast forward  [Tab]',
    'hud.tip.slow': 'Normal speed',
    'hud.tip.pause': 'Pause  [Space]',
    'hud.tip.mute': 'Silence music and sound  [M]',
    'hud.tip.unmute': 'Turn sound back on  [M]',
    'gauge.sea': 'Sea level against the lowest crest\non the ring dike',
    'gauge.dry': 'How much of your land is workable today.\nRain and seepage put it under; the mills\ntake it off again. Wet land pays nothing,\nand land the sea has been over pays less\nfor a long while after.',
    'gauge.canal': 'Water level in the canal network, in\nmetres against NAP, the same datum as\nthe sea. It rises as your mills pump\ninto it; at +0.6 m it is full and they stall.',
    'gauge.homes': 'Homes still standing',
    // Short captions printed on the gauges themselves.
    'gauge.sea.cap': 'SEA',
    'gauge.dry.cap': 'DRY',
    'gauge.canal.cap': 'CANAL',
    'gauge.homes.cap': 'HOMES',

    /* ---- Placement ---- */
    'place.hintTouch': 'Tap a tile to aim, then tap BUILD.',
    'place.hintMouse': 'Pick a highlighted tile.  Right-click or Esc to cancel.',
    'place.here': '{what} here\nf {cost}',
    'place.buildHere': 'Build here for f {cost}',
    'place.confirm': 'BUILD',
    'place.cancel': 'STOP',
    'place.built': '{what} built - f {cost}',

    /* ---- Refusals ---- */
    'no.money': 'Not enough guilders',
    'no.dike.coastal': 'Dikes can only go on the coastal ring',
    'no.dike.full': 'Already at full height',
    'no.canal.dry': 'Canals need dry ground',
    'no.canal.already': 'Already a canal',
    'no.built': 'Something is built here',
    'no.machinery': 'Occupied by machinery',
    'no.canal.ring': 'Keep the coastal ring for dikes',
    'no.pump.dry': 'Pumps need dry ground',
    'no.occupied': 'Occupied',
    'no.pump.exposed': 'Too exposed - build inland',
    'no.pump.canal': 'Needs a canal within {n} tiles to discharge into',
    'no.outlet.ring': 'Outlets go in the coastal ring',
    'no.canal.near': 'Needs a canal within {n} tiles',
    'no.unknown': 'Unknown structure',
    'no.over': 'The scenario is over',
    'no.outside': 'Outside the map',

    /* ---- Tile inspector ---- */
    'insp.col': 8,
    'insp.polder': 'Polder',
    'insp.use.pasture': 'Meadow',
    'insp.use.plough': 'Arable',
    'insp.use.tulipRed': 'Tulips',
    'insp.use.tulipYellow': 'Tulips',
    'insp.yield': 'f {n} of {full}',
    'insp.salt': 'Salt',
    'insp.rough': 'Rough ground',
    'insp.roughValue': 'worth f {n}',
    'insp.reclaim': 'Broken in',
    'insp.sea': 'North Sea',
    'insp.canal': 'Canal',
    'insp.ring': 'Coastal ring',
    'insp.house': 'House',
    'insp.church': 'Church',
    'insp.ruin': 'Ruin',
    'insp.ground': 'Ground',
    'insp.water': 'Water',
    'insp.seaLevel': 'Sea',
    'insp.crest': 'Crest',
    'insp.dike': 'Dike',
    'insp.stress': 'Stress',
    'insp.pump': 'Pump',
    'insp.mill': 'Mill',
    'insp.outlet': 'Outlet',
    'insp.repair': 'Repair',
    'insp.dry': 'dry',
    'insp.canalLevel': 'Canal level',
    'insp.demolish': 'Demolish',
    'insp.refund': 'Demolish refund',
    'insp.belowCanal': 'Below canal: needs pumping',
    'insp.breached': 'BREACHED',
    'insp.level': 'level {n}/3',
    'insp.stalled': 'STALLED',
    'insp.running': 'running',
    'insp.idle': 'idle',
    'insp.draining': 'draining',
    'insp.shut': 'shut (tide)',
    'insp.pumping': 'pumping',
    'insp.off': 'off',
    'insp.stage.engine': 'pumps',
    'insp.stage.mill': 'mill',
    'insp.stage.steam': 'steam',
    'insp.flooded': 'FLOODED',

    /* ---- Weather ---- */
    'dir.xm': 'north-west',
    'dir.xp': 'south-east',
    'dir.ym': 'north-east',
    'dir.yp': 'south-west',
    'storm.warnBanner': 'STORM IN {n} DAYS - {peak} M FROM THE {dir}',
    'storm.activeBanner': 'STORM - {n} DAYS LEFT - FROM THE {dir}',
    'storm.over': 'The storm has blown itself out.',
    'breach.title': 'DIKE BREACH!',
    'breach.body': 'the sea is through at {x},{y}',
    'lost.title': 'HOUSE LOST',
    'lost.body': 'a home has gone under',
    'lost.float': 'LOST',
    'broke.title': 'OUT OF MONEY',
    'broke.pump': 'a mill has been laid up',
    'broke.outlet': 'the outlet pumps have been shut down',
    'canalFull.title': 'THE CANAL IS FULL',
    'canalFull.body': 'The mills have nowhere to put the water. Build another outlet; digging more ditch only makes the canal stand lower and drain slower.',
    'broke.float': 'LAID UP',
    'backOn.all': 'The works are running again.',
    'backOn.some': 'One of the works is running again - {n} still laid up.',

    /* ---- Tutorial ---- */
    'tut.1.title': 'LOOK AROUND',
    'tut.1.text': 'Drag to pan, scroll to zoom. The polder floor sits below sea level - only the ring dike is keeping the sea out.',
    'tut.2.title': 'WATCH THE WATER',
    'tut.2.text': 'Rain collects in the lowest fields. Click any tile to read its ground level and depth.',
    'tut.3.title': 'DIG A CANAL',
    'tut.3.text': 'Canals hold the water your pumps lift. Press [2] and extend the ditch by one tile.',
    'tut.4.title': 'BUILD A MILL',
    'tut.4.text': 'Press [3] and put a poldermolen next to the canal. Its scoop wheel lifts water off the land into the canal.',
    'tut.6.title': 'WATCH THE CANAL',
    'tut.6.text': 'Your outlets empty the canal into the sea. Watch the canal gauge: if it fills up, your mills stall. When it stays high, press [4] and build another outlet on the ring.',
    'tut.7.title': 'BUILD FOR THE STORM',
    'tut.7.text': 'A storm drops six times the normal rain. Size your pump fleet for that, not for a quiet week, or the polder fills up faster than you can drain it.',
    'tut.8.title': 'RAISE THE DIKE',
    'tut.8.text': 'Storms arrive from one side. When warned, press [1] and build on the dikes facing the wind to raise their crest.',

    /* ---- Pause ---- */
    'pause.title': 'PAUSED',
    'pause.resume': 'RESUME',
    'pause.saveQuit': 'SAVE AND QUIT',
    'pause.restart': 'RESTART SCENARIO',
    'pause.keys': 'Esc / Space  resume\n1-4          build\nTab          fast forward',

    /* ---- Result ---- */
    'over.won': 'THE POLDER HOLDS',
    'over.lost': 'THE SEA WINS',
    'over.endlessBody': 'You won {ha} ha from the sea before it took the village back.',
    'over.leaderboard': 'RANKS',
    'over.wonBody': '{intact} of {total} homes still standing.',
    'over.lostBody': 'Only {intact} of {total} homes remained.',
    'over.days': 'Days survived',
    'over.homes': 'Homes saved',
    'over.breaches': 'Dike breaches',
    'over.peak': 'Highest sea level',
    'over.spent': 'Spent on works',
    'over.score': 'SCORE',
    'over.newBest': 'NEW BEST',
    'over.best': 'best {score}',
    'over.retry': 'RETRY',
    'over.next': 'NEXT',
    'over.menu': 'MENU',

    /* ---- Calendar ---- */
    'month.1': 'Jan',
    'month.2': 'Feb',
    'month.3': 'Mar',
    'month.4': 'Apr',
    'month.5': 'May',
    'month.6': 'Jun',
    'month.7': 'Jul',
    'month.8': 'Aug',
    'month.9': 'Sep',
    'month.10': 'Oct',
    'month.11': 'Nov',
    'month.12': 'Dec',
    'locale': 'en-GB',
  },

  nl: {
    /* ---- Boot ---- */
    'boot.status': 'De polder droogmalen',
    'boot.step.land': 'Het land ophogen',
    'boot.updated': 'Bijgewerkt naar de nieuwste versie',

    /* ---- Menu ---- */
    'menu.tagline': 'HOUD DE ZEE BUITEN',
    'menu.continue': 'VERDER - {name}',
    'menu.play': 'SPELEN',
    'menu.locked': 'OP SLOT',
    'menu.lockedHint': 'Op slot - speel eerst {name} uit',
    'menu.completed': 'Voltooid - beste {score}',
    'menu.best': 'Beste {score} (dag {days})',
    'menu.settingsTip': 'Geluid, trillen en taal',
    'menu.howTo': 'ZO SPEEL JE',
    'help.title': 'ZO SPEEL JE',
    'help.back': 'TERUG',
    'help.next': 'VERDER',
    'help.start': 'DUIDELIJK',
    'help.close': 'SLUIT',
    'help.polder.title': 'EEN POLDER LIGT ONDER ZEENIVEAU',
    'help.polder.body': 'Je land ligt lager dan het water eromheen. Regen valt erop en kan nergens heen. Al het andere in dit spel volgt uit dat ene feit.',
    'help.dike.title': 'DE RINGDIJK HOUDT DE ZEE TEGEN',
    'help.dike.body': 'Stormen slijten hem uit. Let op de belasting van een dijkvak en verhoog het voordat het bezwijkt: door een doorbraak loopt de zee sneller naar binnen dan welke molen ook eruit maalt.',
    'help.canal.title': 'VAARTEN BERGEN HET WATER',
    'help.canal.body': 'In de vaarten zetten de molens wat ze opmalen. Het is berging, geen afvoer: graaf je meer, dan staat hetzelfde water er lager in, en loost het juist trager naar zee.',
    'help.mill.title': 'MOLENS MALEN HET LAND DROOG',
    'help.mill.body': 'Een molen maalt de natte akkers om zich heen de vaart in. Hij moet een vaart binnen twee vakken kunnen bereiken, en staat meteen stil zodra de vaart vol is.',
    'help.outlet.title': 'DE UITWATERING IS DE UITWEG',
    'help.outlet.body': 'Hij loost de vaart op zee, wat het tij ook doet, en laat het water bij laag tij gratis onder vrij verval weglopen. Te weinig uitwatering en elke molen in de polder valt tegelijk stil.',
    'help.money.title': 'DROOG LAND BRENGT OP',
    'help.money.body': 'Onontgonnen grond brengt niets op. Houd een perceel veertien dagen droog en het wordt ontgonnen tot wei of akker, en betaalt daarna elke dag. Loopt het onder, dan valt het terug naar riet: de polder die je droog houdt is de polder die de volgende molen betaalt.',
    'menu.hintTouch': 'Sleep om te schuiven  -  knijp om te zoomen  -  tik een tegel om te bouwen',
    'menu.hintKeys': 'Sleep om te schuiven  -  1-4 bouwen  -  Spatie pauze  -  Tab versnellen',
    'menu.settings': 'INSTELLINGEN',
    'menu.music': 'Muziek',
    'menu.effects': 'Effecten',
    'menu.language': 'Taal',
    'menu.haptics': 'Trillen',
    'menu.on': 'AAN',
    'menu.off': 'UIT',
    'menu.saveNote': 'Voortgang wordt op dit apparaat bewaard.',

    /* ---- Scenarios ---- */
    'level.beemster.subtitle': 'Een kalm voorjaar in een jonge polder',
    'level.winter.subtitle': 'Stormen, vooral uit het noordwesten',
    'level.brief.title': 'VOORBEREIDEN',
    'level.winter.brief': 'Eerste storm over ongeveer {days} dagen. De meeste komen uit het noordwesten.',
    'level.haarlemmermeer.subtitle': 'Stoom maalt het meer droog; kolen kosten geld',
    'level.dollard.subtitle': 'Win land op zee, zonder einde',
    'level.dollard.brief': 'Zet met het dijkgereedschap rijsdammen op het wad. Is de kwelder bij de dijk gegroeid, klik er dan op om het hele stuk als nieuwe polder te bedijken. Verhoog de zeedijk voor een storm. De eerste over ongeveer {days} dagen.',
    'build.enclose': 'Bedijken',
    'insp.old': 'Oud land',
    'insp.flat': 'Wad',
    'insp.marsh': 'Kwelder',
    'insp.toMarsh': 'Tot kwelder',
    'insp.fenced': 'Rijsdam: slibt snel op',
    'insp.unfenced': 'Geen rijsdam: slibt traag op',
    'insp.drowned': 'Onder het stormtij: spoelt weg',
    'insp.drownedHeld': 'Onder het stormtij: opslibben stopt',
    'klink.title': 'NIEUWE POLDER KLINKT IN',
    'klink.body': 'de jonge klei zakt naar het kanaal: graaf vaarten en bouw gemalen',
    'ripe.title': 'KWELDER KLAAR',
    'ripe.body': 'klik erop met het dijkgereedschap om hem te bedijken',
    'build.dike.tip.wadden': 'Verzwaar de zeewering: bouw op een dijk\nom hem op te hogen. Op het wad zet\nhetzelfde gereedschap een rijsdam: slib\nbezinkt op dat vak en het groeit op\ntot kwelder. Klik op kwelder bij de dijk\nen het hele stuk wordt in een keer\nbedijkt: nieuwe dijk ervoor, nieuwe\npolder erachter.',
    'build.fence': 'Rijsdam',
    'build.fence.tip': 'Een rijshoutdam op het wad. Het tij\nremt erop af en laat zijn slib vallen:\ndit vak groeit op tot kwelder. Kwelder\nbij de dijk kan bedijkt worden.',
    'no.fence.flat': 'Rijsdammen horen op het wad voor de dijk',
    'dike.join': 'Deze kwelder reikt nog niet tot de dijk',
    'dike.narrow': 'Te smal: de kwelder moet langs de dijk liggen, twee vakken of meer',
    'enclosed.title': 'NIEUWE POLDER',
    'enclosed.body': 'de zee heeft al {ha} ha prijsgegeven',
    'era.title': 'EEN NIEUW TIJDPERK',
    'era.engine': 'er kunnen nu elektrische gemalen worden gebouwd',
    'era.steam': 'er kunnen nu stoomgemalen worden gebouwd',
    'level.delta.subtitle': 'De lange noodtoestand',

    /* ---- Build bar ---- */
    'build.dike': 'Dijk',
    'build.canal': 'Vaart',
    'build.pump': 'Gemaal',
    'build.outlet': 'Uitwatering',
    'build.mill': 'Molen',
    'build.engine': 'Gemaal',
    'build.steam': 'Stoomgemaal',
    'build.steam.tip': 'Een stoomgemaal: maalt twee keer zoveel\nals een molen binnen {radius} tegels van het\nland af, maar stookt elke dag kolen. Heeft\neen vaart binnen {range} tegels nodig.',
    'build.outlet.tip.steam': 'Een stoommachine die de boezem op zee\nuitslaat wat het tij ook doet.\nElke volgende kost meer.',
    'build.dike.tip': 'Verhoog de zeewering.\nAlleen op de ringdijk. Bouw op een\nbestaande dijk om hem op te hogen.',
    'build.canal.tip': 'Berging en afvoer voor het water\ndat je gemalen opmalen.\nElke vaart kost meer dan de vorige.',
    'build.pump.tip': 'Maalt het water binnen {radius} tegels\nvan het land af. Heeft een vaart binnen\n{range} tegels nodig om op te lozen.',
    'build.mill.tip': 'Een poldermolen: maalt het water binnen\n{radius} tegels van het land af. Heeft een vaart\nbinnen {range} tegels nodig om op te lozen.',
    'build.outlet.tip': 'Een gemaal dat de boezem op zee\nuitslaat wat het tij ook doet.\nElke volgende kost meer.',
    'build.outlet.tip.mill': 'Een molen die de boezem op zee\nuitslaat wat het tij ook doet.\nElke volgende kost meer.',

    /* ---- Top bar ---- */
    'hud.perDay': '{sign}{n}/dag',
    'hud.day': 'Dag {n}   {speed}',
    'hud.tip.fit': 'Toon de hele polder  [Home]',
    'hud.tip.fast': 'Versnellen  [Tab]',
    'hud.tip.slow': 'Normale snelheid',
    'hud.tip.pause': 'Pauze  [Spatie]',
    'hud.tip.mute': 'Muziek en geluid uit  [M]',
    'hud.tip.unmute': 'Geluid weer aan  [M]',
    'gauge.sea': 'Zeestand tegenover de laagste kruin\nvan de ringdijk',
    'gauge.dry': 'Hoeveel van je land vandaag te bewerken is.\nRegen en kwel zetten het onder; de molens\nmalen het er weer af. Nat land brengt niets op,\nen land waar de zee overheen is geweest nog\nlang daarna veel minder.',
    'gauge.canal': 'Waterstand in de boezem, in meters\nten opzichte van NAP, net als de zee.\nHij stijgt als je molens erin malen;\nbij +0,6 m is hij vol en vallen ze stil.',
    'gauge.homes': 'Huizen die nog overeind staan',
    'gauge.sea.cap': 'ZEE',
    'gauge.dry.cap': 'DROOG',
    'gauge.canal.cap': 'BOEZEM',
    'gauge.homes.cap': 'HUIZEN',

    /* ---- Placement ---- */
    'place.hintTouch': 'Tik een tegel om te mikken, tik dan BOUW.',
    'place.hintMouse': 'Kies een gemarkeerde tegel.  Rechtsklik of Esc om te stoppen.',
    'place.here': '{what} hier\nf {cost}',
    'place.buildHere': 'Bouw hier voor f {cost}',
    'place.confirm': 'BOUW',
    'place.cancel': 'STOP',
    'place.built': '{what} gebouwd - f {cost}',

    /* ---- Refusals ---- */
    'no.money': 'Niet genoeg guldens',
    'no.dike.coastal': 'Dijken kunnen alleen langs de kust',
    'no.dike.full': 'Al op volle hoogte',
    'no.canal.dry': 'Vaarten hebben droge grond nodig',
    'no.canal.already': 'Hier ligt al een vaart',
    'no.built': 'Hier staat al iets',
    'no.machinery': 'Bezet door machines',
    'no.canal.ring': 'Houd de ringdijk vrij voor dijken',
    'no.pump.dry': 'Gemalen hebben droge grond nodig',
    'no.occupied': 'Bezet',
    'no.pump.exposed': 'Te veel in de wind - bouw landinwaarts',
    'no.pump.canal': 'Heeft een vaart binnen {n} tegels nodig om op te lozen',
    'no.outlet.ring': 'Uitwateringen horen in de ringdijk',
    'no.canal.near': 'Heeft een vaart binnen {n} tegels nodig',
    'no.unknown': 'Onbekend bouwwerk',
    'no.over': 'Het scenario is afgelopen',
    'no.outside': 'Buiten de kaart',

    /* ---- Tile inspector ---- */
    // Dutch labels are longer, so the value column starts further right.
    'insp.col': 10,
    'insp.polder': 'Polder',
    'insp.use.pasture': 'Weiland',
    'insp.use.plough': 'Bouwland',
    'insp.use.tulipRed': 'Tulpen',
    'insp.use.tulipYellow': 'Tulpen',
    'insp.yield': 'f {n} van {full}',
    'insp.salt': 'Zout',
    'insp.rough': 'Onontgonnen',
    'insp.roughValue': 'straks f {n}',
    'insp.reclaim': 'Ontgonnen',
    'insp.sea': 'Noordzee',
    'insp.canal': 'Vaart',
    'insp.ring': 'Ringdijk',
    'insp.house': 'Huis',
    'insp.church': 'Kerk',
    'insp.ruin': 'Ruïne',
    'insp.ground': 'Maaiveld',
    'insp.water': 'Water',
    'insp.seaLevel': 'Zee',
    'insp.crest': 'Kruin',
    'insp.dike': 'Dijk',
    'insp.stress': 'Belasting',
    'insp.pump': 'Gemaal',
    'insp.mill': 'Molen',
    'insp.outlet': 'Uitwatering',
    'insp.repair': 'Staat',
    'insp.dry': 'droog',
    'insp.canalLevel': 'Boezempeil',
    'insp.demolish': 'Slopen',
    'insp.refund': 'Opbrengst slopen',
    'insp.belowCanal': 'Onder boezem: opmalen',
    'insp.breached': 'DOORGEBROKEN',
    'insp.level': 'hoogte {n}/3',
    'insp.stalled': 'STIL',
    'insp.running': 'maalt',
    'insp.idle': 'in rust',
    'insp.draining': 'loost',
    'insp.shut': 'dicht (tij)',
    'insp.pumping': 'maalt',
    'insp.off': 'uit',
    'insp.stage.engine': 'gemaal',
    'insp.stage.mill': 'molen',
    'insp.stage.steam': 'stoom',
    'insp.flooded': 'ONDER WATER',

    /* ---- Weather ---- */
    'dir.xm': 'noordwesten',
    'dir.xp': 'zuidoosten',
    'dir.ym': 'noordoosten',
    'dir.yp': 'zuidwesten',
    'storm.warnBanner': 'STORM OVER {n} DAGEN - {peak} M UIT HET {dir}',
    'storm.activeBanner': 'STORM - NOG {n} DAGEN - UIT HET {dir}',
    'storm.over': 'De storm is uitgeraasd.',
    'breach.title': 'DIJKDOORBRAAK!',
    'breach.body': 'de zee is door bij {x},{y}',
    'lost.title': 'HUIS VERLOREN',
    'lost.body': 'een huis is ondergelopen',
    'lost.float': 'WEG',
    'broke.title': 'GEEN GELD MEER',
    'broke.pump': 'een molen is stilgelegd',
    'broke.outlet': 'het gemaal is stilgelegd',
    'canalFull.title': 'DE VAART ZIT VOL',
    'canalFull.body': 'De molens kunnen het water nergens kwijt. Bouw nog een uitwatering; meer vaart graven laat de vaart juist lager staan en trager lozen.',
    'broke.float': 'STILGELEGD',
    'backOn.all': 'De werken draaien weer.',
    'backOn.some': 'Een van de werken draait weer - nog {n} stilgelegd.',

    /* ---- Tutorial ---- */
    'tut.1.title': 'KIJK ROND',
    'tut.1.text': 'Sleep om te schuiven, scroll om te zoomen. De polderbodem ligt onder zeeniveau - alleen de ringdijk houdt de zee buiten.',
    'tut.2.title': 'LET OP HET WATER',
    'tut.2.text': 'Regen verzamelt zich in de laagste percelen. Klik een tegel aan om het maaiveld en de waterdiepte te lezen.',
    'tut.3.title': 'GRAAF EEN VAART',
    'tut.3.text': 'Vaarten bergen het water dat je gemalen opmalen. Druk op [2] en verleng de vaart met één tegel.',
    'tut.4.title': 'BOUW EEN MOLEN',
    'tut.4.text': 'Druk op [3] en zet een poldermolen aan de vaart. Zijn scheprad maalt het water van het land de vaart in.',
    'tut.6.title': 'LET OP DE VAART',
    'tut.6.text': 'Je uitwateringen lozen de vaart op zee. Kijk naar de boezemmeter: loopt die vol, dan vallen je molens stil. Blijft hij hoog, druk dan op [4] en bouw nog een uitwatering in de ringdijk.',
    'tut.7.title': 'BOUW VOOR DE STORM',
    'tut.7.text': 'Een storm brengt zes keer zo veel regen. Kies je aantal gemalen daarop, niet op een rustige week, anders loopt de polder sneller vol dan je hem leeg krijgt.',
    'tut.8.title': 'HOOG DE DIJK OP',
    'tut.8.text': 'Stormen komen van één kant. Druk bij een waarschuwing op [1] en bouw op de dijken die in de wind liggen om hun kruin op te hogen.',

    /* ---- Pause ---- */
    'pause.title': 'GEPAUZEERD',
    'pause.resume': 'VERDER',
    'pause.saveQuit': 'OPSLAAN EN STOPPEN',
    'pause.restart': 'OPNIEUW BEGINNEN',
    'pause.keys': 'Esc / Spatie  verder\n1-4           bouwen\nTab           versnellen',

    /* ---- Result ---- */
    'over.won': 'DE POLDER HOUDT STAND',
    'over.lost': 'DE ZEE WINT',
    'over.endlessBody': 'Je won {ha} ha op de zee voordat die het dorp terugnam.',
    'over.leaderboard': 'RANGLIJST',
    'over.wonBody': '{intact} van de {total} huizen staan nog overeind.',
    'over.lostBody': 'Er bleven maar {intact} van de {total} huizen over.',
    'over.days': 'Dagen volgehouden',
    'over.homes': 'Huizen gered',
    'over.breaches': 'Dijkdoorbraken',
    'over.peak': 'Hoogste zeestand',
    'over.spent': 'Besteed aan werken',
    'over.score': 'SCORE',
    'over.newBest': 'NIEUW RECORD',
    'over.best': 'beste {score}',
    'over.retry': 'OPNIEUW',
    'over.next': 'VOLGENDE',
    'over.menu': 'MENU',

    /* ---- Calendar ---- */
    'month.1': 'jan',
    'month.2': 'feb',
    'month.3': 'mrt',
    'month.4': 'apr',
    'month.5': 'mei',
    'month.6': 'jun',
    'month.7': 'jul',
    'month.8': 'aug',
    'month.9': 'sep',
    'month.10': 'okt',
    'month.11': 'nov',
    'month.12': 'dec',
    'locale': 'nl-NL',
  },
};

let lang = 'en';
/** Bumped on every change so callers can tell a cached layout is stale. */
let revision = 0;

/**
 * The device's preference, used the first time the game runs. Anything Dutch
 * or Flemish gets Dutch; everything else gets English.
 */
export function detectLang() {
  if (typeof navigator === 'undefined') return 'en';
  const tags = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || ''];
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (base === 'nl') return 'nl';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function getLang() {
  return lang;
}

export function langRevision() {
  return revision;
}

export function setLang(next) {
  const l = LANGS.includes(next) ? next : 'en';
  if (l === lang) return lang;
  lang = l;
  revision += 1;
  return lang;
}

function fill(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  ));
}

/**
 * Look up a key. A missing translation falls back to English rather than to a
 * blank label, and a missing key returns the key itself so it is obvious on
 * screen instead of silently empty.
 */
export function t(key, params) {
  const table = STRINGS[lang] || STRINGS.en;
  let value = table[key];
  if (value === undefined) value = STRINGS.en[key];
  if (value === undefined) return key;
  if (typeof value !== 'string') return value;
  return fill(value, params);
}

/** Numbers with the thousands separator the selected language expects. */
export function formatNumber(n) {
  return Math.floor(n).toLocaleString(t('locale'));
}

/** Exported for the test that checks the two dictionaries stay in step. */
export function keysOf(l) {
  return Object.keys(STRINGS[l] || {});
}
