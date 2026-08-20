import * as replay from './replay.js';
import * as generic from './generic.js';
import * as mock from './mock.js';

/** Pick the adapter for a source: an explicit `adapter`, else a recording, else the DOM scraper. */
export function resolveAdapter(sourceId, source) {
  const explicit = source.adapter;
  if (explicit === 'mock' || sourceId === 'mock') return mock;
  if (explicit === 'replay') return replay;
  if (explicit === 'generic') return generic;
  if (replay.hasRecording(sourceId, source)) return replay;
  if (source.urlTemplate) return generic;
  return null;
}

export function adapterHint(sourceId, source) {
  if (source.urlTemplate) return `seteaza selectorii pentru ${sourceId}`;
  return `ruleaza: npm run record -- ${sourceId}`;
}

export { replay, generic, mock };
