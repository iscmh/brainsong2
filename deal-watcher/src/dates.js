/** Date helpers. All dates are handled as plain 'YYYY-MM-DD' strings in UTC to avoid DST surprises. */

const DAY_MS = 86_400_000;

export function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${iso}`);
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = toDay(d);
  if (back !== iso) throw new Error(`Invalid calendar date: ${iso}`);
  return d;
}

export function toDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toDay(parseDay(iso) + n * DAY_MS);
}

export function diffDays(fromIso, toIso) {
  return Math.round((parseDay(toIso) - parseDay(fromIso)) / DAY_MS);
}

/** Day of week, 0 = Sunday. */
export function weekday(iso) {
  return new Date(parseDay(iso)).getUTCDay();
}

const RO_DAYS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sam'];

/** "Sam 24 iul" style short label. */
export function shortLabel(iso) {
  const RO_MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec'];
  const d = new Date(parseDay(iso));
  return `${RO_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${RO_MONTHS[d.getUTCMonth()]}`;
}

/**
 * Every check-in date in [checkInFrom, checkInTo] for a stay of `nights`.
 * Returns [{ checkIn, checkOut, nights, hot }] where `hot` marks the preferred sub-window.
 */
export function buildStays({ checkInFrom, checkInTo, nights, preferredFrom, preferredTo }) {
  if (!Number.isInteger(nights) || nights < 1) throw new Error(`nights must be a positive integer, got ${nights}`);
  const last = parseDay(checkInTo);
  const stays = [];
  for (let ms = parseDay(checkInFrom); ms <= last; ms += DAY_MS) {
    const checkIn = toDay(ms);
    stays.push({
      checkIn,
      checkOut: addDays(checkIn, nights),
      nights,
      hot: isHot(checkIn, preferredFrom, preferredTo),
    });
  }
  if (!stays.length) throw new Error(`Empty date window: ${checkInFrom} .. ${checkInTo}`);
  return stays;
}

function isHot(checkIn, preferredFrom, preferredTo) {
  if (!preferredFrom || !preferredTo) return false;
  return checkIn >= preferredFrom && checkIn <= preferredTo;
}
