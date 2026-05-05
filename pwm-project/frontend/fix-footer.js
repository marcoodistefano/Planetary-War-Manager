const fs = require('fs');

const globalCssPath = 'src/global.scss';
let globalCss = fs.readFileSync(globalCssPath, 'utf8');
globalCss = globalCss.replace(/position: absolute;\s*bottom: 0;\s*left: 0;\s*width: 100%;\s*z-index: 100;/, 'width: 100%;\n  z-index: 100;');
fs.writeFileSync(globalCssPath, globalCss);

const homeCssPath = 'src/app/home/home.page.scss';
let homeCss = fs.readFileSync(homeCssPath, 'utf8');
homeCss = homeCss.replace(/justify-content: space-between;/, 'justify-content: center;\n  gap: 60px;');
homeCss = homeCss.replace(/margin-top: auto;/, 'margin-top: 0;');
fs.writeFileSync(homeCssPath, homeCss);

const footerHtml = `<ion-footer class="ion-no-border">
  <div class="hud-footer transparent-element" style="border-top: 1px solid rgba(88, 166, 255, 0.2);">
    <div class="hud-footer-content">
      <div class="footer-left">
        <span class="status-dot"></span> COMM-LINK: <span class="status-text">ONLINE</span>
      </div>
      <div class="footer-center">
        &copy; 2026 PLANETARY WAR MANAGER <span class="divider">///</span> STRATEGIC COMMAND
      </div>
      <div class="footer-right">
        SYS.VER 1.0.4
      </div>
    </div>
  </div>
</ion-footer>`;

const files = [
  'src/app/home/home.page.html',
  'src/app/auth/login/login.page.html',
  'src/app/auth/recover-password/recover-password.page.html',
  'src/app/auth/register/register.page.html'
];

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  // Aggressively remove any leftover div.hud-footer from previous run
  content = content.replace(/<div class="hud-footer[^>]*>[\s\S]*?SYS\.VER 1\.0\.4\s*<\/div>\s*<\/div>\s*<\/div>/g, '');
  content = content.replace(/<ion-footer[\s\S]*?<\/ion-footer>/g, '');
  
  // Make sure only ONE footer is injected
  content = content.replace('</ion-content>', '</ion-content>\n' + footerHtml);
  fs.writeFileSync(f, content);
});
console.log("Footer fixed.");
