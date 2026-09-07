import { configChangeEmitter, configRead, configWrite } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";
import { GuideEntryRenderer } from "./ytUI.js";

/** The browseId a guide entry navigates to; the search entry has none. */
function entryBrowseId(item) {
    const nav = item?.guideEntryRenderer?.navigationEndpoint;
    return nav?.browseEndpoint?.browseId || (nav?.searchEndpoint ? 'search' : null);
}

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
        const browseId = entryBrowseId(item);
        if (!browseId) continue;
        if (!order.some(orderItem => orderBrowseId(orderItem) === browseId)) {
            order.push(browseId);
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
        const index = available.findIndex((item, i) => !used.has(i) && entryBrowseId(item) === browseId);
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
                            // Entries are keyed by browseId now (upstream 2f2c567).
                            // The old iconType keys are still honoured so existing
                            // configs — including this fork's non-empty default —
                            // keep hiding what they always did.
                            const browseId = entryBrowseId(section.items[j]);
                            const isDisabled = disabledSidebarContents?.length && (
                                (browseId && disabledSidebarContents.includes(browseId))
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
