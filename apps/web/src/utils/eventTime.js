/**
 * Event dates are stored as a calendar date (the organizer's <input type="date"> value, saved as UTC
 * midnight) plus a separate wall-clock `time` string in Pakistan time. Format the date in UTC so the
 * calendar day never shifts with the viewer's timezone, and label the time explicitly as PKT.
 */
export const EVENT_TIMEZONE_LABEL = 'PKT (UTC+05:00)';

export const formatEventDate = (date, options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(date).toLocaleDateString('en-PK', { ...options, timeZone: 'UTC' });

// "7:00 PM PST" (Pakistan Standard Time in older data) → "7:00 PM"
export const formatEventTime = (time = '') => time.replace(/\s*\b(PST|PKT)\b\s*$/i, '').trim();

// End of the event's calendar day in Pakistan (UTC+5), used to treat past events as ended
export const eventDayEnd = (date) => {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59) - 5 * 3600 * 1000;
};
