import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, MenuController } from '@ionic/angular'; // <--- AGGIUNTO MenuController
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
declare var io: any;
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
  sensorSocket: any;
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
  isTroopsDropdownOpen = false;
  troopsDropdownX = 0;
  troopsDropdownY = 0;
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
    experience: 85, matchesWon: 24, matchesLost: 5,
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
    land: [ { label: 'Soldato', path: 'land_troops/soldier.glb' } ],
    sea: [ { label: 'Cacciatorpediniere', path: 'sea_troops/cacciatorpediniere.glb' } ],
    air: [ { label: 'Aereo Cargo', path: 'air_troops/aereo_cargo.glb' } ]
  };

    // Aggiungi queste proprietà alla classe MatchPage
  isRadialMenuVisible = false;
  radialMenuX = 0;
  radialMenuY = 0;

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
    // Connect Socket.IO through gateway (explicit origin + path)
    this.sensorSocket = io(window.location.origin, { path: '/socket.io', auth: { token: localStorage.getItem('jwt') || "IL_TUO_JWT_TOKEN" } });
    this.sensorSocket.on('point_data', (data: any) => this.handlePointData(data));
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
    if (this.avatarSub) {
      this.avatarSub.unsubscribe();
    }
  }

  ionViewWillEnter() {
    this.loadGameRules();
    this.loadUserProfile();
    this.loadMatchContext();
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
      return;
    }

    this.homeService.getMatchAlliance(this.currentMatchId).subscribe({
      next: (response: any) => {
        this.matchAlliances = Array.isArray(response?.alliances) ? response.alliances : [];
        this.cdr.detectChanges();
      },
      error: () => {
        this.matchAlliances = [];
        this.cdr.detectChanges();
      }
    });
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

        this.userProfile = {
          ...this.userProfile,
          username: String(profile.username),
          rank: profile.rank || profile.reg || this.userProfile.rank,
          experience: profile.experience ?? this.userProfile.experience,
          avatar: profile.avatar_id ? this.avatarPath(profile.avatar_id) : this.userProfile.avatar,
        };

        if (profile.avatar_id) {
          this.userState.setAvatarId(Number(profile.avatar_id));
        }

        this.cdr.detectChanges();
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
    setTimeout(() => {
      this.initMap();
      setTimeout(() => { if (this.map) this.map.resize(); }, 300);
    }, 150);
  }

  // --- AZIONI HUD E CONTROLLI UI ---

  closeMobileMenu() {
    this.menuCtrl.close('mobile-tactical-menu');
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
      this.isBuildPanelOpen = false;
      this.isTechModalOpen = false;
      this.isDiplomacyModalOpen = false;
      this.isIntelligenceModalOpen = false;
      this.isMarketModalOpen = false;
    }
    this.closeMobileMenu();
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
    if (this.isBuildPanelOpen) { this.isTechModalOpen = false; this.isDiplomacyModalOpen = false; this.isIntelligenceModalOpen = false; this.isMarketModalOpen = false; this.isArmyModalOpen = false;}
    this.closeMobileMenu();
  }

  toggleDiplomacyModal() {
    this.isDiplomacyModalOpen = !this.isDiplomacyModalOpen;
    if (this.isDiplomacyModalOpen) { this.isBuildPanelOpen = false; this.isTechModalOpen = false; this.isIntelligenceModalOpen = false; this.isMarketModalOpen = false; this.isArmyModalOpen = false;}
    this.closeMobileMenu();
  }

  toggleIntelligenceModal() {
    this.isIntelligenceModalOpen = !this.isIntelligenceModalOpen;
    if (this.isIntelligenceModalOpen) { this.isBuildPanelOpen = false; this.isTechModalOpen = false; this.isDiplomacyModalOpen = false; this.isMarketModalOpen = false; this.isArmyModalOpen = false;}
    this.closeMobileMenu();
  }

  toggleMapSettings() { this.isMapSettingsOpen = !this.isMapSettingsOpen; this.closeMobileMenu();}
  setBuildCategory(cat: 'risorse' | 'armamenti') { this.activeBuildCategory = cat; }
  setOpenProfile(isOpen: boolean) { this.isProfileModalOpen = isOpen; }

  toggleTroopsDropdown(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (this.isTouchViewport()) {
      const target = event.currentTarget as HTMLElement | null;
      const rect = target?.getBoundingClientRect();

      if (rect) {
        this.troopsDropdownX = Math.max(12, rect.left - 12);
        this.troopsDropdownY = rect.top + rect.height / 2;
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
        const response = await fetch('/assets/game_rules.json'); 
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
        center: [12.5, 41.9], zoom: 3.5, minZoom: 1.5, renderWorldCopies: true, projection: { type: 'mercator' }
    });

    this.map.dragRotate.disable();

    this.map.on('load', () => {
        this.map.addSource('terrain-source', { type: 'raster-dem', url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${this.MAPTILER_KEY}`, tileSize: 256 });
        this.map.setTerrain({ source: 'terrain-source', exaggeration: 1.2 });
        this.map.addSource('contours', { type: 'vector', url: `https://api.maptiler.com/tiles/contours-v2/tiles.json?key=${this.MAPTILER_KEY}` });

        this.map.addLayer({
            'id': 'contour-lines', 'type': 'line', 'source': 'contours', 'source-layer': 'contour', 'minzoom': 6, 
            'layout': { 'visibility': 'none' },
            'paint': { 'line-color': '#f59e0b', 'line-width': ['case', ['==', ['get', 'nth_line'], 5], 1.5, 0.5], 'line-opacity': 0.8 }
        });

        this.loadTopoJsonLayer('/assets/map/nations.json', 'nazioni', 'nazioni-layer', 0, 3.5);
        this.loadTopoJsonLayer('/assets/map/regions.json', 'regioni', 'regioni-layer', 3.5, 24);
        // sovrapponi gli archi (strade/rotte) generati in shared/assets/map/archs.json
        this.loadArchesLayer('/assets/map/archs.json');
    });

    this.map.on('touchstart', (e: any) => {
      // Avviamo un timer di 500ms (0.5 secondi)
      this.touchTimer = setTimeout(() => {
        // Se il timer arriva alla fine, attiviamo il menu radiale
        // Usiamo le coordinate del punto toccato
        this.radialMenuX = e.originalEvent.touches[0].clientX;
        this.radialMenuY = e.originalEvent.touches[0].clientY;
        
        this.isRadialMenuVisible = true;
        this.cdr.detectChanges();
        
        // Opzionale: un piccolo feedback di vibrazione se il dispositivo lo supporta
        if (navigator.vibrate) navigator.vibrate(50);
        
      }, 500); // <--- Durata della pressione: 0.5 secondi
    });

    this.map.on('touchend', () => {
      // Se l'utente alza il dito prima del secondo, annulliamo tutto
      this.clearTouchTimer();
    });

    this.map.on('touchmove', () => {
      // Se l'utente trascina la mappa, annulliamo il timer 
      // (altrimenti il menu si aprirebbe durante lo scrolling)
      this.clearTouchTimer();
    });

    this.map.on('click', (e: any) => this.handleMapPointSelect(e));

    // Mantieni anche il vecchio listener contextmenu per il Desktop
    this.map.on('contextmenu', (e: any) => {
      e.originalEvent.preventDefault();
      this.radialMenuX = e.originalEvent.clientX;
      this.radialMenuY = e.originalEvent.clientY;
      this.isRadialMenuVisible = true;
      this.cdr.detectChanges();
    });

    this.map.on('mousemove', (e: any) => this.handleMapMouseMove(e));

    this.map.on('contextmenu', (e: any) => {
      // Impedisce il menu standard
      e.originalEvent.preventDefault();
      
      // Coord dello schermo per posizionare il div HTML
      this.radialMenuX = e.originalEvent.clientX;
      this.radialMenuY = e.originalEvent.clientY;
      
      this.isRadialMenuVisible = true;
      this.cdr.detectChanges();
    });

    this.map.on('dragstart', () => {
      this.closeRadialOnInteraction();
      this.closeTroopsDropdownOnInteraction();
    });

    // AGGIUNGI QUESTO: Chiude il menu quando inizia lo zoom
    this.map.on('zoomstart', () => {
      this.closeRadialOnInteraction();
      this.closeTroopsDropdownOnInteraction();
    });

    this.map.on('movestart', () => {
      this.closeRadialOnInteraction();
      this.closeTroopsDropdownOnInteraction();
    });
  }

  // Carica archs.json e lo converte in GeoJSON LineString per la sovrapposizione
  loadArchesLayer(url: string) {
    fetch(url).then(res => res.json()).then((data: any) => {
      try {
        const lineFeatures: any[] = [];
        const nodeMap = new Map<string, any>();

        // data è un oggetto con pathN: { arcs: [{lon,lat}, ...], ... }
        Object.keys(data).forEach(key => {
          const entry = data[key];
          if (!entry || !Array.isArray(entry.arcs)) return;
          const coords = entry.arcs.map((p: any) => [Number(p.lon), Number(p.lat)]).filter((c: any) => c && c.length === 2);
          if (coords.length < 2) return; // serve almeno una linea

          lineFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: {
              id: key,
              city1: entry.city1 || null,
              city2: entry.city2 || null,
              distance: entry.distance || null,
              road_type: entry.road_type || null
            }
          });

          // endpoints — usa primo e ultimo punto come "nodi" (città)
          const first = entry.arcs[0];
          const last = entry.arcs[entry.arcs.length - 1];
          if (first && first.lon != null && first.lat != null) {
            const k = `${Number(first.lon).toFixed(6)},${Number(first.lat).toFixed(6)}`;
            if (!nodeMap.has(k)) nodeMap.set(k, {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [Number(first.lon), Number(first.lat)] },
              properties: { name: entry.city1 || null }
            });
          }
          if (last && last.lon != null && last.lat != null) {
            const k2 = `${Number(last.lon).toFixed(6)},${Number(last.lat).toFixed(6)}`;
            if (!nodeMap.has(k2)) nodeMap.set(k2, {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [Number(last.lon), Number(last.lat)] },
              properties: { name: entry.city2 || null }
            });
          }
        });

        const linesGeo = { type: 'FeatureCollection', features: lineFeatures };
        const nodesGeo = { type: 'FeatureCollection', features: Array.from(nodeMap.values()) };

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

  private clearTouchTimer() {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touchTimer = null;
    }
  }

  // Eseguita quando si preme un'azione nel menu radiale
  handleRadialAction(action: string) {
    console.log("Comando Tattico:", action);
    
    switch(action) {
      case 'COSTRUISCI':
        this.toggleBuildPanel();
        break;
      case 'INFO':
        // Logica per mostrare dettagli territorio
        break;
      case 'ATTACCA':
        // Logica combattimento
        break;
    }
    
    this.isRadialMenuVisible = false;
  }

  // Chiude il menu se si clicca altrove col tasto sinistro
  closeRadialMenu() {
    this.isRadialMenuVisible = false;
  }

  handleMapMouseMove(e: any) {
    this.updatePointReadout(e, false);
  }

  handleMapPointSelect(e: any) {
    this.updatePointReadout(e, true);
  }

  private updatePointReadout(e: any, persistSelection: boolean) {
    this.sensorSocket.emit('query_point', { lng: e.lngLat.lng, lat: e.lngLat.lat });

    const coordsText = this.formatMapCoordinates(e.lngLat.lng, e.lngLat.lat);
    const outCoords = document.getElementById('out-coords');
    if (outCoords) outCoords.innerText = coordsText;

    if (persistSelection) {
      this.selectedPointCoords = coordsText;
    }

    if (this.map.getZoom() > 6) {
        this.clearHoverState();
        if (!persistSelection && !this.isTouchLayout) {
          this.selectedPointName = '';
        }
        return;
    }

    if (!this.map.getLayer('nazioni-layer') || !this.map.getLayer('regioni-layer')) return;

    const features = this.map.queryRenderedFeatures(e.point, { layers: ['nazioni-layer', 'regioni-layer'] });

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
    if(outAlt) outAlt.innerText = `${alt} M`;
  }

  loadTopoJsonLayer(url: string, sourceId: string, layerId: string, minZ: number, maxZ: number) {
    fetch(url).then(res => res.json()).then(topology => {
        const geoData = topojson.feature(topology, topology.objects[Object.keys(topology.objects)[0]]);
        this.map.addSource(sourceId, { type: 'geojson', data: geoData, generateId: true });
        this.map.addLayer({
            id: layerId, type: 'fill', source: sourceId, minzoom: minZ, maxzoom: maxZ,
            paint: {
                'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#00f2ff', 'transparent'],
                'fill-opacity': 0.3
            }
        });
        this.map.addLayer({
            id: layerId + '-borders', type: 'line', source: sourceId, minzoom: minZ, maxzoom: maxZ,
            paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.5 }
        });
    });
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