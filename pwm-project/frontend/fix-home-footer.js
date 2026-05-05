const fs = require('fs');

const scssPath = 'src/global.scss';
let scss = fs.readFileSync(scssPath, 'utf8');

// Ensure the global hud-footer isn't conflicting and isn't obscured
scss = scss.replace(/position: absolute;.*z-index: 100;/g, 'z-index: 100;');
fs.writeFileSync(scssPath, scss);

// Remove absolute positioning from the footer if it's there
console.log("Global SCSS rules checked.");
