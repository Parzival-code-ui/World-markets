// Exchange holidays and early closes, keyed by market id (see markets.js).
// "YYYY-MM-DD": "Holiday name"            → closed all day
// "YYYY-MM-DD": ["HH:MM", "Holiday name"] → early close at that local time
// `through` is the last date the list covers; after it, the site falls back to regular hours.
// Sources: exchange calendars (NYSE, TMX, LSE, Deutsche Börse, Euronext, NSE, JPX, HKEX, ASX, KRX, SGX),
// checked November 2026. Add each new year when the exchange publishes it.
window.HOLIDAYS_CHECKED = "November 2026";
window.HOLIDAYS = {
  us: { through: "2027-12-31", days: {
    "2026-11-26": "Thanksgiving", "2026-11-27": ["13:00", "Day after Thanksgiving"], "2026-12-24": ["13:00", "Christmas Eve"], "2026-12-25": "Christmas",
    "2027-01-01": "New Year's Day", "2027-01-18": "Martin Luther King Jr. Day", "2027-02-15": "Presidents' Day", "2027-03-26": "Good Friday",
    "2027-05-31": "Memorial Day", "2027-06-18": "Juneteenth", "2027-07-05": "Independence Day", "2027-09-06": "Labor Day",
    "2027-11-25": "Thanksgiving", "2027-11-26": ["13:00", "Day after Thanksgiving"], "2027-12-24": "Christmas",
  } },
  ca: { through: "2027-12-31", days: {
    "2026-12-24": ["13:00", "Christmas Eve"], "2026-12-25": "Christmas", "2026-12-28": "Boxing Day",
    "2027-01-01": "New Year's Day", "2027-02-15": "Family Day", "2027-03-26": "Good Friday", "2027-05-24": "Victoria Day",
    "2027-07-01": "Canada Day", "2027-08-02": "Civic Holiday", "2027-09-06": "Labour Day", "2027-10-11": "Thanksgiving",
    "2027-12-24": ["13:00", "Christmas Eve"], "2027-12-27": "Christmas", "2027-12-28": "Boxing Day",
  } },
  uk: { through: "2027-12-31", days: {
    "2026-12-24": ["12:30", "Christmas Eve"], "2026-12-25": "Christmas", "2026-12-28": "Boxing Day", "2026-12-31": ["12:30", "New Year's Eve"],
    "2027-01-01": "New Year's Day", "2027-03-26": "Good Friday", "2027-03-29": "Easter Monday", "2027-05-03": "Early May bank holiday",
    "2027-05-31": "Spring bank holiday", "2027-08-30": "Summer bank holiday", "2027-12-24": ["12:30", "Christmas Eve"],
    "2027-12-27": "Christmas", "2027-12-28": "Boxing Day", "2027-12-31": ["12:30", "New Year's Eve"],
  } },
  de: { through: "2027-12-31", days: {
    "2026-12-24": "Christmas Eve", "2026-12-25": "Christmas", "2026-12-31": "New Year's Eve",
    "2027-01-01": "New Year's Day", "2027-03-26": "Good Friday", "2027-03-29": "Easter Monday", "2027-12-24": "Christmas Eve", "2027-12-31": "New Year's Eve",
  } },
  fr: { through: "2027-12-31", days: {
    "2026-12-24": ["14:05", "Christmas Eve"], "2026-12-25": "Christmas", "2026-12-31": ["14:05", "New Year's Eve"],
    "2027-01-01": "New Year's Day", "2027-03-26": "Good Friday", "2027-03-29": "Easter Monday", "2027-12-24": ["14:05", "Christmas Eve"], "2027-12-31": ["14:05", "New Year's Eve"],
  } },
  in: { through: "2026-12-31", days: {
    "2026-11-10": "Diwali Balipratipada", "2026-11-24": "Guru Nanak Jayanti", "2026-12-25": "Christmas",
  } },
  jp: { through: "2027-12-31", days: {
    "2026-11-23": "Labor Thanksgiving Day", "2026-12-31": "Year-end holiday",
    "2027-01-01": "New Year's Day", "2027-01-11": "Coming of Age Day", "2027-02-11": "National Foundation Day", "2027-02-23": "Emperor's Birthday",
    "2027-03-22": "Vernal Equinox Day", "2027-04-29": "Showa Day", "2027-05-03": "Constitution Memorial Day", "2027-05-04": "Greenery Day",
    "2027-05-05": "Children's Day", "2027-07-19": "Marine Day", "2027-08-11": "Mountain Day", "2027-09-20": "Respect for the Aged Day",
    "2027-09-23": "Autumnal Equinox Day", "2027-10-11": "Sports Day", "2027-11-03": "Culture Day", "2027-11-23": "Labor Thanksgiving Day",
    "2027-12-31": "Year-end holiday",
  } },
  hk: { through: "2027-12-31", days: {
    "2026-12-24": ["12:00", "Christmas Eve"], "2026-12-25": "Christmas", "2026-12-31": ["12:00", "New Year's Eve"],
    "2027-01-01": "New Year's Day", "2027-02-05": ["12:00", "Lunar New Year's Eve"], "2027-02-08": "Lunar New Year", "2027-02-09": "Lunar New Year",
    "2027-03-26": "Good Friday", "2027-03-29": "Easter Monday", "2027-04-05": "Ching Ming Festival", "2027-05-13": "Buddha's Birthday",
    "2027-06-09": "Tuen Ng Festival", "2027-07-01": "HKSAR Establishment Day", "2027-09-16": "Day after Mid-Autumn Festival",
    "2027-10-01": "National Day", "2027-10-08": "Chung Yeung Festival", "2027-12-24": ["12:00", "Christmas Eve"],
    "2027-12-27": "Christmas", "2027-12-31": ["12:00", "New Year's Eve"],
  } },
  au: { through: "2027-12-31", days: {
    "2026-12-24": ["14:10", "Christmas Eve"], "2026-12-25": "Christmas", "2026-12-28": "Boxing Day", "2026-12-31": ["14:10", "New Year's Eve"],
    "2027-01-01": "New Year's Day", "2027-01-26": "Australia Day", "2027-03-26": "Good Friday", "2027-03-29": "Easter Monday",
    "2027-06-14": "King's Birthday", "2027-12-24": ["14:10", "Christmas Eve"], "2027-12-27": "Christmas", "2027-12-28": "Boxing Day",
    "2027-12-31": ["14:10", "New Year's Eve"],
  } },
  kr: { through: "2026-12-31", days: { "2026-12-25": "Christmas", "2026-12-31": "Year-end closing" } },
  sg: { through: "2026-12-31", days: { "2026-12-24": ["12:00", "Christmas Eve"], "2026-12-25": "Christmas", "2026-12-31": ["12:00", "New Year's Eve"] } },
  cn: { through: "2026-12-31", days: {} },
};
// Euronext Amsterdam shares the Paris calendar; the Euro Stoxx 50 follows Eurex/Xetra.
window.HOLIDAYS.nl = window.HOLIDAYS.fr;
window.HOLIDAYS.eu = window.HOLIDAYS.de;
