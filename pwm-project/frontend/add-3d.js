const fs = require('fs');
const homeCssPath = 'src/app/home/home.page.scss';
let css = fs.readFileSync(homeCssPath, 'utf8');

// Add perspective to top-row
css = css.replace('.top-row {', '.top-row {\n  perspective: 2000px;');

// Add 3D transforms
css += `
/* ==========================================================================
   3D SCI-FI LAYOUT
   ========================================================================== */
.left-column.panel {
  transform: rotateY(5deg);
  transform-origin: right center;
  transition: transform 0.4s ease-out, box-shadow 0.4s ease-out;
  box-shadow: 20px 10px 30px rgba(0, 0, 0, 0.2) !important;
}
.left-column.panel:hover {
  transform: rotateY(2deg);
  box-shadow: 10px 10px 30px rgba(0, 0, 0, 0.25) !important;
}

.right-column.panel {
  transform: rotateY(-5deg);
  transform-origin: left center;
  transition: transform 0.4s ease-out, box-shadow 0.4s ease-out;
  box-shadow: -20px 10px 30px rgba(0, 0, 0, 0.2) !important;
}
.right-column.panel:hover {
  transform: rotateY(-2deg);
  box-shadow: -10px 10px 30px rgba(0, 0, 0, 0.25) !important;
}

/* Ensure center buttons are completely centered */
.center-column {
  justify-content: center !important;
}
.games-container.buttons-bottom {
  margin-top: 0 !important;
  margin-bottom: 0 !important;
}
`;

fs.writeFileSync(homeCssPath, css);
console.log('3D styling added.');
