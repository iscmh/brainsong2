#!/usr/bin/env node
import process from 'node:process';
import { loadEnv, loadConfig, enabledSources } from './config.js';
import { Store } from './store.js';
import { Telegram, sleep, esc } from './telegram.js';
import { runSweep } from './sweep.js';
import { handleCommand } from './commands.js';
import { formatTop, formatStatus } from './format.js';
import { record } from './record.js';

loadEnv();

const MINUTE = 60_000;

async function main() {
  const [command = 'watch', ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const cfg = loadConfig();
  if (flags.source) {
    if (!cfg.sources[flags.source]) throw new Error(`Sursa '${flags.source}' nu exista in config.`);
    // --source is an explicit request: run just that one, without making the user edit config first.
    for (const [id, source] of Object.entries(cfg.sources)) source.enabled = id === flags.source;
  }
  const store = new Store(cfg.runtime.stateFile);
  const telegram = new Telegram();

  switch (command) {
    case 'watch':
      return watch({ cfg, store, telegram, flags });
    case 'once':
      return once({ cfg, store, telegram, flags });
    case 'record':
      return record({ cfg, sourceId: flags._[0] || Object.keys(cfg.sources).find((id) => cfg.sources[id].enabled) });
    case 'ping':
      return ping({ telegram });
    case 'top':
      console.log(stripHtml(formatTop(store.cheapest(Number(flags._[0]) || 10), { base: cfg.currency.base })));
      return undefined;
    case 'status':
      console.log(stripHtml(formatStatus({ cfg, stats: store.stats(), paused: store.state.paused })));
      return undefined;
    default:
      console.error(`Comenzi: watch | once | record -- <sursa> | ping | top | status`);
      process.exitCode = 1;
      return undefined;
  }
}

function notifier(telegram, { enabled = true } = {}) {
  return async (text, { urgent = false } = {}) => {
    console.log(`\n--- ALERTA ---\n${stripHtml(text)}\n`);
    if (!enabled || !telegram.configured) return;
    await telegram.send(text, { silent: !urgent }).catch((err) => console.error('Telegram:', err.message));
  };
}

async function once({ cfg, store, telegram, flags }) {
  const notify = notifier(telegram, { enabled: !flags.noTelegram });
  const summary = await runSweep({
    cfg,
    store,
    notify,
    onlyHot: Boolean(flags.hot),
    sourceFilter: flags.source || null,
  });
  console.log(`\nVerificate: ${summary.checked} · oferte: ${summary.offersFound} · alerte: ${summary.alerts}`);
  if (summary.errors.length) console.log(`Erori:\n  ${summary.errors.slice(0, 10).join('\n  ')}`);
  console.log(`\n${stripHtml(formatTop(store.cheapest(5), { base: cfg.currency.base }))}`);
  return summary;
}

async function watch({ cfg, store, telegram, flags }) {
  const notify = notifier(telegram, { enabled: !flags.noTelegram });
  const ctx = { nextSweepAt: Date.now(), pending: 'full', requestSweep: (mode) => { ctx.pending = mode; ctx.nextSweepAt = Date.now(); } };
  let stop = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop = true; });

  console.log(
    `deal-watcher pornit · surse: ${enabledSources(cfg).map((s) => s.id).join(', ')} · ` +
      `scan complet la ${cfg.schedule.fullSweepMinutes} min, date preferate la ${cfg.schedule.hotSweepMinutes} min`,
  );
  if (telegram.configured) {
    await telegram.send('🤖 <b>Deal watcher pornit.</b> Scriu aici cand apare ceva bun. /help pentru comenzi.', { silent: true })
      .catch((err) => console.error('Telegram:', err.message));
  }

  let lastFullAt = 0;
  let lastHotAt = 0;

  while (!stop) {
    await pumpCommands({ cfg, store, telegram, ctx });
    if (store.state.paused) { await sleep(5_000); continue; }

    const now = Date.now();
    // A little jitter so we never hit the hotel's server on a perfectly predictable clock.
    const spread = jitter(0, cfg.schedule.jitterSeconds);
    const fullDue = ctx.pending === 'full' || now - lastFullAt >= cfg.schedule.fullSweepMinutes * MINUTE + spread;
    const hotDue = ctx.pending === 'hot' || now - lastHotAt >= cfg.schedule.hotSweepMinutes * MINUTE + spread;

    if (fullDue || hotDue) {
      const onlyHot = !fullDue;
      ctx.pending = null;
      try {
        const summary = await runSweep({ cfg, store, notify, onlyHot });
        console.log(
          `[${new Date().toISOString()}] sweep ${onlyHot ? 'hot' : 'full'}: ` +
            `${summary.checked} verificari, ${summary.alerts} alerte, ${summary.errors.length} erori`,
        );
        if (summary.errors.length && summary.offersFound === 0) {
          await maybeWarn({ telegram, store, summary });
        }
      } catch (err) {
        console.error('Sweep a esuat:', err.message);
        store.noteError('sweep', err);
        store.save();
      }
      const finishedAt = Date.now();
      if (onlyHot) lastHotAt = finishedAt;
      else { lastFullAt = finishedAt; lastHotAt = finishedAt; }
      ctx.nextSweepAt = Math.min(lastFullAt + cfg.schedule.fullSweepMinutes * MINUTE, lastHotAt + cfg.schedule.hotSweepMinutes * MINUTE);
    }

    await maybeDigest({ cfg, store, telegram });
    await sleepUntil(3_000, () => stop); // short naps keep Ctrl-C responsive
  }

  console.log('Opresc.');
  store.save();
  return undefined;
}

/** Read and answer any pending Telegram commands. Never throws into the sweep loop. */
async function pumpCommands({ cfg, store, telegram, ctx }) {
  if (!telegram.configured) return;
  try {
    const { messages, nextOffset } = await telegram.poll(store.state.telegramOffset);
    if (nextOffset !== store.state.telegramOffset) {
      store.state.telegramOffset = nextOffset;
      store.save();
    }
    for (const msg of messages) {
      if (!telegram.isAllowed(msg.chatId)) {
        console.warn(`Ignor mesaj de la chat ${msg.chatId} (${msg.from})`);
        continue;
      }
      const reply = await handleCommand({ text: msg.text, cfg, store, ctx });
      if (reply) await telegram.send(reply, { chatId: msg.chatId, silent: true });
    }
  } catch (err) {
    console.error('Telegram poll:', err.message);
  }
}

/** One warning per hour when a sweep produced nothing but errors. */
async function maybeWarn({ telegram, store, summary }) {
  const last = store.state.lastWarnAt ? Date.parse(store.state.lastWarnAt) : 0;
  if (Date.now() - last < 60 * MINUTE) return;
  store.state.lastWarnAt = new Date().toISOString();
  store.save();
  if (!telegram.configured) return;
  await telegram
    .send(`⚠️ <b>Scanarea nu a returnat nimic.</b>\n<code>${esc(summary.errors[0] || 'necunoscut')}</code>`, { silent: true })
    .catch(() => {});
}

async function maybeDigest({ cfg, store, telegram }) {
  const hour = cfg.alerts.dailyDigestHourLocal;
  if (hour == null || !telegram.configured) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (store.state.lastDigestDay === today) return;
  if (localHour(now, cfg.runtime.timezone) < hour) return;
  store.state.lastDigestDay = today;
  store.save();
  const rows = store.cheapest(5);
  await telegram
    .send(formatTop(rows, { base: cfg.currency.base, title: '📬 Rezumat zilnic — cele mai bune preturi' }), { silent: true })
    .catch(() => {});
}

function localHour(date, timezone) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(date));
}

async function ping({ telegram }) {
  if (!telegram.configured) {
    console.error('TELEGRAM_BOT_TOKEN lipseste. Copiaza .env.example in .env si pune tokenul de la @BotFather.');
    process.exitCode = 1;
    return;
  }
  const me = await telegram.call('getMe');
  console.log(`Bot: @${me.username} (${me.id})`);
  if (!telegram.chatId) {
    console.log('TELEGRAM_CHAT_ID nu e setat. Trimite un mesaj botului in Telegram, apoi ruleaza din nou "npm run ping".');
    const { messages } = await telegram.poll(0);
    for (const m of messages) console.log(`  chat id: ${m.chatId} (de la ${m.from})`);
    return;
  }
  await telegram.send('✅ Merge. Deal watcher poate sa-ti scrie aici.');
  console.log('Mesaj de test trimis.');
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--hot') flags.hot = true;
    else if (arg === '--no-telegram') flags.noTelegram = true;
    else if (arg === '--source') flags.source = argv[++i];
    else if (arg !== '--') flags._.push(arg);
  }
  return flags;
}

function jitter(baseMs, jitterSeconds = 0) {
  return baseMs + Math.floor(Math.random() * (jitterSeconds || 0) * 1000);
}

async function sleepUntil(totalMs, shouldStop, step = 250) {
  for (let waited = 0; waited < totalMs; waited += step) {
    if (shouldStop()) return;
    await sleep(step);
  }
}

const stripHtml = (s) =>
  String(s)
    .replace(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
