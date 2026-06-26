const fs = require('fs');

// --- home.ts ---
let homeTs = fs.readFileSync('src/app/home/home.ts', 'utf8');
if (!homeTs.includes('shareReplay')) {
  homeTs = homeTs.replace(/import \{ Observable \} from 'rxjs';/, `import { Observable } from 'rxjs';\nimport { shareReplay } from 'rxjs/operators';`);
  homeTs = homeTs.replace(
    /  getDashboardData\(\): Observable<ApiResponse> \{\r?\n    return this\.http\.get<ApiResponse>\(this\.apiUrl, \{ withCredentials: true \}\);\r?\n  \}/,
`  private dashboardData$: Observable<ApiResponse> | null = null;

  getDashboardData(forceRefresh = false): Observable<ApiResponse> {
    if (!this.dashboardData$ || forceRefresh) {
      this.dashboardData$ = this.http.get<ApiResponse>(this.apiUrl, { withCredentials: true }).pipe(
        shareReplay(1)
      );
    }
    return this.dashboardData$;
  }`
  );
  fs.writeFileSync('src/app/home/home.ts', homeTs, 'utf8');
}

// --- home.page.ts ---
let homePage = fs.readFileSync('src/app/home/home.page.ts', 'utf8');

// Update loadDashboardData definition
if (homePage.includes('loadDashboardData() {')) {
  homePage = homePage.replace(/loadDashboardData\(\) \{/, 'loadDashboardData(forceRefresh = false) {');
  homePage = homePage.replace(/this\.homeService\.getDashboardData\(\)\.subscribe\(\{/, 'this.homeService.getDashboardData(forceRefresh).subscribe({');
}

// Replace pollingInterval
if (!homePage.includes('private startPolling()')) {
  homePage = homePage.replace(/  ngOnInit\(\) \{[\s\S]*?\}\r?\n/, `  ngOnInit() {
    this.titleService.setTitle('PWM | Homepage');
    this.refreshLastJoinedMatch();
    this.loadDashboardData(); // Carica i dati dal backend all'avvio
    this.loadJoinableMatches();
    this.loadCountryFlags();

    this.avatarSub = this.userState.avatarId$.subscribe((id) => {
      if (id) this.currentPlayer.avatar = this.avatarPath(id);
    });
  }
`);

  homePage = homePage.replace(/  ionViewWillEnter\(\) \{[\s\S]*?\}\r?\n/, `  ionViewWillEnter() {
    this.refreshLastJoinedMatch();
    this.loadDashboardData();
    this.loadJoinableMatches();
    this.startPolling();
  }

  ionViewWillLeave() {
    this.stopPolling();
  }

  private startPolling() {
    this.stopPolling();
    this.pollingInterval = setInterval(() => {
      this.loadDashboardData(true);
      this.loadJoinableMatches();
    }, 120000);
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
`);

  homePage = homePage.replace(/  ngOnDestroy\(\) \{[\s\S]*?\}\r?\n/, `  ngOnDestroy() {
    this.stopPolling();
    if (this.avatarSub) this.avatarSub.unsubscribe();
  }
`);

  // Fix loadCountryFlags
  homePage = homePage.replace(/  async loadCountryFlags\(\) \{[\s\S]*?    \} catch \(error\) \{\r?\n      console\.error\('Errore nel caricamento delle nazioni per la homepage:', error\);\r?\n    \}\r?\n  \}\r?\n/, `  async loadCountryFlags() {
    const CACHE_KEY = 'pwm_country_flags';
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) { this.countryFlagsMap = JSON.parse(cached); return; }
    try {
      const res = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,translations');
      const data = await res.json();
      const newMap: Record<string, string> = {};
      data.forEach((country: any) => {
        newMap[country.cca2] = country.translations?.ita?.common || country.name.common;
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(newMap));
      this.countryFlagsMap = newMap;
    } catch (e) { console.error('Errore bandiere:', e); }
  }
`);
  fs.writeFileSync('src/app/home/home.page.ts', homePage, 'utf8');
}

// --- leaderboard.page.ts ---
let leaderboardPage = fs.readFileSync('src/app/leaderboard/leaderboard.page.ts', 'utf8');
if (leaderboardPage.includes('this.loadData(true);') && !leaderboardPage.includes('loadData(forceRefresh = false)')) {
  leaderboardPage = leaderboardPage.replace(/  loadData\(\) \{/, '  loadData(forceRefresh = false) {');
  leaderboardPage = leaderboardPage.replace(/this\.homeService\.getDashboardData\(\)\.subscribe\(\{/, 'this.homeService.getDashboardData(forceRefresh).subscribe({');
  fs.writeFileSync('src/app/leaderboard/leaderboard.page.ts', leaderboardPage, 'utf8');
}

console.log('Script done');
