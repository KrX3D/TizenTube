import { configRead } from '../config.js';

const style = document.createElement('style');
let css = '';

function updateStyle() {
    css = `
    ytlr-guide-response yt-focus-container {
        background-color: ${configRead('focusContainerColor')};
    }

    #container {
        background-color: ${configRead('routeColor')} !important;
    }
`;
    const existingStyle = document.querySelector('style[nonce]');
    if (existingStyle) {
        existingStyle.textContent += css;
    } else {
        style.textContent = css;
    }
};

// The script can be evaluated before YouTube's document has a <head>
// (TizenBrew's cached injection); a throw here would stop the rest of the
// bundle. Ported from reisxd/TizenTube#759.
if (document.head) {
    document.head.appendChild(style);
} else {
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
}
updateStyle();
export default updateStyle;