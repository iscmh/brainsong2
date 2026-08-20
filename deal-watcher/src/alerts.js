/** Pure decision logic: given the previous state of a key and a fresh offer, should we ping Telegram? */

export const REASON = {
  NEW_AVAILABILITY: 'new-availability',
  ALL_TIME_LOW: 'all-time-low',
  PRICE_DROP: 'price-drop',
  UNDER_THRESHOLD: 'under-threshold',
  GONE: 'gone',
};

const HOUR_MS = 3_600_000;

/**
 * @param {object} args
 * @param {object|null} args.offer         cheapest fresh offer for this key (null = nothing available)
 * @param {object|null} args.previousLast  offer seen on the previous sweep
 * @param {object|null} args.previousBest  cheapest offer ever seen
 * @param {string|null} args.lastAlertAt   ISO timestamp of the last alert for this key
 * @param {boolean} args.isFirstObservation true when this key had never been queried before
 * @param {object} args.alerts             config.alerts
 * @param {number} args.guests             head count, for per-person-per-night thresholds
 * @param {number} args.nights
 * @param {number} args.now                epoch ms
 */
export function decide({
  offer,
  previousLast,
  previousBest,
  lastAlertAt,
  isFirstObservation,
  alerts,
  guests,
  nights,
  now = Date.now(),
}) {
  const reasons = [];

  if (!offer) {
    // Availability disappeared - worth one quiet note, never a celebration.
    if (previousLast && alerts.alertOnNewAvailability) reasons.push(REASON.GONE);
    return finish(reasons, { urgent: false, bypassCooldown: false, lastAlertAt, alerts, now });
  }

  const price = offer.priceBase;
  const ppn = guests > 0 && nights > 0 ? price / guests / nights : null;

  const underBudget = isUnderBudget(price, ppn, alerts);
  if (underBudget) reasons.push(REASON.UNDER_THRESHOLD);

  const urgent = underBudget;
  // Only genuinely new information skips the cooldown, otherwise a deal that simply
  // stays under budget would ping on every single sweep.
  const wasUnderBudget = previousLast
    ? isUnderBudget(previousLast.priceBase, guests && nights ? previousLast.priceBase / guests / nights : null, alerts)
    : false;
  let bypassCooldown = underBudget && !wasUnderBudget;

  if (previousBest && price <= previousBest.priceBase * (1 - pct(alerts.minDropPctVsBest))) {
    reasons.push(REASON.ALL_TIME_LOW);
    bypassCooldown = true;
  }

  if (previousLast && price <= previousLast.priceBase * (1 - pct(alerts.minDropPctVsLast))) {
    reasons.push(REASON.PRICE_DROP);
  }

  if (!previousLast && !isFirstObservation && alerts.alertOnNewAvailability) {
    reasons.push(REASON.NEW_AVAILABILITY);
  }

  // First time we ever look at a date: stay quiet unless it clears an explicit budget.
  if (isFirstObservation && !underBudget) return { alert: false, reasons: [], urgent: false, suppressed: 'first-observation' };

  return finish(reasons, { urgent, bypassCooldown, lastAlertAt, alerts, now });
}

function isUnderBudget(price, ppn, alerts) {
  const underAbsolute = isNum(alerts.absoluteThresholdEur) && price <= alerts.absoluteThresholdEur;
  const underPpn = isNum(alerts.perPersonPerNightThresholdEur) && ppn != null && ppn <= alerts.perPersonPerNightThresholdEur;
  return underAbsolute || underPpn;
}

function finish(reasons, { urgent, bypassCooldown, lastAlertAt, alerts, now }) {
  if (!reasons.length) return { alert: false, reasons: [], urgent: false };
  if (!bypassCooldown && withinCooldown(lastAlertAt, alerts.cooldownHours, now)) {
    return { alert: false, reasons, urgent, suppressed: 'cooldown' };
  }
  return { alert: true, reasons, urgent };
}

function withinCooldown(lastAlertAt, cooldownHours, now) {
  if (!lastAlertAt || !isNum(cooldownHours) || cooldownHours <= 0) return false;
  return now - Date.parse(lastAlertAt) < cooldownHours * HOUR_MS;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v) => (isNum(v) ? v / 100 : 0);
