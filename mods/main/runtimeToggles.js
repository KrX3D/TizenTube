// Central runtime toggles for quick testing without touching scattered files.
// Requested defaults:
// - debug: true
// - shorts: false
export const FORCE_DEBUG_ENABLED = true;
export const FORCE_SHORTS_ENABLED = false;
export const FORCE_LOG_SHORTS = false;

export function getDebugEnabled(configRead) {
  if (typeof FORCE_DEBUG_ENABLED === 'boolean') return FORCE_DEBUG_ENABLED;
  return !!configRead?.('enableDebugConsole');
}

export function getShortsEnabled(configRead) {
  if (typeof FORCE_SHORTS_ENABLED === 'boolean') return FORCE_SHORTS_ENABLED;
  return !!configRead?.('enableShorts');
}

export function getLogShortsEnabled(configRead) {
  if (typeof FORCE_LOG_SHORTS === 'boolean') return FORCE_LOG_SHORTS;
  return !!configRead?.('enableDebugConsole');
}
