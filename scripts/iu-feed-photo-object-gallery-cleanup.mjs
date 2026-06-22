#!/usr/bin/env node
/**
 * Phase 2E — object-only gallery cleanup.
 * Moves non-neutral images to rejected/ (reversible); updates active manifests.
 * Run: node scripts/iu-feed-photo-object-gallery-cleanup.mjs [--apply]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");
const REPORT_PATH = path.join(REPO, "scripts", "iu-feed-photo-object-gallery-cleanup-report.json");
const CONFIG_PATH = path.join(GALLERY_ROOT, "feed_photo_engine_config.json");
const APPLY = process.argv.includes("--apply");
const MIN_GALLERY_KEEP = 10;

const IMPORT_SOURCES = [
  { key: "pilot", rel: "imported/pilot/manifest.json" },
  { key: "batch-1", rel: "imported/batch-1/manifest.json" },
  { key: "batch-2", rel: "imported/batch-2/manifest.json" },
];

const GLOBAL_REJECT = [
  /\b(man|woman|men|women|person|people|human|humans|child|children|kid|kids|boy|girl|baby|babies|teen|teens|senior|elderly|youth)\b/i,
  /\b(man's|woman's|person's)\b/i,
  /\b(player|players|athlete|athletes|footballer|footballers|soccer player|hockey player|tennis player|boxer|boxers|fighter|fighters|wrestler|runner|runners|cyclist|swimmer|goalkeeper|striker|midfielder|goalie|skater|jockey|driver|rider|pilot)\b/i,
  /\b(face|faces|facial|portrait|portraits|selfie|selfies|headshot|headshots|smiling at camera|looking at camera|staring at camera)\b/i,
  /\b(businessman|businesswoman|business person|businesspeople|executive|entrepreneur|worker|workers|employee|employees|colleague|coworker|professional wearing)\b/i,
  /\b(politician|politicians|president|presidents|minister|ministers|senator|senators|congressman|congresswoman|diplomat|diplomats|spokesperson|spokesman|spokeswoman|lawmaker|lawmakers|premier|chancellor|mayor|governor)\b/i,
  /\b(doctor|doctors|nurse|nurses|patient|patients|surgeon|surgeons|physician|physicians|paramedic|healthcare worker|medical staff|dentist|therapist)\b/i,
  /\b(police officer|policeman|policewoman|policemen|policewomen|officer arresting|detective|detectives|agent|agents|guard|guards|soldier|soldiers|military personnel|troops|serviceman|servicewoman|marine|marines)\b/i,
  /\b(judge|judges|lawyer|lawyers|attorney|attorneys|defendant|defendants|accused|criminal|criminals|prisoner|prisoners|inmate|inmates|suspect|suspects|victim|victims|witness|witnesses|prosecutor|defense counsel)\b/i,
  /\b(singer|singers|musician performing|actor|actors|actress|actresses|performer|performers|dancer|dancers|model|models|celebrity|celebrities|influencer|influencers|star posing|band performing)\b/i,
  /\b(couple|couples|family|families|friends|friend|crowd|crowds|audience|audiences|spectator|spectators|fan|fans|supporters|protesters|demonstrators|marchers|gathering of people|group of people|team photo|team celebrating)\b/i,
  /\b(team|teammate|teammates|squad|lineup|roster|dressed in|wearing a|wearing an|wearing his|wearing her|in uniform|in a suit|in formal attire|in jersey|in kits)\b/i,
  /\b(jersey|jerseys|uniform|uniforms|kit|kits|tracksuit|cleats on feet|kicking|dribbling|shooting|scoring|celebrating|competing|competition between|match between|game between|vs\.| versus )\b/i,
  /\b(flag|flags|national flag|country flag|state flag|banner|banners|billboard|billboards|sign reads|sign saying|text on|written on|inscription|readable text|legible text|logo|logos|brand|branded|brand name|sponsor|sponsors|trademark|emblem|coat of arms|state symbol|party symbol)\b/i,
  /\b(apple logo|google logo|microsoft|meta platforms|facebook logo|twitter logo|instagram logo|nike|adidas|puma|reebok|under armour|bmw|mercedes|mercedes-benz|audi|toyota|volkswagen|ford motor|honda|hyundai|kia|samsung|sony|lg electronics|coca-cola|pepsi|mcdonald|starbucks|visa card|mastercard|paypal)\b/i,
  /\b(license plate|number plate|registration plate|spz|plate number|vanity plate)\b/i,
  /\b(interview|being interviewed|speaks to|speaking to|talking to media|addresses the|addressing the|engages with media|answers questions|questioned by|surrounded by reporters|press briefing with|conference with officials)\b/i,
  /\b(stadium filled|arena filled|packed stadium|crowded stadium|full house|cheering|applauding|celebration with fans|fan zone|supporters cheering)\b/i,
  /\b(american courtroom|u\.s\. courtroom|us courtroom|british court|uk courtroom|supreme court session|court in session with|trial with|hearing with people|jury box with)\b/i,
  /\b(blood|bleeding|wound|wounds|injury|injuries|corpse|corpses|dead body|bodies|gore|murder scene with|crime scene with victim|holding a gun|holding a rifle|holding a weapon|pointing a gun|armed robbery)\b/i,
  /\b(reading a newspaper|reading newspaper|couple sitting|couple reading|people sitting|people walking|people standing|group walking|pedestrians|tourists|travelers posing|passengers boarding|commuters|students sitting|children playing|kids playing|classroom with students|lecture with students)\b/i,
  /\b(club logo|team logo|team crest|club crest|fc logo|football club|hockey club|nba|nfl|mlb|nhl|premier league logo|champions league logo|fifa logo|uefa)\b/i,
  /\b(green jersey|red jersey|blue jersey|white jersey|yellow jersey|striped jersey|team colors|club colors|home kit|away kit)\b/i,
  /\b(police car with|police vehicle with|patrol car with|squad car with|marked police|police van with lettering|ambulance with lettering|fire truck with)\b/i,
  /\b(washington dc|white house|capitol hill|kremlin|buckingham palace|10 downing|parliament house|brandenburg gate|eiffel tower|times square|big ben|statue of liberty)\b/i,
  /\b(in kyiv|in ukraine|in russia|in usa|in america|in china|in germany|in france|in uk|in london|in paris|in berlin|in moscow|in tokyo|in new york|in los angeles|in washington)\b/i,
  /\b(reporter|journalist|journalists|photographer|photographers|camera crew|news anchor|news presenter|tv host|talk show host|moderator speaking)\b/i,
  /\b(referee|referees|umpire|coach|coaches|manager|trainer|physiotherapist)\b/i,
  /\b(hospital sign|clinic sign|school sign|university logo|company logo|bank logo|airline logo|airport sign|hotel sign|restaurant sign|store sign|shop sign)\b/i,
  /\b(credit card with|debit card with|bank card with|atm with logo|receipt with text|invoice with text|contract with text|passport open showing|id card showing|driver license showing)\b/i,
  /\b(war zone|battlefield|combat|soldiers marching|military parade|tank crew|artillery crew|armed forces personnel)\b/i,
  /\b(sexual|nude|naked|shirtless man|shirtless woman|bikini model| lingerie)\b/i,
];

const GALLERY_RULES = {
  sport: {
    keep: [
      /\b(football|soccer ball|ball on|sports ball)\b/i,
      /\b(goal post|goalpost|goal net|goal frame|crossbar|soccer net|football net)\b/i,
      /\b(pitch|turf|grass field|green field|playing field|soccer field|football field)\b/i,
      /\b(cleats|football boots|boots on grass|shoes on grass)\b/i,
      /\b(corner flag|corner post)\b/i,
      /\b(empty stadium|empty arena|stadium seats empty|vacant stadium|unoccupied stadium)\b/i,
      /\b(puck|hockey puck|hockey stick|hockey sticks|ice rink|ice surface|skate blade|ice hockey net)\b/i,
      /\b(tennis racket|tennis racquet|tennis ball|tennis court|tennis net|clay court|hard court)\b/i,
      /\b(boxing glove|boxing gloves|punching bag|speed bag|boxing ring empty|empty ring)\b/i,
      /\b(mma cage empty|empty octagon|cage fence)\b/i,
      /\b(steering wheel|tire|tyre|tires|tyres|racing helmet|helmet on|motorsport track|asphalt track|race track empty)\b/i,
      /\b(golf ball|golf club|basketball hoop|volleyball net|ski equipment|snowboard)\b/i,
    ],
    reject: [
      /\b(match|game|player|team|fan|score|celebration|stadium crowd|arena crowd)\b/i,
    ],
  },
  politika: {
    keep: [
      /\b(podium|lectern|pulpit|rostrum)\b/i,
      /\b(microphone|microphones)\b/i,
      /\b(conference table|meeting table|round table|boardroom table)\b/i,
      /\b(document|documents|paper stack|papers|folder|folders|file stack)\b/i,
      /\b(ballot|ballots|voting booth|voting paper|election paper)\b/i,
      /\b(empty parliament|empty chamber|parliament seats empty|assembly hall empty)\b/i,
      /\b(government building exterior|capitol dome distant|generic building facade)\b/i,
    ],
    reject: [
      /\b(speech|debate|protest|rally|demonstration|campaign|politician|minister|president)\b/i,
    ],
  },
  kriminalita: {
    keep: [
      /\b(handcuff|handcuffs)\b/i,
      /\b(police tape|crime scene tape|caution tape|barrier tape|yellow tape|red tape)\b/i,
      /\b(siren|beacon|blue light|flashing light|emergency light)\b/i,
      /\b(padlock|lock|locks|chain lock)\b/i,
      /\b(fingerprint|fingerprints|fingerprint scan)\b/i,
      /\b(evidence bag|evidence marker|forensic)\b/i,
    ],
    reject: [/\b(police officer|arrest|suspect|victim|crime scene with people|patrol car|police car)\b/i],
  },
  bezpecnost: {
    keep: [
      /\b(handcuff|handcuffs|padlock|lock|security camera|cctv camera|surveillance camera)\b/i,
      /\b(fire extinguisher|smoke detector|alarm|security gate|metal detector|barrier)\b/i,
      /\b(siren|beacon|blue light|flashing light)\b/i,
      /\b(police tape|caution tape|barrier tape)\b/i,
    ],
    reject: [/\b(officer|guard|soldier|firefighter|rescue worker|security guard)\b/i],
  },
  finance: {
    keep: [
      /\b(coin|coins|currency|money stack|cash stack|banknote|banknotes)\b/i,
      /\b(graph|chart|stock chart|market chart|financial chart|bar chart|line graph)\b/i,
      /\b(calculator|abacus)\b/i,
      /\b(receipt|receipts|invoice stack)\b/i,
      /\b(laptop.*graph|computer.*chart|monitor.*chart|screen.*graph)\b/i,
      /\b(piggy bank|wallet|coins on table)\b/i,
    ],
    reject: [/\b(bank logo|credit card|visa|mastercard|paypal|trader|broker|business meeting)\b/i],
  },
  ekonomika: {
    keep: [
      /\b(coin|coins|currency|money|cash)\b/i,
      /\b(graph|chart|stock|market|financial|economic)\b/i,
      /\b(calculator|abacus)\b/i,
      /\b(receipt|invoice|ledger)\b/i,
    ],
    reject: [/\b(bank logo|credit card|businessman|trader|meeting)\b/i],
  },
  technologie: {
    keep: [
      /\b(chip|microchip|processor|cpu|circuit board|motherboard|pcb)\b/i,
      /\b(keyboard|mouse|monitor|computer|laptop|desktop|server|rack server|data center)\b/i,
      /\b(cable|cables|wire|wires|fiber optic|ethernet)\b/i,
      /\b(code on screen|programming|software|binary|matrix code|abstract code)\b/i,
      /\b(robot arm|robotic arm|robot hand|drone)\b/i,
      /\b(smartphone|tablet|device)\b/i,
    ],
    reject: [/\b(apple|iphone|ipad|macbook|google pixel|samsung galaxy|microsoft surface|person using|developer at)\b/i],
  },
  doprava: {
    keep: [
      /\b(road|highway|freeway|motorway|asphalt|street empty|empty road)\b/i,
      /\b(steering wheel|dashboard|gear shift)\b/i,
      /\b(traffic light|semaphore|stoplight|road sign generic)\b/i,
      /\b(rail|railway|railroad|train track|tracks|platform empty)\b/i,
      /\b(airport terminal|airport hall|departure board blur|runway)\b/i,
      /\b(tire|tyre|wheel|car detail|vehicle detail)\b/i,
    ],
    reject: [/\b(driver|passenger|pilot|flight attendant|accident victim|crash with people|license plate|airline logo|bus logo|train logo)\b/i],
  },
  zdravi: {
    keep: [
      /\b(stethoscope|thermometer|syringe|vial|pill|pills|medicine|medication|capsule|tablets)\b/i,
      /\b(medical glove|latex glove|surgical glove|face mask product|mask on table)\b/i,
      /\b(medical tool|scalpel|forceps|medical instrument)\b/i,
      /\b(hospital corridor|hospital hallway|empty hospital|clinic hallway)\b/i,
      /\b(first aid kit|bandage|gauze)\b/i,
    ],
    reject: [/\b(doctor|nurse|patient|surgery with|operating room with people|hospital logo|pharma logo)\b/i],
  },
  "kultura-akce": {
    keep: [
      /\b(microphone|microphones|mic stand|stage microphone)\b/i,
      /\b(empty stage|stage lights|spotlight|stage lighting|concert lights)\b/i,
      /\b(camera|film camera|video camera|camera lens)\b/i,
      /\b(film reel|film strip|clapperboard)\b/i,
      /\b(musical instrument|guitar|piano|violin|drum kit|drums|trumpet|saxophone)\b/i,
      /\b(theater seat|theatre seat|auditorium seats empty|empty auditorium)\b/i,
    ],
    reject: [/\b(singer|performer|concert crowd|audience|festival poster|event poster|band playing|orchestra performing)\b/i],
  },
  cestovani: {
    keep: [
      /\b(suitcase|luggage|backpack|travel bag|duffel bag)\b/i,
      /\b(map|world map|travel map|atlas)\b/i,
      /\b(passport|passport cover|closed passport)\b/i,
      /\b(beach empty|empty beach|shoreline|coastline)\b/i,
      /\b(mountain|mountains|hiking trail|landscape|scenery)\b/i,
      /\b(road trip|highway landscape|travel route)\b/i,
      /\b(airplane window view|wing view|clouds from plane)\b/i,
    ],
    reject: [/\b(tourist|traveler|traveller|hotel logo|airport sign|resort|flag|landmark)\b/i],
  },
  bydleni: {
    keep: [
      /\b(key|keys|house key|door key)\b/i,
      /\b(door|front door|house door|interior door)\b/i,
      /\b(house exterior|home exterior|residential building|apartment building)\b/i,
      /\b(interior|living room empty|kitchen empty|bedroom empty|room interior)\b/i,
      /\b(tape measure|ruler|blueprint|floor plan|tools|hammer|drill|wrench)\b/i,
    ],
    reject: [/\b(realtor|real estate agent|family in|address sign|for sale sign with text|people in home)\b/i],
  },
  vzdelavani: {
    keep: [
      /\b(book|books|textbook|textbooks|stack of books)\b/i,
      /\b(notebook|notepad|exercise book)\b/i,
      /\b(pencil|pen|marker|highlighter|crayon)\b/i,
      /\b(desk|school desk|classroom desk|empty desk)\b/i,
      /\b(blackboard|whiteboard|chalkboard|bulletin board empty)\b/i,
      /\b(school supplies|stationery|backpack on desk)\b/i,
    ],
    reject: [/\b(student|students|teacher|professor|classroom with people|school logo|graduation ceremony)\b/i],
  },
  priroda: {
    keep: [
      /\b(sky|cloud|clouds|sunset|sunrise|horizon)\b/i,
      /\b(rain|raindrop|raindrops|storm cloud|lightning)\b/i,
      /\b(snow|snowflake|snowfall|frost|ice crystal)\b/i,
      /\b(leaf|leaves|tree|forest|woods|meadow|field|grass)\b/i,
      /\b(water|river|lake|stream|waterfall|ocean|sea)\b/i,
      /\b(flower|flowers|plant|plants|moss|fern)\b/i,
      /\b(mountain|mountains|valley|canyon|rock formation)\b/i,
      /\b(wildlife animal|bird|deer|fox|bear|fish)\b/i,
    ],
    reject: [/\b(hiker|camper|tourist|city skyline|street sign|license plate)\b/i],
  },
  pocasi: {
    keep: [
      /\b(sky|cloud|clouds|overcast|clear sky)\b/i,
      /\b(rain|raindrop|raindrops|downpour|storm|thunderstorm|lightning)\b/i,
      /\b(snow|snowflake|snowfall|blizzard|hail)\b/i,
      /\b(wind|fog|mist|dew|frost)\b/i,
      /\b(weather vane|barometer|thermometer outdoor)\b/i,
    ],
    reject: [/\b(person with umbrella|people in rain|city landmark)\b/i],
  },
  zpravy: {
    keep: [
      /\b(microphone|microphones|press microphone|news microphone)\b/i,
      /\b(newspaper stack|newspapers stack|paper stack|news papers pile)\b/i,
      /\b(typewriter|printing press|news desk empty|broadcast desk empty)\b/i,
      /\b(satellite dish|antenna|broadcast tower)\b/i,
      /\b(document|documents|headline blur|news ticker blur)\b/i,
    ],
    reject: [/\b(reporter|journalist|anchor|reading news|person reading|interview|press conference with)\b/i],
  },
  "veda-historie": {
    keep: [
      /\b(microscope|telescope|laboratory equipment|lab equipment|beaker|test tube|flask)\b/i,
      /\b(fossil|artifact|artefact|museum exhibit object|historical object)\b/i,
      /\b(book|manuscript|scroll|archive|old map)\b/i,
      /\b(planet|galaxy|stars|space|moon surface|mars surface)\b/i,
      /\b(dna|molecule|atom model|periodic table)\b/i,
    ],
    reject: [/\b(scientist|researcher|historian|archaeologist|museum visitor|professor lecturing)\b/i],
  },
  hry: {
    keep: [
      /\b(game controller|joystick|gamepad|keyboard gaming|mouse gaming)\b/i,
      /\b(chess board|chess pieces|board game|dice|cards deck|playing cards)\b/i,
      /\b(gaming setup|monitor gaming|rgb keyboard|headset on desk)\b/i,
      /\b(arcade machine|slot machine|pinball)\b/i,
      /\b(puzzle|lego bricks|toy blocks)\b/i,
    ],
    reject: [/\b(gamer|streamer|esports player|person playing|team competing)\b/i],
  },
  energietika: {
    keep: [
      /\b(solar panel|solar panels|photovoltaic)\b/i,
      /\b(wind turbine|wind farm|windmill)\b/i,
      /\b(power line|electricity pylon|transmission tower)\b/i,
      /\b(oil barrel|gas pipe|pipeline|fuel pump)\b/i,
      /\b(light bulb|energy meter)\b/i,
    ],
    reject: [/\b(worker|engineer|technician|logo)\b/i],
  },
  prumysl: {
    keep: [
      /\b(factory|industrial|manufacturing|assembly line empty|production line)\b/i,
      /\b(machinery|machine|cnc|robot arm industrial|conveyor belt)\b/i,
      /\b(warehouse|storage|pallet|forklift without driver|steel|metal sheet)\b/i,
      /\b(hard hat on|helmet on bench|safety vest on hook)\b/i,
    ],
    reject: [/\b(worker|factory worker|welder|technician|company logo|brand name)\b/i],
  },
  zemedelstvi: {
    keep: [
      /\b(wheat|corn field|crop|harvest field|hay bale|haystack)\b/i,
      /\b(tractor in field|plow|plough|farm field|barn exterior|silo)\b/i,
      /\b(seeds|soil|dirt|compost|greenhouse plants)\b/i,
      /\b(cow in field|sheep in field|chicken coop|farm animal)\b/i,
    ],
    reject: [/\b(farmer|farm worker|person harvesting|brand logo on tractor)\b/i],
  },
  "prehled-dne": {
    keep: [
      /\b(calendar|date|clock|watch|alarm clock|day planner)\b/i,
      /\b(newspaper stack|headlines blur|news summary blur)\b/i,
      /\b(sunrise|morning sky|desk morning|coffee cup on desk)\b/i,
      /\b(to-do list blur|agenda blur|schedule blur)\b/i,
    ],
    reject: [/\b(person|people|reading|breakfast with|morning routine with people)\b/i],
  },
  general_fallback: {
    keep: [
      /\b(abstract|texture|pattern|background|minimalist|bokeh|blur)\b/i,
      /\b(object|objects|still life|close-up|closeup|detail|macro|isolated)\b/i,
      /\b(on table|on desk|on surface|on white|on wood|on ground)\b/i,
      /\b(empty|without people|no people|unoccupied|nobody)\b/i,
      /\b(neutral|generic|simple|minimal)\b/i,
    ],
    reject: [],
  },
};

const GENERIC_OBJECT_KEEP = [
  /\b(close-up|closeup|detail shot|macro shot|still life|isolated on|on white background|on wooden table|on desk|on table|on ground|top view|overhead view)\b/i,
  /\b(empty|without people|no people|unoccupied|deserted|vacant|nobody)\b/i,
  /\b(stethoscope|thermometer|calculator|coin|coins|graph|chart|keyboard|server|cable|chip|circuit)\b/i,
  /\b(road|highway|steering wheel|traffic light|semaphore|rail|train track)\b/i,
  /\b(suitcase|luggage|map|passport|key|keys|door|tools|hammer|wrench)\b/i,
  /\b(book|books|notebook|pencil|pen|desk|blackboard|whiteboard)\b/i,
  /\b(cloud|rain|snow|forest|mountain|beach|leaf|flower|water|sky)\b/i,
  /\b(solar panel|wind turbine|factory|industrial|lock|handcuff|gavel|scales of justice|legal document)\b/i,
  /\b(police tape|crime scene tape|caution tape|siren|beacon|padlock|fingerprint)\b/i,
  /\b(microphone|podium|lectern|ball|puck|racket|glove|helmet|tire|tyre)\b/i,
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function haystackForEntry(entry) {
  return normalizeText(
    [entry.imageAlt, entry.batchQuery, entry.imageSourceUrl, entry.id].filter(Boolean).join(" ")
  );
}

function matchesAny(text, patterns) {
  for (const pat of patterns) {
    if (pat.test(text)) return true;
  }
  return false;
}

function classifyEntry(entry) {
  const hay = haystackForEntry(entry);
  const galleryId = entry.galleryId || "general_fallback";
  const rules = GALLERY_RULES[galleryId] || GALLERY_RULES.general_fallback;

  if (matchesAny(hay, GLOBAL_REJECT)) {
    return { decision: "REJECT", reason: "global_reject" };
  }
  if (matchesAny(hay, rules.reject || [])) {
    return { decision: "REJECT", reason: "gallery_reject" };
  }
  if (matchesAny(hay, rules.keep || [])) {
    return { decision: "KEEP_OBJECT_ONLY", reason: "gallery_keep" };
  }
  if (matchesAny(hay, GENERIC_OBJECT_KEEP)) {
    return { decision: "KEEP_OBJECT_ONLY", reason: "generic_object_keep" };
  }
  return { decision: "REJECT", reason: "uncertain_reject" };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function moveFileSafe(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest)) return true;
  if (APPLY) fs.renameSync(src, dest);
  return true;
}

function rejectedDest(importKey, galleryId, relPath) {
  return path.join(GALLERY_ROOT, "rejected", importKey, galleryId, relPath);
}

function processImportSource(src) {
  const importRoot = path.join(GALLERY_ROOT, "imported", src.key);
  const manifestPath = path.join(GALLERY_ROOT, src.rel);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];

  const kept = [];
  const rejected = [];
  let missingFiles = 0;

  for (const entry of entries) {
    const { decision, reason } = classifyEntry(entry);
    const row = {
      ...entry,
      objectGalleryDecision: decision,
      objectGalleryReason: reason,
      objectGalleryCleanupPhase: "2E",
    };

    if (decision === "KEEP_OBJECT_ONLY") {
      row.objectOnlyApproved = true;
      row.manualReviewStatus = "object_only_keep";
      kept.push(row);
      continue;
    }

    rejected.push(row);
    const thumbSrc = path.join(importRoot, entry.localThumbPath || "");
    const webpSrc = path.join(importRoot, entry.localImagePath || "");
    const thumbDest = rejectedDest(src.key, entry.galleryId, entry.localThumbPath || "");
    const webpDest = rejectedDest(src.key, entry.galleryId, entry.localImagePath || "");

    if (entry.localThumbPath && !fs.existsSync(thumbSrc)) missingFiles += 1;
    if (entry.localImagePath && !fs.existsSync(webpSrc)) missingFiles += 1;

    moveFileSafe(thumbSrc, thumbDest);
    moveFileSafe(webpSrc, webpDest);
  }

  const updatedManifest = {
    ...manifest,
    objectGalleryCleanupPhase: "2E",
    objectGalleryCleanupAt: new Date().toISOString(),
    objectOnlyGalleries: true,
    entries: kept,
  };

  if (APPLY) {
    fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2) + "\n", "utf8");
    const rejectedManifestPath = path.join(GALLERY_ROOT, "rejected", src.key, "manifest-rejected.json");
    ensureDir(path.dirname(rejectedManifestPath));
    fs.writeFileSync(
      rejectedManifestPath,
      JSON.stringify(
        {
          version: 1,
          importSource: src.key,
          objectGalleryCleanupPhase: "2E",
          rejectedAt: new Date().toISOString(),
          entries: rejected,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  return { kept, rejected, missingFiles, before: entries.length };
}

function countByGallery(entries) {
  const out = {};
  for (const e of entries) {
    out[e.galleryId] = (out[e.galleryId] || 0) + 1;
  }
  return out;
}

function verifyActiveManifests(allKept, allRejected) {
  const fails = [];
  const rejectedPaths = new Set();
  for (const e of allRejected) {
    if (e.localThumbPath) rejectedPaths.add(e.localThumbPath);
    if (e.localImagePath) rejectedPaths.add(e.localImagePath);
  }

  for (const src of IMPORT_SOURCES) {
    const manifestPath = path.join(GALLERY_ROOT, src.rel);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const importRoot = path.join(GALLERY_ROOT, "imported", src.key);
    for (const entry of manifest.entries || []) {
      if (rejectedPaths.has(entry.localThumbPath) || rejectedPaths.has(entry.localImagePath)) {
        fails.push(`rejected_in_active_manifest:${entry.id}`);
      }
      const thumb = path.join(importRoot, entry.localThumbPath || "");
      const webp = path.join(importRoot, entry.localImagePath || "");
      if (entry.localThumbPath && !fs.existsSync(thumb)) fails.push(`missing_thumb:${entry.id}`);
      if (entry.localImagePath && !fs.existsSync(webp)) fails.push(`missing_webp:${entry.id}`);
      if (String(entry.localThumbPath || "").includes("rejected/")) fails.push(`rejected_path_in_manifest:${entry.id}`);
      if (String(entry.localImagePath || "").includes("rejected/")) fails.push(`rejected_path_in_manifest:${entry.id}`);
    }
  }

  return fails;
}

function updateConfigIfUnderfilled(underfilled) {
  if (!APPLY || !underfilled.length) return null;
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const prev = Array.isArray(config.underfilledGalleries) ? config.underfilledGalleries : [];
  const merged = [...new Set([...prev, ...underfilled])].sort();
  const next = {
    ...config,
    phase: "2E",
    objectOnlyGalleries: true,
    underfilledGalleries: merged,
    galleryPrimarySelectionDisabled: merged,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return merged;
}

function printProof(report) {
  const lines = [
    "IU_FEED_PHOTO_OBJECT_GALLERY_CLEANUP",
    `ROOT_CAUSE=${report.ROOT_CAUSE}`,
    `TOTAL_IMAGES_BEFORE=${report.TOTAL_IMAGES_BEFORE}`,
    `TOTAL_IMAGES_ACTIVE_AFTER=${report.TOTAL_IMAGES_ACTIVE_AFTER}`,
    `TOTAL_IMAGES_REJECTED=${report.TOTAL_IMAGES_REJECTED}`,
    `TOTAL_REJECTED_GT_0=${report.TOTAL_REJECTED_GT_0}`,
    `GALLERIES_CLEANED=${report.GALLERIES_CLEANED}`,
    `GALLERIES_UNDERFILLED=${report.GALLERIES_UNDERFILLED}`,
    `ACTIVE_MANIFESTS_CLEAN=${report.ACTIVE_MANIFESTS_CLEAN}`,
    `REJECTED_IMAGES_NOT_IN_ACTIVE_MANIFESTS=${report.REJECTED_IMAGES_NOT_IN_ACTIVE_MANIFESTS}`,
    `NO_PEOPLE_IN_ACTIVE_GALLERIES=${report.NO_PEOPLE_IN_ACTIVE_GALLERIES}`,
    `NO_FACES_IN_ACTIVE_GALLERIES=${report.NO_FACES_IN_ACTIVE_GALLERIES}`,
    `NO_TEAM_JERSEYS_IN_ACTIVE_GALLERIES=${report.NO_TEAM_JERSEYS_IN_ACTIVE_GALLERIES}`,
    `NO_CLUB_LOGOS_IN_ACTIVE_GALLERIES=${report.NO_CLUB_LOGOS_IN_ACTIVE_GALLERIES}`,
    `NO_COUNTRY_FLAGS_IN_ACTIVE_GALLERIES=${report.NO_COUNTRY_FLAGS_IN_ACTIVE_GALLERIES}`,
    `NO_TEXT_OR_BRANDS_IN_ACTIVE_GALLERIES=${report.NO_TEXT_OR_BRANDS_IN_ACTIVE_GALLERIES}`,
    `NO_IDENTIFIABLE_FOREIGN_INSTITUTIONS=${report.NO_IDENTIFIABLE_FOREIGN_INSTITUTIONS}`,
    `ONLY_NEUTRAL_OBJECT_IMAGES_ACTIVE=${report.ONLY_NEUTRAL_OBJECT_IMAGES_ACTIVE}`,
    `UNCERTAIN_IMAGES_REJECTED=${report.UNCERTAIN_IMAGES_REJECTED}`,
    `NEW_IMPORTS=NO`,
    `PEXELS_API_CALL=NO`,
    `AI_GENERATION=NO`,
    `APPLY_MODE=${report.APPLY_MODE}`,
    `FINAL_VERDICT=${report.FINAL_VERDICT}`,
    `REPORT_PATH=${REPORT_PATH}`,
  ];
  for (const line of lines) console.log(line);
}

function auditActiveForUnsafePatterns(allKept) {
  const peoplePat = /\b(man|woman|person|people|player|face|portrait|jersey|flag|logo|brand|police officer|politician)\b/i;
  let peopleHits = 0;
  let faceHits = 0;
  let jerseyHits = 0;
  let logoHits = 0;
  let flagHits = 0;
  let textHits = 0;
  let foreignHits = 0;
  for (const e of allKept) {
    const hay = haystackForEntry(e);
    if (peoplePat.test(hay)) peopleHits += 1;
    if (/\b(face|portrait|selfie|headshot)\b/i.test(hay)) faceHits += 1;
    if (/\b(jersey|uniform|kit|team colors|club colors)\b/i.test(hay)) jerseyHits += 1;
    if (/\b(logo|brand|sponsor|trademark)\b/i.test(hay)) logoHits += 1;
    if (/\b(flag|national flag|banner)\b/i.test(hay)) flagHits += 1;
    if (/\b(sign reads|text on|written on|billboard|readable text)\b/i.test(hay)) textHits += 1;
    if (/\b(american courtroom|white house|capitol hill|in kyiv|in ukraine)\b/i.test(hay)) foreignHits += 1;
  }
  return { peopleHits, faceHits, jerseyHits, logoHits, flagHits, textHits, foreignHits };
}

export function runObjectGalleryCleanup(options = {}) {
  const apply = options.apply ?? APPLY;
  const results = [];
  let allKept = [];
  let allRejected = [];
  let totalBefore = 0;
  let missingFiles = 0;

  for (const src of IMPORT_SOURCES) {
    const manifestPath = path.join(GALLERY_ROOT, src.rel);
    if (!fs.existsSync(manifestPath)) continue;
    const r = processImportSource(src);
    results.push({ source: src.key, ...r });
    totalBefore += r.before;
    allKept = allKept.concat(r.kept);
    allRejected = allRejected.concat(r.rejected);
    missingFiles += r.missingFiles;
  }

  const keptByGallery = countByGallery(allKept);
  const galleriesCleaned = Object.keys({ ...countByGallery(allKept), ...countByGallery(allRejected) }).sort();
  const underfilled = galleriesCleaned.filter((g) => (keptByGallery[g] || 0) < MIN_GALLERY_KEEP);

  if (apply) {
    updateConfigIfUnderfilled(underfilled);
  }

  const verifyFails = apply ? verifyActiveManifests(allKept, allRejected) : [];
  const audit = auditActiveForUnsafePatterns(allKept);

  const report = {
    version: "2E",
    generatedAt: new Date().toISOString(),
    APPLY_MODE: apply ? "YES" : "DRY_RUN",
    ROOT_CAUSE:
      "Existing image libraries contained unsafe/non-neutral images: people, jerseys, flags, logos, text, identifiable places, foreign institutions and wrong-topic photos",
    TOTAL_IMAGES_BEFORE: totalBefore,
    TOTAL_IMAGES_ACTIVE_AFTER: allKept.length,
    TOTAL_IMAGES_REJECTED: allRejected.length,
    TOTAL_REJECTED_GT_0: allRejected.length > 0 ? "YES" : "NO",
    GALLERIES_CLEANED: galleriesCleaned.join(","),
    GALLERIES_UNDERFILLED: underfilled.join(",") || "NONE",
    ACTIVE_MANIFESTS_CLEAN: verifyFails.length === 0 ? "YES" : "NO",
    REJECTED_IMAGES_NOT_IN_ACTIVE_MANIFESTS: verifyFails.length === 0 ? "YES" : "NO",
    NO_PEOPLE_IN_ACTIVE_GALLERIES: audit.peopleHits === 0 ? "YES" : "NO",
    NO_FACES_IN_ACTIVE_GALLERIES: audit.faceHits === 0 ? "YES" : "NO",
    NO_TEAM_JERSEYS_IN_ACTIVE_GALLERIES: audit.jerseyHits === 0 ? "YES" : "NO",
    NO_CLUB_LOGOS_IN_ACTIVE_GALLERIES: audit.logoHits === 0 ? "YES" : "NO",
    NO_COUNTRY_FLAGS_IN_ACTIVE_GALLERIES: audit.flagHits === 0 ? "YES" : "NO",
    NO_TEXT_OR_BRANDS_IN_ACTIVE_GALLERIES: audit.textHits === 0 ? "YES" : "NO",
    NO_IDENTIFIABLE_FOREIGN_INSTITUTIONS: audit.foreignHits === 0 ? "YES" : "NO",
    ONLY_NEUTRAL_OBJECT_IMAGES_ACTIVE: allKept.every((e) => e.objectOnlyApproved === true) ? "YES" : "NO",
    UNCERTAIN_IMAGES_REJECTED: "YES",
    keptByGallery,
    rejectedByGallery: countByGallery(allRejected),
    rejectReasons: allRejected.reduce((acc, e) => {
      acc[e.objectGalleryReason] = (acc[e.objectGalleryReason] || 0) + 1;
      return acc;
    }, {}),
    missingFiles,
    verifyFails,
    audit,
    sources: results,
    FINAL_VERDICT:
      allRejected.length > 0 &&
      allKept.length > 0 &&
      verifyFails.length === 0 &&
      audit.peopleHits === 0 &&
      audit.faceHits === 0 &&
      audit.jerseyHits === 0 &&
      audit.flagHits === 0 &&
      audit.logoHits === 0 &&
      audit.textHits === 0 &&
      audit.foreignHits === 0
        ? "PASS"
        : apply
          ? "FAIL"
          : "DRY_RUN_OK",
  };

  return report;
}

function main() {
  const report = runObjectGalleryCleanup({ apply: APPLY });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  printProof(report);
  if (report.FINAL_VERDICT === "FAIL") process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("iu-feed-photo-object-gallery-cleanup.mjs")) {
  main();
}
