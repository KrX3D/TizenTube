let originalJsonParse = null;
const parseHooks = [];
let isPatched = false;

function patchYttvJsonParse(parseFn) {
  window.JSON.parse = parseFn;
  if (!window._yttv) return;

  for (const key in window._yttv) {
    if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
      window._yttv[key].JSON.parse = parseFn;
    }
  }
}

export function registerJsonParseHook(hook) {
  if (!originalJsonParse) {
    originalJsonParse = JSON.parse;
  }

  parseHooks.push(hook);

  if (isPatched) return;

  JSON.parse = function () {
    let parsed = originalJsonParse.apply(this, arguments);

    for (const parseHook of parseHooks) {
      try {
        parsed = parseHook(parsed) ?? parsed;
      } catch (e) {
        console.error('[JSON_PARSE_HOOK] Hook crashed:', e?.message, e?.stack);
      }
    }

    return parsed;
  };

  patchYttvJsonParse(JSON.parse);
  isPatched = true;
}