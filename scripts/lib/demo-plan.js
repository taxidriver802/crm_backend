/**
 * The demo company's records, built in memory. Nothing here touches the
 * database: seed-demo-company.js writes what this returns.
 *
 * One code path builds every customer: a lead that may become a job, an
 * estimate, a deposit and a final invoice, payments, tasks, notes and the
 * status history the reports read. Each customer is a timeline of moments;
 * only the moments at or before `now` happen, so the same rules give a year
 * of finished work and today's open pipeline. Eight featured customers use
 * fixed timelines so a walkthrough always has the same people to click on.
 *
 * Randomness comes from a seeded generator, so a given day always builds the
 * same data. Dates are wall-clock times in the company's time zone.
 */

const DAY = 86400000;
const HOUR = 3600000;
const MINUTE = 60000;

const HISTORY_DAYS = 365;
/** Leads per weekday before seasonality; about 260 leads a year in all. */
const BASE_DAILY_LEADS = 0.8;
/** Jan…Dec. A northern roofer: slow winters, a busy spring and summer. */
const SEASONALITY = [
  0.45, 0.45, 0.75, 1.0, 1.4, 1.5, 1.45, 1.35, 1.25, 1.15, 0.9, 0.55,
];
/**
 * The open pipeline is only the last few weeks of leads, so those weeks
 * never drop below this rate, whatever month the seed runs in.
 */
const RECENT_DAYS = 21;
const RECENT_FLOOR = 1.4;
const STORM_LEADS = 22;

/** The people the records belong to. The owner is whoever registered. */
const TEAM = [
  {
    key: 'maya',
    first_name: 'Maya',
    last_name: 'Ortiz',
    email: 'maya.ortiz@example.com',
    role: 'agent',
  },
  {
    key: 'luis',
    first_name: 'Luis',
    last_name: 'Brennan',
    email: 'luis.brennan@example.com',
    role: 'agent',
  },
  {
    key: 'dana',
    first_name: 'Dana',
    last_name: 'Whitfield',
    email: 'dana.whitfield@example.com',
    role: 'admin',
  },
];

/** How often each salesperson closes, before source and job size. */
const WIN_RATE = { owner: 0.58, maya: 0.53, luis: 0.45 };

// ─── Deterministic randomness ───────────────────────────────────────────────

function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: small, fast, and the same sequence for the same seed. */
function createRng(seedText) {
  let state = hashSeed(String(seedText));
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** entries: [[value, weight], …] */
    weighted(entries) {
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    poisson(mean) {
      const limit = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > limit);
      return k - 1;
    },
  };
}

// ─── Wall-clock time in the company's zone ──────────────────────────────────

function createClock(nowMs, timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  });

  function parts(ms) {
    const out = {};
    for (const part of format.formatToParts(new Date(ms)))
      out[part.type] = part.value;
    return {
      year: Number(out.year),
      month: Number(out.month),
      day: Number(out.day),
      hour: Number(out.hour) % 24,
      minute: Number(out.minute),
      second: Number(out.second),
      weekday: out.weekday,
    };
  }

  function offset(ms) {
    const p = parts(ms);
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Math.floor(ms / 1000) * 1000
    );
  }

  /** The instant a wall clock in the zone shows this date and time. */
  function wall(year, month, day, hour = 0, minute = 0) {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    let instant = guess - offset(guess);
    const corrected = guess - offset(instant);
    if (corrected !== instant) instant = corrected;
    return instant;
  }

  const today = parts(nowMs);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);

  /** `days` calendar days from today (negative is the past), at hour:minute. */
  function at(days, hour = 12, minute = 0) {
    const d = new Date(todayUtc + days * DAY);
    return wall(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      hour,
      minute
    );
  }

  /** Calendar days from today to the day `ms` falls on. */
  function dayOf(ms) {
    const p = parts(ms);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day) - todayUtc) / DAY);
  }

  function isWeekend(days) {
    const weekday = parts(at(days)).weekday;
    return weekday === 'Sat' || weekday === 'Sun';
  }

  /**
   * The first moment at or after `ms` inside working hours. A time pushed
   * to the start of a day gets a little jitter so mornings don't all read
   * 8:00 sharp; `step` rounds minutes (appointments land on :00 or :30).
   */
  function business(
    ms,
    rng,
    { start = 8, end = 18, weekends = false, step = 0 } = {}
  ) {
    let days = dayOf(ms);
    const p = parts(ms);
    let hour = p.hour;
    let minute = p.minute;
    for (let guard = 0; guard < 14; guard += 1) {
      if (!weekends && isWeekend(days)) {
        days += 1;
        hour = start;
        minute = rng.int(0, 70);
        continue;
      }
      if (hour < start) {
        hour = start;
        minute = rng.int(0, 70);
      }
      if (hour >= end) {
        days += 1;
        hour = start;
        minute = rng.int(0, 70);
        continue;
      }
      break;
    }
    hour += Math.floor(minute / 60);
    minute %= 60;
    if (step) {
      minute = Math.ceil(minute / step) * step;
      if (minute >= 60) {
        hour += 1;
        minute = 0;
      }
    }
    return at(days, hour, minute);
  }

  /** The working day `count` weekdays after day `days`. */
  function addWorkdays(days, count) {
    let day = days;
    let left = count;
    while (left > 0) {
      day += 1;
      if (!isWeekend(day)) left -= 1;
    }
    return day;
  }

  return { now: nowMs, parts, at, dayOf, isWeekend, business, addWorkdays };
}

// ─── Reference lists ────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'James',
  'Mary',
  'Robert',
  'Patricia',
  'John',
  'Jennifer',
  'Michael',
  'Linda',
  'David',
  'Elizabeth',
  'William',
  'Barbara',
  'Richard',
  'Susan',
  'Joseph',
  'Jessica',
  'Thomas',
  'Sarah',
  'Chris',
  'Karen',
  'Daniel',
  'Nancy',
  'Matthew',
  'Lisa',
  'Anthony',
  'Betty',
  'Mark',
  'Sandra',
  'Steven',
  'Ashley',
  'Paul',
  'Kimberly',
  'Andrew',
  'Emily',
  'Joshua',
  'Donna',
  'Kevin',
  'Michelle',
  'Brian',
  'Carol',
  'Eric',
  'Amanda',
  'Ryan',
  'Melissa',
  'Jacob',
  'Deborah',
  'Nicholas',
  'Rebecca',
  'Tyler',
  'Laura',
  'Aaron',
  'Megan',
  'Nathan',
  'Rachel',
  'Kyle',
  'Hannah',
  'Adam',
  'Olivia',
  'Ben',
  'Erin',
  'Samir',
  'Aisha',
  'Wei',
  'Mei',
  'Carlos',
  'Lucia',
  'Ahmed',
  'Fatima',
  'Kwame',
  'Ngozi',
  'Anh',
  'Linh',
  'Raj',
  'Anika',
  'Diego',
  'Sofia',
  'Ibrahim',
  'Leila',
  'Hiro',
  'Yuki',
  'Tomas',
  'Ingrid',
  'Sven',
  'Astrid',
  'Mateo',
  'Omar',
  'Zainab',
  'Pa Houa',
  'Tou',
  'Mai',
  'Bao',
  'Greta',
  'Lars',
  'Nora',
  'Erik',
  'Kari',
];

const LAST_NAMES = [
  'Johnson',
  'Olson',
  'Anderson',
  'Carlson',
  'Peterson',
  'Larson',
  'Hanson',
  'Swanson',
  'Gustafson',
  'Halvorson',
  'Sorensen',
  'Bergstrom',
  'Dahl',
  'Lund',
  'Engstrom',
  'Holm',
  'Berg',
  'Nguyen',
  'Tran',
  'Garcia',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Kim',
  'Park',
  'Shah',
  'Singh',
  'Ali',
  'Hassan',
  'Mohamed',
  'Yang',
  'Vang',
  'Xiong',
  'Lor',
  'Her',
  'Thao',
  'Schmidt',
  'Mueller',
  'Becker',
  'Wagner',
  'Schultz',
  "O'Brien",
  'Murphy',
  'Sullivan',
  'Kowalski',
  'Novak',
  'Brown',
  'Miller',
  'Davis',
  'Wilson',
  'Moore',
  'Taylor',
  'Thomas',
  'Jackson',
  'White',
  'Harris',
  'Martin',
  'Thompson',
  'Clark',
  'Lewis',
  'Walker',
  'Hall',
  'Allen',
  'Young',
  'King',
  'Wright',
  'Scott',
  'Green',
  'Baker',
  'Adams',
  'Campbell',
  'Mitchell',
  'Roberts',
  'Carter',
  'Phillips',
  'Evans',
  'Turner',
  'Torres',
  'Parker',
  'Collins',
  'Edwards',
  'Stewart',
  'Morris',
  'Rogers',
  'Reed',
  'Cook',
  'Bell',
  'Cooper',
  'Richardson',
  'Howard',
  'Ward',
  'Gray',
  'Watson',
  'Kelly',
  'Sanders',
  'Price',
  'Bennett',
  'Wood',
  'Barnes',
  'Ross',
  'Henderson',
  'Coleman',
  'Jenkins',
  'Perry',
  'Powell',
  'Long',
  'Patterson',
  'Hughes',
  'Flores',
  'Butler',
  'Foster',
  'Bryant',
  'Russell',
  'Griffin',
  'Diaz',
  'Okafor',
  'Mensah',
  'Haddad',
  'Ramirez',
  'Castillo',
];

const STREETS = [
  'Maple Ave',
  'Cedar Lake Rd',
  'Lakeview Dr',
  'Grand Ave',
  'Hillcrest Dr',
  'Ridgeway Rd',
  'Pinecrest Ct',
  'Willow Bend',
  'Aspen Ln',
  'Elm St',
  'Highland Pkwy',
  'Prairie View Dr',
  'Ford Pkwy',
  'Lyndale Ave S',
  'Bryant Ave S',
  'Xerxes Ave S',
  'France Ave S',
  'Penn Ave N',
  'Excelsior Blvd',
  'Minnehaha Pkwy',
  'Cretin Ave',
  'Snelling Ave',
  'Larpenteur Ave',
  'County Rd B',
  'Bass Lake Rd',
  'Fernbrook Ln',
  'Vicksburg Ln',
  'Weaver Lake Rd',
  'Pioneer Trl',
  'Valley View Rd',
  'Gleason Lake Dr',
  'Shady Oak Rd',
  'Radisson Rd',
  'Lexington Ave',
  'Rice Creek Pkwy',
  'Pilot Knob Rd',
  'Dodd Rd',
  'Cliff Rd',
  'Diffley Rd',
  'Nicollet Ave',
  'Portland Ave',
  'Chicago Ave',
  'Como Ave',
  'Stillwater Rd',
  'Radio Dr',
  'Bielenberg Dr',
  'Lake Elmo Ave',
  'Sunset Ridge',
  'Oakwood Ct',
  'Juniper Ln',
  'Tamarack Rd',
];

const CITIES = [
  ['Minneapolis', ['55406', '55408', '55410', '55417', '55419']],
  ['St Paul', ['55105', '55108', '55116']],
  ['Edina', ['55424', '55435', '55439']],
  ['Plymouth', ['55441', '55446', '55447']],
  ['Maple Grove', ['55311', '55369']],
  ['Eden Prairie', ['55344', '55347']],
  ['Woodbury', ['55125', '55129']],
  ['Eagan', ['55122', '55123']],
  ['Bloomington', ['55420', '55431', '55438']],
  ['Roseville', ['55113']],
  ['Minnetonka', ['55305', '55345']],
  ['Lakeville', ['55044']],
  ['Blaine', ['55434', '55449']],
  ['Apple Valley', ['55124']],
  ['Burnsville', ['55337']],
  ['Shoreview', ['55126']],
];

const AREA_CODES = ['612', '651', '763', '952'];
const EMAIL_DOMAINS = [
  'example.com',
  'example.com',
  'example.net',
  'example.org',
];

const SERVICE_WEIGHTS = [
  ['Replacement', 34],
  ['Repair', 26],
  ['Inspection', 18],
  ['Gutters', 15],
  ['Maintenance', 7],
];
const SOURCE_WEIGHTS = [
  ['Website', 36],
  ['Referral', 24],
  ['Door knock', 18],
  ['Repeat customer', 10],
  ['Other', 12],
];

const SHINGLES = [
  {
    name: 'GAF Timberline HDZ — Charcoal',
    short: 'GAF Timberline HDZ (Charcoal)',
  },
  {
    name: 'GAF Timberline HDZ — Pewter Gray',
    short: 'GAF Timberline HDZ (Pewter Gray)',
  },
  {
    name: 'Owens Corning Duration — Driftwood',
    short: 'Owens Corning Duration (Driftwood)',
  },
  {
    name: 'Owens Corning Duration — Onyx Black',
    short: 'Owens Corning Duration (Onyx Black)',
  },
  {
    name: 'CertainTeed Landmark — Weathered Wood',
    short: 'CertainTeed Landmark (Weathered Wood)',
  },
];
const GUTTER_COLORS = [
  'White',
  'Musket Brown',
  'Colonial Gray',
  'Black',
  'Almond',
];

const INTAKE_MESSAGES = {
  Replacement: [
    'Roof is about 22 years old and there are granules in the gutters. Looking for a replacement quote.',
    'Two layers of shingles on now. Want a full tear-off before we sell next spring.',
    'Shingles are curling on the south side. Would like an estimate for a new roof.',
    'Insurance approved our claim. Need a contractor to do the replacement.',
    'Neighbors all got new roofs this year and ours looks rough next to them. Quote please.',
  ],
  Repair: [
    'Leak over the back bedroom after the last heavy rain.',
    'A few shingles blew off in the wind last week. Need them replaced before winter.',
    'Water stain on the ceiling near the chimney. Flashing looks lifted.',
    'Bathroom vent boot is cracked and dripping into the attic.',
    'Ice dam last winter pulled up some shingles at the eave.',
  ],
  Inspection: [
    'Hail came through a few weeks ago. Want someone to look before I call insurance.',
    'Buying this house. Need a roof inspection before closing.',
    'Another roofer said we need a full replacement. Looking for a second opinion.',
    'Roof is 15 years old. Want to know how much life it has left.',
  ],
  Gutters: [
    'Gutters overflow at the back corner and the fascia is getting soft.',
    'Want seamless gutters with guards. Tired of cleaning them every fall.',
    'Ice dams pulled a section of gutter loose. Need it replaced.',
    'Downspout by the garage dumps water next to the foundation.',
  ],
  Maintenance: [
    'Annual roof check before winter. Some moss on the north slope.',
    'Want the gutters cleaned and a quick look at the vents and boots.',
    'Looking for a yearly maintenance visit. You did our roof a few years back.',
  ],
};

const FIRST_CALL_DETAILS = {
  Replacement: [
    'Roof is original to the house, around 22 years. Granule loss on every slope.',
    'Two layers on now, so it will be a tear-off. Wants the work done before snow.',
    'Curling tabs on the south face and a soft spot by the valley.',
    'Adjuster already approved the claim; wants our number to compare.',
  ],
  Repair: [
    'Leak is above the back bedroom, only in wind-driven rain.',
    'Missing shingles on the ridge after the last storm.',
    'Stain by the chimney, likely failed counter-flashing.',
    'Cracked pipe boot over the bathroom.',
  ],
  Inspection: [
    'Hail hit the neighborhood; a few neighbors already have claims open.',
    'Under contract on the house and needs a roof report for the lender.',
    'Wants a second opinion before agreeing to a full replacement elsewhere.',
  ],
  Gutters: [
    'Overflow at the back corner; fascia feels soft behind the gutter.',
    'Wants seamless 6-inch with guards, color to match the trim.',
    'Gutter pulled away from the fascia after ice dams.',
  ],
  Maintenance: [
    'Moss on the north slope and the gutters are full.',
    'Wants a yearly tune-up so small problems get caught early.',
  ],
};

const INACTIVE_REASONS = [
  'No answer after three calls and a text. Closing this out.',
  'Decided to wait until spring.',
  'Went with the contractor their insurance company recommended.',
  'Price shopping. Said our ballpark was higher than two other bids.',
  'Insurance claim denied, so they are not moving forward this year.',
  'Planning to do the repair themselves.',
];

const LOST_REASONS = [
  {
    reason: 'Went with a lower bid',
    note: 'Thanks for the quote. We went with a lower bid this time.',
  },
  {
    reason: 'Competitor could start sooner',
    note: 'Going with another contractor who can start next week.',
  },
  {
    reason: 'Insurance did not cover enough',
    note: 'Insurance came in lower than we hoped. Holding off for now.',
  },
  {
    reason: 'Decided to wait until next season',
    note: 'We are going to wait until next year.',
  },
];

const APPROVAL_NOTES = [
  "Looks good. Let's get on the schedule.",
  'Approved. Can we do the charcoal color?',
  'Go ahead. Deposit going out today.',
  'Approved. Please call before the crew shows up.',
  null,
  null,
];

const INSTALL_NOTES = {
  Replacement: [
    'Crew on site at 7:30. Tear-off done by noon; decking solid except one sheet by the valley.',
    'Materials dropped in the driveway. Homeowner moved the cars to the street.',
    'Found two layers under the old roof on the garage. Covered by the tear-off line.',
  ],
  Gutters: [
    'Old gutters off and hauled away. New runs hung by early afternoon.',
    'Matched the trim color. Moved the garage downspout away from the foundation.',
  ],
  Repair: [
    'Replaced the damaged shingles and resealed the flashing. Water test came back dry.',
    'Swapped the cracked boot and replaced shingles around it.',
  ],
  Maintenance: [
    'Gutters cleaned, moss treated, two loose shingles resealed.',
    'Tune-up done. Recommended watching the north valley next year.',
  ],
};

const WRAP_UP_NOTES = [
  'Wrapped up. Magnet sweep done twice; homeowner walked it with us and signed off.',
  'Job complete. Before and after photos are on the job.',
  'Done. Homeowner happy with the cleanup.',
];

// ─── Small helpers ──────────────────────────────────────────────────────────

function money(value) {
  return Math.round(value * 100) / 100;
}

/** A believable unit price near `base`: quarters below $50, whole dollars, then fives. */
function price(rng, base) {
  const value = base * rng.float(0.93, 1.07);
  if (value < 50) return Math.round(value * 4) / 4;
  if (value < 200) return Math.round(value);
  return Math.round(value / 5) * 5;
}

function usd(value) {
  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function lower(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ─── People and places ──────────────────────────────────────────────────────

function createDirectory() {
  const names = new Set();
  const emails = new Set();
  const phones = new Set();
  const addresses = new Set();

  function reserve({ first_name, last_name, email, phone }) {
    names.add(`${first_name} ${last_name}`);
    if (email) emails.add(email);
    if (phone) phones.add(phone);
  }

  function phone(rng) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      // 555-0100 through 555-0199 is the range set aside for fiction.
      const value = `${rng.pick(AREA_CODES)}5550${rng.int(100, 199)}`;
      if (!phones.has(value)) {
        phones.add(value);
        return value;
      }
    }
    return `${rng.pick(AREA_CODES)}5550${rng.int(100, 199)}`;
  }

  function email(rng, first, last) {
    const f = first.toLowerCase().replace(/[^a-z]/g, '');
    const l = last.toLowerCase().replace(/[^a-z]/g, '');
    const shapes = [
      `${f}.${l}`,
      `${f}${l}`,
      `${f.charAt(0)}${l}`,
      `${f}.${l}${rng.int(2, 99)}`,
    ];
    for (const shape of shapes) {
      const value = `${shape}@${rng.pick(EMAIL_DOMAINS)}`;
      if (!emails.has(value)) {
        emails.add(value);
        return value;
      }
    }
    return `${f}.${l}.${rng.int(100, 999)}@example.com`;
  }

  function person(rng, { needsEmail = true } = {}) {
    let first = rng.pick(FIRST_NAMES);
    let last = rng.pick(LAST_NAMES);
    for (
      let attempt = 0;
      attempt < 50 && names.has(`${first} ${last}`);
      attempt += 1
    ) {
      first = rng.pick(FIRST_NAMES);
      last = rng.pick(LAST_NAMES);
    }
    names.add(`${first} ${last}`);
    return {
      first_name: first,
      last_name: last,
      email: needsEmail ? email(rng, first, last) : null,
      phone: phone(rng),
    };
  }

  function address(rng) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const [city, zips] = rng.pick(CITIES);
      const value = `${rng.int(100, 9899)} ${rng.pick(STREETS)}, ${city}, MN ${rng.pick(zips)}`;
      if (!addresses.has(value)) {
        addresses.add(value);
        return value;
      }
    }
    return `${rng.int(100, 9899)} ${rng.pick(STREETS)}, Minneapolis, MN 55408`;
  }

  return { reserve, person, address };
}

// ─── Scope: line items, measurements and size ───────────────────────────────

function buildScope(rng, jobType, lastName, options = {}) {
  const lines = [];
  const measurements = [];
  let title;
  let description;
  let estimateTitle;
  let notes;
  let installHours = null;
  let installDays = 1;

  if (jobType === 'Replacement') {
    const squares = options.squares ?? rng.int(16, 40);
    const layers = options.layers ?? (rng.chance(0.3) ? 2 : 1);
    const shingle =
      SHINGLES[options.shingle ?? rng.int(0, SHINGLES.length - 1)];
    const ridge = rng.int(28, 64);
    const eave = rng.int(140, 260);
    lines.push(
      {
        name: `Tear-off & disposal (${layers} layer${layers > 1 ? 's' : ''})`,
        description: 'Per square, haul-away included',
        quantity: squares,
        unit_price: price(rng, layers > 1 ? 118 : 92),
      },
      {
        name: shingle.name,
        description: 'Shingles, starter strip and ridge cap',
        quantity: squares,
        unit_price: price(rng, 380),
      },
      {
        name: 'Synthetic underlayment',
        description: 'Full deck coverage',
        quantity: squares,
        unit_price: price(rng, 28),
      },
      {
        name: 'Ice & water shield',
        description: 'Eaves (6 ft up) and all valleys',
        quantity: 1,
        unit_price: price(rng, 600 + squares * 12),
      },
      {
        name: 'Ridge vent',
        description: 'Shingle-over, per linear foot',
        quantity: ridge,
        unit_price: 9.5,
      },
      {
        name: 'Drip edge',
        description: 'Aluminum, color-matched, per linear foot',
        quantity: eave,
        unit_price: 4.25,
      },
      {
        name: 'Pipe boots & step flashing',
        description: 'Replace every penetration',
        quantity: 1,
        unit_price: price(rng, 375),
      }
    );
    const decking = options.decking ?? (rng.chance(0.35) ? rng.int(3, 12) : 0);
    if (decking) {
      lines.push({
        name: 'Decking replacement',
        description: '7/16" OSB, per sheet',
        quantity: decking,
        unit_price: 85,
      });
    }
    if (options.chimney ?? rng.chance(0.2)) {
      lines.push({
        name: 'Chimney flashing',
        description: 'Counter-flash and reseal',
        quantity: 1,
        unit_price: price(rng, 650),
      });
    }
    lines.push({
      name: 'Dumpster & cleanup',
      description: 'Magnetic nail sweep, twice',
      quantity: 1,
      unit_price: 475,
    });
    measurements.push(
      { label: 'Roof squares', value: squares, unit: 'sq' },
      { label: 'Ridge length', value: ridge, unit: 'ft' },
      { label: 'Eave length', value: eave, unit: 'ft' },
      { label: 'Layers to remove', value: layers, unit: 'ea' }
    );
    title = `${lastName} residence — ${options.storm ? 'hail damage roof replacement' : rng.pick(['full roof replacement', 'tear-off & re-roof', 'roof replacement'])}`;
    description = `Tear off ${layers} layer${layers > 1 ? 's' : ''} and install ${shingle.short} with synthetic underlayment, ice & water shield and ridge vent.`;
    estimateTitle = `${lastName} — roof replacement`;
    notes =
      'Includes permit, 10-year workmanship warranty and full cleanup with a magnetic nail sweep.';
    installDays = squares <= 24 ? 1 : squares <= 34 ? 2 : 3;
  } else if (jobType === 'Repair') {
    const area = rng.int(1, 3);
    lines.push({
      name: 'Shingle repair',
      description: 'Replace damaged shingles, matched to existing',
      quantity: area,
      unit_price: price(rng, 450),
    });
    if (rng.chance(0.55)) {
      lines.push({
        name: 'Flashing repair',
        description: rng.pick([
          'Chimney counter-flashing',
          'Step flashing at the sidewall',
          'Valley flashing',
        ]),
        quantity: 1,
        unit_price: price(rng, 425),
      });
    }
    if (rng.chance(0.45)) {
      lines.push({
        name: 'Pipe boot replacement',
        description: 'Lead-free boot',
        quantity: rng.int(1, 3),
        unit_price: 95,
      });
    }
    lines.push({
      name: 'Service call & photo report',
      description: 'Before and after photos',
      quantity: 1,
      unit_price: 175,
    });
    measurements.push({
      label: 'Damaged area',
      value: area * 100,
      unit: 'sq ft',
    });
    title = `${lastName} residence — ${rng.pick(['leak repair', 'shingle & flashing repair', 'storm damage repair'])}`;
    description =
      'Repair the damaged section, reseal flashing and water-test before leaving.';
    estimateTitle = `${lastName} — roof repair`;
    notes = '2-year workmanship warranty on the repaired area.';
    installHours = rng.int(3, 5);
  } else if (jobType === 'Gutters') {
    const feet = options.feet ?? rng.int(110, 220);
    const downspouts = rng.int(4, 9);
    const color = rng.pick(GUTTER_COLORS);
    lines.push(
      {
        name: 'Remove & dispose old gutters',
        description: 'Includes hangers and downspouts',
        quantity: 1,
        unit_price: price(rng, 300),
      },
      {
        name: '6" seamless aluminum gutters',
        description: `${color}, hidden hangers every 24"`,
        quantity: feet,
        unit_price: price(rng, 14.25),
      },
      {
        name: '3x4 downspouts',
        description: `${color}, with extensions`,
        quantity: downspouts,
        unit_price: price(rng, 95),
      }
    );
    const guards = options.guards ?? rng.chance(0.45);
    if (guards) {
      lines.push({
        name: 'Gutter guards',
        description: 'Micro-mesh, per linear foot',
        quantity: feet,
        unit_price: price(rng, 9.5),
      });
    }
    const fascia = options.fascia ?? (rng.chance(0.25) ? rng.int(8, 32) : 0);
    if (fascia) {
      lines.push({
        name: 'Fascia board replacement',
        description: 'Per linear foot, primed and painted',
        quantity: fascia,
        unit_price: 18,
      });
    }
    measurements.push(
      { label: 'Gutter length', value: feet, unit: 'ft' },
      { label: 'Downspouts', value: downspouts, unit: 'ea' }
    );
    title = `${lastName} residence — ${guards ? 'gutters & guards' : 'seamless gutters'}`;
    description = `Replace gutters and downspouts with 6" seamless aluminum in ${color.toLowerCase()}.`;
    estimateTitle = `${lastName} — gutters`;
    notes = '5-year workmanship warranty. Color matched to the trim.';
  } else {
    lines.push({
      name: 'Roof tune-up',
      description:
        'Reseal flashing, replace cracked boots, secure loose shingles',
      quantity: 1,
      unit_price: price(rng, 395),
    });
    lines.push({
      name: 'Gutter cleaning',
      description: 'Flush downspouts, haul debris',
      quantity: 1,
      unit_price: price(rng, 225),
    });
    if (rng.chance(0.5)) {
      lines.push({
        name: 'Moss treatment',
        description: 'North slope',
        quantity: 1,
        unit_price: price(rng, 260),
      });
    }
    title = `${lastName} residence — roof tune-up`;
    description =
      'Yearly maintenance visit: tune-up, gutter cleaning and a photo report.';
    estimateTitle = `${lastName} — maintenance visit`;
    notes = 'Photo report sent after the visit.';
    installHours = rng.int(2, 4);
  }

  for (const [index, line] of lines.entries()) {
    line.sort_order = index;
    line.line_total = money(line.quantity * line.unit_price);
  }
  const subtotal = money(lines.reduce((sum, line) => sum + line.line_total, 0));
  return {
    lines,
    measurements,
    title,
    description,
    estimateTitle,
    notes,
    subtotal,
    installDays,
    installHours,
  };
}

// ─── Timelines ──────────────────────────────────────────────────────────────

function pickAssignee(rng, source) {
  if (source === 'Referral' || source === 'Repeat customer') {
    return rng.weighted([
      ['owner', 4],
      ['maya', 4],
      ['luis', 2],
    ]);
  }
  if (source === 'Door knock')
    return rng.weighted([
      ['luis', 6],
      ['maya', 4],
    ]);
  return rng.weighted([
    ['maya', 4],
    ['luis', 3],
    ['owner', 3],
  ]);
}

function intakeNote(rng, chain) {
  const message = rng.pick(INTAKE_MESSAGES[chain.service]);
  switch (chain.source) {
    case 'Referral':
      return `Referred by ${chain.referrer}. ${message}`;
    case 'Repeat customer':
      return `Past customer. ${message}`;
    case 'Door knock':
      return `Met at the door while canvassing ${chain.address.split(',')[0].replace(/^\d+ /, '')}. ${message}`;
    case 'Other':
      return `${rng.pick(['Saw our yard sign down the street.', 'Found us on Google Maps.', 'Heard our radio spot.'])} ${message}`;
    default:
      return message;
  }
}

/** A lead's whole possible future, from first contact to paid and closed. */
function randomChain(
  rng,
  clock,
  directory,
  created,
  { storm = false, referrers = [] } = {}
) {
  const service = storm
    ? rng.weighted([
        ['Replacement', 5],
        ['Inspection', 4],
        ['Repair', 3],
      ])
    : rng.weighted(SERVICE_WEIGHTS);
  const source = storm
    ? rng.weighted([
        ['Website', 4],
        ['Door knock', 4],
        ['Referral', 2],
        ['Other', 1],
      ])
    : rng.weighted(SOURCE_WEIGHTS);
  const jobType =
    service === 'Inspection'
      ? rng.chance(storm ? 0.7 : 0.5)
        ? 'Replacement'
        : 'Repair'
      : service;
  const person = directory.person(rng, {
    needsEmail: !(source === 'Door knock' && rng.chance(0.35)),
  });
  const chain = {
    key: null,
    person,
    source,
    service,
    jobType,
    storm,
    assignee: pickAssignee(rng, source),
    urgency: storm
      ? rng.weighted([
          ['Urgent', 6],
          ['Normal', 3],
          ['Low', 1],
        ])
      : service === 'Repair'
        ? rng.weighted([
            ['Urgent', 4],
            ['Normal', 5],
            ['Low', 1],
          ])
        : rng.weighted([
            ['Normal', 6],
            ['Low', 3],
            ['Urgent', 1],
          ]),
    contact: rng.weighted([
      ['Call', 5],
      ['Text', 3],
      ['Email', person.email ? 2 : 0],
    ]),
    address: directory.address(rng),
    referrer: referrers.length ? rng.pick(referrers) : 'a neighbor',
    scope: null,
    t: { created },
  };
  chain.scope = buildScope(rng, jobType, person.last_name, { storm });
  chain.leadNote = intakeNote(rng, chain);

  const t = chain.t;
  const firstTouchHours =
    source === 'Door knock' ? rng.float(0.05, 0.3) : rng.float(0.3, 30);
  if (rng.chance(0.9)) {
    t.contacted = clock.business(created + firstTouchHours * HOUR, rng, {
      start: 8,
      end: 19,
    });
  } else {
    t.inactive = created + rng.float(12, 24) * DAY;
    chain.inactiveReason = INACTIVE_REASONS[0];
  }

  if (t.contacted) {
    let qualify = {
      Replacement: 0.68,
      Repair: 0.72,
      Inspection: 0.78,
      Gutters: 0.62,
      Maintenance: 0.55,
    }[service];
    if (storm) qualify += 0.1;
    if (source === 'Referral' || source === 'Repeat customer') qualify += 0.12;
    if (source === 'Door knock') qualify -= 0.1;
    if (rng.chance(qualify)) {
      t.qualified = rng.chance(0.55)
        ? t.contacted + rng.int(3, 15) * MINUTE
        : clock.business(t.contacted + rng.float(1, 6) * DAY, rng);
    } else {
      t.inactive = t.contacted + rng.float(4, 30) * DAY;
      chain.inactiveReason = rng.pick(INACTIVE_REASONS.slice(1));
    }
  }

  if (t.qualified) {
    t.inspection = clock.business(t.qualified + rng.float(1, 6) * DAY, rng, {
      start: 8,
      end: 17,
      step: 30,
    });
    t.inspectionMinutes = jobType === 'Replacement' ? 90 : 60;
    if (rng.chance(0.93)) {
      t.drafted = clock.business(t.inspection + rng.float(2, 30) * HOUR, rng, {
        start: 8,
        end: 20,
        weekends: true,
      });
      t.proposed = clock.business(t.drafted + rng.float(0.3, 36) * HOUR, rng);
    } else {
      t.lost = clock.business(t.inspection + rng.float(3, 12) * DAY, rng);
      chain.lost = rng.pick([LOST_REASONS[3], LOST_REASONS[2]]);
      chain.responded = false;
    }
  }

  // A little discount on some jobs: referrals and repeat customers mostly.
  const scope = chain.scope;
  const discounted =
    source === 'Referral' || source === 'Repeat customer'
      ? rng.chance(0.4)
      : rng.chance(0.08);
  scope.discount = discounted
    ? scope.subtotal > 5000
      ? rng.pick([250, 500])
      : money(Math.round(scope.subtotal * 0.05))
    : 0;
  scope.discountLabel = discounted
    ? source === 'Repeat customer'
      ? 'Repeat customer discount'
      : source === 'Referral'
        ? 'Referral discount'
        : 'Seasonal discount'
    : null;
  scope.total = money(scope.subtotal - scope.discount);

  if (t.proposed) {
    let win = WIN_RATE[chain.assignee];
    if (source === 'Referral') win += 0.15;
    if (source === 'Repeat customer') win += 0.2;
    if (source === 'Door knock') win -= 0.08;
    if (jobType === 'Repair' || jobType === 'Maintenance') win += 0.12;
    if (jobType === 'Gutters') win += 0.05;
    if (storm) win += 0.05;
    win = Math.min(0.85, Math.max(0.15, win));
    if (rng.chance(win)) {
      chain.won = true;
      t.decided = clock.business(t.proposed + rng.float(0.5, 16) * DAY, rng, {
        start: 8,
        end: 21,
        weekends: true,
      });
      chain.approvalNote = rng.pick(APPROVAL_NOTES);
    } else if (rng.chance(0.7)) {
      t.decided = clock.business(t.proposed + rng.float(2, 20) * DAY, rng, {
        start: 8,
        end: 21,
        weekends: true,
      });
      chain.lost = rng.pick(LOST_REASONS);
      chain.responded = true;
    } else {
      t.decided = clock.business(t.proposed + rng.float(18, 35) * DAY, rng);
      chain.lost = { reason: 'No response after follow-ups', note: null };
      chain.responded = false;
    }
  }

  if (chain.won) planProduction(rng, clock, chain);
  return chain;
}

/** Deposit, install, final invoice and payments for a won job. */
function planProduction(rng, clock, chain, overrides = {}) {
  const t = chain.t;
  const scope = chain.scope;
  const method = () =>
    rng.weighted([
      ['check', 4],
      ['card', 3],
      ['ach', 3],
    ]);

  if (scope.total >= 5000) {
    chain.deposit = {
      percent: rng.weighted([
        [30, 6],
        [25, 1],
        [40, 1],
        [50, 2],
      ]),
      payments: [],
    };
    t.depositSent = clock.business(t.decided + rng.float(1, 20) * HOUR, rng);
    chain.deposit.payments.push({
      at: clock.business(t.depositSent + rng.float(0.2, 5) * DAY, rng, {
        start: 8,
        end: 21,
        weekends: true,
      }),
      share: 1,
      method: method(),
    });
  }

  const ready = chain.deposit ? chain.deposit.payments[0].at : t.decided;
  t.scheduled = clock.business(
    Math.max(ready, t.decided) + rng.float(0.2, 2) * DAY,
    rng
  );
  const leadDays = {
    Replacement: [5, 21],
    Gutters: [4, 14],
    Repair: [1, 7],
    Maintenance: [2, 10],
  }[chain.jobType];
  t.installStart = clock.business(
    t.scheduled + rng.float(...leadDays) * DAY,
    rng,
    { start: 7, end: 9, step: 30 }
  );
  if (scope.installHours) {
    t.installEnd = t.installStart + scope.installHours * HOUR;
  } else {
    const lastDay = clock.addWorkdays(
      clock.dayOf(t.installStart),
      scope.installDays - 1
    );
    t.installEnd = clock.at(
      lastDay,
      rng.int(15, 17),
      rng.pick([0, 15, 30, 45])
    );
  }
  t.finalSent = clock.business(t.installEnd + rng.float(1, 40) * HOUR, rng);
  chain.finalDueDays = 14;

  const due = t.finalSent + chain.finalDueDays * DAY;
  const roll = overrides.finalRoll ?? rng.next();
  const payments = [];
  if (roll < 0.68) {
    payments.push({
      at: t.finalSent + rng.float(1, 12) * DAY,
      share: 1,
      method: method(),
    });
  } else if (roll < 0.78) {
    payments.push({
      at: t.finalSent + rng.float(5, 15) * DAY,
      share: 1,
      method: 'financing',
    });
  } else if (roll < 0.9) {
    payments.push({
      at: t.finalSent + rng.float(2, 8) * DAY,
      share: 0.5,
      method: method(),
    });
    payments.push({
      at: t.finalSent + rng.float(18, 35) * DAY,
      share: 'rest',
      method: method(),
    });
  } else {
    payments.push({
      at: due + rng.float(4, 30) * DAY,
      share: 1,
      method: method(),
    });
  }
  chain.finalPayments = payments.map((payment) => ({
    ...payment,
    at: clock.business(payment.at, rng, { start: 8, end: 21, weekends: true }),
  }));
  t.closed = clock.business(
    chain.finalPayments[chain.finalPayments.length - 1].at +
      rng.float(2, 48) * HOUR,
    rng
  );
}

// ─── Featured customers ─────────────────────────────────────────────────────

/**
 * The same people every time, at fixed points relative to today, so a
 * walkthrough has a hot lead, a proposal out, a crew on a roof today, a
 * past-due balance, a happy finished job and a loss.
 */
function featuredChains(clock, directory) {
  const at = clock.at;
  const chains = [];

  function featured(key, base) {
    const rng = createRng(`featured:${key}`);
    const chain = {
      key,
      featured: true,
      storm: false,
      urgency: 'Normal',
      contact: 'Call',
      responded: true,
      ...base,
      t: { ...base.t },
    };
    directory.reserve(chain.person);
    chain.scope = buildScope(
      rng,
      chain.jobType,
      chain.person.last_name,
      base.scopeOptions || {}
    );
    if (base.scopeTitle) chain.scope.title = base.scopeTitle;
    chain.scope.discount = base.discount || 0;
    chain.scope.discountLabel = base.discount ? base.discountLabel : null;
    chain.scope.total = money(chain.scope.subtotal - chain.scope.discount);
    if (chain.won && base.production) {
      const t = chain.t;
      Object.assign(t, base.production.t);
      chain.deposit = base.production.deposit || null;
      chain.finalPayments = base.production.finalPayments || [];
      chain.finalDueDays = base.production.finalDueDays ?? 14;
    }
    chains.push(chain);
    return chain;
  }

  featured('nelson', {
    person: {
      first_name: 'Marcus',
      last_name: 'Nelson',
      email: 'marcus.nelson@example.com',
      phone: '6125550142',
    },
    source: 'Website',
    service: 'Replacement',
    jobType: 'Replacement',
    urgency: 'Urgent',
    assignee: 'owner',
    address: '512 Oak St, Minneapolis, MN 55409',
    leadNote:
      'Hail on Sunday cracked shingles on the west slope. Adjuster is coming Thursday and I want a contractor there too.',
    scopeOptions: { storm: true, squares: 28 },
    t: {
      created: at(-2, 19, 42),
      contacted: at(-1, 8, 12),
      qualified: at(-1, 8, 20),
      inspection: at(1, 13, 0),
      inspectionMinutes: 90,
    },
    notes: [
      {
        on: 'lead',
        at: at(-1, 8, 14),
        author: 'owner',
        type: 'call',
        direction: 'outbound',
        body: 'Spoke with Marcus. Hail hit the west slope worst; a few shingles cracked through. Adjuster comes Thursday, so we booked our inspection the day before to have photos ready.',
      },
      {
        on: 'lead',
        at: at(-1, 12, 5),
        author: 'owner',
        type: 'text',
        direction: 'inbound',
        body: 'Marcus texted photos of dented gutters and a torn window screen.',
      },
    ],
    extraTasks: [
      {
        title: 'Pull the hail report for Oak St',
        description:
          'Storm date, hail size and the radar map for the adjuster packet.',
        due: at(0, 15, 0),
        assignee: 'owner',
        on: 'job',
      },
    ],
  });

  featured('patel', {
    person: {
      first_name: 'Priya',
      last_name: 'Patel',
      email: 'priya.patel@example.com',
      phone: '7635550198',
    },
    source: 'Referral',
    service: 'Gutters',
    jobType: 'Gutters',
    contact: 'Email',
    assignee: 'owner',
    referrer: 'Tom Andersen',
    address: '1842 Birchwood Ln, Plymouth, MN 55441',
    leadNote:
      'Referred by Tom Andersen. Gutters overflow at the back corner and the fascia is getting soft. Interested in guards.',
    scopeOptions: { feet: 168, guards: true, fascia: 24 },
    t: {
      created: at(-10, 10, 5),
      contacted: at(-10, 13, 30),
      qualified: at(-10, 13, 40),
      inspection: at(-7, 10, 0),
      inspectionMinutes: 60,
      drafted: at(-6, 15, 0),
      proposed: at(-2, 9, 15),
    },
    shareLink: true,
    notes: [
      {
        on: 'lead',
        at: at(-10, 13, 32),
        author: 'owner',
        type: 'call',
        direction: 'outbound',
        body: 'Talked with Priya. Tom Andersen sent her our way. Water overflows at the back corner by the deck. Booked a measure for Thursday morning.',
      },
      {
        on: 'job',
        at: at(-7, 11, 5),
        author: 'owner',
        type: 'in_person',
        direction: 'outbound',
        body: 'Measured 168 ft of gutter. The fascia is soft along the back corner by the deck, about 24 ft to replace before the new gutters go on.',
      },
      {
        on: 'job',
        at: at(-2, 9, 20),
        author: 'owner',
        type: 'email',
        direction: 'outbound',
        body: 'Sent the proposal link. Told Priya we can start within two weeks of approval.',
      },
    ],
  });

  featured('andersen', {
    person: {
      first_name: 'Tom',
      last_name: 'Andersen',
      email: 'tom.andersen@example.com',
      phone: '6125550110',
    },
    source: 'Repeat customer',
    service: 'Replacement',
    jobType: 'Replacement',
    assignee: 'maya',
    address: '903 Lakeview Dr, Edina, MN 55424',
    leadNote:
      'Past customer. We did his gutters in 2019. Roof is 24 years old and starting to leak at the valley.',
    scopeOptions: {
      squares: 32,
      layers: 1,
      shingle: 0,
      decking: 0,
      chimney: true,
    },
    discount: 500,
    discountLabel: 'Repeat customer discount',
    won: true,
    approvalNote: 'Looks great. Charcoal please. Deposit is going out tonight.',
    t: {
      created: at(-62, 9, 30),
      contacted: at(-62, 11, 0),
      qualified: at(-62, 11, 10),
      inspection: at(-59, 9, 0),
      inspectionMinutes: 90,
      drafted: at(-58, 14, 0),
      proposed: at(-57, 10, 0),
      decided: at(-52, 18, 30),
    },
    production: {
      t: {
        depositSent: at(-51, 9, 0),
        scheduled: at(-49, 10, 0),
        installStart: at(-27, 7, 30),
        installEnd: at(-26, 16, 15),
        finalSent: at(-25, 9, 0),
        closed: at(-13, 9, 0),
      },
      deposit: {
        percent: 30,
        payments: [{ at: at(-50, 12, 0), share: 1, method: 'card' }],
      },
      finalPayments: [
        { at: at(-14, 11, 0), share: 1, method: 'check', reference: '4412' },
      ],
    },
    notes: [
      {
        on: 'job',
        at: at(-26, 16, 30),
        author: 'dana',
        type: 'in_person',
        direction: 'outbound',
        body: 'Crew wrapped up at 4:15. Magnet sweep done twice. Tom walked it with us and signed off.',
      },
      {
        on: 'job',
        at: at(-13, 9, 5),
        author: 'maya',
        type: 'email',
        direction: 'outbound',
        body: 'Thanked Tom for the check and asked for a Google review. He said he already sent his neighbor Priya our way.',
      },
    ],
  });

  featured('lindqvist', {
    person: {
      first_name: 'Grace',
      last_name: 'Lindqvist',
      email: 'grace.lindqvist@example.com',
      phone: '6515550127',
    },
    source: 'Website',
    service: 'Replacement',
    jobType: 'Replacement',
    contact: 'Text',
    assignee: 'luis',
    address: '4417 Wood Duck Trl, Eagan, MN 55123',
    leadNote:
      'Shingles are curling on the south side. Would like an estimate for a new roof.',
    scopeOptions: {
      squares: 36,
      layers: 1,
      shingle: 2,
      decking: 6,
      chimney: false,
    },
    won: true,
    approvalNote:
      'Approved. Please text before the crew shows up. We have a dog.',
    t: {
      created: at(-34, 20, 11),
      contacted: at(-33, 9, 5),
      qualified: at(-31, 14, 0),
      inspection: at(-29, 15, 30),
      inspectionMinutes: 90,
      drafted: at(-28, 11, 0),
      proposed: at(-27, 16, 0),
      decided: at(-19, 19, 45),
    },
    production: {
      t: {
        depositSent: at(-18, 9, 30),
        scheduled: at(-16, 10, 0),
        installStart: at(-1, 7, 30),
        installEnd: at(1, 16, 0),
        finalSent: at(2, 10, 0),
        closed: at(14, 10, 0),
      },
      deposit: {
        percent: 40,
        payments: [{ at: at(-17, 14, 10), share: 1, method: 'ach' }],
      },
      finalPayments: [{ at: at(10, 12, 0), share: 1, method: 'check' }],
    },
    portalLink: true,
    notes: [
      {
        on: 'job',
        at: at(-1, 12, 40),
        author: 'dana',
        type: 'in_person',
        direction: 'outbound',
        body: 'Tear-off done on the south side. Found soft decking around the bathroom vent; replacing 6 sheets, covered by the decking line.',
      },
      {
        on: 'job',
        at: at(-1, 17, 5),
        author: 'luis',
        type: 'text',
        direction: 'inbound',
        body: 'Grace: Thanks for tarping everything before the rain!',
      },
    ],
  });

  featured('ruiz', {
    person: {
      first_name: 'Hector',
      last_name: 'Ruiz',
      email: 'hector.ruiz@example.com',
      phone: '9525550163',
    },
    source: 'Door knock',
    service: 'Replacement',
    jobType: 'Replacement',
    assignee: 'luis',
    address: '738 Ridgeway Rd, Woodbury, MN 55125',
    leadNote:
      'Met at the door while canvassing Ridgeway Rd. Missing shingles on the north face after the wind storm.',
    scopeOptions: {
      squares: 26,
      layers: 2,
      shingle: 1,
      decking: 0,
      chimney: false,
    },
    won: true,
    approvalNote: 'Go ahead. Insurance is paying most of it.',
    t: {
      created: at(-60, 16, 20),
      contacted: at(-60, 16, 25),
      qualified: at(-60, 16, 30),
      inspection: at(-58, 10, 0),
      inspectionMinutes: 90,
      drafted: at(-57, 9, 0),
      proposed: at(-56, 17, 0),
      decided: at(-50, 12, 0),
    },
    production: {
      t: {
        depositSent: at(-49, 10, 0),
        scheduled: at(-46, 10, 0),
        installStart: at(-29, 7, 30),
        installEnd: at(-28, 16, 0),
        finalSent: at(-27, 10, 0),
      },
      deposit: {
        percent: 30,
        payments: [
          { at: at(-47, 9, 0), share: 1, method: 'check', reference: '1187' },
        ],
      },
      finalPayments: [],
      finalDueDays: 15,
    },
    collectionCall: { due: at(0, 10, 0), assignee: 'owner' },
    notes: [
      {
        on: 'job',
        at: at(-5, 14, 0),
        author: 'owner',
        type: 'call',
        direction: 'outbound',
        body: 'Left Hector a voicemail about the balance. Last week he said he was waiting on the insurance depreciation check.',
      },
    ],
  });

  featured('hayes', {
    person: {
      first_name: 'Jordan',
      last_name: 'Hayes',
      email: 'jordan.hayes@example.com',
      phone: '6125550188',
    },
    source: 'Website',
    service: 'Replacement',
    jobType: 'Replacement',
    assignee: 'maya',
    address: '2201 Summit Ave, St Paul, MN 55105',
    leadNote:
      'Two layers of shingles on now. Want a full tear-off before we sell next spring.',
    scopeOptions: {
      squares: 30,
      layers: 2,
      shingle: 4,
      decking: 4,
      chimney: true,
    },
    won: false,
    lost: LOST_REASONS[1],
    t: {
      created: at(-24, 13, 0),
      contacted: at(-24, 15, 30),
      qualified: at(-23, 9, 0),
      inspection: at(-20, 11, 0),
      inspectionMinutes: 90,
      drafted: at(-19, 10, 0),
      proposed: at(-18, 15, 0),
      decided: at(-6, 10, 30),
    },
  });

  featured('brooks', {
    person: {
      first_name: 'Elena',
      last_name: 'Brooks',
      email: null,
      phone: '6515550177',
    },
    source: 'Door knock',
    service: 'Gutters',
    jobType: 'Gutters',
    urgency: 'Low',
    contact: 'Text',
    assignee: 'luis',
    address: '61 Juniper Ln, Roseville, MN 55113',
    leadNote:
      'Met at the door while canvassing Juniper Ln. Downspout by the garage dumps water next to the foundation.',
    t: { created: at(-4, 17, 45), contacted: at(-3, 10, 20) },
    followUpDue: at(0, 11, 0),
    notes: [
      {
        on: 'lead',
        at: at(-3, 10, 22),
        author: 'luis',
        type: 'text',
        direction: 'outbound',
        body: 'Texted Elena about a time to measure. She is traveling and asked to talk after she gets back.',
      },
    ],
  });

  featured('chen', {
    person: {
      first_name: 'David',
      last_name: 'Chen',
      email: 'david.chen@example.com',
      phone: '9525550133',
    },
    source: 'Website',
    service: 'Repair',
    jobType: 'Repair',
    urgency: 'Urgent',
    assignee: 'maya',
    address: '1509 Cliff Rd, Burnsville, MN 55337',
    leadNote:
      'Water is coming through the ceiling by the chimney during the rain last night. Need someone as soon as possible.',
    t: { created: at(-1, 7, 50) },
    keepCallbackOverdue: true,
  });

  return chains;
}

// ─── From timelines to records ──────────────────────────────────────────────

function buildDemoPlan({
  now = new Date(),
  timeZone = 'America/Chicago',
  seed = 'joist-demo-v1',
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const clock = createClock(nowMs, timeZone);
  const rng = createRng(seed);
  const directory = createDirectory();
  const happened = (time) => time != null && time <= nowMs;

  const featured = featuredChains(clock, directory);

  // Every day of the last year: a few new leads, more in spring and summer,
  // fewer on weekends, plus a burst after a summer hail storm.
  const chains = [];
  const referrers = [];
  const stormDay = (() => {
    const year = clock.parts(nowMs).year;
    for (const y of [year, year - 1]) {
      const day = clock.dayOf(Date.UTC(y, 6, 9, 18));
      if (day <= -60 && day >= -HISTORY_DAYS + 30) return day;
    }
    return -150;
  })();

  for (let day = -HISTORY_DAYS; day <= 0; day += 1) {
    const month = clock.parts(clock.at(day)).month;
    const seasonal = Math.max(
      BASE_DAILY_LEADS * SEASONALITY[month - 1],
      day > -RECENT_DAYS ? RECENT_FLOOR : 0
    );
    const rate = seasonal * (clock.isWeekend(day) ? 0.45 : 1);
    const arrivals = Array.from({ length: rng.poisson(rate) }, () => false);
    if (day >= stormDay && day < stormDay + 14) {
      const stormRate = (STORM_LEADS / 4.5) * Math.exp(-(day - stormDay) / 3.5);
      for (let i = rng.poisson(stormRate); i > 0; i -= 1) arrivals.push(true);
    }
    for (const storm of arrivals) {
      const hour = rng.weighted([
        [7, 1],
        [8, 3],
        [9, 4],
        [10, 4],
        [11, 3],
        [12, 3],
        [13, 3],
        [14, 3],
        [15, 3],
        [16, 3],
        [17, 3],
        [18, 3],
        [19, 4],
        [20, 4],
        [21, 2],
      ]);
      const created = clock.at(day, hour, rng.int(0, 59));
      if (created > nowMs) continue;
      const chain = randomChain(rng, clock, directory, created, {
        storm,
        referrers,
      });
      chains.push(chain);
      if (chain.won)
        referrers.push(`${chain.person.first_name} ${chain.person.last_name}`);
    }
  }

  const all = [...chains, ...featured].sort(
    (a, b) => a.t.created - b.t.created
  );
  all.forEach((chain, index) => {
    chain.key = chain.key || `c${index + 1}`;
  });

  const plan = {
    timeZone,
    leads: [],
    leadStatusEvents: [],
    assignmentEvents: [],
    jobs: [],
    estimates: [],
    invoices: [],
    tasks: [],
    notes: [],
    activity: [],
    notifications: [],
    savedViews: [],
    automationRules: [],
    estimateTemplates: [],
  };

  for (const chain of all)
    materialize(chain, plan, { clock, rng, happened, nowMs });

  numberInvoices(plan);
  addJobActivity(plan, { clock, rng, nowMs });
  addNotifications(plan, { nowMs });
  addWorkspaceExtras(plan);
  snoozeStaleTasks(plan, { clock, rng, nowMs });
  plan.summary = summarize(plan);
  return plan;
}

function materialize(chain, plan, { clock, rng, happened, nowMs }) {
  const t = chain.t;
  const { person, scope } = chain;
  const name = `${person.first_name} ${person.last_name}`;
  const leadKey = `lead:${chain.key}`;
  const jobKey = `job:${chain.key}`;
  const creator =
    chain.source === 'Website' || chain.source === 'Other'
      ? 'owner'
      : chain.assignee;

  // ── Lead ──
  let leadStatus = 'New';
  let leadChanged = t.created;
  let leadUpdated = t.created;
  const leadStep = (to, time) => {
    if (!happened(time)) return false;
    plan.leadStatusEvents.push({
      lead: leadKey,
      from_status: leadStatus,
      to_status: to,
      changed_at: time,
    });
    leadStatus = to;
    leadChanged = time;
    leadUpdated = Math.max(leadUpdated, time);
    return true;
  };
  if (leadStep('Contacted', t.contacted) && t.qualified)
    leadStep('Qualified', t.qualified);
  if (leadStatus !== 'Qualified' && t.inactive)
    leadStep('Inactive', t.inactive);
  const leadClosedAt = t.decided ?? t.lost;
  if (leadStatus === 'Qualified' && leadClosedAt)
    leadStep('Closed', leadClosedAt);

  const budget =
    chain.featured || rng.chance(0.6)
      ? [
          Math.max(500, Math.round((scope.subtotal * 0.8) / 500) * 500),
          Math.round((scope.subtotal * 1.2) / 500) * 500,
        ]
      : [null, null];

  plan.leads.push({
    key: leadKey,
    creator,
    assignee: chain.assignee,
    first_name: person.first_name,
    last_name: person.last_name,
    email: person.email,
    phone: person.phone,
    source: chain.source,
    status: leadStatus,
    budget_min: budget[0],
    budget_max: budget[1],
    notes: chain.leadNote,
    service_type: chain.service,
    preferred_contact_method: chain.contact,
    urgency: chain.urgency,
    created_at: t.created,
    updated_at: leadUpdated,
    status_changed_at: leadChanged,
  });
  plan.assignmentEvents.push({
    entity_type: 'lead',
    entity: leadKey,
    user: chain.assignee,
    assigned_at: t.created,
  });

  const task = (fields) => {
    if (!happened(fields.created_at)) return;
    const completed = happened(fields.completed_at)
      ? fields.completed_at
      : null;
    plan.tasks.push({
      creator: fields.creator || chain.assignee,
      assignee: fields.assignee || chain.assignee,
      lead: fields.on === 'job' ? null : leadKey,
      job: fields.on === 'job' ? jobKey : null,
      title: fields.title,
      description: fields.description || null,
      kind: fields.kind || 'task',
      due_date: fields.due_date,
      end_at: fields.end_at || null,
      location: fields.location || null,
      status: completed ? 'Completed' : 'Pending',
      completed_at: completed,
      created_at: fields.created_at,
      updated_at: completed || fields.created_at,
      keepOverdue: Boolean(fields.keepOverdue),
    });
  };
  const note = (fields) => {
    if (!happened(fields.at)) return;
    if (fields.on === 'job' && !happened(t.qualified)) return;
    plan.notes.push({
      entity_type: fields.on,
      entity: fields.on === 'job' ? jobKey : leadKey,
      author: fields.author || chain.assignee,
      type: fields.type,
      direction: fields.direction,
      body: fields.body,
      created_at: fields.at,
    });
  };

  // First touch.
  const callbackDue = clock.business(t.created + 2 * HOUR, rng, {
    start: 8,
    end: 19,
  });
  task({
    title: `Call back ${name}`,
    description: `${chain.service} inquiry from ${chain.source === 'Other' ? 'a referral source' : lower(chain.source)}. Prefers ${chain.contact.toLowerCase()}.`,
    created_at: t.created,
    due_date: callbackDue,
    completed_at: t.contacted ?? t.inactive,
    keepOverdue: chain.keepCallbackOverdue,
  });

  if (t.contacted && !t.qualified) {
    task({
      title: `Follow up with ${person.first_name} about ${chain.service === 'Gutters' ? 'gutters' : `the ${chain.service.toLowerCase()}`}`,
      created_at: t.contacted,
      due_date:
        chain.followUpDue ??
        clock.business(t.contacted + rng.float(1.5, 3) * DAY, rng),
      completed_at: t.inactive,
    });
  }

  if (!chain.featured) {
    if (t.contacted) {
      const viaText = chain.contact === 'Text';
      const details = rng.pick(FIRST_CALL_DETAILS[chain.service]);
      note({
        on: 'lead',
        at: t.contacted + rng.int(1, 6) * MINUTE,
        type: viaText ? 'text' : chain.contact === 'Email' ? 'email' : 'call',
        direction: 'outbound',
        body: t.qualified
          ? `${viaText ? 'Texted with' : 'Spoke with'} ${person.first_name}. ${details} Booked an inspection.`
          : `${viaText ? 'Texted' : 'Called'} ${person.first_name}. ${details} Will follow up.`,
      });
      if (rng.chance(0.3)) {
        note({
          on: 'lead',
          at: t.contacted + rng.float(2, 30) * HOUR,
          type: rng.pick(['text', 'email']),
          direction: 'inbound',
          body: `${person.first_name} sent ${rng.pick(['photos of the damage', 'a photo of the ceiling stain', 'their insurance claim number', 'a few questions about financing'])}.`,
        });
      }
    }
    if (t.inactive) {
      note({
        on: 'lead',
        at: t.inactive,
        type: 'note',
        direction: 'internal',
        body: chain.inactiveReason,
      });
    }
  }

  for (const extra of chain.notes || []) note(extra);

  if (!happened(t.qualified)) return;

  // ── Job ──
  const jobCreated = t.qualified;
  let jobStatus = 'New';
  let jobChanged = jobCreated;
  let jobUpdated = jobCreated;
  let stopped = false;
  const transitions = [];
  const jobStep = (to, time) => {
    if (stopped || !happened(time)) {
      stopped = true;
      return false;
    }
    transitions.push({ from: jobStatus, to, at: time });
    jobStatus = to;
    jobChanged = time;
    jobUpdated = Math.max(jobUpdated, time);
    return true;
  };
  jobStep('Appointment Scheduled', jobCreated + 2 * MINUTE);
  if (t.lost) {
    jobStep('Lost', t.lost);
  } else if (t.proposed) {
    jobStep('Proposal Sent', t.proposed);
    if (t.decided) jobStep(chain.won ? 'Sold' : 'Lost', t.decided);
    if (chain.won) {
      jobStep('Work Scheduled', t.scheduled);
      jobStep('In Progress', t.installStart);
      jobStep('Work Complete', t.installEnd);
      jobStep('Closed', t.closed);
    }
  }

  const sold = chain.won && happened(t.decided);
  const lostAt = jobStatus === 'Lost' ? jobChanged : null;
  const job = {
    key: jobKey,
    lead: leadKey,
    customer: name,
    creator: chain.assignee,
    assignee: chain.assignee,
    title: scope.title,
    description: scope.description,
    status: jobStatus,
    address: chain.address,
    created_at: jobCreated,
    updated_at: jobUpdated,
    status_changed_at: jobChanged,
    sold_at: sold ? t.decided : null,
    work_completed_at:
      happened(t.installEnd) && chain.won ? t.installEnd : null,
    closed_at: jobStatus === 'Closed' ? jobChanged : null,
    lost_at: lostAt,
    lost_reason: lostAt ? chain.lost.reason : null,
    measurements: [],
    transitions,
    portalLink: Boolean(chain.portalLink),
  };
  plan.jobs.push(job);
  plan.assignmentEvents.push({
    entity_type: 'job',
    entity: jobKey,
    user: chain.assignee,
    assigned_at: jobCreated,
  });

  // Inspection appointment.
  const inspectionEnd = t.inspection + (t.inspectionMinutes || 60) * MINUTE;
  task({
    on: 'job',
    kind: 'appointment',
    title: `${chain.jobType === 'Gutters' ? 'Gutter measure' : 'Roof inspection'} — ${name}`,
    description:
      chain.jobType === 'Gutters'
        ? 'Measure runs and downspouts, check the fascia.'
        : 'Walk every slope, check the attic, photos for the estimate.',
    created_at: jobCreated,
    due_date: t.inspection,
    end_at: inspectionEnd,
    location: chain.address,
    completed_at: inspectionEnd,
  });

  if (happened(inspectionEnd)) {
    job.measurements = scope.measurements.map((m, index) => ({
      ...m,
      sort_order: index,
      created_at: inspectionEnd,
    }));
    if (!chain.featured) {
      const m = scope.measurements[0];
      note({
        on: 'job',
        at: inspectionEnd + rng.int(5, 40) * MINUTE,
        type: 'in_person',
        direction: 'outbound',
        body: m
          ? `Inspection done. ${m.label}: ${m.value} ${m.unit}. ${rng.pick(['Photos are uploaded to the job.', 'Homeowner walked the yard with us.', 'Attic ventilation is short; adding to the estimate.', 'No soft spots in the decking that we could find.'])}`
          : 'Visit done. Photos are uploaded to the job.',
      });
    }
  }

  if (t.drafted) {
    task({
      on: 'job',
      title: `Write up the estimate — ${person.last_name}`,
      created_at: inspectionEnd,
      due_date: clock.business(inspectionEnd + DAY, rng),
      completed_at: t.proposed,
    });
  }
  if (t.proposed) {
    task({
      on: 'job',
      title: `Follow up on the proposal — ${name}`,
      created_at: t.proposed,
      due_date: clock.business(t.proposed + 3 * DAY, rng),
      completed_at: t.decided,
    });
  }
  for (const extra of chain.extraTasks || []) {
    task({
      on: extra.on,
      title: extra.title,
      description: extra.description,
      assignee: extra.assignee,
      created_at: jobCreated,
      due_date: extra.due,
    });
  }

  // ── Estimate ──
  if (happened(t.drafted)) {
    const estimateKey = `estimate:${chain.key}`;
    const lines = scope.lines.map((line) => ({ ...line }));
    let status = 'Draft';
    let updated = t.drafted;
    let sentAt = null;
    let respondedAt = null;
    let responseNote = null;
    let approvedAt = null;
    if (happened(t.proposed)) {
      status = 'Sent';
      sentAt = t.proposed;
      updated = t.proposed;
    }
    if (happened(t.decided)) {
      if (chain.won) {
        status = 'Approved';
        approvedAt = t.decided;
        respondedAt = t.decided;
        responseNote = chain.approvalNote ?? null;
      } else {
        status = 'Rejected';
        if (chain.responded) {
          respondedAt = t.decided;
          responseNote = chain.lost.note;
        }
      }
      updated = t.decided;
    }
    plan.estimates.push({
      key: estimateKey,
      job: jobKey,
      creator: chain.assignee,
      title: scope.estimateTitle,
      status,
      subtotal: scope.subtotal,
      tax_total: 0,
      discount_total: scope.discount,
      grand_total: scope.total,
      notes: scope.discountLabel
        ? `${scope.notes} ${scope.discountLabel} applied.`
        : scope.notes,
      client_responded_at: respondedAt,
      client_response_note: responseNote,
      sent_at: sentAt,
      approved_at: approvedAt,
      created_at: t.drafted,
      updated_at: updated,
      lines,
      shareLink: Boolean(chain.shareLink) && status === 'Sent',
      shareExpires: (t.proposed ?? t.drafted) + 30 * DAY,
    });
    job.estimate = estimateKey;
  }

  if (!sold) return;

  // ── Production tasks ──
  task({
    on: 'job',
    assignee: 'dana',
    creator: chain.assignee,
    title: `Order materials — ${person.last_name}`,
    description: scope.lines
      .slice(0, 3)
      .map((line) => line.name)
      .join(', '),
    created_at: t.decided,
    due_date: clock.business(t.decided + 2 * DAY, rng),
    completed_at: t.scheduled,
  });
  if (happened(t.scheduled)) {
    task({
      on: 'job',
      kind: 'appointment',
      assignee: 'dana',
      creator: 'dana',
      title: `Install — ${scope.title.split(' — ')[0]}`,
      description: scope.description,
      created_at: t.scheduled,
      due_date: t.installStart,
      end_at: t.installEnd,
      location: chain.address,
      completed_at: t.installEnd,
    });
  }
  if (!chain.featured && happened(t.installStart)) {
    note({
      on: 'job',
      at: t.installStart + rng.float(3, 6) * HOUR,
      author: 'dana',
      type: 'in_person',
      direction: 'outbound',
      body: rng.pick(INSTALL_NOTES[chain.jobType]),
    });
  }
  if (!chain.featured && happened(t.installEnd)) {
    note({
      on: 'job',
      at: t.installEnd + rng.int(5, 45) * MINUTE,
      author: 'dana',
      type: 'in_person',
      direction: 'outbound',
      body: rng.pick(WRAP_UP_NOTES),
    });
  }
  task({
    on: 'job',
    assignee: 'owner',
    creator: 'dana',
    title: `Send the final invoice — ${person.last_name}`,
    created_at: t.installEnd,
    due_date: clock.business(t.installEnd + DAY, rng),
    completed_at: t.finalSent,
  });

  // ── Invoices ──
  const estimateKey = job.estimate;
  let depositTotal = 0;
  if (chain.deposit && happened(t.depositSent)) {
    depositTotal = money((scope.total * chain.deposit.percent) / 100);
    plan.invoices.push(
      invoiceRecord({
        key: `invoice:${chain.key}:deposit`,
        job: jobKey,
        estimate: estimateKey,
        kind: 'deposit',
        creator: 'owner',
        sentAt: t.depositSent,
        dueDays: 7,
        subtotal: depositTotal,
        discount: 0,
        prior: 0,
        total: depositTotal,
        notes: `Deposit due before work is scheduled. Applied to the final invoice for ${scope.estimateTitle}.`,
        lines: [
          {
            name: 'Deposit',
            description: `${chain.deposit.percent}% deposit on ${scope.estimateTitle}`,
            quantity: 1,
            unit_price: depositTotal,
            line_total: depositTotal,
            sort_order: 0,
          },
        ],
        payments: chain.deposit.payments,
        happened,
        nowMs,
        rng,
      })
    );
  }
  if (happened(t.finalSent)) {
    plan.invoices.push(
      invoiceRecord({
        key: `invoice:${chain.key}:final`,
        job: jobKey,
        estimate: estimateKey,
        kind: 'final',
        creator: 'owner',
        sentAt: t.finalSent,
        dueDays: chain.finalDueDays,
        subtotal: scope.subtotal,
        discount: scope.discount,
        prior: depositTotal,
        total: money(scope.total - depositTotal),
        notes: scope.notes,
        lines: scope.lines.map((line) => ({ ...line })),
        payments: chain.finalPayments,
        happened,
        nowMs,
        rng,
        collectionCall: chain.collectionCall,
      })
    );
  }
}

function invoiceRecord({
  key,
  job,
  estimate,
  kind,
  creator,
  sentAt,
  dueDays,
  subtotal,
  discount,
  prior,
  total,
  notes,
  lines,
  payments,
  happened,
  nowMs,
  rng,
  collectionCall,
}) {
  const due = sentAt + dueDays * DAY;
  const received = [];
  let paid = 0;
  for (const payment of payments) {
    if (!happened(payment.at)) continue;
    const amount =
      payment.share === 'rest'
        ? money(total - paid)
        : money(total * payment.share);
    if (amount <= 0) continue;
    paid = money(paid + amount);
    received.push({
      amount,
      method: payment.method,
      reference:
        payment.reference ??
        (payment.method === 'check'
          ? String(rng.int(1001, 9899))
          : payment.method === 'financing'
            ? `FIN-${rng.int(10000, 99999)}`
            : null),
      received_at: payment.at,
      balanceAfter: money(total - paid),
    });
  }
  let status = 'Sent';
  let paidAt = null;
  if (paid >= total - 0.004) {
    status = 'Paid';
    paidAt = received[received.length - 1].received_at;
  } else if (nowMs > due) {
    status = 'Overdue';
  } else if (paid > 0) {
    status = 'Partially Paid';
  }
  return {
    key,
    job,
    estimate,
    kind,
    creator,
    status,
    subtotal,
    tax_total: 0,
    discount_total: discount,
    prior_billed_total: prior,
    grand_total: total,
    amount_paid: paid,
    due_date: due,
    sent_at: sentAt,
    paid_at: paidAt,
    notes,
    created_at: sentAt - 10 * MINUTE,
    // An overdue invoice was last touched by the nightly sweep that marked it.
    updated_at:
      paidAt ?? (status === 'Overdue' ? Math.min(due + DAY, nowMs) : sentAt),
    lines,
    payments: received,
    collectionCall,
  };
}

/** INV-0001 onward in the order the invoices were created, as the app counts. */
function numberInvoices(plan) {
  plan.invoices.sort((a, b) => a.created_at - b.created_at);
  plan.invoices.forEach((invoice, index) => {
    invoice.invoice_number = `INV-${String(index + 1).padStart(4, '0')}`;
  });
}

/** Job activity (what the job timeline and stage-time reports read), and collection calls. */
function addJobActivity(plan, { clock, rng, nowMs }) {
  plan.notes.forEach((noteRecord, index) => {
    noteRecord.key = `note:${index}`;
  });
  const byJob = new Map(plan.jobs.map((job) => [job.key, job]));
  const estimatesByJob = new Map(
    plan.estimates.map((estimate) => [estimate.job, estimate])
  );
  const invoicesByJob = new Map();
  for (const invoice of plan.invoices) {
    if (!invoicesByJob.has(invoice.job)) invoicesByJob.set(invoice.job, []);
    invoicesByJob.get(invoice.job).push(invoice);
  }

  for (const job of byJob.values()) {
    const by = job.assignee;
    plan.activity.push({
      job: job.key,
      by,
      type: 'JOB_CREATED',
      title: 'Job created',
      message: job.title,
      entity: { type: 'job', key: job.key },
      metadata: { jobTitle: job.title, status: 'New' },
      created_at: job.created_at,
    });
    for (const step of job.transitions) {
      plan.activity.push({
        job: job.key,
        by: ['Work Scheduled', 'In Progress', 'Work Complete'].includes(step.to)
          ? 'dana'
          : by,
        type: 'JOB_STATUS_CHANGED',
        title: 'Status changed',
        message: `${step.from} → ${step.to}`,
        entity: { type: 'job', key: job.key },
        metadata: {
          fromStatus: step.from,
          toStatus: step.to,
          ...(step.to === 'Lost' ? { lostReason: job.lost_reason } : {}),
        },
        created_at: step.at,
      });
    }
    const estimate = estimatesByJob.get(job.key);
    if (estimate) {
      plan.activity.push({
        job: job.key,
        by: estimate.creator,
        type: 'ESTIMATE_CREATED',
        title: 'Estimate created',
        message: `${estimate.title} was created`,
        entity: { type: 'estimate', key: estimate.key },
        metadata: { estimateTitle: estimate.title },
        created_at: estimate.created_at,
      });
    }
    for (const invoice of invoicesByJob.get(job.key) || []) {
      plan.activity.push({
        job: job.key,
        by: invoice.creator,
        type: 'INVOICE_CREATED',
        title:
          invoice.kind === 'deposit'
            ? 'Deposit invoice created'
            : 'Invoice created',
        message: `${invoice.invoice_number} was created`,
        entity: { type: 'invoice', key: invoice.key },
        metadata: { invoiceNumber: invoice.invoice_number, kind: invoice.kind },
        created_at: invoice.created_at,
      });
      invoice.payments.forEach((payment, index) => {
        payment.key = `${invoice.key}:payment:${index}`;
        const label = {
          check: 'check',
          card: 'card',
          cash: 'cash',
          ach: 'bank transfer',
          financing: 'financing',
          other: 'payment',
        }[payment.method];
        const ref = payment.reference ? ` #${payment.reference}` : '';
        plan.activity.push({
          job: job.key,
          by: 'owner',
          type: 'PAYMENT_RECORDED',
          title:
            payment.balanceAfter <= 0 ? 'Paid in full' : 'Payment received',
          message: `${usd(payment.amount)} by ${label}${ref} on ${invoice.invoice_number} — ${usd(payment.balanceAfter)} left`,
          entity: { type: 'payment', key: payment.key },
          metadata: {
            invoiceNumber: invoice.invoice_number,
            amount: payment.amount,
            method: payment.method,
          },
          created_at: payment.received_at + 5 * MINUTE,
        });
      });

      const open =
        invoice.status === 'Overdue' || invoice.status === 'Partially Paid';
      if (open && (invoice.collectionCall || invoice.status === 'Overdue')) {
        const call = invoice.collectionCall || {};
        plan.tasks.push({
          creator: 'owner',
          assignee: call.assignee || 'owner',
          lead: null,
          job: job.key,
          title: `Call ${job.customer} about ${invoice.invoice_number}`,
          description: `${usd(invoice.grand_total - invoice.amount_paid)} still open.`,
          kind: 'task',
          due_date:
            call.due ??
            clock.business(
              Math.max(invoice.due_date + 2 * DAY, nowMs - DAY),
              rng
            ),
          end_at: null,
          location: null,
          status: 'Pending',
          completed_at: null,
          created_at: Math.min(invoice.due_date + DAY, nowMs - HOUR),
          updated_at: Math.min(invoice.due_date + DAY, nowMs - HOUR),
          keepOverdue: false,
        });
      }
    }
  }

  for (const noteRecord of plan.notes) {
    if (noteRecord.entity_type !== 'job') continue;
    const dir =
      noteRecord.direction.charAt(0).toUpperCase() +
      noteRecord.direction.slice(1);
    const label =
      noteRecord.type === 'in_person' ? 'in person' : noteRecord.type;
    plan.activity.push({
      job: noteRecord.entity,
      by: noteRecord.author,
      type: 'COMMUNICATION_LOGGED',
      title: `${dir} ${label}`,
      message:
        noteRecord.body.length > 160
          ? `${noteRecord.body.slice(0, 157)}...`
          : noteRecord.body,
      entity: { type: 'note', key: noteRecord.key },
      metadata: { commType: noteRecord.type, direction: noteRecord.direction },
      created_at: noteRecord.created_at,
    });
  }
}

/** The owner's bell: the last week's new leads, client answers and payments. */
function addNotifications(plan, { nowMs }) {
  const since = nowMs - 7 * DAY;
  const items = [];
  for (const lead of plan.leads) {
    if (lead.created_at < since) continue;
    items.push({
      type: 'LEAD_CREATED',
      title: 'New lead',
      message: `${lead.first_name} ${lead.last_name} — ${lead.service_type.toLowerCase()} (${lead.source.toLowerCase()})`,
      entity: { type: 'lead', key: lead.key },
      created_at: lead.created_at + MINUTE,
    });
  }
  for (const estimate of plan.estimates) {
    if (!estimate.client_responded_at || estimate.client_responded_at < since)
      continue;
    const approved = estimate.status === 'Approved';
    items.push({
      type: 'ESTIMATE_CLIENT_RESPONDED',
      title: approved ? 'Estimate approved' : 'Estimate declined',
      message: `${estimate.title} was ${approved ? 'approved' : 'declined'} by the client`,
      entity: { type: 'estimate', key: estimate.key },
      created_at: estimate.client_responded_at + MINUTE,
    });
  }
  for (const invoice of plan.invoices) {
    if (invoice.status !== 'Paid' || invoice.paid_at < since) continue;
    items.push({
      type: 'INVOICE_PAID',
      title: 'Invoice paid',
      message: `${invoice.invoice_number} paid in full — ${usd(invoice.grand_total)}`,
      entity: { type: 'invoice', key: invoice.key },
      created_at: invoice.paid_at + 5 * MINUTE,
    });
  }
  items.sort((a, b) => a.created_at - b.created_at);
  for (const [index, item] of items.entries()) {
    plan.notifications.push({
      ...item,
      user: 'owner',
      read_at:
        item.created_at < nowMs - 30 * HOUR ? item.created_at + 2 * HOUR : null,
      dedupe_key: `demo-seed:${index}`,
    });
  }
}

function addWorkspaceExtras(plan) {
  plan.savedViews.push(
    {
      user: 'owner',
      entity_type: 'leads',
      name: 'Team pipeline board',
      filters: { viewScope: 'all', viewMode: 'board' },
    },
    {
      user: 'owner',
      entity_type: 'leads',
      name: 'New leads',
      filters: { status: 'New', viewScope: 'all' },
    },
    {
      user: 'owner',
      entity_type: 'jobs',
      name: 'Proposals out',
      filters: { status: 'Proposal Sent', viewScope: 'all' },
    },
    {
      user: 'owner',
      entity_type: 'jobs',
      name: 'In production',
      filters: { phase: 'production', viewScope: 'all' },
    },
    {
      user: 'owner',
      entity_type: 'tasks',
      name: 'Open team tasks',
      filters: { status: 'Pending', viewScope: 'all' },
    }
  );
  plan.automationRules.push({
    user: 'owner',
    name: 'Schedule the install after approval',
    description:
      'When a client approves an estimate, create a task to get the install on the calendar.',
    trigger_event: 'ESTIMATE_APPROVED',
    conditions: {},
    action_type: 'CREATE_FOLLOW_UP_TASK',
    action_config: { title: 'Schedule the install', due_in_days: 2 },
    enabled: true,
  });
  plan.estimateTemplates.push(
    {
      name: 'Full roof replacement',
      description:
        'Per-square pricing for a single-layer tear-off. Set quantities from the measure.',
      lines: [
        {
          name: 'Tear-off & disposal (1 layer)',
          description: 'Per square, haul-away included',
          quantity: 1,
          unit_price: 92,
        },
        {
          name: 'Architectural shingles',
          description: 'Shingles, starter strip and ridge cap',
          quantity: 1,
          unit_price: 380,
        },
        {
          name: 'Synthetic underlayment',
          description: 'Full deck coverage',
          quantity: 1,
          unit_price: 28,
        },
        {
          name: 'Ice & water shield',
          description: 'Eaves (6 ft up) and all valleys',
          quantity: 1,
          unit_price: 900,
        },
        {
          name: 'Dumpster & cleanup',
          description: 'Magnetic nail sweep, twice',
          quantity: 1,
          unit_price: 475,
        },
      ],
    },
    {
      name: 'Seamless gutters',
      description: '6" aluminum gutters, downspouts and optional guards.',
      lines: [
        {
          name: 'Remove & dispose old gutters',
          description: 'Includes hangers and downspouts',
          quantity: 1,
          unit_price: 300,
        },
        {
          name: '6" seamless aluminum gutters',
          description: 'Per linear foot',
          quantity: 1,
          unit_price: 14.25,
        },
        {
          name: '3x4 downspouts',
          description: 'With extensions',
          quantity: 1,
          unit_price: 95,
        },
        {
          name: 'Gutter guards',
          description: 'Micro-mesh, per linear foot',
          quantity: 1,
          unit_price: 9.5,
        },
      ],
    },
    {
      name: 'Roof tune-up',
      description: 'Yearly maintenance visit.',
      lines: [
        {
          name: 'Roof tune-up',
          description:
            'Reseal flashing, replace cracked boots, secure loose shingles',
          quantity: 1,
          unit_price: 395,
        },
        {
          name: 'Gutter cleaning',
          description: 'Flush downspouts, haul debris',
          quantity: 1,
          unit_price: 225,
        },
      ],
    }
  );
}

/**
 * An open task a real rep would have pushed out: one that went stale more
 * than a day ago moves to the next few days, so the demo shows a handful of
 * overdue items instead of every unfinished follow-up from the past month.
 */
function snoozeStaleTasks(plan, { clock, rng, nowMs }) {
  for (const taskRecord of plan.tasks) {
    if (
      taskRecord.status !== 'Pending' ||
      taskRecord.kind !== 'task' ||
      taskRecord.keepOverdue
    )
      continue;
    if (taskRecord.due_date >= nowMs - 18 * HOUR) continue;
    taskRecord.due_date = clock.business(nowMs + rng.float(2, 96) * HOUR, rng);
    taskRecord.updated_at = Math.max(
      taskRecord.created_at,
      nowMs - rng.float(1, 20) * HOUR
    );
  }
  // People set due times on the quarter hour.
  const quarter = 15 * MINUTE;
  for (const taskRecord of plan.tasks) {
    if (taskRecord.kind === 'task')
      taskRecord.due_date = Math.round(taskRecord.due_date / quarter) * quarter;
  }
}

function summarize(plan) {
  const count = (list, field) =>
    list.reduce((acc, item) => {
      acc[item[field]] = (acc[item[field]] || 0) + 1;
      return acc;
    }, {});
  return {
    leads: plan.leads.length,
    leadStatus: count(plan.leads, 'status'),
    jobs: plan.jobs.length,
    jobStatus: count(plan.jobs, 'status'),
    estimates: plan.estimates.length,
    invoices: plan.invoices.length,
    invoiceStatus: count(plan.invoices, 'status'),
    payments: plan.invoices.reduce(
      (sum, invoice) => sum + invoice.payments.length,
      0
    ),
    collected: money(
      plan.invoices.reduce((sum, invoice) => sum + invoice.amount_paid, 0)
    ),
    tasks: plan.tasks.length,
    notes: plan.notes.length,
    activity: plan.activity.length,
  };
}

module.exports = {
  buildDemoPlan,
  createRng,
  createClock,
  TEAM,
  DAY,
  HOUR,
  MINUTE,
};
