const fs = require('fs');

const homeCssPath = 'src/app/home/home.page.scss';
let css = fs.readFileSync(homeCssPath, 'utf8');

css = css.replace(/rotateY\(15deg\)/g, 'rotateY(5deg) translateX(3vw)');
css = css.replace(/rotateY\(-15deg\)/g, 'rotateY(-5deg) translateX(-3vw)');

// Just in case it wasn't 15deg
css = css.replace(/transform: rotateY\(5deg\);/g, 'transform: rotateY(5deg) translateX(4vw);');
css = css.replace(/transform: rotateY\(-5deg\);/g, 'transform: rotateY(-5deg) translateX(-4vw);');

css = css.replace(/transform: rotateY\(2deg\);/g, 'transform: rotateY(2deg) translateX(4vw);');
css = css.replace(/transform: rotateY\(-2deg\);/g, 'transform: rotateY(-2deg) translateX(-4vw);');

fs.writeFileSync(homeCssPath, css);
console.log('Fixed transform');
