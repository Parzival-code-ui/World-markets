// Scheduled market-moving events for the Calendar tab: central bank decisions and inflation releases.
// [date, local time or null, IANA time zone, kind, title, flag]
// Sources: RBI (MPC schedule 2026-27), Federal Reserve (FOMC 2027), ECB Governing Council calendar,
// Bank of England (MPC dates 2027), Bank of Japan (MPM 2027), BLS CPI schedule, MoSPI advance release calendar.
// Company results dates come live from Yahoo Finance, so they aren't listed here.
window.CALENDAR_CHECKED = "November 2026";
window.CALENDAR = [
  // Reserve Bank of India: decision on the last day of each meeting
  ["2026-12-04", "10:00", "Asia/Kolkata", "rate", "RBI policy decision", "🇮🇳"],
  ["2027-02-05", "10:00", "Asia/Kolkata", "rate", "RBI policy decision", "🇮🇳"],
  // US Federal Reserve
  ["2026-12-09", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-01-27", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-03-17", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-04-28", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-06-09", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-07-28", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-09-15", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-10-27", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  ["2027-12-08", "14:00", "America/New_York", "rate", "Fed rate decision", "🇺🇸"],
  // European Central Bank
  ["2026-12-17", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-02-04", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-03-18", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-04-29", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-06-10", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-07-22", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-09-09", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-10-28", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  ["2027-12-16", "14:15", "Europe/Berlin", "rate", "ECB rate decision", "🇪🇺"],
  // Bank of England
  ["2026-12-17", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-02-04", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-03-18", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-04-29", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-06-17", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-07-29", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-09-16", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-11-04", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  ["2027-12-16", "12:00", "Europe/London", "rate", "Bank of England rate decision", "🇬🇧"],
  // Bank of Japan: the statement comes when the meeting ends, usually around midday Tokyo time
  ["2026-12-18", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-01-22", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-03-18", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-04-28", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-06-11", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-07-22", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-09-22", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-10-29", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  ["2027-12-17", null, "Asia/Tokyo", "rate", "Bank of Japan rate decision", "🇯🇵"],
  // US CPI (BLS), covering the previous month
  ["2026-12-10", "08:30", "America/New_York", "cpi", "US inflation (CPI) for November", "🇺🇸"],
  ["2027-01-13", "08:30", "America/New_York", "cpi", "US inflation (CPI) for December", "🇺🇸"],
  ["2027-02-11", "08:30", "America/New_York", "cpi", "US inflation (CPI) for January", "🇺🇸"],
  ["2027-03-10", "08:30", "America/New_York", "cpi", "US inflation (CPI) for February", "🇺🇸"],
  ["2027-04-13", "08:30", "America/New_York", "cpi", "US inflation (CPI) for March", "🇺🇸"],
  ["2027-05-12", "08:30", "America/New_York", "cpi", "US inflation (CPI) for April", "🇺🇸"],
  ["2027-06-10", "08:30", "America/New_York", "cpi", "US inflation (CPI) for May", "🇺🇸"],
  ["2027-07-14", "08:30", "America/New_York", "cpi", "US inflation (CPI) for June", "🇺🇸"],
  ["2027-08-11", "08:30", "America/New_York", "cpi", "US inflation (CPI) for July", "🇺🇸"],
  ["2027-09-14", "08:30", "America/New_York", "cpi", "US inflation (CPI) for August", "🇺🇸"],
  ["2027-10-14", "08:30", "America/New_York", "cpi", "US inflation (CPI) for September", "🇺🇸"],
  ["2027-11-10", "08:30", "America/New_York", "cpi", "US inflation (CPI) for October", "🇺🇸"],
  ["2027-12-10", "08:30", "America/New_York", "cpi", "US inflation (CPI) for November", "🇺🇸"],
  // India CPI (MoSPI): the 12th, or the next working day if that's a holiday
  ["2026-12-12", "16:00", "Asia/Kolkata", "cpi", "India inflation (CPI) for November", "🇮🇳"],
  ["2027-01-12", "16:00", "Asia/Kolkata", "cpi", "India inflation (CPI) for December", "🇮🇳"],
  ["2027-02-12", "16:00", "Asia/Kolkata", "cpi", "India inflation (CPI) for January", "🇮🇳"],
  ["2027-03-12", "16:00", "Asia/Kolkata", "cpi", "India inflation (CPI) for February", "🇮🇳"],
];
