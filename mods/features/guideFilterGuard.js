import { appendFileOnlyLog } from './hideWatched.js';

/**
 * guideFilterGuard.js — make sure the sidebar on screen went through the
 * filter in customGuideAction.js.
 *
 * Reported on 6.5: after a wake reload that started the app on a video, the
 * sidebar showed every entry (Shorts, Gaming, ...) that disabledSidebarContents
 * hides. The capture had no sidebar.guideShape or sidebar.accountHidden line
 * after that reload, while the morning's reload onto the library had both: the
 * guide response was parsed before the injection finished, and the one
 * reloadGuideAction ui.js issues at startup either found no command executor
 * yet or fired before the app could act on it. Nothing tried again.
 *
 * So: customGuideAction.js notes every guide response it sees, and if none has
 * come through a few seconds after startup, the guide is reloaded, retrying
 * until YouTube's command executor exists.
 */

let _guideParsedAt = 0;

/** Called by customGuideAction.js for every guide response it processes. */
export function noteGuideParsed() {
  _guideParsedAt = Date.now();
}

const POLL_MS = 500;
// Give the startup reload and the app's own guide load this long first.
const FIRST_RELOAD_AFTER_MS = 3000;
const SECOND_RELOAD_AFTER_MS = 10000;
const GIVE_UP_AFTER_MS = 30000;

/**
 * @param {() => ({executeFunction: Function, commandFunction: Function}|undefined)} getCommandExecutor
 */
export function ensureGuideFiltered(getCommandExecutor) {
  const startedAt = Date.now();
  let reloads = 0;
  const tick = () => {
    const elapsed = Date.now() - startedAt;
    if (_guideParsedAt) {
      if (reloads) appendFileOnlyLog('sidebar.guideRefiltered', { reloads, afterMs: elapsed });
      return;
    }
    if (elapsed >= GIVE_UP_AFTER_MS) {
      appendFileOnlyLog('sidebar.guideNotFiltered', { reloads, afterMs: elapsed });
      return;
    }
    const due = (reloads === 0 && elapsed >= FIRST_RELOAD_AFTER_MS)
      || (reloads === 1 && elapsed >= SECOND_RELOAD_AFTER_MS);
    if (due) {
      try {
        const executor = getCommandExecutor();
        if (executor && executor.commandFunction) {
          executor.executeFunction(new executor.commandFunction('reloadGuideAction'));
          reloads++;
          appendFileOnlyLog('sidebar.guideReloaded', { attempt: reloads, afterMs: elapsed });
        }
      } catch (err) {
        appendFileOnlyLog('sidebar.guideReloadFailed', { msg: String(err?.message || err) });
        reloads++;
      }
    }
    setTimeout(tick, POLL_MS);
  };
  setTimeout(tick, POLL_MS);
}
