/** Telegram command handling. Every command is answerable while a sweep is running. */

import { saveConfig, validate, enabledSources } from './config.js';
import { formatStatus, formatTop } from './format.js';
import { buildStays } from './dates.js';
import { esc } from './telegram.js';

const HELP = [
  '<b>Comenzi</b>',
  '/status — ce urmaresc si cand a fost ultimul scan',
  '/best [n] — cele mai ieftine n oferte de acum (default 5)',
  '/now — forteaza un scan complet acum',
  '/pause · /resume — opreste / reia scanarile',
  '/prag &lt;eur&gt; — alerta cand totalul scade sub suma asta (0 = fara prag)',
  '/pragpn &lt;eur&gt; — acelasi lucru, dar pe persoana pe noapte',
  '/fereastra &lt;2027-07-20&gt; &lt;2027-08-08&gt; — schimba intervalul de check-in',
  '/nopti &lt;n&gt; — schimba numarul de nopti',
  '/surse — sursele active si erorile lor',
  '/help — mesajul asta',
].join('\n');

export async function handleCommand({ text, cfg, store, ctx }) {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, '');

  switch (cmd) {
    case '/start':
    case '/help':
      return HELP;

    case '/status':
      return formatStatus({
        cfg,
        stats: store.stats(),
        paused: store.state.paused,
        nextSweepAt: ctx.nextSweepAt ? new Date(ctx.nextSweepAt).toISOString() : null,
      });

    case '/best': {
      const n = clamp(Number(args[0]) || 5, 1, 20);
      return formatTop(store.cheapest(n), { base: cfg.currency.base });
    }

    case '/now':
      ctx.requestSweep('full');
      return '🔄 Am pornit un scan complet. Iti trimit ce gasesc.';

    case '/pause':
      store.state.paused = true;
      store.save();
      return '⏸ Pus pe pauza. /resume ca sa repornesc.';

    case '/resume':
      store.state.paused = false;
      store.save();
      ctx.requestSweep('full');
      return '▶️ Repornit.';

    case '/prag':
    case '/pragpn': {
      const value = Number(String(args[0] ?? '').replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) return 'Foloseste: /prag 1500';
      const field = cmd === '/prag' ? 'absoluteThresholdEur' : 'perPersonPerNightThresholdEur';
      cfg.alerts[field] = value === 0 ? null : value;
      saveConfig(cfg);
      return value === 0
        ? '✅ Pragul a fost scos.'
        : `✅ Prag setat: ${value} ${cfg.currency.base}${cmd === '/pragpn' ? ' /pers/noapte' : ' total'}.`;
    }

    case '/fereastra': {
      const [from, to] = args;
      const next = { ...cfg.search, checkInFrom: from, checkInTo: to };
      try {
        buildStays(next);
      } catch (err) {
        return `❌ ${esc(err.message)}`;
      }
      cfg.search.checkInFrom = from;
      cfg.search.checkInTo = to;
      saveConfig(cfg);
      ctx.requestSweep('full');
      return `✅ Fereastra: ${esc(from)} → ${esc(to)} (${buildStays(cfg.search).length} date de check-in).`;
    }

    case '/nopti': {
      const nights = Number(args[0]);
      if (!Number.isInteger(nights) || nights < 1 || nights > 30) return 'Foloseste: /nopti 6';
      cfg.search.nights = nights;
      validate(cfg);
      saveConfig(cfg);
      ctx.requestSweep('full');
      return `✅ Caut acum sejururi de ${nights} nopti.`;
    }

    case '/surse': {
      const lines = ['<b>Surse active</b>'];
      for (const s of enabledSources(cfg)) {
        const err = store.state.errors[s.id];
        lines.push(`• ${esc(s.label || s.id)} — ${err ? `⚠️ ${esc(err.lastError)}` : 'ok'}`);
      }
      return lines.join('\n');
    }

    default:
      return cmd.startsWith('/') ? `Nu cunosc ${esc(cmd)}. /help pentru lista.` : null;
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
