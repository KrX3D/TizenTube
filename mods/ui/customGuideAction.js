import { configChangeEmitter, configRead, configWrite } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";
import { GuideEntryRenderer } from "./ytUI.js";
import { guideEntryKey } from "./guideEntryKey.js";
// The only import here that is not already part of this file's early load:
// appendFileOnlyLog comes from hideWatched.js, which thirty-odd modules
// already import, so it is loaded before this regardless of order.
import { appendFileOnlyLog } from "../features/hideWatched.js";

/** Order entries are plain browseId strings or { browseId, title } objects. */
function orderBrowseId(orderItem) {
    return (typeof orderItem === 'object' && orderItem !== null) ? orderItem.browseId : orderItem;
}

/**
 * Keep sidebarContentsOrder in sync with what the guide actually contains.
 * New entries are appended so they show up at the bottom rather than
 * disappearing; nothing is removed, because a channel the user pinned may
 * legitimately not be in this particular response.
 *
 * Returns the order, and whether it had to be written back.
 */
function syncOrder(section) {
    const order = configRead('sidebarContentsOrder');
    if (!Array.isArray(order)) return { order: [], changed: false };
    let changed = false;
    for (const item of section.items) {
        const key = guideEntryKey(item);
        if (!key) continue;
        if (!order.some(orderItem => orderBrowseId(orderItem) === key)) {
            order.push(key);
            changed = true;
        }
    }
    return { order, changed };
}

/**
 * Reorder the guide's entries to match sidebarContentsOrder, synthesising an
 * entry for each pinned channel ({ browseId, title } object) that YouTube
 * itself doesn't send.
 *
 * Entries the order list doesn't mention are appended rather than dropped —
 * upstream's version silently loses them.
 */
function applyOrder(section, order) {
    const available = section.items.slice();

    for (const orderItem of order) {
        if (typeof orderItem === 'object' && orderItem !== null && orderItem.browseId) {
            available.push(GuideEntryRenderer(
                orderItem.title,
                { browseEndpoint: { browseId: orderItem.browseId } },
                'PERSON'
            ));
        }
    }

    const ordered = [];
    const used = new Set();
    for (const orderItem of order) {
        const browseId = orderBrowseId(orderItem);
        const index = available.findIndex((item, i) => !used.has(i) && guideEntryKey(item) === browseId);
        if (index !== -1) {
            used.add(index);
            ordered.push(available[index]);
        }
    }
    available.forEach((item, i) => { if (!used.has(i)) ordered.push(item); });

    section.items = ordered;
}

const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);

    try {
        if (r && r.items && Array.isArray(r.items) && r.items[0] && r.items[0].guideSectionRenderer) {
            const firstSection = r.items[0].guideSectionRenderer;
            if (Array.isArray(firstSection.items)) {
                try {
                    const { order, changed } = syncOrder(firstSection);
                    // Written back before reordering so a first run persists the
                    // natural order; the resulting reloadGuideAction re-enters
                    // here, finds nothing new, and settles.
                    if (changed) configWrite('sidebarContentsOrder', order);
                    if (order.length) applyOrder(firstSection, order);
                } catch (orderErr) {
                    console.warn('[customGuideAction] sidebar ordering failed:', orderErr);
                }
            }

            const disabledSidebarContents = configRead('disabledSidebarContents');
            const disableChannelsOnSidebar = configRead('disableChannelsOnSidebar');

            // The account row that sits above Home and shows one letter of the
            // account name.
            //
            // It is not in items[], which is why hiding it needed asking: the
            // loop below walks guide.items and this lives in guide.topbar. A
            // capture of the guide's shape named it exactly:
            //
            //   topbar {"guideSectionRenderer":{"items":["[1]",
            //     {"guideAccountEntryRenderer":{"navigationEndpoint":"…",
            //       "thumbnail":"…","title":"…","trackingParams":"string"}}]}}
            //
            // Only the account entries are taken out, not the section and not
            // the topbar: something else may be put in there later, and
            // deleting the container would take that with it. A section left
            // with no items is left in place for the same reason — the app
            // renders an empty one without complaint, and it is not this
            // file's business to decide the topbar should not exist.
            try {
                if (configRead('hideAccountOnSidebar')) {
                    const topSection = r.topbar?.guideSectionRenderer;
                    if (Array.isArray(topSection?.items)) {
                        const before = topSection.items.length;
                        topSection.items = topSection.items.filter(
                            (item) => !item?.guideAccountEntryRenderer
                        );
                        if (topSection.items.length !== before) {
                            appendFileOnlyLog('sidebar.accountHidden', {
                                removed: before - topSection.items.length,
                                left: topSection.items.length,
                            });
                        }
                    }
                }
            } catch (accountErr) {
                console.warn('[customGuideAction] hiding the account row failed:', accountErr);
            }
            for (let i = 0; i < r.items.length; i++) {
                try {
                    const section = r.items[i].guideSectionRenderer;
                    if (!section || !Array.isArray(section.items)) continue;
                    // Snapshot before hiding: the settings modal lists entries
                    // from here, so hidden ones stay reachable to un-hide.
                    section.originalItems = section.items.slice();
                    for (let j = 0; j < section.items.length; j++) {
                        try {
                            const item = section.items[j].guideEntryRenderer;
                            if (!item) continue;
                            // Entries are keyed by guideEntryKey: the browseId, or
                            // for an entry that opens no page (Shorts) its icon.
                            // The old iconType keys are still honoured so existing
                            // configs — including this fork's non-empty default —
                            // keep hiding what they always did.
                            const key = guideEntryKey(section.items[j]);
                            const isDisabled = disabledSidebarContents?.length && (
                                (key && disabledSidebarContents.includes(key))
                                || (item.icon?.iconType && disabledSidebarContents.includes(item.icon.iconType))
                            );
                            if (isDisabled || (disableChannelsOnSidebar && item?.thumbnail)) {
                                section.items.splice(j, 1);
                                j--;
                            }
                        } catch (itemErr) {
                            console.warn('[customGuideAction] Item processing error at index', j, itemErr);
                        }
                    }
                } catch (sectionErr) {
                    console.warn('[customGuideAction] Section processing error at index', i, sectionErr);
                }
            }
        }
    } catch (err) {
        console.warn('[customGuideAction] JSON.parse patch failed:', err);
    }

    return r;
};

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail.key === 'disabledSidebarContents' || e.detail.key === 'disableChannelsOnSidebar' || e.detail.key === 'sidebarContentsOrder') {
        try {
            const commandExecutor = getCommandExecutor();
            if (commandExecutor) {
                commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
            }
        } catch (err) {
            console.warn('[customGuideAction] reloadGuideAction failed:', err);
        }
    }
});
