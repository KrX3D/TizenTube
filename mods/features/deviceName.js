/**
 * deviceName.js — what to call the TV this is running on.
 *
 * Lifted out of visualConsole.js, which has shown the model on screen for a
 * while, because a second caller turned up: syslog frames carry a HOSTNAME
 * field, and a syslog server names its files after it. With that field left as
 * the page's own host, every TV on the network wrote to one file called
 * syslog-www.youtube.com.log, which says nothing about which TV, or even that
 * it is a TV.
 *
 * Four sources, each tried and the last one winning, because they are in
 * increasing order of how specific they are:
 *
 *   h5vcc.system.getDeviceInfo().modelName   Cobalt's own device info
 *   webapis.productinfo.getModel()           Samsung's, on the TV app
 *   webapis.productinfo.getRealModel()       the retail model, where it differs
 *   webapis.productinfo.getModelCode()       added in brackets, not instead
 *
 * and the user agent as a last resort, which on a TV carries something like
 * "(SMART-TV; Linux armv7l)". None of these exists everywhere, and on the CDP
 * path the page is plain youtube.com with no Tizen API at all, so every one is
 * guarded and the whole thing can come back empty.
 */

/** The model as it reads for a person: "UE55RU7179 (RU7179)", or null. */
export function detectTvModel() {
    let modelName = null;
    let modelCode = null;

    try {
        const h5vccModel = window?.h5vcc?.system?.getDeviceInfo?.()?.modelName;
        if (h5vccModel) modelName = String(h5vccModel);
    } catch (_) { }

    try {
        const webapisModel = window?.webapis?.productinfo?.getModel?.();
        if (webapisModel) modelName = String(webapisModel);
    } catch (_) { }

    try {
        const webapisRealModel = window?.webapis?.productinfo?.getRealModel?.();
        if (webapisRealModel) modelName = String(webapisRealModel);
    } catch (_) { }

    try {
        const maybeCode = window?.webapis?.productinfo?.getModelCode?.();
        if (maybeCode) modelCode = String(maybeCode);
    } catch (_) { }

    try {
        const ua = String(navigator.userAgent || '');
        const match = ua.match(/\(([^)]*?TV[^)]*?)\)/i);
        if (!modelName && match?.[1]) modelName = match[1];
    } catch (_) { }

    if (!modelName && !modelCode) return null;
    if (modelName && modelCode) return `${modelName} (${modelCode})`;
    return modelName || modelCode;
}

/** The same, worded for a screen: never empty. */
export function tvModelForDisplay() {
    return detectTvModel() || 'unknown';
}

/**
 * A name fit for a syslog HOSTNAME field, or null.
 *
 * RFC 5424 separates its header fields with spaces, so a model with a space in
 * it — which is most of them once the code is appended — would shift every
 * field after it and the receiver would read the rest of the line wrongly.
 * Everything outside letters, digits, dot and dash becomes a dash, which also
 * keeps it usable as the filename a syslog server derives from it.
 */
export function deviceNameForSyslog() {
    const model = detectTvModel();
    if (!model) return null;
    const name = String(model)
        .replace(/[^A-Za-z0-9.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 255);
    return name || null;
}
