export function detectPlaylistButtons({ getCurrentPage, addPlaylistControlButtons }) {
  if (getCurrentPage() !== 'playlist') return;
  addPlaylistControlButtons(1);
}

export function addPlaylistControlButtons(attempt = 1, { getCurrentPage, debugEnabled = false, resolveCommand, logChunkedByLines }) {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const baseContainer = document.querySelector('.TXB27d.RuKowd.fitbrf.B3hoEd') || document.querySelector('[class*="TXB27d"]');
  if (!baseContainer) {
    console.log('[PLAYLIST_BUTTON] No button container found (attempt ' + attempt + ')');
    if (attempt < 6) setTimeout(() => addPlaylistControlButtons(attempt + 1, { getCurrentPage, debugEnabled, resolveCommand, logChunkedByLines }), 1200);
    return;
  }

  const parentContainer = baseContainer.parentElement;
  const trimHtml = (value, max = 1200) => {
    const str = String(value || '');
    if (str.length <= max) return str;
    return str.slice(0, max) + `...[+${str.length - max} chars]`;
  };

  const getVisibleButtons = (root) => {
    if (!root) return [];
    return Array.from(root.querySelectorAll('ytlr-button-renderer')).filter((btn) => {
      if (btn.getAttribute('data-tizentube-collection-btn') === '1') return false;
      const rect = btn.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return false;
      const style = window.getComputedStyle(btn);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (btn.getAttribute('aria-hidden') === 'true') return false;
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      return !!text;
    });
  };

  const baseButtons = getVisibleButtons(baseContainer);
  const parentButtons = getVisibleButtons(parentContainer);

  if (attempt === 1 && debugEnabled) {
    console.log('[PLAYLIST_BUTTON] base buttons:', baseButtons.length, '| parent buttons:', parentButtons.length);
  }

  const useParent = parentButtons.length > baseButtons.length;
  const container = useParent ? parentContainer : baseContainer;

  const allCustomButtons = Array.from(document.querySelectorAll('[data-tizentube-collection-btn="1"]'));
  allCustomButtons.forEach((btn) => {
    if (!container.contains(btn)) {
      btn.remove();
    }
  });

  const getNativeButtons = () => getVisibleButtons(container);

  const existingButtons = getNativeButtons();
  const getButtonRect = (btn) => {
    const r = btn.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  };
  const currentUrl = window.location.href;

  if (attempt <= 2) {
    console.log('[PLAYLIST_BUTTON] Container=', useParent ? 'parent' : 'base', '| buttons=', existingButtons.length, '| attempt=', attempt);
  }

  if (existingButtons.length === 0) {
    const now = Date.now();
    if (!window._playlistNoNativeLogAt || (now - window._playlistNoNativeLogAt) > 15000) {
      console.log('[PLAYLIST_BUTTON] No native buttons in container (attempt ' + attempt + ')');
      window._playlistNoNativeLogAt = now;
    }
    if (attempt < 6) setTimeout(() => addPlaylistControlButtons(attempt + 1, { getCurrentPage, debugEnabled, resolveCommand, logChunkedByLines }), 1200);
    return;
  }

  if (attempt <= 2 && debugEnabled) {
    window._playlistButtonDumpUrl = currentUrl;
    try {
      const targetHostForDump = (parentContainer || container);
      const existingCustomBtn = container.querySelector('[data-tizentube-collection-btn="1"]');
      const dump = {
        page,
        baseButtonsBefore: baseButtons.length,
        parentButtonsBefore: parentButtons.length,
        baseTag: baseContainer.tagName,
        baseClass: baseContainer.className,
        baseOuterHTML: trimHtml(baseContainer.outerHTML),
        parentTag: parentContainer?.tagName,
        parentClass: parentContainer?.className,
        parentOuterHTML: trimHtml(parentContainer?.outerHTML),
        targetTag: targetHostForDump.tagName,
        targetClass: targetHostForDump.className,
        targetOuterHTML: trimHtml(targetHostForDump.outerHTML),
        targetParentTag: targetHostForDump.parentElement?.tagName,
        targetParentClass: targetHostForDump.parentElement?.className,
        targetParentOuterHTML: trimHtml(targetHostForDump.parentElement?.outerHTML),
        buttonOuterHTML: existingButtons.map((btn) => trimHtml(btn.outerHTML, 700)),
        allButtonOuterHTML: Array.from(container.querySelectorAll('ytlr-button-renderer')).slice(0, 6).map((btn) => trimHtml(btn.outerHTML, 700)),
        existingCustomButtonOuterHTML: existingCustomBtn ? trimHtml(existingCustomBtn.outerHTML, 700) : null,
      };
      console.log('[PLAYLIST_BUTTON_JSON] Dumping button/container snapshot attempt=', attempt);
      logChunkedByLines('[PLAYLIST_BUTTON_JSON]', JSON.stringify(dump, null, 2), 60);
    } catch (e) {
      console.log('[PLAYLIST_BUTTON_JSON] Failed to stringify button container', e?.message || e);
    }
  }

  const templateBtn = existingButtons.reduce((best, btn) => {
    if (!best) return btn;
    const a = getButtonRect(best);
    const b = getButtonRect(btn);
    if (b.top > a.top + 1) return btn;
    if (Math.abs(b.top - a.top) <= 1 && b.left > a.left) return btn;
    return best;
  }, null) || existingButtons[existingButtons.length - 1];

  const runRefresh = (evt) => {
    evt?.preventDefault?.();
    evt?.stopPropagation?.();
    resolveCommand({ signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
  };

  const setupCustomButton = (btn) => {
    btn.setAttribute('data-tizentube-collection-btn', '1');
    btn.removeAttribute('idomkey');
    btn.removeAttribute('id');
    btn.setAttribute('tabindex', '0');
    btn.removeAttribute('aria-hidden');
    btn.style.pointerEvents = 'auto';
    btn.style.opacity = '1';
    btn.style.visibility = 'visible';
    btn.removeAttribute('disablehybridnavinsubtree');
    btn.querySelectorAll('[idomkey]').forEach((el) => el.removeAttribute('idomkey'));
    btn.querySelectorAll('[disablehybridnavinsubtree]').forEach((el) => el.removeAttribute('disablehybridnavinsubtree'));
    btn.querySelectorAll('[aria-hidden]').forEach((el) => el.setAttribute('aria-hidden', 'false'));

    const labelNode = btn.querySelector('yt-formatted-string');
    if (labelNode) labelNode.textContent = 'Refresh Filters';

    if (btn.dataset.tizentubeRefreshBound !== '1') {
      btn.addEventListener('click', runRefresh);
      btn.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') runRefresh(evt);
      });
      btn.dataset.tizentubeRefreshBound = '1';
    }

    const innerButton = btn.querySelector('button');
    if (innerButton) {
      innerButton.style.pointerEvents = 'auto';
      innerButton.removeAttribute('disabled');
      innerButton.setAttribute('tabindex', '0');
      if (innerButton.dataset.tizentubeRefreshBound !== '1') {
        innerButton.addEventListener('click', runRefresh);
        innerButton.dataset.tizentubeRefreshBound = '1';
      }
    }
  };

  let customBtn = container.querySelector('[data-tizentube-collection-btn="1"]');
  if (!customBtn) customBtn = templateBtn.cloneNode(true);
  setupCustomButton(customBtn);

  const nativeButtonRects = existingButtons.map((btn, idx) => {
    const r = btn.getBoundingClientRect();
    return { idx, y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), id: null, custom: btn.getAttribute('data-tizentube-collection-btn') === '1' };
  });
  console.log('[PLAYLIST_BUTTON] Native button rects:', JSON.stringify(nativeButtonRects));

  if (templateBtn.nextElementSibling !== customBtn) {
    templateBtn.insertAdjacentElement('afterend', customBtn);
  }

  const templateRect = templateBtn.getBoundingClientRect();
  customBtn.style.transform = templateBtn.style.transform || '';
  customBtn.style.position = '';
  customBtn.style.top = '';
  customBtn.style.left = '';

  if (container) {
    container.style.overflow = 'visible';
    container.style.minHeight = `${Math.max(container.getBoundingClientRect().height, templateRect.height * (existingButtons.length + 1) + 8)}px`;
  }
  if (parentContainer) {
    parentContainer.style.overflow = 'visible';
  }

  window._playlistButtonInjectedUrl = currentUrl;

  const crect = container.getBoundingClientRect();
  const rect = customBtn.getBoundingClientRect();
  console.log('[PLAYLIST_BUTTON] Injected button at y=', Math.round(rect.top), 'h=', Math.round(rect.height), '| container y=', Math.round(crect.top), 'h=', Math.round(crect.height));

  try {
    const postButtons = Array.from(container.querySelectorAll('ytlr-button-renderer'));
    const postButtonRects = postButtons.map((btn, idx) => {
      const r = btn.getBoundingClientRect();
      return { idx, y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), id: null, custom: btn.getAttribute('data-tizentube-collection-btn') === '1' };
    });

    const afterDump = {
      page,
      attempt,
      clonedCustomButtonOuterHTML: trimHtml(customBtn.outerHTML, 700),
      clonedCustomButtonRect: { y: Math.round(rect.top), h: Math.round(rect.height), w: Math.round(rect.width) },
      containerRect: { y: Math.round(crect.top), h: Math.round(crect.height), w: Math.round(crect.width) },
      templateMetrics: { top: Math.round(templateBtn.offsetTop || 0), left: Math.round(templateBtn.offsetLeft || 0), height: Math.round(templateBtn.offsetHeight || 0), width: Math.round(templateBtn.offsetWidth || 0) },
      nativeButtonRectsBefore: nativeButtonRects,
      parentButtonsAfter: postButtons.length,
      nativeButtonRectsAfter: postButtonRects,
      baseOuterHTMLAfter: trimHtml(baseContainer.outerHTML),
      parentOuterHTMLAfter: trimHtml(parentContainer?.outerHTML),
    };
    if (attempt <= 2 && debugEnabled) {
      logChunkedByLines('[PLAYLIST_BUTTON_JSON_AFTER]', JSON.stringify(afterDump, null, 2), 60);
    }
  } catch (e) {
    console.log('[PLAYLIST_BUTTON_JSON_AFTER] Failed to stringify injected button', e?.message || e);
  }
}

export function initPlaylistButtonMaintenance({ getCurrentPage, addPlaylistControlButtons, cleanupPlaylistHelperTiles }) {
  if (typeof window === 'undefined') return;
  setTimeout(() => { addPlaylistControlButtons(1); cleanupPlaylistHelperTiles(); }, 2500);
  let lastPlaylistButtonHref = window.location.href;
  setInterval(() => {
    const page = getCurrentPage();
    if (page === 'playlist' || page === 'playlists') {
      cleanupPlaylistHelperTiles();
      if (!document.querySelector('[data-tizentube-collection-btn="1"]') && page === 'playlist') {
        addPlaylistControlButtons(7);
      }
    }
    if (window.location.href !== lastPlaylistButtonHref) {
      lastPlaylistButtonHref = window.location.href;
      if (page === 'playlist') {
        setTimeout(() => { addPlaylistControlButtons(1); cleanupPlaylistHelperTiles(); }, 1800);
      }
    }
  }, 1200);
}
