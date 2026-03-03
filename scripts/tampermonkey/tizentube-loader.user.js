// ==UserScript==
// @name         TizenTube Loader
// @namespace    https://github.com/KrX3D/TizenTube
// @version      0.2
// @description  Load latest TizenTube userscript bundle for local /tv debugging
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/KrX3D/TizenTube/main/scripts/tampermonkey/tizentube-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/KrX3D/TizenTube/main/scripts/tampermonkey/tizentube-loader.user.js
// ==/UserScript==

(function () {
  const src = `https://raw.githubusercontent.com/KrX3D/TizenTube/main/dist/userScript.js?ts=${Date.now()}`;
  const s = document.createElement('script');
  s.src = src;
  s.async = false;
  s.crossOrigin = 'anonymous';
  (document.documentElement || document.head || document.body).appendChild(s);
})();
