import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, MenuController, ToastController } from '@ionic/angular'; // <--- AGGIUNTO MenuController
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { HomeService } from '../../home/home';
import { AuthApiService } from '../../auth/auth-api.service';
import { UserStateService } from '../../user-state.service';

// Componenti
import { ProfileModalComponent } from '../components/profile-modal/profile-modal.component';
import { DiplomacyModalComponent } from '../components/diplomacy-modal/diplomacy-modal.component';
import { IntelligenceModalComponent } from '../components/intelligence-modal/intelligence-modal.component';
import { InGameChatComponent } from '../components/in-game-chat/in-game-chat.component';
import { TechTreeComponent } from '../components/tech-tree/tech-tree.component';
import { MarketModalComponent } from '../components/market-modal/market-modal.component';
import { ArmyModalComponent } from '../components/army-modal/army-modal.component';

// Librerie esterne caricate via CDN o definite globalmente
declare var maplibregl: any;
declare var topojson: any;
declare var THREE: any;

const AVATAR_ASSET_VERSION = '20260517';

@Component({
  selector: 'app-match',
  templateUrl: './match.page.html',
  styleUrls: ['./match.page.scss'],
  standalone: true,
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    ProfileModalComponent,
    DiplomacyModalComponent,
    IntelligenceModalComponent,
    InGameChatComponent,
    TechTreeComponent,
    MarketModalComponent,
    ArmyModalComponent
  ]
})
export class MatchPage implements OnInit, AfterViewInit, OnDestroy {

  // --- 1. PROPRIETÀ E STATO DELLA MAPPA ---
  map: any;
  isGlobe = false;
  MAPTILER_KEY = 'PGAzmQH2OduY9E8gSi6n';
  hoveredState = { id: null as any, source: null as any };
  currentHoveredName = '';
  selectedPointName = '';
  selectedPointCoords = '--';
  selectedPointLngLat: [number, number] | null = null;
  activePopup: any = null;
  popupTimer: any = null;

  // WebSocket State
  matchSocket?: WebSocket;
  private reconnectTimer?: number;
  private shouldReconnect = true;

  private touchTimer: any;
  private avatarSub?: Subscription;
  isTouchLayout = false;

  // --- 2. STATO DELL'INTERFACCIA (UI) ---
  isProfileModalOpen = false;
  isMapSettingsOpen = false;

  // Gestione modali sovrapposte
  isBuildPanelOpen = false;
  isTechModalOpen = false;
  isDiplomacyModalOpen = false;
  isIntelligenceModalOpen = false;
  isChatOpen = false;
  isMarketModalOpen = false;
  isArmyModalOpen = false;
  armyModalInitialTab: 'management' | 'operations' = 'management';
  isTroopsDropdownOpen = false;
  troopsDropdownX = 0;
  troopsDropdownY = 0;
  matchArmies: any[] = [];
  armyMarkers = new Map<string, any>(); // Ripristinato per i marker HTML
  nodesGeoData: any = null; // Per i tether
  armyHoverPopup: any = null; // Per l'hover di 3 secondi
  isFirstArmyRender = true;
  matchNations: any[] = [];
  regionsGeoData: any = null;
  nationMarkers: any[] = [];
  chatUnreadCount = 0;
  currentMatchId = '';
  matchPlayers: string[] = [];
  matchAlliances: any[] = [];

  activeBuildCategory: 'risorse' | 'armamenti' = 'risorse';

  // --- 3. DATI DI GIOCO E REGOLE ---
  gameRules: any = null;

  playerResources: any = {
    denaro: 100000, legno: 5000, piombo: 2500, acciaio: 3000,
    mattoni: 4000, petrolio: 1500, gas_naturale: 1200, uranio: 100, oro: 50
  };

  userProfile = {
    username: 'Caricamento...',
    rank: 'Generale di Brigata',
    experience: 85, matchesWon: 24, matchesLost: 5, kdRatio: '4.8',
    avatar: this.avatarPath(1)
  };

  playerTroops: any = {
    "Fante": 150, "Veicolo Leggero": 20, "Fanteria Speciale": 10,
    "Carro Armato": 5, "Caccia": 2, "Missile Balistico": 1
  };

  // --- 4. CONFIGURAZIONI STATICHE ---
  resourceConfig = [
    { id: 'denaro', icon: '💵', label: 'DENARO' },
    { id: 'legno', icon: '🪵', label: 'LEGNO' },
    { id: 'piombo', icon: '🔘', label: 'PIOMBO' },
    { id: 'acciaio', icon: '🏗️', label: 'ACCIAIO' },
    { id: 'mattoni', icon: '🧱', label: 'MATTONI' },
    { id: 'petrolio', icon: '🛢️', label: 'PETROLIO' },
    { id: 'gas_naturale', icon: '🔥', label: 'GAS NATURALE' },
    { id: 'uranio', icon: '☢️', label: 'URANIO' },
    { id: 'truppe', icon: '👥', label: 'UNITÀ', isTrigger: true },
    { id: 'oro', icon: '🪙', label: 'ORO' }
  ];

  // Aggiungi questo oggetto sotto playerResources
  resourceProduction: any = {
    denaro: 1250,
    legno: 450,
    piombo: 120,
    acciaio: 300,
    mattoni: 200,
    petrolio: 80,
    gas_naturale: 150,
    uranio: 5,
    oro: 0 // L'oro solitamente non ha produzione oraria
  };

  modelDB: any = {
    land: [{ label: 'Soldato', path: 'land_troops/soldier.glb' }],
    sea: [{ label: 'Cacciatorpediniere', path: 'sea_troops/cacciatorpediniere.glb' }],
    air: [{ label: 'Aereo Cargo', path: 'air_troops/aereo_cargo.glb' }]
  };

  // Aggiungi queste proprietà alla classe MatchPage
  isRadialMenuVisible = false;
  radialMenuX = 0;
  radialMenuY = 0;
  radialMenuOpenedAt = 0;

  // All'interno di ngOnInit o in una funzione di inizializzazione
  initRadialListeners() {
    const mapEl = document.getElementById('map-container');

    if (mapEl) {
      mapEl.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault(); // Blocca il menu standard del browser

        this.radialMenuX = e.clientX;
        this.radialMenuY = e.clientY;
        this.isRadialMenuVisible = true;

        // Forza il refresh della UI se necessario
        this.cdr.detectChanges();
      });
    }

    // Chiude il menu se si clicca altrove con il tasto sinistro
    window.addEventListener('click', () => {
      if (this.isRadialMenuVisible) this.isRadialMenuVisible = false;
    });
  }

  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private modalCtrl: ModalController,
    private menuCtrl: MenuController,
    private toastCtrl: ToastController,
    private route: ActivatedRoute,
    private homeService: HomeService,
    private authApi: AuthApiService,
    private userState: UserStateService
  ) { }

  ngOnInit() {
    this.currentMatchId = this.route.snapshot.paramMap.get('id') || localStorage.getItem('pwm_last_joined_match') || '';
    this.loadGameRules();
    this.loadUserProfile();
    this.loadMatchContext();
    this.isTouchLayout = this.isTouchViewport();
    this.avatarSub = this.userState.avatarId$.subscribe((avatarId) => {
      this.userProfile = {
        ...this.userProfile,
        avatar: this.avatarPath(avatarId)
      };
      this.cdr.detectChanges();
    });

    if (this.currentMatchId) {
      this.connectMatchSocket();
    }

    window.addEventListener('click', () => {
      if (this.isRadialMenuVisible) {
        this.isRadialMenuVisible = false;
        this.cdr.detectChanges();
      }

      if (this.isTroopsDropdownOpen) {
        this.isTroopsDropdownOpen = false;
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.matchSocket?.close();

    if (this.avatarSub) {
      this.avatarSub.unsubscribe();
    }

    // Fix: Previeni Memory Leak del WebGL Context
    if (this.map) {
      this.map.remove();
    }
  }

  ionViewWillEnter() {
    this.loadGameRules();
    this.loadUserProfile();
    this.loadMatchContext();
    this.preloadTroopImages();
  }

  private preloadTroopImages() {
    const images = ['soldier_front.png', 'soldier_back.png', 'soldier_side.png'];
    images.forEach(img => {
      const i = new Image();
      i.src = `/assets/2Dmodels/Land_troops/Soldier/${img}`;
    });
  }

  private getGatewayWsBaseUrl(): string {
    // Ritorna ws://localhost:4000
    return window.location.origin.replace(/^http(s?):\/\//i, 'ws$1://');
  }

  private connectMatchSocket() {
    if (!this.currentMatchId) return;

    const wsBaseUrl = this.getGatewayWsBaseUrl();
    const wsUrl = `${wsBaseUrl}/match/${encodeURIComponent(this.currentMatchId)}`;

    try {
      console.log(`[WS_MATCH] Tentativo di connessione a ${wsUrl}`);
      this.matchSocket = new WebSocket(wsUrl);

      this.matchSocket.onopen = () => {
        console.log('[WS_MATCH] Connessione al server di gioco stabilita.');
        this.matchSocket?.send(JSON.stringify({ action: 'GET_INITIAL_STATE' }));
        this.cdr.detectChanges();
      };

      this.matchSocket.onmessage = (event) => {
        let parsed;
        try {
          parsed = JSON.parse(event.data);
        } catch (e) {
          return;
        }

        console.log('[WS_MATCH] Evento ricevuoto:', parsed);

        if (parsed.type === 'INITIAL_STATE') {
          if (parsed.payload?.armies) {
            this.matchArmies = parsed.payload.armies;
            this.renderArmies();
          }
          if (parsed.payload?.nations) {
            this.matchNations = parsed.payload.nations;
            this.applyTerritoryColors();
          }
          this.cdr.detectChanges();
        }

        if (parsed.type === 'TROOPS_MOVED') {
          const { armyId, targetName, targetCoords, etaMs } = parsed.data;
          const armyIndex = this.matchArmies.findIndex(a => a.id === armyId);
          if (armyIndex !== -1) {
            this.matchArmies[armyIndex].status = 'moving';
            this.matchArmies[armyIndex].targetName = targetName;
            this.matchArmies[armyIndex].targetCoords = targetCoords;
          }
          console.log(`[WS_MATCH] Movimento in corso verso ${targetName}. Arrivo stimato: ${etaMs}ms`);
          this.renderArmies();
          this.cdr.detectChanges();
        }

        if (parsed.type === 'TROOPS_SPAWNED') {
          const { userId, army } = parsed.data;
          // In the future, we could check if userId matches local user. 
          // For now, we append it to matchArmies so it renders on map.
          this.matchArmies.push(army);
          console.log(`[WS_MATCH] Nuova truppa generata a Palermo per l'utente ${userId}!`);
          this.renderArmies();
          this.cdr.detectChanges();
        }

        if (parsed.type === 'PLAYER_JOINED') {
          console.log(`[WS_MATCH] Un nuovo giocatore si è unito: ${parsed.payload.newPlayer}`);
          if (parsed.payload?.nations) {
            this.matchNations = parsed.payload.nations;
            this.applyTerritoryColors();
          }
          this.cdr.detectChanges();
        }

        if (parsed.type === 'TERRITORY_CONQUERED' || parsed.type === 'DIPLOMACY_UPDATED') {
          console.log(`[WS_MATCH] Aggiornamento mappa (${parsed.type})`);
          if (parsed.payload?.nations) {
            this.matchNations = parsed.payload.nations;
            this.applyTerritoryColors();
          }
          this.cdr.detectChanges();
        }

        if (parsed.type === 'ALLIANCE_UPDATED') {
          console.log(`[WS_MATCH] Aggiornamento alleanze (${parsed.type})`);
          this.reloadMatchAlliances();
        }
      };

      this.matchSocket.onerror = (error) => {
        console.error('[WS_MATCH] Errore di connessione:', error);
      };

      this.matchSocket.onclose = (event) => {
        console.log('[WS_MATCH] Connessione chiusa', event.code, event.reason);
        if (this.shouldReconnect) {
          console.log('[WS_MATCH] Riconnessione in corso tra 3 secondi...');
          this.reconnectTimer = window.setTimeout(() => this.connectMatchSocket(), 3000);
        }
      };
    } catch (error) {
      console.error('[WS_MATCH] Eccezione durante la connessione:', error);
    }
  }

  private loadMatchContext() {
    this.reloadMatchAlliances();

    this.homeService.getDashboardData().subscribe({
      next: (response: any) => {
        const info = response?.data;
        const matchEntry = this.findCurrentMatchEntry(info);
        const dashboardPlayers = this.extractPlayersFromMatchEntry(matchEntry);

        if (!this.currentMatchId) {
          this.matchPlayers = dashboardPlayers.length > 0 ? dashboardPlayers : [];
          this.cdr.detectChanges();
          return;
        }

        this.homeService.getMatchPlayers(this.currentMatchId).subscribe({
          next: (playersResponse: any) => {
            const players: any[] = Array.isArray(playersResponse?.players) ? playersResponse.players : [];
            const playerNames: string[] = players
              .map((entry: any) => String(entry?.username || entry?.name || entry?.player || '').trim())
              .filter((name: string): name is string => Boolean(name));

            this.matchPlayers = playerNames.length > 0
              ? [...new Set(playerNames)]
              : (dashboardPlayers.length > 0 ? dashboardPlayers : []);

            this.cdr.detectChanges();
          },
          error: () => {
            this.matchPlayers = dashboardPlayers.length > 0 ? dashboardPlayers : [];
            this.cdr.detectChanges();
          }
        });
      },
      error: (error) => {
        console.error('Errore nel recupero dei dati partita per la chat:', error);
      }
    });
  }

  reloadMatchAlliances() {
    if (!this.currentMatchId) {
      this.matchAlliances = [];
      this.applyTerritoryColors();
      return;
    }

    this.homeService.getMatchAlliance(this.currentMatchId).subscribe({
      next: (response: any) => {
        this.matchAlliances = Array.isArray(response?.alliances) ? response.alliances : [];
        this.applyTerritoryColors();
        this.cdr.detectChanges();
      },
      error: () => {
        this.matchAlliances = [];
        this.applyTerritoryColors();
        this.cdr.detectChanges();
      }
    });
  }

  get currentAlliance() {
    return this.findCurrentAlliance();
  }

  get currentAllianceId(): string | null {
    const alliance = this.currentAlliance;
    const allianceId = String(alliance?.id_alleanza ?? '').trim();
    return allianceId || null;
  }

  get currentAllianceLabel(): string {
    return String(this.currentAlliance?.nome_alleanza || 'ALLEANZA');
  }

  private findCurrentAlliance() {
    const currentUser = String(this.userProfile.username || '').trim().toLowerCase();
    if (!currentUser || !Array.isArray(this.matchAlliances) || this.matchAlliances.length === 0) {
      return null;
    }

    return this.matchAlliances.find((alliance: any) =>
      Array.isArray(alliance?.members) && alliance.members.some((member: string) => String(member || '').trim().toLowerCase() === currentUser),
    ) || null;
  }

  private findCurrentMatchEntry(info: any) {
    const allMatches = [
      ...(info?.match_attivi ? Object.values(info.match_attivi) : []),
      ...(info?.last_created_match ? Object.values(info.last_created_match) : []),
    ];

    const normalizedMatchId = String(this.currentMatchId || '').trim();
    if (!normalizedMatchId) {
      return null;
    }

    return allMatches.find((match: any) => {
      const candidates = [
        match?.id_partita_visualizzato,
        match?.id_partita_hash,
        match?.id_partita,
        match?.routeId,
        match?.joinId,
        match?.matchId,
      ].filter(Boolean).map((value) => String(value).trim());

      return candidates.includes(normalizedMatchId);
    }) || null;
  }

  private extractPlayersFromMatchEntry(matchEntry: any): string[] {
    if (!matchEntry) {
      return [];
    }

    const candidateFields = [
      matchEntry.players,
      matchEntry.playerNames,
      matchEntry.player_names,
      matchEntry.participants,
      matchEntry.partecipanti,
      matchEntry.members,
      matchEntry.users,
    ];

    const names: string[] = [];

    for (const field of candidateFields) {
      if (!Array.isArray(field)) {
        continue;
      }

      for (const entry of field) {
        let resolvedName = '';

        if (typeof entry === 'string') {
          resolvedName = entry;
        } else if (entry && typeof entry === 'object') {
          const typedEntry = entry as any;
          resolvedName = typedEntry.username || typedEntry.name || typedEntry.player || typedEntry.displayName || typedEntry.username_display || '';
        }

        const normalizedName = String(resolvedName || '').trim();
        if (normalizedName) {
          names.push(normalizedName);
        }
      }
    }

    return [...new Set(names)];
  }

  private loadUserProfile() {
    this.authApi.getProfile().subscribe({
      next: (response: any) => {
        const profile = response?.data?.profile || response?.data?.user_profile || response?.profile || response?.user_profile;
        if (!profile?.username) {
          return;
        }

        const combatStats = response?.data?.combat_stats;

        this.userProfile = {
          ...this.userProfile,
          username: String(profile.username),
          rank: profile.rank || profile.reg || this.userProfile.rank,
          experience: profile.experience ?? this.userProfile.experience,
          avatar: profile.avatar_id ? this.avatarPath(profile.avatar_id) : this.userProfile.avatar,
          matchesWon: combatStats ? Math.round((combatStats.win_rate / 100) * 100) : this.userProfile.matchesWon,
          matchesLost: combatStats ? 100 - Math.round((combatStats.win_rate / 100) * 100) : this.userProfile.matchesLost,
          kdRatio: combatStats && combatStats.deaths ? (combatStats.kills / combatStats.deaths).toFixed(1) : this.userProfile.kdRatio
        };

        if (profile.avatar_id) {
          this.userState.setAvatarId(Number(profile.avatar_id));
        }

        this.cdr.detectChanges();
        this.applyTerritoryColors();
      },
      error: (error) => {
        console.error('Errore nel recupero del profilo utente per il match:', error);
        if (error?.status === 401) {
          this.router.navigate(['/login']);
        }
      }
    });
  }

  private avatarPath(avatarId: number) {
    return `assets/profile_icons/id_${avatarId}.jpeg?v=${AVATAR_ASSET_VERSION}`;
  }

  ngAfterViewInit() {
    // Lasciamo vuoto, l'inizializzazione passa a ionViewDidEnter per attendere il CSS
  }

  ionViewDidEnter() {
    // Chiudiamo menu se rimasti aperti
    this.menuCtrl.close('mobile-tactical-menu').catch(() => { });

    // Inizializza la mappa SOLO se non esiste già
    if (!this.map) {
      setTimeout(() => {
        this.initMap();

        // Un singolo resize assicurativo post-rendering
        setTimeout(() => {
          if (this.map) {
            this.map.resize();
          }
        }, 200);
      }, 50);
    } else {
      // Se esisteva già (es. da cache del router), forza il resize
      this.map.resize();
    }
  }

  // --- AZIONI HUD E CONTROLLI UI ---

  closeMobileMenu() {
    this.menuCtrl.close('mobile-tactical-menu');
  }

  openMobileMenu() {
    this.menuCtrl.enable(true, 'mobile-tactical-menu');
    this.menuCtrl.open('mobile-tactical-menu');
  }

  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
    this.closeMobileMenu();
  }

  goToHome() {
    this.router.navigate(['/home']); // Assicurati che '/' sia il path della tua homepage
  }

  toggleArmyModal() {
    this.isArmyModalOpen = !this.isArmyModalOpen;
    if (this.isArmyModalOpen) {
      this.armyModalInitialTab = 'management';
      this.isBuildPanelOpen = false;
      this.isTechModalOpen = false;
      this.isDiplomacyModalOpen = false;
      this.isIntelligenceModalOpen = false;
      this.isMarketModalOpen = false;
    }
    this.closeMobileMenu();
  }

  openArmyModalFromRadial() {
    this.isArmyModalOpen = true;
    this.armyModalInitialTab = 'operations';
    this.isBuildPanelOpen = false;
    this.isTechModalOpen = false;
    this.isDiplomacyModalOpen = false;
    this.isIntelligenceModalOpen = false;
    this.isMarketModalOpen = false;
    this.closeMobileMenu();
  }

  showArmyHoverBanner(army: any, coordinates: [number, number]) {
    if (this.armyHoverPopup) {
      this.armyHoverPopup.remove();
    }

    const dmg = army.damage || army.dmg_tot || 0;
    const hp = army.hp || army.hp_tot || 100;
    const stato = String(army.status || 'Standby').toUpperCase();

    const popupHtml = `
      <div style="background: rgba(15, 23, 42, 0.9); color: #e2e8f0; padding: 8px 12px; border-radius: 8px; border: 1px solid #334155; font-family: 'JetBrains Mono', monospace; font-size: 11px; backdrop-filter: blur(4px); box-shadow: 0 4px 6px rgba(0,0,0,0.5); width: max-content;">
          <div style="color: #60a5fa; font-weight: bold; margin-bottom: 6px; font-size: 12px; text-transform: uppercase;">${army.name}</div>
          <div style="display: flex; gap: 12px; font-weight: 600;">
              <span><span style="color: #ef4444;">⚔️</span> ATK: ${dmg}</span>
              <span><span style="color: #22c55e;">❤️</span> PV: ${hp}</span>
              <span><span style="color: #f59e0b;">⚡</span> ${stato}</span>
          </div>
      </div>
      `;

    this.armyHoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      anchor: 'bottom',
      offset: [0, -40], // Shift up to appear ABOVE the marker
      className: 'tactical-hover-popup'
    })
      .setLngLat(coordinates)
      .setHTML(popupHtml)
      .addTo(this.map);

    // Rimuoviamo il padding bianco default di maplibre
    const popupContent = this.armyHoverPopup.getElement().querySelector('.maplibregl-popup-content');
    if (popupContent) {
      popupContent.style.padding = '0';
      popupContent.style.background = 'transparent';
      popupContent.style.boxShadow = 'none';
    }
  }

  hideArmyHoverBanner() {
    if (this.armyHoverPopup) {
      this.armyHoverPopup.remove();
      this.armyHoverPopup = null;
    }
  }

  toggleMarketModal() {
    this.isMarketModalOpen = !this.isMarketModalOpen;
    if (this.isMarketModalOpen) {
      this.isBuildPanelOpen = false;
      this.isTechModalOpen = false;
      this.isDiplomacyModalOpen = false;
      this.isIntelligenceModalOpen = false;
      this.isArmyModalOpen = false;
    }
    this.closeMobileMenu();
  }

  toggleTechModal() {
    this.isTechModalOpen = !this.isTechModalOpen;
    if (this.isTechModalOpen) {
      this.isBuildPanelOpen = false;
      this.isDiplomacyModalOpen = false;
      this.isIntelligenceModalOpen = false;
      this.isMarketModalOpen = false;
      this.isArmyModalOpen = false;
    }
    this.closeMobileMenu();
  }

  // Assicurati che gli altri toggle chiudano isTechModalOpen
  toggleBuildPanel() {
    this.isBuildPanelOpen = !this.isBuildPanelOpen;
    if (this.isBuildPanelOpen) { this.isTechModalOpen = false; this.isDiplomacyModalOpen = false; this.isIntelligenceModalOpen = false; this.isMarketModalOpen = false; this.isArmyModalOpen = false; }
    this.closeMobileMenu();
  }

  toggleDiplomacyModal() {
    this.isDiplomacyModalOpen = !this.isDiplomacyModalOpen;
    if (this.isDiplomacyModalOpen) { this.isBuildPanelOpen = false; this.isTechModalOpen = false; this.isIntelligenceModalOpen = false; this.isMarketModalOpen = false; this.isArmyModalOpen = false; }
    this.closeMobileMenu();
  }

  toggleIntelligenceModal() {
    this.isIntelligenceModalOpen = !this.isIntelligenceModalOpen;
    if (this.isIntelligenceModalOpen) { this.isBuildPanelOpen = false; this.isTechModalOpen = false; this.isDiplomacyModalOpen = false; this.isMarketModalOpen = false; this.isArmyModalOpen = false; }
    this.closeMobileMenu();
  }

  toggleMapSettings() { this.isMapSettingsOpen = !this.isMapSettingsOpen; this.closeMobileMenu(); }
  setBuildCategory(cat: 'risorse' | 'armamenti') { this.activeBuildCategory = cat; }
  setOpenProfile(isOpen: boolean) { this.isProfileModalOpen = isOpen; }

  get useFloatingDropdown(): boolean {
    return window.innerWidth <= 1310;
  }

  toggleTroopsDropdown(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (this.useFloatingDropdown) {
      const target = event.currentTarget as HTMLElement | null;
      const rect = target?.getBoundingClientRect();

      if (rect) {
        if (window.innerWidth < 768) {
          // Mobile (vertical bar on the right)
          this.troopsDropdownX = rect.left;
          this.troopsDropdownY = rect.top + rect.height / 2;
        } else {
          // Tablet (horizontal bar at the top)
          this.troopsDropdownX = rect.left + rect.width / 2;
          this.troopsDropdownY = rect.top + rect.height + 8; // 8px below the button
        }
      }
    }

    this.isTroopsDropdownOpen = !this.isTroopsDropdownOpen;
    this.cdr.detectChanges();
  }

  private isTouchViewport() {
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 1024;
  }

  // --- LOGICA DELLE REGOLE (CDB) ---

  async loadGameRules() {
    try {
      const response = await fetch('assets/game_rules.json');
      if (response.ok) {
        this.gameRules = await response.json();
        this.cdr.detectChanges();
      }
    } catch (err) { console.error("Errore Intelligence: Regole non caricate", err); }
  }

  getFilteredBuildItems() {
    if (!this.gameRules || !this.gameRules.sheets) return [];
    if (this.activeBuildCategory === 'risorse') {
      return this.gameRules.sheets.find((s: any) => s.name === 'Estrattori')?.lines || [];
    } else {
      return this.gameRules.sheets.find((s: any) => s.name === 'Strutture')?.lines || [];
    }
  }

  startConstruction(item: any) { console.log("Inizio costruzione di:", item.name || item.nome); }

  // --- LOGICA MAPPA E SENSORI ---

  initMap() {
    this.map = new maplibregl.Map({
      container: 'map-container',
      style: {
        version: 8,
        sources: {
          'esri-tiles': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 },
          'maptiler-tiles': { type: 'raster', tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${this.MAPTILER_KEY}`], tileSize: 256 },
          'carto-light-tiles': { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'], tileSize: 256 }
        },
        layers: [
          { id: 'esri-sat', type: 'raster', source: 'esri-tiles', layout: { visibility: 'visible' } },
          { id: 'maptiler-hybrid', type: 'raster', source: 'maptiler-tiles', layout: { visibility: 'none' } },
          { id: 'carto-light', type: 'raster', source: 'carto-light-tiles', layout: { visibility: 'none' } }
        ]
      },
      center: [12.5, 41.9], zoom: 3, minZoom: 1.5, maxZoom: 14, renderWorldCopies: true, projection: { type: 'mercator' }
    });

    this.map.dragRotate.disable();
    this.map.touchZoomRotate.disableRotation();
    if (this.map.touchPitch) {
      this.map.touchPitch.disable();
    }

    this.map.on('load', () => {
      this.map.addSource('contours', { type: 'vector', url: `https://api.maptiler.com/tiles/contours-v2/tiles.json?key=${this.MAPTILER_KEY}` });

      this.map.addLayer({
        'id': 'contour-lines', 'type': 'line', 'source': 'contours', 'source-layer': 'contour', 'minzoom': 6,
        'layout': { 'visibility': 'none' },
        'paint': { 'line-color': '#f59e0b', 'line-width': ['case', ['==', ['get', 'nth_line'], 5], 1.5, 0.5], 'line-opacity': 0.8 }
      });

      this.loadTopoJsonLayer('/assets/map/regions.json', 'regioni', 'regioni-layer', 0, 24);
      this.loadTopoJsonArchsLayer('/assets/map/archs.json', 'archi', 'archi-layer', 0, 24);
      this.loadTopoJsonCitiesLayer('/assets/map/cities.json', 'cities', 'cities-points', 'cities-labels', 5, 24);

      // --- SETUP TETHERS SOURCE & LAYER ---
      this.map.addSource('tethers-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      this.map.addLayer({
        id: 'tethers-layer',
        type: 'line',
        source: 'tethers-source',
        paint: {
          'line-color': '#1d4ed8', // Blu scuro
          'line-width': 2,
          'line-dasharray': [2, 2],
          'line-opacity': 0.8
        }
      });

      // Eliminato il setup nativo GeoJSON perché causava offset grafico ingestibile con le immagini grandi.
      // Torniamo al caricamento DOM che adatta il background-size al div in pixel.
      setTimeout(() => {
        this.renderArmies();
      }, 500);
    });

    let touchStartTime = 0;
    let touchStartCoords = { x: 0, y: 0 };

    this.map.on('touchstart', (e: any) => {
      touchStartTime = Date.now();
      touchStartCoords = { x: e.point.x, y: e.point.y };
    });

    this.map.on('touchend', (e: any) => {
      const touchDuration = Date.now() - touchStartTime;
      if (touchDuration < 300) {
        const dx = Math.abs(e.point.x - touchStartCoords.x);
        const dy = Math.abs(e.point.y - touchStartCoords.y);
        // Se il dito non si è mosso molto, è un tap!
        if (dx < 15 && dy < 15) {
          this.handleMapPointSelect(e);
        }
      }
    });

    // Manteniamo anche il click per il Desktop
    this.map.on('click', (e: any) => {
      if (e.originalEvent.pointerType === 'mouse' || !this.isTouchLayout) {
        this.handleMapPointSelect(e);
      }
    });

    this.map.on('contextmenu', (e: any) => {
      e.originalEvent.preventDefault();
      this.updatePointReadout(e, true);
      this.radialMenuX = e.originalEvent.clientX;
      this.radialMenuY = e.originalEvent.clientY;
      this.isRadialMenuVisible = true;
      this.radialMenuOpenedAt = Date.now();
      this.cdr.detectChanges();
    });

    this.map.on('mousemove', (e: any) => this.handleMapMouseMove(e));

    this.map.on('dragstart', () => {
      this.closeRadialOnInteraction();
      this.closeTroopsDropdownOnInteraction();
    });

    // AGGIUNGI QUESTO: Chiude il menu quando inizia lo zoom
    this.map.on('zoomstart', () => {
      this.closeRadialOnInteraction();
      this.closeTroopsDropdownOnInteraction();
    });

    this.map.on('zoom', () => {
      this.updateArmyMarkersScale();
      this.updateNationBannersVisibility();
    });

    this.map.on('movestart', () => {
      // this.closeRadialOnInteraction();
      // this.closeTroopsDropdownOnInteraction();
    });
  }

  // --- RENDERING ARMATE SU MAPPA ---
  renderArmies() {
    console.log('[DEBUG_MAP] renderArmies richiamato. Mappa pronta?', !!this.map, 'Armate in memoria:', this.matchArmies.length);
    if (!this.map) return;

    // Rimuoviamo i marker non più presenti
    const currentArmyIds = new Set(this.matchArmies.map(a => a.id));
    for (const [id, marker] of this.armyMarkers.entries()) {
      if (!currentArmyIds.has(id)) {
        marker.remove();
        this.armyMarkers.delete(id);
      }
    }

    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    let hasArmies = false;
    const tetherFeatures: any[] = [];

    // Aggiungiamo o aggiorniamo i marker
    this.matchArmies.forEach(army => {
      if (!army.currentLocation) return;

      let coords: [number, number];
      if (typeof army.currentLocation === 'string') {
        const parts = army.currentLocation.split(',').map((c: string) => parseFloat(c.trim()));
        if (parts.length !== 2) return;
        coords = [parts[0], parts[1]];
      } else if (army.currentLocation && army.currentLocation.x !== undefined && army.currentLocation.y !== undefined) {
        coords = [army.currentLocation.x, army.currentLocation.y];
      } else {
        return;
      }

      hasArmies = true;
      if (coords[0] < minLng) minLng = coords[0];
      if (coords[0] > maxLng) maxLng = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];

      const totalTroops = (Object.values(army.composition || {}) as number[]).reduce((a, b) => a + b, 0) as number;

      // Trova il nodo target per la linea (tether)
      let targetNodeCoords = [...coords];
      if (this.nodesGeoData && this.nodesGeoData.features) {
        let cityName = '';
        if (army.name && army.name.toLowerCase().startsWith('guarnigione ')) {
          cityName = army.name.substring(12).trim().toLowerCase();
        } else {
          cityName = String(army.name || '').trim().toLowerCase();
        }

        let matchingNode = this.nodesGeoData.features.find((f: any) =>
          f.properties.name && f.properties.name.toLowerCase() === cityName
        );

        if (!matchingNode) {
          let minDist = Infinity;
          this.nodesGeoData.features.forEach((f: any) => {
            const nx = f.geometry.coordinates[0];
            const ny = f.geometry.coordinates[1];
            const dist = Math.pow(nx - coords[0], 2) + Math.pow(ny - coords[1], 2);
            if (dist < minDist) {
              minDist = dist;
              matchingNode = f;
            }
          });
        }

        if (matchingNode && matchingNode.geometry && matchingNode.geometry.coordinates) {
          targetNodeCoords = matchingNode.geometry.coordinates;
        }
      }

      const distSq = Math.pow(targetNodeCoords[0] - coords[0], 2) + Math.pow(targetNodeCoords[1] - coords[1], 2);
      if (distSq > 0.000001) {
        tetherFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [coords, targetNodeCoords]
          }
        });
      }

      if (this.armyMarkers.has(army.id)) {
        // Aggiorna posizione se necessario
        const marker = this.armyMarkers.get(army.id);
        marker.setLngLat([coords[0], coords[1]]);
        const badgeEl = marker.getElement().querySelector('.army-badge') as HTMLElement;
        if (badgeEl) badgeEl.innerText = String(totalTroops);
        // Salviamo info per il clustering
        marker.troopsData = { total: totalTroops, id: army.id };

        // Aggiorniamo i listener esistenti? MapLibre riutilizza il DOM, 
        // quindi gli event listener precedentemente agganciati continuano a funzionare.
      } else {
        // Il root element fornito a MapLibre deve essere 0x0 pixel senza anchor automatico,
        // altrimenti cambiando la dimensione del figlio, MapLibre si sfasa dal nodo.
        const el = document.createElement('div');
        el.className = 'army-marker';
        el.style.width = '0px';
        el.style.height = '0px';
        el.style.position = 'relative';
        el.style.zIndex = '999';

        // Il vero contenitore che scala e si allinea esattamente al centro del nodo
        const container = document.createElement('div');
        container.className = 'army-container';
        container.style.position = 'absolute';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.display = 'flex';
        container.style.justifyContent = 'center';
        container.style.alignItems = 'center'; // Modificato per centrare il contenuto
        container.style.cursor = 'pointer';
        container.title = army.name;

        // Inizializziamo a 32x32 per sicurezza
        container.style.width = '32px';
        container.style.height = '32px';

        const imgDiv = document.createElement('div');
        imgDiv.className = 'army-image';
        imgDiv.style.width = '100%';
        imgDiv.style.height = '100%';
        imgDiv.style.backgroundImage = 'url(/assets/2Dmodels/Land_troops/Soldier/soldier_front.png)';
        imgDiv.style.backgroundSize = 'contain';
        imgDiv.style.backgroundRepeat = 'no-repeat';
        imgDiv.style.backgroundPosition = 'center bottom';

        const badgeDiv = document.createElement('div');
        badgeDiv.className = 'army-badge';
        badgeDiv.innerText = String(totalTroops);
        badgeDiv.style.backgroundColor = '#e5e7eb';
        badgeDiv.style.color = '#1f2937';
        badgeDiv.style.borderRadius = '4px';
        badgeDiv.style.width = 'max-content'; // Si adatta al testo
        badgeDiv.style.height = 'fit-content';
        badgeDiv.style.padding = '1px 4px';
        badgeDiv.style.display = 'flex';
        badgeDiv.style.alignItems = 'center';
        badgeDiv.style.justifyContent = 'center';
        badgeDiv.style.fontSize = '11px';
        badgeDiv.style.fontWeight = 'bold';
        badgeDiv.style.border = '1px solid #9ca3af';
        badgeDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        badgeDiv.style.position = 'absolute';

        container.appendChild(imgDiv);
        container.appendChild(badgeDiv);
        el.appendChild(container);

        // --- INTERAZIONI CLICK & HOVER ---
        let hoverTimer: any = null;

        container.addEventListener('mouseenter', () => {
          hoverTimer = setTimeout(() => {
            this.showArmyHoverBanner(army, [coords[0], coords[1]]);
          }, 3000); // Mostra dopo 3 secondi
        });

        container.addEventListener('mouseleave', () => {
          if (hoverTimer) clearTimeout(hoverTimer);
          this.hideArmyHoverBanner();
        });

        container.addEventListener('click', (e) => {
          e.stopPropagation(); // Evita che il click passi alla mappa sottostante
          if (hoverTimer) clearTimeout(hoverTimer);
          this.hideArmyHoverBanner();
          this.openArmyModalFromRadial();
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([coords[0], coords[1]])
          .addTo(this.map);

        // Salviamo dati utili sul marker stesso
        (marker as any).troopsData = { total: totalTroops, id: army.id };
        this.armyMarkers.set(army.id, marker);
      }
    });

    if (this.map.getSource('tethers-source')) {
      (this.map.getSource('tethers-source') as any).setData({
        type: 'FeatureCollection',
        features: tetherFeatures
      });
    }

    if (this.isFirstArmyRender && hasArmies) {
      this.isFirstArmyRender = false;
      if (minLng <= maxLng && minLat <= maxLat) {
        this.map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 6, duration: 2000 });
      }
    }

    // Aggiorniamo la visibilità subito dopo il render
    this.updateArmyMarkersScale();
  }

  // Modifica visibilità in base allo zoom e accorpa vicini
  updateArmyMarkersScale() {
    if (!this.map) return;
    const currentZoom = this.map.getZoom();
    const thresholdZoom = 5.5; // Sotto questo livello si accorpano e nascondono i numeri

    // Raccogliamo la proiezione a schermo di tutti i marker
    const screenMarkers: any[] = [];
    this.armyMarkers.forEach(marker => {
      const coords = marker.getLngLat();
      const screenPt = this.map.project(coords);
      screenMarkers.push({ marker, pt: screenPt, x: screenPt.x, y: screenPt.y });
    });

    // Distanza in pixel sotto la quale i marker vengono "clusterizzati"
    const clusterPixelRadius = 40;
    const clusters: any[] = [];

    // Algoritmo greedy di clustering su schermo
    for (const item of screenMarkers) {
      let addedToCluster = false;
      for (const cluster of clusters) {
        const dx = item.x - cluster.x;
        const dy = item.y - cluster.y;
        if (Math.sqrt(dx * dx + dy * dy) < clusterPixelRadius) {
          cluster.items.push(item);
          addedToCluster = true;
          break;
        }
      }
      if (!addedToCluster) {
        clusters.push({ x: item.x, y: item.y, items: [item] });
      }
    }

    // Adesso applichiamo le classi e le scale
    clusters.forEach(cluster => {
      // Il marker principale è quello con più truppe o il primo
      cluster.items.sort((a: any, b: any) => b.marker.troopsData.total - a.marker.troopsData.total);

      // Calcoliamo la somma totale delle truppe per questo cluster
      const clusterTotalTroops = cluster.items.reduce((sum: number, item: any) => sum + item.marker.troopsData.total, 0);

      cluster.items.forEach((item: any, index: number) => {
        const el = item.marker.getElement();
        const container = el.querySelector('.army-container') as HTMLElement;
        const imgDiv = el.querySelector('.army-image') as HTMLElement;
        const badgeDiv = el.querySelector('.army-badge') as HTMLElement;
        if (!container || !imgDiv || !badgeDiv) return;

        // Nascondiamo i marker secondari del cluster
        if (index > 0 && currentZoom < thresholdZoom) {
          el.style.display = 'none';
          return;
        }

        el.style.display = 'block';

        // Scala di base del marker principale
        const minSize = 32;
        const maxSize = 80;
        const scaleFactor = Math.min(Math.max((currentZoom - 3) / (10 - 3), 0), 1);
        let dynamicSize = minSize + (maxSize - minSize) * scaleFactor;

        if (currentZoom < thresholdZoom) {
          // In fase di dezoom: Mostra l'avatar e MOSTRA il badge numerico!
          if (cluster.items.length > 1) {
            dynamicSize = dynamicSize * 1.5; // Facciamo la pedina più grande per indicare il cluster
          }

          container.style.width = `${dynamicSize}px`;
          container.style.height = `${dynamicSize}px`;

          imgDiv.style.display = 'block';
          badgeDiv.style.display = 'flex';
          // Mostra il numero aggregato di tutto il cluster
          badgeDiv.innerText = String(clusterTotalTroops);

          badgeDiv.style.position = 'absolute';
          badgeDiv.style.bottom = 'auto';
          badgeDiv.style.top = '100%';
          badgeDiv.style.marginTop = '2px';
        } else {
          // Zoom ravvicinato: Mostra l'avatar, NASCONDI il numero
          container.style.width = `${dynamicSize}px`;
          container.style.height = `${dynamicSize}px`;

          imgDiv.style.display = 'block';
          badgeDiv.style.display = 'none';

          // Ripristina il numero corretto della singola armata nel caso serva
          badgeDiv.innerText = String(item.marker.troopsData.total);
        }
      });
    });
  }

  // Carica archs.json e lo converte in GeoJSON LineString per la sovrapposizione
  loadArchesLayer(url: string) {
    fetch(url).then(res => res.json()).then((data: any) => {
      try {
        const lineFeatures: any[] = [];
        const nodeMap = new Map<string, any>();

        const features = data?.type === 'FeatureCollection' && Array.isArray(data.features)
          ? data.features
          : Object.keys(data || {}).map((key: string) => {
            const entry = data[key];
            if (!entry || !Array.isArray(entry.arcs)) return null;
            const coords = entry.arcs
              .map((p: any) => [Number(p.lon), Number(p.lat)])
              .filter((c: any) => c && c.length === 2);
            if (coords.length < 2) return null;
            return {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords },
              properties: {
                id: key,
                city1: entry.city1 || null,
                city2: entry.city2 || null,
                distance: entry.distance || null,
                road_type: entry.road_type || null,
                pendenza: entry.pendenza || null
              }
            };
          }).filter(Boolean);

        features.forEach((feature: any, index: number) => {
          const geometry = feature?.geometry;
          const coordinates = geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)
            ? geometry.coordinates
            : null;
          if (!coordinates || coordinates.length < 2) return;

          const properties = feature?.properties || {};
          const featureId = feature?.id || properties.id || `path${index + 1}`;

          lineFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {
              id: featureId,
              city1: properties.city1 || null,
              city2: properties.city2 || null,
              distance: properties.distance || null,
              road_type: properties.road_type || null,
              pendenza: properties.pendenza || null
            }
          });

          const first = coordinates[0];
          const last = coordinates[coordinates.length - 1];
          if (first && first.length === 2) {
            const k = `${Number(first[0]).toFixed(6)},${Number(first[1]).toFixed(6)}`;
            if (!nodeMap.has(k)) nodeMap.set(k, {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [Number(first[0]), Number(first[1])] },
              properties: { name: properties.city1 || null }
            });
          }
          if (last && last.length === 2) {
            const k2 = `${Number(last[0]).toFixed(6)},${Number(last[1]).toFixed(6)}`;
            if (!nodeMap.has(k2)) nodeMap.set(k2, {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [Number(last[0]), Number(last[1])] },
              properties: { name: properties.city2 || null }
            });
          }
        });

        const linesGeo = { type: 'FeatureCollection', features: lineFeatures };
        const nodesGeo = { type: 'FeatureCollection', features: Array.from(nodeMap.values()) };
        this.nodesGeoData = nodesGeo;

        // aggiorna o crea source + layer per le linee
        if (this.map.getSource('archs')) {
          (this.map.getSource('archs') as any).setData(linesGeo);
        } else {
          this.map.addSource('archs', { type: 'geojson', data: linesGeo, generateId: true });

          this.map.addLayer({
            id: 'archs-lines',
            type: 'line',
            source: 'archs',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#ff6b6b',
              'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.6, 10, 2.6],
              'line-opacity': 0.9
            }
          });

          this.map.addLayer({
            id: 'archs-lines-outline',
            type: 'line',
            source: 'archs',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#2b2b2b',
              'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.4, 10, 3.6],
              'line-opacity': 0.35
            }
          });
        }

        // crea/aggiorna source + layer per i nodi (circle + label)
        if (this.map.getSource('archs-nodes')) {
          (this.map.getSource('archs-nodes') as any).setData(nodesGeo);
        } else {
          this.map.addSource('archs-nodes', { type: 'geojson', data: nodesGeo, generateId: true });

          // cerchi per i nodi
          this.map.addLayer({
            id: 'archs-nodes-circle',
            type: 'circle',
            source: 'archs-nodes',
            minzoom: 4,
            paint: {
              'circle-color': '#ffd166',
              'circle-stroke-color': '#2b2b2b',
              'circle-stroke-width': 1,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 6, 10, 10],
              'circle-opacity': 0.95
            }
          });

          // label con nome città (se disponibile)
          this.map.addLayer({
            id: 'archs-nodes-label',
            type: 'symbol',
            source: 'archs-nodes',
            minzoom: 4,
            layout: {
              'text-field': ['coalesce', ['get', 'name'], ''],
              'text-size': 11,
              'text-offset': [0, 1.2],
              'text-anchor': 'top'
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': '#000000',
              'text-halo-width': 1
            }
          });
        }

      } catch (err) {
        console.error('Errore caricamento archs.json', err);
      }
    }).catch(err => console.error('Errore fetch archs.json', err));
  }

  private closeRadialOnInteraction() {
    if (this.isRadialMenuVisible) {
      this.isRadialMenuVisible = false;
      this.cdr.detectChanges();
    }
  }

  private closeTroopsDropdownOnInteraction() {
    if (this.isTroopsDropdownOpen) {
      this.isTroopsDropdownOpen = false;
      this.cdr.detectChanges();
    }
  }



  // Eseguita quando si preme un'azione nel menu radiale
  handleRadialAction(action: string) {
    if (Date.now() - this.radialMenuOpenedAt < 400) {
      console.log("Ignorato click sintetico/immediato sul menu radiale");
      return;
    }

    console.log("Comando Tattico:", action);

    switch (action) {
      case 'COSTRUISCI':
        this.toggleBuildPanel();
        break;
      case 'ARMATE':
      case 'TRUPPE':
        this.openArmyModalFromRadial();
        break;
      case 'INFO':
        this.showTerritoryInfoBanner();
        break;
      case 'ATTACCA':
        // Logica combattimento
        break;
    }

    this.isRadialMenuVisible = false;
  }

  async showTerritoryInfoBanner() {
    if (!this.selectedPointName || !this.selectedPointLngLat) return;

    let owner = 'NESSUNO';

    const feature = this.regionsGeoData?.features?.find((f: any) =>
      (f.properties.name?.toUpperCase() === this.selectedPointName) ||
      (f.properties.ADMIN?.toUpperCase() === this.selectedPointName) ||
      (f.properties.adm1_code?.toUpperCase() === this.selectedPointName) ||
      (f.id === this.selectedPointName)
    );

    const provId = feature ? (feature.properties.adm1_code || feature.properties.name || feature.id) : this.selectedPointName;

    const nation = this.matchNations?.find((n: any) => n.territories_flat && n.territories_flat.includes(provId));

    if (nation && nation.isOccupied) {
      if (nation.playerId.includes('bot')) {
        owner = '🤖 BOT';
      } else {
        owner = nation.playerId.toUpperCase();
      }
    }

    if (this.popupTimer) {
      clearTimeout(this.popupTimer);
      this.popupTimer = null;
    }

    if (this.activePopup) {
      this.activePopup.remove();
    }

    const popupHtml = `
      <div class="tactical-popup-container">
        <span style="font-size: 0.65rem; color: #86d7ff; font-weight: 900; letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase;">Dominio</span>
        <span style="font-size: 1.1rem; color: #fff; font-weight: 700; font-family: 'JetBrains Mono', monospace;">${owner}</span>
      </div>
    `;

    this.activePopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: true,
      anchor: 'bottom',
      offset: 15,
      className: 'tactical-popup'
    })
      .setLngLat(this.selectedPointLngLat)
      .setHTML(popupHtml)
      .addTo(this.map);

    // Chiusura automatica dopo 5 secondi
    this.popupTimer = setTimeout(() => {
      if (this.activePopup) {
        this.activePopup.remove();
        this.activePopup = null;
      }
    }, 5000);
  }

  onArmyMissionRequested(event: any) {
    console.log('Ordine armata emesso:', event);
    if (this.matchSocket && this.matchSocket.readyState === WebSocket.OPEN) {
      this.matchSocket.send(JSON.stringify({
        action: 'MOVE_TROOPS',
        payload: {
          armyId: event.armyId,
          mode: event.mode,
          targetName: event.targetName,
          targetCoords: event.targetCoords,
          composition: event.composition
        }
      }));
    } else {
      console.error("WebSocket non connesso");
    }
  }

  saveArmiesToBackend() {
    if (this.matchSocket && this.matchSocket.readyState === WebSocket.OPEN) {
      this.matchSocket.send(JSON.stringify({
        action: 'SAVE_ARMIES',
        payload: {
          armies: this.matchArmies
        }
      }));
    }
  }

  // Chiude il menu se si clicca altrove col tasto sinistro
  closeRadialMenu() {
    this.isRadialMenuVisible = false;
  }

  handleMapMouseMove(e: any) {
    this.updatePointReadout(e, false);
  }

  handleMapPointSelect(e: any) {
    console.log("Map clicked!", e.point);
    if (this.isRadialMenuVisible) {
      // Se è già aperto, il click lo chiude.
      this.isRadialMenuVisible = false;
      this.cdr.detectChanges();
      return;
    }

    // Seleziona il punto e apri il menu radiale
    this.updatePointReadout(e, true);

    // Usa e.point (pixel relativi al contenitore della mappa) garantiti da MapLibre
    this.radialMenuX = e.point ? e.point.x : window.innerWidth / 2;
    this.radialMenuY = e.point ? e.point.y : window.innerHeight / 2;

    this.radialMenuOpenedAt = Date.now();
    this.isRadialMenuVisible = true;
    this.cdr.detectChanges();

    if (navigator.vibrate) navigator.vibrate(50);
  }

  private updatePointReadout(e: any, persistSelection: boolean) {
    const coordsText = this.formatMapCoordinates(e.lngLat.lng, e.lngLat.lat);
    const outCoords = document.getElementById('out-coords');
    if (outCoords) outCoords.innerText = coordsText;

    if (persistSelection) {
      this.selectedPointCoords = coordsText;
      this.selectedPointLngLat = [e.lngLat.lng, e.lngLat.lat];
    }



    if (!this.map.getLayer('regioni-layer')) return;

    const features = this.map.queryRenderedFeatures(e.point, { layers: ['regioni-layer'] });

    if (features.length > 0 && features[0].id !== undefined) {
      const f = features[0];
      const territoryName = f.properties.name || f.properties.ADMIN || 'SCONOSCIUTO';
      const readableName = territoryName.toUpperCase();
      this.currentHoveredName = readableName;

      if (persistSelection || this.isTouchLayout) {
        this.selectedPointName = readableName;
      }

      if (this.hoveredState.id !== null && this.hoveredState.id !== f.id) {
        this.map.setFeatureState({ source: this.hoveredState.source, id: this.hoveredState.id }, { hover: false });
      }

      this.hoveredState = { id: f.id, source: f.source };
      this.map.setFeatureState({ source: this.hoveredState.source, id: this.hoveredState.id }, { hover: true });
      this.map.getCanvas().style.cursor = 'pointer';
    } else {
      this.clearHoverState();
      if (persistSelection || this.isTouchLayout) {
        this.selectedPointName = '';
      }
    }
  }

  private formatMapCoordinates(lng: number, lat: number) {
    let wrappedLng = lng;
    while (wrappedLng > 180) wrappedLng -= 360;
    while (wrappedLng < -180) wrappedLng += 360;

    return `${wrappedLng.toFixed(3)}, ${lat.toFixed(3)}`;
  }

  private clearHoverState() {
    if (this.hoveredState.id !== null) {
      this.map.setFeatureState({ source: this.hoveredState.source, id: this.hoveredState.id }, { hover: false });
      this.hoveredState = { id: null, source: null };
      this.currentHoveredName = '';
    }
    this.map.getCanvas().style.cursor = '';
  }

  handlePointData(data: any) {
    const alt = Math.floor(data.altitude);
    const outAlt = document.getElementById('out-alt');
    if (outAlt) outAlt.innerText = `${alt} M`;
  }

  loadTopoJsonLayer(url: string, sourceId: string, layerId: string, minZ: number, maxZ: number) {
    const fetchUrl = `${url}?v=${new Date().getTime()}`;
    fetch(fetchUrl).then(res => res.json()).then(topology => {
      const geoData = topojson.feature(topology, topology.objects[Object.keys(topology.objects)[0]]);

      if (layerId === 'regioni-layer') {
        this.regionsGeoData = geoData;
      }

      this.map.addSource(sourceId, { type: 'geojson', data: geoData, generateId: true });

      const paintConfig = layerId === 'regioni-layer' ? {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], '#00ccffff',
          ['has', 'fillColor'], ['get', 'fillColor'],
          'rgba(150, 150, 150, 0.2)'
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 0.25,
          ['has', 'fillColor'], 0.45,
          0.1
        ]
      } : {
        'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#00f2ff', 'transparent'],
        'fill-opacity': 0.3
      };

      this.map.addLayer({
        id: layerId, type: 'fill', source: sourceId, minzoom: minZ, maxzoom: maxZ,
        paint: paintConfig
      });

      if (layerId === 'regioni-layer') {
        this.map.addLayer({
          id: layerId + '-borders', type: 'line', source: sourceId, minzoom: minZ, maxzoom: maxZ,
          paint: {
            'line-color': '#000000',
            'line-width': 0.2,
            'line-opacity': 0.4
          }
        });
        this.applyTerritoryColors();
      }
    });
  }

  loadTopoJsonArchsLayer(url: string, sourceId: string, layerId: string, minZ: number, maxZ: number) {
    const fetchUrl = `${url}?v=${new Date().getTime()}`;
    fetch(fetchUrl).then(res => res.json()).then(topology => {
      let allFeatures: any[] = [];
      const featureMap = new Map<string, any>();

      Object.keys(topology.objects).forEach(objKey => {
        const geoData: any = topojson.feature(topology, topology.objects[objKey]);
        const features = geoData?.features || (geoData?.type === 'Feature' ? [geoData] : []);

        features.forEach((f: any) => {
          const id = f.properties?.id || f.id;
          if (id) {
            featureMap.set(id, f);
          } else {
            allFeatures.push(f);
          }
        });
      });

      allFeatures = allFeatures.concat(Array.from(featureMap.values()));
      const mergedGeoData = { type: 'FeatureCollection', features: allFeatures };
      this.map.addSource(sourceId, { type: 'geojson', data: mergedGeoData, generateId: true });
      this.map.addLayer({
        id: layerId, type: 'fill', source: sourceId, minzoom: minZ, maxzoom: maxZ,
        paint: {
          'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#00f2ff', 'transparent'],
          'fill-opacity': 0.3
        }
      });
      this.map.addLayer({
        id: layerId + '-borders', type: 'line', source: sourceId, minzoom: minZ, maxzoom: maxZ,
        paint: {
          'line-color': '#ff6b6b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 2.0, 10, 3.6],
          'line-opacity': 0.9
        }
      });
    });
  }

  loadTopoJsonCitiesLayer(url: string, sourceId: string, pointsLayerId: string, labelsLayerId: string, minZ: number, maxZ: number) {
    const fetchUrl = `${url}?v=${new Date().getTime()}`;
    fetch(fetchUrl).then(res => res.json()).then(topology => {
      const objectName = Object.keys(topology.objects || {})[0];
      if (!objectName) {
        return;
      }

      const geoData = topojson.feature(topology, topology.objects[objectName]);

      if (this.map.getSource(sourceId)) {
        (this.map.getSource(sourceId) as any).setData(geoData);
        return;
      }

      this.map.addSource(sourceId, { type: 'geojson', data: geoData, generateId: true });

      this.map.addLayer({
        id: pointsLayerId,
        type: 'circle',
        source: sourceId,
        minzoom: minZ,
        maxzoom: maxZ,
        paint: {
          'circle-color': '#ffd84d',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.8, 4, 2.8, 7, 4.6],
          'circle-stroke-color': '#1a1402',
          'circle-stroke-width': 1,
          'circle-opacity': 0.95
        }
      });

      this.map.addLayer({
        id: labelsLayerId,
        type: 'symbol',
        source: sourceId,
        minzoom: minZ,
        maxzoom: maxZ,
        layout: {
          'text-field': ['coalesce', ['get', 'NAME'], ''],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 11],
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'visibility': 'visible'
        },
        paint: {
          'text-color': '#fff4b0',
          'text-halo-color': '#000000',
          'text-halo-width': 1.2,
          'text-halo-blur': 0.5
        }
      });
    }).catch(err => console.error('Errore fetch cities.json', err));
  }

  changeBasemap(event: any) {
    const selected = event.target.value;
    ['esri-sat', 'maptiler-hybrid', 'carto-light'].forEach(id => {
      this.map.setLayoutProperty(id, 'visibility', id === selected ? 'visible' : 'none');
    });
  }

  toggleLayer(type: string) {
    if (type === 'contours') {
      const ids = ['contour-lines'];
      const vis = this.map.getLayoutProperty(ids[0], 'visibility');
      this.map.setLayoutProperty(ids[0], 'visibility', vis === 'visible' ? 'none' : 'visible');
    }
  }

  applyTerritoryColors() {
    if (!this.regionsGeoData || !this.matchNations || !this.map || !this.map.getSource('regioni')) return;

    if (this.nationMarkers) {
      this.nationMarkers.forEach((m: any) => m.remove());
    }
    this.nationMarkers = [];

    const colorMap: Record<string, string> = {};
    const currentUser = String(this.userProfile?.username || '').trim().toLowerCase();
    const currentAllianceId = this.currentAllianceId;

    this.matchNations.forEach((nation: any) => {
      if (!nation.isOccupied) return;

      let statusColor = '#eab308'; // Default non neutral (enemy)
      const occupier = String(nation.playerId || '').trim().toLowerCase();

      if (occupier === currentUser) {
        statusColor = '#22c55e'; // Verde per il player
      } else if (nation.inWar) {
        statusColor = '#ef4444'; // Rosso per in guerra
      } else if (occupier.includes('bot')) {
        statusColor = '#cececeff'; // Grigio chiaro per i bot
      } else {
        let isAlly = false;
        if (currentAllianceId) {
          const allyGrp = this.matchAlliances?.find((a: any) => String(a.id_alleanza) === currentAllianceId);
          if (allyGrp && Array.isArray(allyGrp.members)) {
            isAlly = allyGrp.members.some((m: string) => String(m).trim().toLowerCase() === occupier);
          }
        }
        statusColor = isAlly ? '#3b82f6' : '#eab308';
      }

      if (Array.isArray(nation.territories_flat)) {
        nation.territories_flat.forEach((provId: string) => {
          colorMap[provId] = statusColor;
        });
      }

      if (Array.isArray(nation.territories_flat) && nation.territories_flat.length > 0) {
        const firstProvId = nation.territories_flat[0];
        const feature = this.regionsGeoData.features.find((f: any) =>
          (f.properties.adm1_code === firstProvId) || (f.id === firstProvId) || (f.properties.name === firstProvId)
        );
        if (feature && feature.geometry && feature.geometry.coordinates) {
          let coords = feature.geometry.coordinates;
          while (coords.length && Array.isArray(coords[0][0])) {
            coords = coords[0];
          }
          if (coords.length > 0 && coords[0].length === 2) {
            const centerPoint = coords[Math.floor(coords.length / 2)];

            const el = document.createElement('div');
            el.className = 'nation-banner-marker';
            el.style.backgroundColor = 'rgba(0,0,0,0.8)';
            el.style.color = '#fff';
            el.style.border = `2px solid ${statusColor}`;
            el.style.borderRadius = '4px';
            el.style.padding = '3px 8px';
            el.style.fontSize = '11px';
            el.style.fontWeight = 'bold';
            el.style.whiteSpace = 'nowrap';
            el.style.display = 'none';
            el.innerText = occupier.includes('bot') ? '🤖 BOT' : nation.playerId.toUpperCase();

            const marker = new maplibregl.Marker({ element: el })
              .setLngLat(centerPoint)
              .addTo(this.map);
            this.nationMarkers.push(marker);
          }
        }
      }
    });

    this.regionsGeoData.features.forEach((f: any) => {
      const pId = f.properties.adm1_code || f.properties.name || f.id;
      if (colorMap[pId]) {
        f.properties.fillColor = colorMap[pId];
      } else {
        delete f.properties.fillColor;
      }
    });

    const source = this.map.getSource('regioni') as any;
    if (source) {
      source.setData(this.regionsGeoData);
    }

    this.updateNationBannersVisibility();
  }

  updateNationBannersVisibility() {
    if (!this.map || !this.nationMarkers) return;
    const zoom = this.map.getZoom();
    const show = zoom >= 5.5;
    this.nationMarkers.forEach((m: any) => {
      m.getElement().style.display = show ? 'block' : 'none';
    });
  }

  switchGlobe() {
    this.isGlobe = !this.isGlobe;
    this.map.setProjection({ type: this.isGlobe ? 'globe' : 'mercator' });
  }

  async ionViewWillLeave() {
    try {
      // Controlla se c'è una modale attualmente in cima allo stack visivo
      const topModal = await this.modalCtrl.getTop();

      // Se esiste una modale aperta, forzane la chiusura
      if (topModal) {
        await this.modalCtrl.dismiss();
      }
    } catch (error) {
      console.error('Errore durante la chiusura della modale:', error);
    }
  }
}