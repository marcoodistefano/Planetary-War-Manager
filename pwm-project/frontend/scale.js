const fs = require('fs');

const scale = 0.75;
const scalePx = (val) => Math.round(parseFloat(val) * scale) + 'px';
const scaleRem = (val) => (parseFloat(val) * scale).toFixed(2).replace(/\.?0+$/, '') + 'rem';
const scaleVw = (val) => (parseFloat(val) * scale).toFixed(2).replace(/\.?0+$/, '') + 'vw';

let css = fs.readFileSync('src/app/home/home.page.scss', 'utf8');

// Hardcoded explicit replacements for safety
const edits = [
  ['padding: 24px;', 'padding: 18px;'],
  ['minmax(260px, 340px) minmax(240px, 1fr) minmax(260px, 340px)', 'minmax(195px, 255px) minmax(180px, 1fr) minmax(195px, 255px)'],
  ['gap: 20px;', 'gap: 15px;'],
  ['gap: 60px;', 'gap: 45px;'],
  ['margin-bottom: 24px;', 'margin-bottom: 18px;'],
  ['border-radius: 24px;', 'border-radius: 18px;'],
  ['padding: 18px;', 'padding: 14px;'],
  ['border-radius: 16px;', 'border-radius: 12px;'],
  ['margin: 0 18px;', 'margin: 0 14px;'],
  ['gap: 14px;', 'gap: 10px;'],
  ['margin-bottom: 16px;', 'margin-bottom: 12px;'],
  ['font-size: 1.05rem;', 'font-size: 0.8rem;'],
  ['margin-top: 18px;', 'margin-top: 14px;'],
  ['margin-bottom: 10px;', 'margin-bottom: 8px;'],
  ['font-size: 0.95rem;', 'font-size: 0.7rem;'],
  ['gap: 8px;', 'gap: 6px;'],
  ['margin-bottom: 12px;', 'margin-bottom: 9px;'],
  ['padding: 8px 12px;', 'padding: 6px 9px;'],
  ['border-radius: 12px;', 'border-radius: 9px;'],
  ['grid-template-columns: 52px 28px 1fr auto;', 'grid-template-columns: 40px 22px 1fr auto;'],
  ['gap: 10px;', 'gap: 8px;'],
  ['padding: 10px 12px;', 'padding: 8px 9px;'],
  ['border-radius: 14px;', 'border-radius: 10px;'],
  ['margin-top: 8px;', 'margin-top: 6px;'],
  ['font-size: 1.1rem;', 'font-size: 0.85rem;'],
  ['min-height: 260px;', 'min-height: 195px;'],
  ['font-size: 0.82rem;', 'font-size: 0.62rem;'],
  ['font-size: clamp(2.4rem, 5vw, 4.8rem);', 'font-size: clamp(1.8rem, 3.75vw, 3.6rem);'],
  ['width: 64px;', 'width: 48px;'],
  ['height: 64px;', 'height: 48px;'],
  ['font-size: 1.2rem;', 'font-size: 0.9rem;'],
  ['margin: 0 0 2px;', 'margin: 0 0 1px;'],
  ['font-size: 0.78rem;', 'font-size: 0.6rem;'],
  ['min-height: 44px;', 'min-height: 33px;'],
  ['padding: 0 14px;', 'padding: 0 10px;'],
  ['padding: 20px;', 'padding: 15px;'],
  ['font-size: 1.35rem;', 'font-size: 1rem;'],
  ['padding: 14px 0 0;', 'padding: 10px 0 0;'],
  ['font-size: 0.9rem;', 'font-size: 0.7rem;'],
  ['font-size: 0.72rem;', 'font-size: 0.55rem;'],
  ['padding: 7px 11px;', 'padding: 5px 8px;'],
  ['padding: 6px 12px;', 'padding: 4px 9px;'],
  ['border-radius: 10px;', 'border-radius: 8px;'],
];

for (let [oldStr, newStr] of edits) {
   // Global replace because some properties happen repeatedly
   css = css.split(oldStr).join(newStr);
}

// Any missed rems? Let's check some manually forgotten
css = css.replace(/color: rgba\(244, 247, 251, 0.68\);/g, 'color: rgba(244, 247, 251, 0.68);\n    font-size: 0.65rem;');
css = css.replace(/\.profile-card small \{\n  color/g, '.profile-card small {\n  font-size: 0.65rem;\n  color');

fs.writeFileSync('src/app/home/home.page.scss', css);
console.log('Scaled home.page.scss done');
