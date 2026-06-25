const fs = require('fs');

const homePath = 'pwm-project/frontend/src/app/home/home.page.html';
let homeContent = fs.readFileSync(homePath, 'utf8');

// Replace left column and right column using regex
homeContent = homeContent.replace(
  /<aside class="panel leaderboard-panel">[\s\S]*?<\/aside>/,
  (match) => `
      <!-- COLONNA SINISTRA -->
      <div class="panel left-column">
        <aside class="leaderboard-panel inner-panel">
${match.replace('<aside class="panel leaderboard-panel">', '').replace('</aside>', '').replace(/class="leaderboard-entry"/g, 'class="leaderboard-entry transparent-element"').replace(/class="leaderboard-entry secondary"/g, 'class="leaderboard-entry secondary transparent-element"')}
        </aside>
`
);

homeContent = homeContent.replace(
  /<section class="bottom-section panel">[\s\S]*?<h2>Ultime 5 partite attive<\/h2>[\s\S]*?<\/section>/,
  (match) => `
        <hr class="panel-divider" />
        <section class="bottom-section inner-panel" style="flex: 1;">
${match.replace('<section class="bottom-section panel">', '').replace('</section>', '').replace(/class="game-card"/g, 'class="game-card transparent-element"')}
        </section>
      </div>
`
);

homeContent = homeContent.replace(
  /<div class="title-block">[\s\S]*?<\/div>\s*<aside class="panel profile-panel">/,
  (match) => `
      <!-- COLONNA CENTRALE -->
      <div class="center-column">
        <div class="title-block">
          <p class="eyebrow">Strategia, alleanze, conquista</p>
          <h1>Planetary War Manager</h1>
        </div>

        <div class="games-container buttons-bottom">
          <div class="games-actions">
            <button type="button" class="primary-button">Crea nuova partita</button>
            <button type="button" class="ghost-button">Vedi tutte le partite attive</button>
            <button type="button" class="ghost-button">Partite terminate ({{ finishedGames }})</button>
          </div>
        </div>
      </div>

      <!-- COLONNA DESTRA -->
      <div class="panel right-column">
        <aside class="profile-panel inner-panel">
`
);

// We need to make profile actions transparent
homeContent = homeContent.replace(
  /<button type="button" \*ngFor="let action of quickActions">/g,
  '<button type="button" class="transparent-element" *ngFor="let action of quickActions">'
);
homeContent = homeContent.replace(
  /<div class="avatar">/g,
  '<div class="avatar transparent-element">'
);

homeContent = homeContent.replace(
  /<section class="bottom-section panel">[\s\S]*?<h2>Ultime partite create<\/h2>[\s\S]*?<\/section>/,
  (match) => `
        <hr class="panel-divider" />
        <section class="bottom-section inner-panel" style="flex: 1;">
${match.replace('<section class="bottom-section panel">', '').replace('</section>', '').replace(/class="game-card"/g, 'class="game-card transparent-element"').replace(/class="glass-searchbar"/g, 'class="glass-searchbar transparent-element"').replace(/class="join-button"/g, 'class="join-button transparent-element"')}
        </section>
      </div>
`
);

// Remove the old games-container since we moved it above
homeContent = homeContent.replace(
  /<div class="games-container">[\s\S]*?<\/div>\s*<\/div>\s*<div class="bottom-grid">/g,
  ''
);

// Remove <div class="bottom-grid">, since we now have everything in top-row
homeContent = homeContent.replace(
  /<div class="bottom-grid">/,
  ''
);

// Remove the matching closing div for bottom-grid
homeContent = homeContent.replace(
  /<\/div>\s*<\/div>\s*<\/ion-content>/,
  '  </div>\n</ion-content>'
);

const footer = fs.readFileSync('pwm-project/frontend/src/app/footer.html', 'utf8');

// Insert footer to all 4 pages
['pwm-project/frontend/src/app/home/home.page.html', 
 'pwm-project/frontend/src/app/auth/login/login.page.html', 
 'pwm-project/frontend/src/app/auth/recover-password/recover-password.page.html', 
 'pwm-project/frontend/src/app/auth/register/register.page.html']
.forEach(f => {
   let c = f === homePath ? homeContent : fs.readFileSync(f, 'utf8');
   c = c.replace('</ion-content>', footer + '\n</ion-content>');
   fs.writeFileSync(f, c);
});

