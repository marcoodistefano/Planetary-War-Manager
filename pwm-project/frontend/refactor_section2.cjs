const fs = require('fs');

// --- HomeService ---
let homeService = fs.readFileSync('src/app/home/home.ts', 'utf8');
homeService = homeService.replace(
  /  getDashboardData\(\): Observable<ApiResponse> \{\r?\n    return this\.http\.get<ApiResponse>\(this\.apiUrl, \{ withCredentials: true \}\);\r?\n  \}/,
`  private dashboardData$: Observable<ApiResponse> | null = null;

  getDashboardData(forceRefresh = false): Observable<ApiResponse> {
    if (!this.dashboardData$ || forceRefresh) {
      this.dashboardData$ = this.http.get<ApiResponse>(this.apiUrl, { withCredentials: true }).pipe(
        import_rxjs_operators.shareReplay(1)
      );
    }
    return this.dashboardData$;
  }`
);
if (!homeService.includes('shareReplay')) {
  homeService = `import * as import_rxjs_operators from 'rxjs/operators';\n` + homeService;
}
fs.writeFileSync('src/app/home/home.ts', homeService, 'utf8');


// --- HomePage ---
let homePage = fs.readFileSync('src/app/home/home.page.ts', 'utf8');
homePage = homePage.replace(/  private pollingInterval: any;\r?\n/, '');

// Add startPolling/stopPolling and properties
homePage = homePage.replace(/  constructor\(/, `  private pollingInterval: any;
  private dynamicRegionMap: Record<string, string> = {};

  constructor(`);

// Replace ngOnInit
homePage = homePage.replace(/  ngOnInit\(\) \{[\s\S]*?\}\r?\n/, `  ngOnInit() {
    this.titleService.setTitle('PWM | Homepage');
    this.loadCountryFlags();
    this.avatarSub = this.userState.avatarId$.subscribe((id) => {
      if (id) this.currentPlayer.avatar = this.avatarPath(id);
    });
  }
`);

// Add ionViewWillEnter, ionViewWillLeave, startPolling, stopPolling
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

// Replace loadCountryFlags
homePage = homePage.replace(/  async loadCountryFlags\(\) \{[\s\S]*?\}\r?\n/, `  async loadCountryFlags() {
    const CACHE_KEY = 'pwm_country_flags';
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) { this.dynamicRegionMap = JSON.parse(cached); this.loadData(); return; }
    try {
      const res = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,translations');
      const data = await res.json();
      const newMap: Record<string, string> = {};
      data.forEach((country: any) => {
        newMap[country.cca2] = country.translations?.ita?.common || country.name.common;
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(newMap));
      this.dynamicRegionMap = newMap;
      this.loadData();
    } catch (e) { console.error('Errore bandiere:', e); this.loadData(); }
  }
`);

// Replace ngOnDestroy
homePage = homePage.replace(/  ngOnDestroy\(\) \{[\s\S]*?\}\r?\n/, `  ngOnDestroy() {
    this.stopPolling();
    this.avatarSub?.unsubscribe();
  }
`);

// Update loadDashboardData to pass forceRefresh to getDashboardData
homePage = homePage.replace(/  loadDashboardData\(\) \{\r?\n    this\.homeService\.getDashboardData\(\)/, `  loadDashboardData(forceRefresh = false) {
    this.homeService.getDashboardData(forceRefresh)`);

fs.writeFileSync('src/app/home/home.page.ts', homePage, 'utf8');


// --- LeaderboardPage ---
let leaderboardPage = fs.readFileSync('src/app/leaderboard/leaderboard.page.ts', 'utf8');

// Replace ngOnInit
leaderboardPage = leaderboardPage.replace(/  ngOnInit\(\) \{[\s\S]*?\}\r?\n/, `  ngOnInit() {
    this.titleService.setTitle('PWM | Leaderboard');
    this.loadCountryFlags();
    this.avatarSub = this.userState.avatarId$.subscribe(() => undefined);
  }
`);

// Add ionViewWillEnter, ionViewWillLeave, startPolling, stopPolling
leaderboardPage = leaderboardPage.replace(/  ionViewDidEnter\(\) \{\r?\n    this\.playBackgroundVideo\(\);\r?\n  \}\r?\n/, `  ionViewDidEnter() {
    this.playBackgroundVideo();
  }

  ionViewWillEnter() {
    this.loadData();
    this.startPolling();
  }
`);

leaderboardPage = leaderboardPage.replace(/  ionViewWillLeave\(\) \{\r?\n    if \(this\.pollingInterval\) \{\r?\n      clearInterval\(this\.pollingInterval\);\r?\n    \}\r?\n  \}\r?\n/, `  ionViewWillLeave() {
    this.stopPolling();
  }

  private startPolling() {
    this.stopPolling();
    this.pollingInterval = setInterval(() => {
      this.loadData(true);
    }, 120000);
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
`);

// Replace loadCountryFlags
leaderboardPage = leaderboardPage.replace(/  async loadCountryFlags\(\) \{[\s\S]*?\}\r?\n/, `  async loadCountryFlags() {
    const CACHE_KEY = 'pwm_country_flags';
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) { this.dynamicRegionMap = JSON.parse(cached); this.loadData(); return; }
    try {
      const res = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,translations');
      const data = await res.json();
      const newMap: Record<string, string> = {};
      data.forEach((country: any) => {
        newMap[country.cca2] = country.translations?.ita?.common || country.name.common;
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(newMap));
      this.dynamicRegionMap = newMap;
      this.loadData();
    } catch (e) { console.error('Errore bandiere:', e); this.loadData(); }
  }
`);

// Replace ngOnDestroy
leaderboardPage = leaderboardPage.replace(/  ngOnDestroy\(\) \{[\s\S]*?\}\r?\n/, `  ngOnDestroy() {
    this.stopPolling();
    this.avatarSub?.unsubscribe();
  }
`);

fs.writeFileSync('src/app/leaderboard/leaderboard.page.ts', leaderboardPage, 'utf8');

console.log('Done refactoring Section 2');
