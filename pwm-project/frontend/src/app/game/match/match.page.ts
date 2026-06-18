import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, MenuController, ToastController, ActionSheetController } from '@ionic/angular'; // <--- AGGIUNTO MenuController
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { HomeService } from '../../home/home';
import { AuthApiService } from '../../auth/auth-api.service';
import { UserStateService } from '../../user-state.service';
import { environment } from '../../../environments/environment';

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

  @ViewChild(ArmyModalComponent) armyModalComponent!: ArmyModalComponent;
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
  private reconnectTimer: number | null = null;
  private shouldReconnect: boolean = true;

  // Layer ordering function to guarantee correct visualization
  private reorderMapLayers() {
    if (!this.map) return;
    const order = [
      'regioni-layer',
      'regioni-layer-borders',
      'archi-layer',
      'archi-layer-borders',
      'archs-lines-outline',
      'archs-lines',
      'archs-nodes-circle',
      'archs-nodes-label',
      'tethers-layer',
      'moving-troops-paths-layer',
      'hovered-troop-path-layer'
    ];

    try {
      for (const layerId of order) {
        if (this.map.getLayer(layerId)) {
          this.map.moveLayer(layerId);
        }
      }
    } catch (err) {
      console.warn('[Mapbox] Errore riordino layer:', err);
    }
  }

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
  armyHoverInterval: any = null;
  isFirstArmyRender = true;
  matchNations: any[] = [];
  regionsGeoData: any = null;
  nationMarkers: any[] = [];
  citiesHp: { [cityId: string]: number } = {};
  cityHpMarkers = new Map<string, any>();
  chatUnreadCount = 0;
  currentMatchId = '';
  matchPlayers: string[] = [];
  matchAlliances: any[] = [];
  selectedArmyId = '';
  selectedArmiesForMovement: string[] = [];
  previousSelectedArmiesForMovement: string[] = [];
  animationFrameId: any;
  activeArmyPopup: any = null;

  getArmyModelAssetUrl(army: any, direction: 'front' | 'back' | 'side' | 'side-flip'): string {
    let modelName = 'Soldier';
    let folder = 'Land_troops';
    if (army.composition) {
      if (army.composition['Carro Armato']) { modelName = 'Tank'; folder = 'Land_troops'; }
      else if (army.composition['Veicolo Leggero']) { modelName = 'LMV'; folder = 'Land_troops'; }
      else if (army.composition['APC']) { modelName = 'APC'; folder = 'Land_troops'; }
      else if (army.composition['Caccia']) { modelName = 'Aircraft'; folder = 'Sea_troops'; }
    }
    if (army.id_modello) {
      if (army.id_modello.includes('Tank')) { modelName = 'Tank'; folder = 'Land_troops'; }
      else if (army.id_modello.includes('Aircraft')) { modelName = 'Aircraft'; folder = 'Sea_troops'; }
    }
    const suffix = '_' + direction.replace('-flip', '') + '.png';
    if (modelName === 'Soldier') {
      return `/assets/2Dmodels/Land_troops/Soldier/soldier${suffix}`;
    }
    return `/assets/2Dmodels/${folder}/${modelName}/${modelName}${suffix}`;
  }

  startAnimationLoop() {
    const animate = () => {
      try {
        this.updateMovingArmies();
      } catch (err) {
        console.error('Animation loop error:', err);
      }
      this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  updateMovingArmies() {
    if (!this.map || this.matchArmies.length === 0) return;
    const now = Date.now();
    this.matchArmies.forEach(army => {
      if ((army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco") && army.path && army.path.length > 1 && army.startTime && army.etaMs) {
        console.log("updateMovingArmies: army", army.id, "startTime:", army.startTime, "etaMs:", army.etaMs, "path.length:", army.path?.length, "status:", army.status);
        const elapsed = now - army.startTime;
        let progress = Math.max(0, Math.min(1, elapsed / army.etaMs));

        let currentLngLat = army.path[army.path.length - 1];
        let prevLngLat = army.path[0];
        let direction: 'front' | 'back' | 'side' | 'side-flip' = 'front';

        if (progress < 1) {
          army._hasVisuallyArrived = false;
          const totalSegments = army.path.length - 1;
          const exactIndex = progress * totalSegments;
          const currentIndex = Math.floor(exactIndex);
          const segmentProgress = exactIndex - currentIndex;
          const p1 = army.path[currentIndex];
          const p2 = army.path[currentIndex + 1] || p1;
          prevLngLat = p1;
          const lng = p1[0] + (p2[0] - p1[0]) * segmentProgress;
          const lat = p1[1] + (p2[1] - p1[1]) * segmentProgress;
          currentLngLat = [lng, lat];
        } else {
          if (!army._hasVisuallyArrived) {
             army._hasVisuallyArrived = true;
             army.status = 'standby';
             army.currentLocation = { x: currentLngLat[0], y: currentLngLat[1] };
             delete army.path;
             delete army.etaMs;
             delete army.startTime;
             setTimeout(() => this.renderArmies(), 0);
          }
          prevLngLat = army.path ? army.path[Math.max(0, army.path.length - 2)] : currentLngLat;
        }

        const dx = currentLngLat[0] - prevLngLat[0];
        const dy = currentLngLat[1] - prevLngLat[1];
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) direction = 'side';
          else direction = 'side-flip';
        } else {
          if (dy > 0) direction = 'back';
          else direction = 'front';
        }

        const marker = this.armyMarkers.get(army.id);
        if (marker) {
          marker.setLngLat(currentLngLat);
          const el = marker.getElement();
          const imgDiv = el.querySelector('.army-image') as HTMLElement;
          if (imgDiv) {
            const assetUrl = `url(${this.getArmyModelAssetUrl(army, direction)})`;
            if (imgDiv.style.backgroundImage !== assetUrl) {
              imgDiv.style.backgroundImage = assetUrl;
            }

            // Apply flip
            const targetTransform = direction === 'side-flip' ? 'scaleX(-1)' : 'scaleX(1)';
            if (imgDiv.style.transform !== targetTransform) {
              imgDiv.style.transform = targetTransform;
            }
          }
        }
      }
    });
  }

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
    private actionSheetCtrl: ActionSheetController,
    private route: ActivatedRoute,
    private homeService: HomeService,
    private authApi: AuthApiService,
    private userState: UserStateService
  ) { }

  ngOnInit() {
    this.startAnimationLoop();
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
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
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
    const configured = String(environment.apiBaseUrl || '').replace(/\/$/, '');
    if (configured) {
      return configured.replace(/^http(s?):\/\//i, 'ws$1://');
    }
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
            this.matchArmies = parsed.payload.armies.filter((a: any) => a.owner === this.userProfile.username);
            const moving = this.matchArmies.find(a => a.status === "moving");
            if (moving) console.log("INITIAL_STATE moving army:", moving.id, "startTime:", moving.startTime, "path:", moving.path?.length);
            this.renderArmies();
          }
          if (parsed.payload?.nations) {
            this.matchNations = parsed.payload.nations;
            this.applyTerritoryColors();
          }
          this.cdr.detectChanges();
        }

        if (parsed.type === 'TROOPS_MOVED') {
          const { armyId, targetName, targetCoords, etaMs, startTime, path, mode } = parsed.data;
          const armyIndex = this.matchArmies.findIndex(a => a.id === armyId);
          if (armyIndex !== -1) {
            const newArmies = [...this.matchArmies];
            newArmies[armyIndex] = { ...newArmies[armyIndex] };
            newArmies[armyIndex].status = 'moving';
            newArmies[armyIndex].targetName = targetName;
            newArmies[armyIndex].targetCoords = targetCoords;
            newArmies[armyIndex].path = path;
            newArmies[armyIndex].etaMs = etaMs;
            newArmies[armyIndex].startTime = startTime || Date.now();
            if (mode) newArmies[armyIndex].missionMode = mode;
            this.matchArmies = newArmies;
          }
          console.log(`[WS_MATCH] Movimento in corso verso ${targetName}. Arrivo stimato: ${etaMs}ms`);
          this.renderArmies();
          this.applyTerritoryColors();
          this.cdr.detectChanges();
        }

        if (parsed.type === 'TROOPS_ARRIVED') {
          const { armyId, targetName, targetCoords } = parsed.data;
          const armyIndex = this.matchArmies.findIndex(a => a.id === armyId);
          if (armyIndex !== -1) {
            const newArmies = [...this.matchArmies];
            newArmies[armyIndex] = { ...newArmies[armyIndex] };
            newArmies[armyIndex].status = 'standby';
            newArmies[armyIndex].currentLocation = targetCoords || targetName;
            delete newArmies[armyIndex].targetName;
            delete newArmies[armyIndex].missionMode;
            delete newArmies[armyIndex].path;
            delete newArmies[armyIndex].etaMs;
            delete newArmies[armyIndex].startTime;
            this.matchArmies = newArmies;

            const hoverSource: any = this.map?.getSource('hovered-troop-path-source');
            if (hoverSource) {
              hoverSource.setData({ type: 'FeatureCollection', features: [] });
            }
            this.hideArmyHoverBanner();

            const marker = this.armyMarkers.get(armyId);
            if (marker) {
              const el = marker.getElement();
              const imgDiv = el.querySelector('.army-image') as HTMLElement;
              if (imgDiv) {
                const assetUrl = this.getArmyModelAssetUrl(this.matchArmies[armyIndex], 'front');
                imgDiv.style.backgroundImage = `url(${assetUrl})`;
                imgDiv.style.transform = 'scaleX(1)';
              }
            }
          }
          console.log(`[WS_MATCH] Armata arrivata a ${targetName}.`);
          this.renderArmies();
          this.applyTerritoryColors();
          this.cdr.detectChanges();
        }

        if (parsed.type === 'MISSION_CANCELLED') {
          const { armyId, newLocation } = parsed.payload;
          const armyIndex = this.matchArmies.findIndex(a => a.id === armyId);
          if (armyIndex !== -1) {
            const newArmies = [...this.matchArmies];
            newArmies[armyIndex] = { ...newArmies[armyIndex] };
            newArmies[armyIndex].status = 'standby';
            newArmies[armyIndex].currentLocation = newLocation || newArmies[armyIndex].currentLocation;
            delete newArmies[armyIndex].targetName;
            delete newArmies[armyIndex].missionMode;
            delete newArmies[armyIndex].path;
            delete newArmies[armyIndex].etaMs;
            delete newArmies[armyIndex].startTime;
            this.matchArmies = newArmies;

            const hoverSource: any = this.map?.getSource('hovered-troop-path-source');
            if (hoverSource) {
              hoverSource.setData({ type: 'FeatureCollection', features: [] });
            }
            this.hideArmyHoverBanner();
          }
          console.log(`[WS_MATCH] Missione armata ${armyId} annullata.`);
          this.renderArmies();
          this.applyTerritoryColors();
          this.cdr.detectChanges();
        }

        if (parsed.type === 'COMBAT_CANCELLED') {
          const { armyId } = parsed.data;
          const armyIndex = this.matchArmies.findIndex(a => a.id === armyId);
          if (armyIndex !== -1) {
            const newArmies = [...this.matchArmies];
            newArmies[armyIndex] = { ...newArmies[armyIndex] };
            newArmies[armyIndex].status = 'standby';
            delete newArmies[armyIndex].targetName;
            delete newArmies[armyIndex].missionMode;
            delete newArmies[armyIndex].path;
            delete newArmies[armyIndex].etaMs;
            delete newArmies[armyIndex].startTime;
            delete newArmies[armyIndex].next_round_time;
            this.matchArmies = newArmies;
            this.renderArmies();
            this.cdr.detectChanges();
          }
        }

        if (parsed.type === 'TROOPS_SPAWNED') {
          const { userId, army } = parsed.data;
          if (userId === this.userProfile.username) {
            this.matchArmies.push(army);
            console.log(`[WS_MATCH] Nuova truppa generata a Palermo per l'utente ${userId}!`);
          }
          this.renderArmies();
          this.applyTerritoryColors();
          this.cdr.detectChanges();
        }

        if (parsed.type === 'FOG_OF_WAR_UPDATE') {
          let visibleEnemies = [];
          let myArmies = [];
          
          if (Array.isArray(parsed.payload)) {
             visibleEnemies = parsed.payload;
             myArmies = this.matchArmies.filter(a => a.owner === this.userProfile.username);
          } else if (parsed.payload && typeof parsed.payload === 'object') {
             visibleEnemies = parsed.payload.visibleEnemies || [];
             myArmies = parsed.payload.myArmies || this.matchArmies.filter(a => a.owner === this.userProfile.username);
             this.citiesHp = parsed.payload.citiesHp || {};
          }
          
          this.matchArmies = [...myArmies, ...visibleEnemies];
          this.renderArmies();
          this.renderCitiesHp();
          this.applyTerritoryColors();
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

        if (parsed.type === 'WAR_DECLARED' || parsed.type === 'TERRITORY_CONQUERED' || parsed.type === 'DIPLOMACY_UPDATED') {
          console.log(`[WS_MATCH] Aggiornamento mappa (${parsed.type})`);
          const updatedNations = parsed.nations || parsed.payload?.nations;
          if (updatedNations) {
            this.matchNations = updatedNations;
            this.applyTerritoryColors();
          }
          this.cdr.detectChanges();
        }

        if (parsed.type === 'ALLIANCE_UPDATED') {
          console.log(`[WS_MATCH] Aggiornamento alleanze (${parsed.type})`);
          this.reloadMatchAlliances();
        }

        if (parsed.type === 'COMBAT_EVENT') {
          const { attacker, defender, damage, result, players } = parsed.payload;
          if (players && players.includes(this.userProfile.username)) {
            let color = 'primary';
            let icon = 'information-circle-outline';
            if (result === 'distrutta') {
              color = 'danger';
              icon = 'skull-outline';
            }
            if (result === 'sopravvissuta') {
              color = 'warning';
              icon = 'shield-half-outline';
            }
            
            const message = `Scontro: ${attacker} vs ${defender} (Danno: ${damage}). Esito: ${result}.`;
            this.toastCtrl.create({
              message: message,
              duration: 4000,
              position: 'top',
              color: color,
              icon: icon
            }).then(t => t.present());

            // Ricarica il cimitero in tempo reale se la modale è aperta sulla tab storico
            if (this.isArmyModalOpen && this.armyModalComponent && this.armyModalComponent.activeTab === 'storico') {
              this.armyModalComponent.loadGraveyard();
            }
          }
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
    this.hideArmyHoverBanner();

    const updateBanner = () => {
        const currentArmy = this.matchArmies.find(a => a.id === army.id) || army;
        
        let calculatedDmg = 0;
        let calculatedMaxHp = 0;
        if (this.gameRules?.sheets) {
            const truppeSheet = this.gameRules.sheets.find((s: any) => s.name === 'Truppe');
            if (truppeSheet && currentArmy.composition) {
                for (const [troopId, count] of Object.entries(currentArmy.composition)) {
                    const stats = truppeSheet.lines.find((l: any) => l.id_truppa === troopId);
                    if (stats && Number(count) > 0) {
                        calculatedDmg += (stats.danno_base || 0) * Number(count);
                        calculatedMaxHp += (stats.HP || 10) * Number(count);
                    }
                }
            }
        }

        const dmg = calculatedDmg > 0 ? calculatedDmg : (currentArmy.damage || currentArmy.dmg_tot || 0);
        const hp = currentArmy.hp !== undefined ? currentArmy.hp : (calculatedMaxHp > 0 ? calculatedMaxHp : 100);
        const stato = String(currentArmy.status || 'Standby').toUpperCase();

        let timeInfo = '';
        const now = Date.now();
        
        if (currentArmy.status === 'in combattimento' && currentArmy.next_round_time) {
            const nextRoundDate = new Date(currentArmy.next_round_time).getTime();
            const diff = nextRoundDate - now;
            if (diff > 0) {
                const mins = Math.floor(diff / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                timeInfo = `<div style="margin-top: 6px; color: #f87171; font-weight: bold;">Prossimo Attacco in: ${mins}:${secs.toString().padStart(2, '0')}</div>`;
            } else {
                timeInfo = `<div style="margin-top: 6px; color: #f87171; font-weight: bold;">Attacco in corso...</div>`;
            }
        } else if ((currentArmy.status === 'moving' || currentArmy.status === 'moving_to_border' || currentArmy.status === "Pronto all'attacco") && currentArmy.startTime && currentArmy.etaMs) {
            const endMovementTime = currentArmy.startTime + currentArmy.etaMs;
            const diff = endMovementTime - now;
            if (diff > 0) {
                const hours = Math.floor(diff / 3600000);
                const mins = Math.floor((diff % 3600000) / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                const timeStr = hours > 0 
                    ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
                    : `${mins}:${secs.toString().padStart(2, '0')}`;
                timeInfo = `<div style="margin-top: 6px; color: #eab308; font-weight: bold;">Arrivo tra: ${timeStr}</div>`;
            }
        }

        const popupHtml = `
          <div style="background: rgba(15, 23, 42, 0.9); color: #e2e8f0; padding: 8px 12px; border-radius: 8px; border: 1px solid #334155; font-family: 'JetBrains Mono', monospace; font-size: 11px; backdrop-filter: blur(4px); box-shadow: 0 4px 6px rgba(0,0,0,0.5); width: max-content;">
              <div style="color: #60a5fa; font-weight: bold; margin-bottom: 6px; font-size: 12px; text-transform: uppercase;">${currentArmy.name}</div>
              <div style="display: flex; gap: 12px; font-weight: 600;">
                  <span><span style="color: #ef4444;">⚔️</span> ATK: ${dmg}</span>
                  <span><span style="color: #22c55e;">❤️</span> PV: ${hp}</span>
                  <span><span style="color: #f59e0b;">⚡</span> ${stato}</span>
              </div>
              ${timeInfo}
          </div>
        `;

        if (!this.armyHoverPopup) {
            this.armyHoverPopup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                anchor: 'bottom',
                offset: [0, -40],
                className: 'tactical-hover-popup'
            })
            .setLngLat(coordinates)
            .setHTML(popupHtml)
            .addTo(this.map);

            const popupContent = this.armyHoverPopup.getElement().querySelector('.maplibregl-popup-content');
            if (popupContent) {
                popupContent.style.padding = '0';
                popupContent.style.background = 'transparent';
                popupContent.style.boxShadow = 'none';
            }
        } else {
            this.armyHoverPopup.setHTML(popupHtml);
        }
    };

    updateBanner();
    this.armyHoverInterval = setInterval(updateBanner, 1000);
  }

  hideArmyHoverBanner() {
    if (this.armyHoverPopup) {
      this.armyHoverPopup.remove();
      this.armyHoverPopup = null;
    }
    if (this.armyHoverInterval) {
      clearInterval(this.armyHoverInterval);
      this.armyHoverInterval = null;
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

      // --- PERCORSI TRUPPE IN MOVIMENTO ---
      this.map.addSource('moving-troops-paths-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      this.map.addLayer({
        id: 'moving-troops-paths-layer',
        type: 'line',
        source: 'moving-troops-paths-source',
        paint: {
          'line-color': '#eab308', // Giallo
          'line-width': 3,
          'line-opacity': 0.8
        }
      });

      // --- PERCORSO TRUPPA IN HOVER ---
      this.map.addSource('hovered-troop-path-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      this.map.addLayer({
        id: 'hovered-troop-path-layer',
        type: 'line',
        source: 'hovered-troop-path-source',
        paint: {
          'line-color': '#eab308', // Giallo
          'line-width': 4,
          'line-opacity': 1.0
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

  getArmyCoordinates(army: any): [number, number] | null {
    if (!army.currentLocation) return null;
    if (typeof army.currentLocation === 'string') {
      if (army.currentLocation.includes(',')) {
        const parts = army.currentLocation.split(',').map((c: string) => parseFloat(c.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return [parts[0], parts[1]];
        }
      } else if (this.nodesGeoData && this.nodesGeoData.features) {
        const cityName = army.currentLocation.trim().toLowerCase();
        const matchingNode = this.nodesGeoData.features.find((f: any) =>
          f.properties.name && f.properties.name.toLowerCase() === cityName
        );
        if (matchingNode && matchingNode.geometry && matchingNode.geometry.coordinates) {
          return [matchingNode.geometry.coordinates[0], matchingNode.geometry.coordinates[1]];
        }
      }
    } else if (army.currentLocation && army.currentLocation.x !== undefined && army.currentLocation.y !== undefined) {
      return [army.currentLocation.x, army.currentLocation.y];
    } else if (Array.isArray(army.currentLocation) && army.currentLocation.length >= 2) {
      return [army.currentLocation[0], army.currentLocation[1]];
    }
    return null;
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
    const movingPathsFeatures: any[] = [];
    
    // Mappa per tenere traccia delle armate sulle stesse coordinate per evitare sovrapposizioni
    const coordinateCounts = new Map<string, number>();

    // --- FOG OF WAR LOGIC ---
    const currentUser = String(this.userProfile?.username || '').trim().toLowerCase();
    const alliedArmies = this.matchArmies.filter(a => String(a.owner || '').trim().toLowerCase() === currentUser);

    // Funzione helper Haversine
    const haversineDist = (lon1: number, lat1: number, lon2: number, lat2: number) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Aggiungiamo o aggiorniamo i marker
    this.matchArmies.forEach(army => {
      const coords = this.getArmyCoordinates(army);

      if (!coords) return;

      // Siccome il Server (fogOfWarEngine) invia unicamente le truppe nemiche 
      // all'interno del raggio visivo, possiamo assumere che tutte le armate
      // presenti in this.matchArmies debbano essere renderizzate.
      let isVisible = true;
      if (!isVisible) return;

      hasArmies = true;
      if (coords[0] < minLng) minLng = coords[0];
      if (coords[0] > maxLng) maxLng = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];

      const coordKey = `${coords[0].toFixed(5)},${coords[1].toFixed(5)}`;
      const countAtCoord = coordinateCounts.get(coordKey) || 0;
      coordinateCounts.set(coordKey, countAtCoord + 1);

      // Calculate an offset if multiple armies are on the exact same coordinate
      let markerCoords = [...coords];
      if (countAtCoord > 0) {
        // Offset di ~2km (0.02 gradi) a spirale per evitare sovrapposizioni
        const offsetRadius = 0.02 + (0.01 * Math.floor((countAtCoord - 1) / 8));
        const angle = countAtCoord * (Math.PI / 4); // 45 gradi di step
        markerCoords = [
          coords[0] + Math.cos(angle) * offsetRadius,
          coords[1] + Math.sin(angle) * offsetRadius
        ];
      }

      const totalTroops = (Object.values(army.composition || {}) as number[]).reduce((a, b) => a + b, 0) as number;

      if ((army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco") && army.path && army.path.length > 0) {
        let progress = 0;
        if (army.startTime && army.etaMs) {
           const elapsed = Date.now() - army.startTime;
           progress = Math.max(0, Math.min(1, elapsed / army.etaMs));
        }
        if (progress < 1) {
          movingPathsFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: army.path
            },
            properties: { armyId: army.id }
          });
        }
      }

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
        if (army.status !== 'moving' && army.status !== 'moving_to_border' && army.status !== "Pronto all'attacco") {
          marker.setLngLat([markerCoords[0], markerCoords[1]]);
        }
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

        // Inizializziamo a 32x32 per sicurezza
        container.style.width = '32px';
        container.style.height = '32px';

        const imgDiv = document.createElement('div');
        imgDiv.className = 'army-image';
        imgDiv.style.width = '100%';
        imgDiv.style.height = '100%';
        imgDiv.style.backgroundImage = `url(${this.getArmyModelAssetUrl(army, 'front')})`;
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
        if (army.owner !== this.userProfile.username) {
          if (army.status === "Pronto all'attacco" || army.status === 'in_battaglia' || army.status === 'moving_to_border') {
            imgDiv.style.filter = 'drop-shadow(0 0 5px red)';
            badgeDiv.style.border = '2px solid red';
          } else {
            imgDiv.style.filter = 'drop-shadow(0 0 5px yellow)';
            badgeDiv.style.border = '2px solid yellow';
          }
        }
        badgeDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        badgeDiv.style.position = 'absolute';

        container.appendChild(imgDiv);
        container.appendChild(badgeDiv);
        el.appendChild(container);

        // --- INTERAZIONI CLICK & HOVER ---
        let hoverTimer: any = null;
        let clickTimer: any = null;

        container.addEventListener('mouseenter', () => {
          const currentArmy = this.matchArmies.find(a => a.id === army.id) || army;
          if ((currentArmy.status === 'moving' || currentArmy.status === 'moving_to_border' || currentArmy.status === "Pronto all'attacco") && currentArmy.path && currentArmy.path.length > 0) {
            const hoverSource: any = this.map?.getSource('hovered-troop-path-source');
            if (hoverSource) {
              hoverSource.setData({
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: currentArmy.path },
                  properties: { armyId: currentArmy.id }
                }]
              });
            }
          }
          hoverTimer = setTimeout(() => {
            const currentMarker = this.armyMarkers.get(army.id);
            if (currentMarker) {
              const currentLngLat = currentMarker.getLngLat();
              this.showArmyHoverBanner(currentArmy, [currentLngLat.lng, currentLngLat.lat]);
            } else {
              const freshCoords = this.getArmyCoordinates(currentArmy);
              if (freshCoords) {
                this.showArmyHoverBanner(currentArmy, [freshCoords[0], freshCoords[1]]);
              }
            }
          }, 1000); // Mostra dopo 1 secondi
        });

        container.addEventListener('mouseleave', () => {
          const hoverSource: any = this.map.getSource('hovered-troop-path-source');
          if (hoverSource) {
            hoverSource.setData({ type: 'FeatureCollection', features: [] });
          }
          if (hoverTimer) clearTimeout(hoverTimer);
          this.hideArmyHoverBanner();
        });

        container.addEventListener('click', (e) => {
          e.stopPropagation(); // Evita che il click passi alla mappa sottostante
          if (hoverTimer) clearTimeout(hoverTimer);
          this.hideArmyHoverBanner();

          if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;

            // Doppio click -> Gestione armata
            this.selectedArmyId = army.id;
            this.isArmyModalOpen = true;
            this.armyModalInitialTab = 'management';
            this.isBuildPanelOpen = false;
            this.isTechModalOpen = false;
            this.isDiplomacyModalOpen = false;
            this.isIntelligenceModalOpen = false;
            this.isMarketModalOpen = false;
            this.closeMobileMenu();
            this.cdr.detectChanges();
          } else {
            clickTimer = setTimeout(() => {
              clickTimer = null;

              if (army.owner !== this.userProfile?.username && this.selectedArmiesForMovement.length > 0) {
                // Stiamo comandando un attacco!
                const targetCoords = [coords[0], coords[1]];
                this.selectedArmiesForMovement.forEach(armyId => {
                  const myArmy = this.matchArmies.find(a => a.id === armyId);
                  if (myArmy) {
                    this.onArmyMissionRequested({
                      armyId: myArmy.id,
                      mode: 'attack',
                      targetName: army.id,
                      targetCoords: targetCoords,
                      composition: myArmy.composition
                    });
                  }
                });
                this.toastCtrl.create({
                  message: `Ordine di attacco inviato per ${this.selectedArmiesForMovement.length} armate!`,
                  duration: 2000,
                  position: 'top',
                  color: 'danger'
                }).then(t => t.present());
                this.selectedArmiesForMovement = [];
                this.previousSelectedArmiesForMovement = [];
                return; // Non selezionare la truppa nemica
              }

              if (army.owner === this.userProfile?.username) {
                if (this.selectedArmiesForMovement.length === 1 && this.selectedArmiesForMovement[0] === army.id) {
                  // Stessa armata già selezionata, non cambiamo la selection
                } else {
                  // Salviamo la selezione precedente per poterla ripristinare col tasto +
                  this.previousSelectedArmiesForMovement = [...this.selectedArmiesForMovement];
                  this.selectedArmiesForMovement = [army.id];
                }

                const popupHtml = `
                      <div class="army-action-popup" style="display:flex; justify-content:center; padding:0;">
                         <button id="btn-add-multi" style="background: #10b981; color: white; border: 2px solid white; border-radius: 50%; font-weight: bold; font-size: 24px; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; line-height: 1; transition: transform 0.1s ease-out;">+</button>
                      </div>
                    `;
                if (this.activeArmyPopup) {
                  this.activeArmyPopup.remove();
                }
                const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: [30, 0], anchor: 'left' })
                  .setLngLat([coords[0], coords[1]])
                  .setHTML(popupHtml)
                  .addTo(this.map);
                this.activeArmyPopup = popup;

                setTimeout(() => {
                  if (this.activeArmyPopup === popup) {
                    popup.remove();
                    this.activeArmyPopup = null;
                  }
                }, 5000);

                const popupContent = popup.getElement().querySelector('.maplibregl-popup-content') as HTMLElement;
                if (popupContent) {
                  popupContent.style.padding = '0';
                  popupContent.style.background = 'transparent';
                  popupContent.style.boxShadow = 'none';
                }
                const popupTip = popup.getElement().querySelector('.maplibregl-popup-tip') as HTMLElement;
                if (popupTip) {
                  popupTip.style.display = 'none';
                }

                this.toastCtrl.create({
                  message: 'Armata selezionata. Clicca sulla mappa o su un nemico.',
                  duration: 1500,
                  position: 'top',
                  color: 'primary'
                }).then(t => t.present());

                setTimeout(() => {
                  const btnMulti = document.getElementById('btn-add-multi');
                  if (btnMulti) {
                    btnMulti.addEventListener('click', (e) => {
                      e.stopPropagation();
                      const newSelection = new Set([...this.previousSelectedArmiesForMovement, army.id]);
                      this.selectedArmiesForMovement = Array.from(newSelection);
                      this.previousSelectedArmiesForMovement = [...this.selectedArmiesForMovement];

                      popup.remove();
                      if (this.activeArmyPopup === popup) this.activeArmyPopup = null;
                      
                      this.toastCtrl.create({
                        message: `${this.selectedArmiesForMovement.length} armate selezionate.`,
                        duration: 2000,
                        color: 'secondary'
                      }).then(t => t.present());
                    });
                  }
                }, 50);
              } else {
                this.toastCtrl.create({
                  message: 'Truppa nemica. Seleziona prima una tua truppa per attaccare.',
                  duration: 2000,
                  position: 'top',
                  color: 'warning'
                }).then(t => t.present());
              }
            }, 250);
          }
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([markerCoords[0], markerCoords[1]])
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
      try {
        if (this.map.getLayer('tethers-layer')) this.map.moveLayer('tethers-layer');
      } catch (err) { console.warn(err); }
    }

    if (this.map.getSource('moving-troops-paths-source')) {
      (this.map.getSource('moving-troops-paths-source') as any).setData({
        type: 'FeatureCollection',
        features: movingPathsFeatures
      });
      try {
        if (this.map.getLayer('moving-troops-paths-layer')) this.map.moveLayer('moving-troops-paths-layer');
        if (this.map.getLayer('hovered-troop-path-layer')) this.map.moveLayer('hovered-troop-path-layer');
      } catch (err) { console.warn(err); }
    }

    if (this.isFirstArmyRender && hasArmies) {
      this.isFirstArmyRender = false;
      if (minLng <= maxLng && minLat <= maxLat) {
        this.map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 6, duration: 2000 });
      }
    }

    // Aggiorniamo la visibilità subito dopo il render
    this.updateArmyMarkersScale();
    this.reorderMapLayers();
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

  // --- RENDERING BARRE HP CITTA ---
  renderCitiesHp() {
    if (!this.map || !this.nodesGeoData?.features) return;

    // Rimuoviamo i marker non più presenti (es. tornati a 1000)
    for (const [cityId, marker] of this.cityHpMarkers.entries()) {
      if (this.citiesHp[cityId] === undefined || this.citiesHp[cityId] >= 1000) {
        marker.remove();
        this.cityHpMarkers.delete(cityId);
      }
    }

    for (const [cityId, hp] of Object.entries(this.citiesHp)) {
      if (hp >= 1000) continue;

      const feature = this.nodesGeoData.features.find((f: any) =>
        f.id === cityId || (f.properties.name && f.properties.name.toLowerCase() === cityId.toLowerCase())
      );
      if (!feature || !feature.geometry || !feature.geometry.coordinates) continue;

      let center = feature.geometry.coordinates;
      while (center.length && Array.isArray(center[0])) center = center[0];
      if (center.length !== 2) continue;

      let marker = this.cityHpMarkers.get(cityId);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'city-hp-marker';
        el.style.width = '40px';
        el.style.height = '6px';
        el.style.backgroundColor = 'rgba(0,0,0,0.8)';
        el.style.border = '1px solid #333';
        el.style.borderRadius = '3px';
        el.style.position = 'relative';
        el.style.zIndex = '997'; // Sotto armate
        el.style.pointerEvents = 'none';

        const bar = document.createElement('div');
        bar.className = 'city-hp-bar';
        bar.style.height = '100%';
        bar.style.backgroundColor = '#ef4444'; // red-500
        bar.style.width = '100%';
        bar.style.borderRadius = '2px';
        bar.style.transition = 'width 0.3s ease-out';
        el.appendChild(bar);

        const text = document.createElement('div');
        text.className = 'city-hp-text';
        text.style.color = 'white';
        text.style.fontSize = '9px';
        text.style.fontWeight = 'bold';
        text.style.textShadow = '1px 1px 2px black, -1px -1px 2px black';
        text.style.position = 'absolute';
        text.style.top = '8px';
        text.style.left = '50%';
        text.style.transform = 'translateX(-50%)';
        text.style.whiteSpace = 'nowrap';
        el.appendChild(text);

        marker = new (window as any).maplibregl.Marker({ element: el })
          .setLngLat([center[0], center[1]])
          .addTo(this.map);
        
        this.cityHpMarkers.set(cityId, marker);
      }

      const el = marker.getElement();
      const bar = el.querySelector('.city-hp-bar') as HTMLElement;
      const text = el.querySelector('.city-hp-text') as HTMLElement;
      
      const percent = Math.max(0, Math.min(100, (hp / 1000) * 100));
      if (bar) bar.style.width = `${percent}%`;
      if (text) text.innerText = `${hp}/1000`;
    }
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

        // Riesegue il render delle armate ora che i nodi sono disponibili
        this.renderArmies();

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
      if (event.mode === 'cancel') {
        this.matchSocket.send(JSON.stringify({
          action: 'CANCEL_MISSION',
          payload: {
            armyId: event.armyId
          }
        }));
      } else {
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
      }
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

  centerMapOnArmy(armyId: string) {
    const marker = this.armyMarkers.get(armyId);
    if (marker && this.map) {
      const coords = marker.getLngLat();
      this.map.flyTo({ center: [coords.lng, coords.lat], zoom: 8, duration: 1500 });
    }
  }

  promptMovementOrAttack(targetName: string, targetCoords: string, lngLat: any) {
    const popupHtml = `
      <div style="display:flex; flex-direction:column; gap:8px; padding:12px; background: rgba(17, 24, 39, 0.95); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); min-width: 140px;">
        <div style="font-weight:bold; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; text-align:center; margin-bottom:4px; color:#9ca3af;">Ordini</div>
        <button id="btn-popup-attack" style="background:linear-gradient(to right, #ef4444, #dc2626); color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:bold; font-size: 14px; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3); transition: all 0.2s;">
          <ion-icon name="flame"></ion-icon> Attacca
        </button>
        <button id="btn-popup-move" style="background:linear-gradient(to right, #3b82f6, #2563eb); color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:bold; font-size: 14px; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3); transition: all 0.2s;">
          <ion-icon name="navigate"></ion-icon> Sposta
        </button>
      </div>
    `;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: [0, -10] })
      .setLngLat([lngLat.lng, lngLat.lat])
      .setHTML(popupHtml)
      .addTo(this.map);

    const popupContent = popup.getElement().querySelector('.maplibregl-popup-content') as HTMLElement;
    if (popupContent) {
      popupContent.style.padding = '0';
      popupContent.style.background = 'transparent';
      popupContent.style.boxShadow = 'none';
    }
    const popupTip = popup.getElement().querySelector('.maplibregl-popup-tip') as HTMLElement;
    if (popupTip) {
      popupTip.style.display = 'none';
    }

    setTimeout(() => {
      const btnAttack = document.getElementById('btn-popup-attack');
      const btnMove = document.getElementById('btn-popup-move');

      if (btnAttack) {
        btnAttack.addEventListener('click', (e) => {
          e.stopPropagation();
          this.sendMissionOrder('attack', targetName, targetCoords);
          popup.remove();
        });
      }
      if (btnMove) {
        btnMove.addEventListener('click', (e) => {
          e.stopPropagation();
          this.sendMissionOrder('move', targetName, targetCoords);
          popup.remove();
        });
      }
    }, 50);
  }

  private sendMissionOrder(mode: 'attack' | 'move', targetName: string, targetCoords: string) {
    this.selectedArmiesForMovement.forEach(armyId => {
      const army = this.matchArmies.find(a => a.id === armyId);
      if (army) {
        this.onArmyMissionRequested({
          armyId: army.id,
          mode: mode,
          targetName: targetName,
          targetCoords: targetCoords,
          composition: army.composition
        });
      }
    });
    this.toastCtrl.create({
      message: `Ordine di ${mode === 'attack' ? 'attacco' : 'movimento'} inviato per ${this.selectedArmiesForMovement.length} armate.`,
      duration: 2000,
      position: 'top',
      color: 'success'
    }).then(t => t.present());
    this.selectedArmiesForMovement = [];
    this.previousSelectedArmiesForMovement = [];
  }

  handleMapPointSelect(e: any) {
    console.log("Map clicked!", e.point);

    if (this.selectedArmiesForMovement.length > 0) {
      this.updatePointReadout(e, true);
      const targetCoords = this.formatMapCoordinates(e.lngLat.lng, e.lngLat.lat);
      const targetName = this.selectedPointName || 'OBIETTIVO';

      this.promptMovementOrAttack(targetName, targetCoords, e.lngLat);
      return;
    }

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

    return `${wrappedLng.toFixed(5)}, ${lat.toFixed(5)}`;
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

      this.reorderMapLayers();
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
      } else if (nation.inWarWith && nation.inWarWith.includes(currentUser)) {
        statusColor = '#ef4444'; // Rosso solo se è in guerra con ME
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

    const attackedTerritories = new Set<string>();
    if (this.matchArmies) {
       this.matchArmies.forEach(army => {
          if (army.owner === currentUser || army.owner === this.userProfile?.username || !army.owner) {
              if (army.status === 'attacking' || army.status === 'in combattimento' || ((army.status === "Pronto all'attacco" || army.status === 'moving') && army.missionMode === 'attack')) {
                  if (army.targetName && army.targetName !== 'OBIETTIVO' && army.targetName !== 'SCONOSCIUTO') {
                      attackedTerritories.add(army.targetName.toLowerCase());
                  }
              }
          }
       });
    }

    this.regionsGeoData.features.forEach((f: any) => {
      const pId = f.properties.adm1_code || f.properties.name || f.id;
      if (pId && attackedTerritories.has(pId.toLowerCase())) {
        f.properties.fillColor = '#ef4444'; // Red for territories under attack
      } else if (colorMap[pId]) {
        f.properties.fillColor = colorMap[pId];
      } else {
        f.properties.fillColor = '#00000000'; // Trasparente
      }
    });

    const source = this.map.getSource('regioni') as any;
    if (source) {
      source.setData(this.regionsGeoData);
    }

    this.updateNationBannersVisibility();
    this.reorderMapLayers();
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