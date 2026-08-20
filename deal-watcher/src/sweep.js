import { buildStays } from './dates.js';
import { enabledOccupancies, enabledSources, occupancySummary } from './config.js';
import { entryKey } from './store.js';
import { resolveAdapter, adapterHint } from './sources/index.js';
import { renderTemplate } from './sources/generic.js';
import { decide } from './alerts.js';
import { formatAlert } from './format.js';
import { convert, round2 } from './money.js';
import { sleep } from './telegram.js';

/**
 * One pass over every (source × occupancy × check-in date) combination.
 * Cheapest offer per combination is what gets tracked; the rest ride along as "alte optiuni".
 */
export async function runSweep({ cfg, store, notify, onlyHot = false, sourceFilter = null, log = console.log }) {
  const allStays = buildStays(cfg.search);
  const stays = onlyHot ? allStays.filter((s) => s.hot) : allStays;
  const occupancies = enabledOccupancies(cfg);
  const base = cfg.currency.base;
  const summary = { checked: 0, offersFound: 0, alerts: 0, errors: [], started: new Date().toISOString() };

  for (const source of enabledSources(cfg)) {
    if (sourceFilter && source.id !== sourceFilter) continue;

    const adapter = resolveAdapter(source.id, source);
    if (!adapter) {
      const message = `sursa '${source.id}' nu e configurata inca - ${adapterHint(source.id, source)}`;
      store.noteError(source.id, message);
      summary.errors.push(message);
      continue;
    }

    let session;
    try {
      session = await adapter.createSession({ sourceId: source.id, source, cfg, log });
    } catch (err) {
      store.noteError(source.id, err);
      summary.errors.push(`${source.id}: ${err.message}`);
      continue;
    }

    // Per-source pacing: be gentle with real hotels, instant for the offline mock.
    const delayMs = source.requestDelayMs ?? cfg.schedule.requestDelayMs;
    let sourceFailures = 0;
    try {
      for (const occupancy of occupancies) {
        const occ = occupancySummary(occupancy);
        for (const stay of stays) {
          summary.checked += 1;
          let offers = null;
          try {
            offers = await withRetries(
              () => session.search({ stay, occupancy, occupancySummary: occ }),
              cfg.schedule.retries,
              delayMs || 1000,
            );
            store.clearError(source.id);
          } catch (err) {
            sourceFailures += 1;
            store.noteError(source.id, err);
            summary.errors.push(`${source.id} ${stay.checkIn} ${occupancy.id}: ${err.message}`);
            if (sourceFailures >= 3) {
              log(`${source.id}: 3 erori consecutive, opresc sursa pentru sweep-ul asta`);
              throw new StopSource();
            }
            continue;
          }
          sourceFailures = 0;

          const normalised = normalise(offers, { source, cfg, stay, occupancy, occ, base });
          summary.offersFound += normalised.length;
          const alerted = await handleResult({ cfg, store, notify, source, occupancy, occ, stay, offers: normalised, base });
          if (alerted) summary.alerts += 1;

          await sleep(delayMs);
        }
      }
    } catch (err) {
      if (!(err instanceof StopSource)) {
        store.noteError(source.id, err);
        summary.errors.push(`${source.id}: ${err.message}`);
      }
    } finally {
      await session.close?.().catch?.(() => {});
    }
  }

  store.state.lastSweepAt = new Date().toISOString();
  store.state.sweeps = (store.state.sweeps || 0) + 1;
  store.save();
  summary.finished = new Date().toISOString();
  return summary;
}

class StopSource extends Error {}

export function normalise(rawOffers, { source, cfg, stay, occupancy, occ, base }) {
  const rates = cfg.currency.rates;
  const perNight = source.priceIs === 'perNight';
  // Some engines list rooms that cannot actually hold the party; filter them by name.
  const include = source.titleInclude ? new RegExp(source.titleInclude, 'i') : null;
  const exclude = source.titleExclude ? new RegExp(source.titleExclude, 'i') : null;
  // A deep link straight to the right dates beats a link to the hotel's home page.
  const deepLink = source.bookingUrlTemplate
    ? renderTemplate(source.bookingUrlTemplate, { stay, occ, currency: source.currency || base })
    : null;
  return (rawOffers || [])
    .filter((raw) => {
      const title = `${raw.title || ''} ${raw.board || ''}`;
      if (include && !include.test(title)) return false;
      if (exclude && exclude.test(title)) return false;
      return true;
    })
    .map((raw) => {
      const currency = (raw.currency || source.currency || base).toUpperCase();
      if (!rates[currency]) return null;
      const price = perNight ? raw.price * stay.nights : raw.price;
      return {
        sourceId: source.id,
        sourceLabel: source.label || source.id,
        occupancyId: occupancy.id,
        occupancyLabel: occupancy.label || occupancy.id,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: stay.nights,
        guests: occ.guests,
        title: raw.title || '',
        board: raw.board || '',
        cancellation: raw.cancellation || '',
        price: round2(price),
        currency,
        priceBase: round2(convert(price, currency, base, rates)),
        url: raw.url || raw.searchUrl || deepLink || source.hotelUrl || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priceBase - b.priceBase);
}

async function handleResult({ cfg, store, notify, source, occupancy, occ, stay, offers, base }) {
  const key = entryKey(source.id, occupancy.id, stay.checkIn);
  const isFirstObservation = !store.entry(key);
  const cheapest = offers[0] || null;
  const { entry, previousLast, previousBest } = store.record(key, cheapest);

  const verdict = decide({
    offer: cheapest,
    previousLast,
    previousBest,
    lastAlertAt: entry.lastAlertAt,
    isFirstObservation,
    alerts: cfg.alerts,
    guests: occ.guests,
    nights: stay.nights,
  });

  if (!verdict.alert || !notify) return false;

  const text = formatAlert({
    reasons: verdict.reasons,
    offer: cheapest,
    previousBest,
    previousLast,
    guests: occ.guests,
    nights: stay.nights,
    alternatives: offers.slice(1, cfg.alerts.maxOffersPerAlert ?? 3),
    base,
  });
  await notify(text, { urgent: verdict.urgent });
  store.markAlerted(key);
  return true;
}

async function withRetries(fn, retries, delayMs) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
}
