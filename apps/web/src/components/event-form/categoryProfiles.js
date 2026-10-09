/**
 * Wording, examples and starting ticket tiers for the create-event form, per category, so a concert isn't
 * asked for a "match title" and a conference doesn't start with "VIP Pavilion" tickets. Organizer-added
 * categories (OTHER) and General Admission use the neutral profile.
 */

const GENERIC = {
  nameLabel: 'Event name',
  namePlaceholder: 'e.g. Lahore Food Festival 2026',
  venueLabel: 'Venue',
  venuePlaceholder: 'e.g. Expo Centre Lahore',
  descriptionLabel: 'Event description',
  descriptionPlaceholder: 'What happens at the event, the schedule, and who it is for…',
  titleTip: 'Say what it is and when, e.g. “Lahore Food Festival 2026”.',
  venueTip: 'Choose the exact venue and city so attendees can easily find your event.',
  tiers: [
    { name: 'General Admission', price: 1000, totalQuantity: 500 },
    { name: 'VIP', price: 3000, totalQuantity: 100 },
  ],
  tierExamples: 'General Admission, VIP or Early Bird',
};

const SPORT = {
  nameLabel: 'Match title',
  descriptionLabel: 'Match details & teams',
  descriptionPlaceholder: 'Match overview, teams, squads and anything fans should know…',
  venueLabel: 'Stadium / ground',
  venueTip: 'Choose the correct stadium and city so fans can easily find the match.',
};

export const CATEGORY_PROFILES = {
  CRICKET_MATCH: {
    ...SPORT,
    namePlaceholder: 'e.g. Lahore Qalandars vs Islamabad United – PSL 2026',
    venuePlaceholder: 'e.g. Gaddafi Stadium',
    titleTip: 'Include team names, match type and season (e.g. Lahore Qalandars vs Islamabad United – PSL 2026).',
    tiers: [
      { name: 'General Enclosure', price: 1500, totalQuantity: 500 },
      { name: 'VIP Pavilion', price: 5000, totalQuantity: 100 },
    ],
    tierExamples: 'General Enclosure, First Class or VIP Pavilion',
  },
  FOOTBALL_MATCH: {
    ...SPORT,
    namePlaceholder: 'e.g. Karachi United vs WAPDA FC – PFF League',
    venuePlaceholder: 'e.g. Jinnah Sports Stadium',
    titleTip: 'Include both teams and the competition (e.g. Karachi United vs WAPDA FC – PFF League).',
    tiers: [
      { name: 'General Stand', price: 800, totalQuantity: 800 },
      { name: 'Main Stand', price: 2000, totalQuantity: 300 },
      { name: 'VIP Box', price: 5000, totalQuantity: 50 },
    ],
    tierExamples: 'General Stand, Main Stand or VIP Box',
  },
  HOCKEY_MATCH: {
    ...SPORT,
    namePlaceholder: 'e.g. Pakistan vs Malaysia – Hockey Series 2026',
    venuePlaceholder: 'e.g. National Hockey Stadium',
    titleTip: 'Include both teams and the tournament (e.g. Pakistan vs Malaysia – Hockey Series 2026).',
    tiers: [
      { name: 'General Enclosure', price: 600, totalQuantity: 600 },
      { name: 'VIP Enclosure', price: 2500, totalQuantity: 100 },
    ],
    tierExamples: 'General Enclosure or VIP Enclosure',
  },
  KABADDI: {
    ...SPORT,
    namePlaceholder: 'e.g. Punjab Lions vs Sindh Warriors – Kabaddi Cup',
    venuePlaceholder: 'e.g. Punjab Stadium',
    titleTip: 'Include both teams and the cup or league (e.g. Punjab Lions vs Sindh Warriors – Kabaddi Cup).',
    tiers: [
      { name: 'General', price: 500, totalQuantity: 600 },
      { name: 'VIP', price: 2000, totalQuantity: 100 },
    ],
    tierExamples: 'General or VIP',
  },
  BOXING: {
    ...SPORT,
    nameLabel: 'Fight card title',
    namePlaceholder: 'e.g. Fight Night Lahore – Main Event',
    venueLabel: 'Arena / hall',
    venuePlaceholder: 'e.g. Nishtar Park Sports Complex',
    descriptionLabel: 'Fight card & details',
    descriptionPlaceholder: 'Main event, undercard bouts, weigh-in and doors-open times…',
    titleTip: 'Name the main event or the fighters headlining it.',
    venueTip: 'Choose the exact arena or hall and city so fans can easily find it.',
    tiers: [
      { name: 'Balcony', price: 1500, totalQuantity: 300 },
      { name: 'Floor', price: 4000, totalQuantity: 150 },
      { name: 'Ringside', price: 10000, totalQuantity: 40 },
    ],
    tierExamples: 'Balcony, Floor or Ringside',
  },
  MUSIC_CONCERT: {
    nameLabel: 'Concert / artist name',
    namePlaceholder: 'e.g. Atif Aslam Live in Lahore',
    venueLabel: 'Venue / hall',
    venuePlaceholder: 'e.g. Alhamra Open Air Theatre',
    descriptionLabel: 'About the concert & lineup',
    descriptionPlaceholder: 'Headliner, opening acts, set times and doors-open time…',
    titleTip: 'Lead with the artist and the city or tour (e.g. Atif Aslam Live in Lahore).',
    venueTip: 'Choose the exact hall or open-air venue and city so fans can easily find it.',
    tiers: [
      { name: 'Silver', price: 3000, totalQuantity: 500 },
      { name: 'Gold', price: 6000, totalQuantity: 200 },
      { name: 'Platinum (front rows)', price: 12000, totalQuantity: 50 },
    ],
    tierExamples: 'Silver, Gold or Platinum (front rows)',
  },
  MUSIC_FESTIVAL: {
    nameLabel: 'Festival name',
    namePlaceholder: 'e.g. Lahore Music Meet 2026',
    venueLabel: 'Festival grounds',
    venuePlaceholder: 'e.g. Expo Centre Lahore',
    descriptionLabel: 'About the festival & lineup',
    descriptionPlaceholder: 'Artists by day, stages, food and what to bring…',
    titleTip: 'Use the festival’s name and year (e.g. Lahore Music Meet 2026).',
    venueTip: 'Choose the festival grounds and city; pin the main entrance on the map.',
    tiers: [
      { name: 'Day Pass', price: 2500, totalQuantity: 1000 },
      { name: 'Weekend Pass', price: 4500, totalQuantity: 500 },
      { name: 'VIP Pass', price: 10000, totalQuantity: 100 },
    ],
    tierExamples: 'Day Pass, Weekend Pass or VIP Pass',
  },
  QAWWALI: {
    nameLabel: 'Qawwali night title',
    namePlaceholder: 'e.g. Rahat Fateh Ali Khan – Qawwali Night',
    venueLabel: 'Venue / courtyard',
    venuePlaceholder: 'e.g. Lahore Fort',
    descriptionLabel: 'About the evening & performers',
    descriptionPlaceholder: 'Performers, kalaam, seating arrangement and timings…',
    titleTip: 'Lead with the qawwal or party performing (e.g. Rahat Fateh Ali Khan – Qawwali Night).',
    venueTip: 'Choose the exact venue and city so guests can easily find it.',
    tiers: [
      { name: 'General', price: 2000, totalQuantity: 400 },
      { name: 'Family Enclosure', price: 4000, totalQuantity: 150 },
      { name: 'VIP (front seating)', price: 8000, totalQuantity: 50 },
    ],
    tierExamples: 'General, Family Enclosure or VIP (front seating)',
  },
  THEATRE: {
    nameLabel: 'Play / show title',
    namePlaceholder: 'e.g. Anarkali – Stage Play',
    venueLabel: 'Theatre / auditorium',
    venuePlaceholder: 'e.g. Alhamra Arts Council, Hall 1',
    descriptionLabel: 'About the play & cast',
    descriptionPlaceholder: 'Story, director and cast, running time and age guidance…',
    titleTip: 'Use the play’s title, and the company or season if it helps.',
    venueTip: 'Name the theatre and the hall or auditorium inside it.',
    tiers: [
      { name: 'Balcony', price: 1500, totalQuantity: 150 },
      { name: 'Stalls', price: 3000, totalQuantity: 250 },
      { name: 'Front Stalls', price: 5000, totalQuantity: 50 },
    ],
    tierExamples: 'Balcony, Stalls or Front Stalls',
  },
  CONFERENCE: {
    nameLabel: 'Conference name',
    namePlaceholder: 'e.g. Pakistan Tech Summit 2026',
    venueLabel: 'Venue / convention centre',
    venuePlaceholder: 'e.g. Pak-China Friendship Centre',
    descriptionLabel: 'Agenda & speakers',
    descriptionPlaceholder: 'Topics, speakers, sessions and who should attend…',
    titleTip: 'Use the conference’s name and year (e.g. Pakistan Tech Summit 2026).',
    venueTip: 'Name the venue and the hall; attendees will look for it on the map.',
    tiers: [
      { name: 'Student', price: 1000, totalQuantity: 200 },
      { name: 'Standard', price: 3500, totalQuantity: 400 },
      { name: 'All-access (with workshops)', price: 8000, totalQuantity: 80 },
    ],
    tierExamples: 'Student, Standard or All-access',
  },
};

/** The form profile for a category (falls back to the neutral one). */
export const categoryProfile = (type) => ({ ...GENERIC, ...(CATEGORY_PROFILES[type] || {}) });
