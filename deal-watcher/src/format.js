import { esc } from './telegram.js';
import { shortLabel } from './dates.js';
import { fmtMoney, round2 } from './money.js';
import { REASON } from './alerts.js';

const REASON_TITLE = {
  [REASON.UNDER_THRESHOLD]: '🎯 Sub bugetul setat',
  [REASON.ALL_TIME_LOW]: '🔥 Cel mai mic pret de pana acum',
  [REASON.PRICE_DROP]: '📉 A scazut pretul',
  [REASON.NEW_AVAILABILITY]: '🆕 S-a eliberat disponibilitate',
  [REASON.GONE]: '⚠️ Nu mai e disponibil',
};

export function headline(reasons) {
  for (const r of [REASON.UNDER_THRESHOLD, REASON.ALL_TIME_LOW, REASON.PRICE_DROP, REASON.NEW_AVAILABILITY, REASON.GONE]) {
    if (reasons.includes(r)) return REASON_TITLE[r];
  }
  return 'ℹ️ Update';
}

export function perPersonPerNight(offer, guests, nights) {
  if (!guests || !nights) return null;
  return offer.priceBase / guests / nights;
}

export function formatAlert({ reasons, offer, previousBest, previousLast, guests, nights, alternatives = [], base = 'EUR' }) {
  const lines = [`<b>${headline(reasons)}</b>`];

  if (!offer) {
    lines.push(
      `${esc(previousLast?.sourceLabel || '')} · ${stayLine(previousLast)}`,
      `Ultimul pret vazut: ${esc(fmtMoney(previousLast.priceBase, base))}`,
    );
    return lines.join('\n');
  }

  const ppn = perPersonPerNight(offer, guests, nights);
  lines.push(
    `🏨 ${esc(offer.sourceLabel || offer.sourceId)}`,
    `📅 ${stayLine(offer)}`,
    `👨‍👩‍👧 ${esc(offer.occupancyLabel || offer.occupancyId)}`,
    `💶 <b>${esc(fmtMoney(offer.priceBase, base))}</b> total${ppn ? ` · ${esc(fmtMoney(ppn, base))}/pers/noapte` : ''}`,
  );

  if (offer.currency && offer.currency !== base) {
    lines.push(`   (afisat pe site: ${esc(fmtMoney(offer.price, offer.currency))})`);
  }
  if (previousBest && previousBest.priceBase > offer.priceBase) {
    lines.push(`📉 ${esc(deltaLine(offer.priceBase, previousBest.priceBase, base))} fata de minimul anterior`);
  } else if (previousLast && previousLast.priceBase > offer.priceBase) {
    lines.push(`📉 ${esc(deltaLine(offer.priceBase, previousLast.priceBase, base))} fata de ultima verificare`);
  }
  if (offer.title) lines.push(`🛏 ${esc(offer.title)}${offer.board ? ` · ${esc(offer.board)}` : ''}`);
  if (offer.cancellation) lines.push(`↩️ ${esc(offer.cancellation)}`);
  if (offer.url) lines.push(`🔗 <a href="${esc(offer.url)}">deschide oferta</a>`);

  if (alternatives.length) {
    lines.push('', '<i>Alte optiuni in aceeasi zi:</i>');
    for (const alt of alternatives) {
      lines.push(`• ${esc(alt.title || alt.occupancyLabel || '-')} — ${esc(fmtMoney(alt.priceBase, base))}`);
    }
  }
  return lines.join('\n');
}

export function stayLine(offer) {
  if (!offer) return '-';
  const year = offer.checkIn.slice(0, 4);
  return `${shortLabel(offer.checkIn)} → ${shortLabel(offer.checkOut)} ${year} (${offer.nights} nopti)`;
}

export function deltaLine(now, before, base) {
  const diff = before - now;
  const pct = before > 0 ? (diff / before) * 100 : 0;
  return `-${fmtMoney(diff, base)} (-${round2(pct)}%)`;
}

export function formatTop(rows, { base = 'EUR', title = '🏆 Cele mai bune preturi de acum' } = {}) {
  if (!rows.length) return 'Nimic disponibil momentan pentru filtrele setate.';
  const lines = [`<b>${title}</b>`];
  rows.forEach((row, i) => {
    const o = row.offer;
    const ppn = o.guests && o.nights ? ` · ${fmtMoney(o.priceBase / o.guests / o.nights, base)}/p/n` : '';
    lines.push(
      `${i + 1}. <b>${esc(fmtMoney(o.priceBase, base))}</b>${esc(ppn)}`,
      `   ${esc(stayLine(o))} · ${esc(o.occupancyLabel || row.occupancyId)}`,
      `   ${esc(o.title || '')}${o.url ? ` — <a href="${esc(o.url)}">link</a>` : ''}`,
    );
  });
  return lines.join('\n');
}

export function formatStatus({ cfg, stats, paused, nextSweepAt }) {
  const s = cfg.search;
  const lines = [
    '<b>📊 Status</b>',
    `Stare: ${paused ? '⏸ pe pauza' : '▶️ activ'}`,
    `Fereastra: ${esc(s.checkInFrom)} → ${esc(s.checkInTo)}, ${s.nights} nopti`,
    `Ocupari: ${esc((s.occupancies || []).filter((o) => o.enabled !== false).map((o) => o.id).join(', '))}`,
    `Surse: ${esc(Object.entries(cfg.sources).filter(([, v]) => v.enabled).map(([k]) => k).join(', '))}`,
    `Combinatii urmarite: ${stats.tracked} (disponibile acum: ${stats.available})`,
    `Sweep-uri rulate: ${stats.sweeps ?? 0}`,
    `Ultimul scan: ${esc(stats.lastSweepAt || 'inca niciunul')}`,
    nextSweepAt ? `Urmatorul scan: ${esc(nextSweepAt)}` : '',
    `Prag alerta: ${cfg.alerts.absoluteThresholdEur ?? '-'} ${cfg.currency.base} total, ${cfg.alerts.perPersonPerNightThresholdEur ?? '-'} /pers/noapte`,
  ].filter(Boolean);

  const errors = Object.entries(stats.errors || {});
  if (errors.length) {
    lines.push('', '<b>⚠️ Erori</b>');
    for (const [id, e] of errors) lines.push(`• ${esc(id)}: ${esc(e.lastError)} (${e.count}x)`);
  }
  return lines.join('\n');
}
