import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef, ViewChild, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, MenuController, ToastController, ActionSheetController } from '@ionic/angular'; // <--- AGGIUNTO MenuController
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { HomeService } from '../../home/home';
import { AuthApiService } from '../../auth/auth-api.service';
import { UserStateService } from '../../user-state.service';
import { environment } from '../../../environments/environment';

import { ProfileModalComponent } from '../components/profile-modal/profile-modal.component';
import { DiplomacyModalComponent } from '../components/diplomacy-modal/diplomacy-modal.component';
import { IntelligenceModalComponent } from '../components/intelligence-modal/intelligence-modal.component';
import { InGameChatComponent } from '../components/in-game-chat/in-game-chat.component';
import { TechTreeComponent } from '../components/tech-tree/tech-tree.component';
import { MarketModalComponent } from '../components/market-modal/market-modal.component';
import { ArmyModalComponent } from '../components/army-modal/army-modal.component';

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
  @ViewChild(InGameChatComponent) chatComponent!: InGameChatComponent;
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
  playerTrainings: any[] = [];
  fantiRate: number = 0;

  showResourceDetails = false;
  armyModalInitialTab: 'management' | 'operations' = 'management';
  isTroopsDropdownOpen = false;
  troopsDropdownX = 0;
  troopsDropdownY = 0;

  activeBuildCategory: 'risorse' | 'armamenti' = 'risorse';
  selectedStructureForBuild: any = null;
  buildPreviewMarker: any = null;
  userTechnologies: string[] = [];
  matchStructures: any[] = [];
  structureMarkers = new Map<string, any>();

  matchArmies: any[] = [];
  armyMarkers = new Map<string, any>(); // Ripristinato per i marker HTML
  armyTetherCache = new Map<string, number[]>(); // Cache per i target node tether (evita freeze su spostamenti)
  nodesGeoData: any = null; // Per i tether
  armyHoverPopup: any = null; // Per l'hover di 3 secondi
  armyHoverInterval: any = null;
  isFirstArmyRender = true;
  matchNations: any[] = [];
  regionsGeoData: any = null;
  regionIdMap: Map<string, number> = new Map();
  nationMarkers: any[] = [];
  regionsResources: any = {};
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
      if (army.composition['carro_armato']) { modelName = 'Tank'; folder = 'Land_troops'; }
      else if (army.composition['apc']) { modelName = 'APC'; folder = 'Land_troops'; }
      else if (army.composition['sam_mobile']) { modelName = 'SAM'; folder = 'Land_troops'; }
      else if (army.composition['lmv']) { modelName = 'LMV'; folder = 'Land_troops'; }
      else if (army.composition['speciali']) { modelName = 'Special'; folder = 'Land_troops'; }
      else if (army.composition['artiglieria']) { modelName = 'Tank'; folder = 'Land_troops'; }
      else if (army.composition['cacciatorpediniere']) { modelName = 'Cacciatorpediniere'; folder = 'Sea_troops'; }
      else if (army.composition['fregata']) { modelName = 'Fregata'; folder = 'Sea_troops'; }
      else if (army.composition['corvetta']) { modelName = 'Corvetta'; folder = 'Sea_troops'; }
      else if (army.composition['cargo_navale']) { modelName = 'CargoBoat'; folder = 'Sea_troops'; }
      else if (army.composition['caccia']) { modelName = 'F35'; folder = 'Air_troops'; }
    }

    if (army.id_modello) {
      const mod = army.id_modello.toLowerCase();
      if (mod.includes('tank') || mod.includes('carro_armato')) { modelName = 'Tank'; folder = 'Land_troops'; }
      else if (mod.includes('apc')) { modelName = 'APC'; folder = 'Land_troops'; }
      else if (mod.includes('sam')) { modelName = 'SAM'; folder = 'Land_troops'; }
      else if (mod.includes('lmv')) { modelName = 'LMV'; folder = 'Land_troops'; }
      else if (mod.includes('special')) { modelName = 'Special'; folder = 'Land_troops'; }
      else if (mod.includes('artiglieria')) { modelName = 'Tank'; folder = 'Land_troops'; }
      else if (mod.includes('cacciatorpediniere')) { modelName = 'Cacciatorpediniere'; folder = 'Sea_troops'; }
      else if (mod.includes('fregata')) { modelName = 'Fregata'; folder = 'Sea_troops'; }
      else if (mod.includes('corvetta')) { modelName = 'Corvetta'; folder = 'Sea_troops'; }
      else if (mod.includes('cargo')) { modelName = 'CargoBoat'; folder = 'Sea_troops'; }
      else if (mod.includes('caccia') || mod.includes('aircraft')) { modelName = 'F35'; folder = 'Air_troops'; }
    }

    const suffix = '_' + direction.replace('-flip', '') + '.png';
    if (modelName === 'Soldier') {
      return `/assets/2Dmodels/Land_troops/Soldier/soldier${suffix}`;
    }
    return `/assets/2Dmodels/${folder}/${modelName}/${modelName}${suffix}`;
  }

  startAnimationLoop() {
    this.ngZone.runOutsideAngular(() => {
      const animate = () => {
        try {
          this.updateMovingArmies();
        } catch (err) {
          console.error('Animation loop error:', err);
        }
        this.animationFrameId = requestAnimationFrame(animate);
      };
      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  /**
   * Pre-calcola le distanze cumulative dei segmenti del path di un'armata.
   * Viene chiamato UNA SOLA VOLTA quando il path viene assegnato (TROOPS_MOVED / INITIAL_STATE).
   * updateMovingArmies() usa poi questo cache per trovare il segmento con ricerca binaria O(log n)
   * invece di ricalcolare O(n) ogni frame (~60 volte/s).
   */
  private precomputeArmyPathCache(army: any) {
    if (!army.path || army.path.length < 2) {
      delete army._pathCache;
      return;
    }
    const segDists: number[] = [];
    const cumDists: number[] = [0];
    let total = 0;
    for (let i = 0; i < army.path.length - 1; i++) {
      const dx = army.path[i + 1][0] - army.path[i][0];
      const dy = army.path[i + 1][1] - army.path[i][1];
      const d = Math.sqrt(dx * dx + dy * dy);
      segDists.push(d);
      total += d;
      cumDists.push(total);
    }
    army._pathCache = { segmentDistances: segDists, totalDistance: total, cumulativeDistances: cumDists };
  }

  /** Ricerca binaria dell'indice di segmento dato targetDist nelle distanze cumulative. O(log n). */
  private findSegmentBinarySearch(cumDists: number[], targetDist: number): number {
    let lo = 0;
    let hi = cumDists.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumDists[mid + 1] < targetDist) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  updateMovingArmies() {
    if (!this.map || this.matchArmies.length === 0) return;
    const now = Date.now();
    this.matchArmies.forEach(army => {
      if ((army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco") && army.path && army.path.length > 1 && army.startTime && army.etaMs) {
        const elapsed = now - army.startTime;
        const progress = Math.max(0, Math.min(1, elapsed / army.etaMs));

        let currentLngLat: [number, number] = army.path[army.path.length - 1];
        let prevLngLat: [number, number] = army.path[0];
        let direction: 'front' | 'back' | 'side' | 'side-flip' = 'front';

        if (progress < 1) {
          army._hasVisuallyArrived = false;

          // Usa la cache pre-calcolata se disponibile, altrimenti calcolala ora (lazy)
          if (!army._pathCache) {
            this.precomputeArmyPathCache(army);
          }

          const cache = army._pathCache;
          if (cache && cache.totalDistance > 0) {
            const targetDistance = progress * cache.totalDistance;
            // Ricerca binaria O(log n) invece del loop O(n) originale
            const segIdx = this.findSegmentBinarySearch(cache.cumulativeDistances, targetDistance);
            const segDist = cache.segmentDistances[segIdx];
            const segProgress = segDist > 0
              ? (targetDistance - cache.cumulativeDistances[segIdx]) / segDist
              : 0;
            const p1: [number, number] = army.path[segIdx];
            const p2: [number, number] = army.path[segIdx + 1] || p1;
            prevLngLat = p1;
            currentLngLat = [
              p1[0] + (p2[0] - p1[0]) * segProgress,
              p1[1] + (p2[1] - p1[1]) * segProgress
            ];
          }
        } else {
          prevLngLat = army.path ? army.path[Math.max(0, army.path.length - 2)] : currentLngLat;
          if (!army._hasVisuallyArrived) {
            army._hasVisuallyArrived = true;
            army.status = 'standby';
            army.currentLocation = { x: currentLngLat[0], y: currentLngLat[1] };
            delete army.path;
            delete army.etaMs;
            delete army.startTime;
            delete army._pathCache; // Libera la cache
            setTimeout(() => this.renderArmies(), 0);
          }
        }

        const dx = currentLngLat[0] - prevLngLat[0];
        const dy = currentLngLat[1] - prevLngLat[1];
        if (Math.abs(dx) > Math.abs(dy)) {
          direction = dx > 0 ? 'side' : 'side-flip';
        } else {
          direction = dy > 0 ? 'back' : 'front';
        }

        const marker = this.armyMarkers.get(army.id);
        if (marker) {
          marker.setLngLat(currentLngLat);
          const el = marker.getElement();

          let imgDiv = (marker as any).imgDiv;
          if (!imgDiv) {
            imgDiv = el.querySelector('.army-image') as HTMLElement;
            (marker as any).imgDiv = imgDiv;
          }

          if (imgDiv) {
            if ((marker as any)._lastDirection !== direction) {
              const assetUrl = `url(${this.getArmyModelAssetUrl(army, direction)})`;
              imgDiv.style.backgroundImage = assetUrl;
              const targetTransform = direction === 'side-flip' ? 'scaleX(-1)' : 'scaleX(1)';
              imgDiv.style.transform = targetTransform;
              (marker as any)._lastDirection = direction;
            }
          }
        }
      }
    });
  }

  // --- 3. DATI DI GIOCO E REGOLE ---
  gameRules: any = null;

  playerResources: any = {
    denaro: 0, legno: 0, piombo: 0, acciaio: 0,
    mattoni: 0, petrolio: 0, gas_naturale: 0, uranio: 0, oro: 0
  };

  resourceAnimations: { [key: string]: { id: number, amount: number, active: boolean }[] } = {};
  private animationIdCounter = 0;

  updatePlayerResources(newResources: any) {
    if (!newResources) return;

    // Controlla se le risorse precedenti non erano a 0 (per evitare animazioni al primo caricamento/refresh)
    const hasInitialValues = this.playerResources && this.playerResources['denaro'] > 0;

    if (hasInitialValues) {
      for (const key of Object.keys(newResources)) {
        const oldVal = this.playerResources[key] || 0;
        const newVal = newResources[key] || 0;
        const diff = newVal - oldVal;

        if (diff < -5) { // Evita micro fluttuazioni, cattura solo spese reali
          this.triggerResourceAnimation(key, diff);
        }
      }
    }

    // Clona l'oggetto per forzare la change detection di Angular
    this.playerResources = { ...newResources };
  }

  triggerResourceAnimation(resourceId: string, amount: number) {
    if (!this.resourceAnimations[resourceId]) {
      this.resourceAnimations[resourceId] = [];
    }
    const animId = this.animationIdCounter++;
    this.resourceAnimations[resourceId].push({ id: animId, amount, active: true });

    setTimeout(() => {
      if (this.resourceAnimations[resourceId]) {
        this.resourceAnimations[resourceId] = this.resourceAnimations[resourceId].filter(a => a.id !== animId);
        this.cdr.detectChanges();
      }
    }, 2000);
  }

  userProfile = {
    username: 'Caricamento...',
    rank: 'Generale di Brigata',
    experience: 85, matchesWon: 24, matchesLost: 5, kdRatio: '4.8',
    avatar: this.avatarPath(1)
  };

  playerTroops: any = {};

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

  getResourceIcon(resourceId: string): string {
    if (!resourceId) return '';
    const res = this.resourceConfig.find(r => r.id === resourceId);
    return res ? res.icon : '';
  }

  resourceProduction: any = {
    denaro: 0,
    legno: 0,
    piombo: 0,
    acciaio: 0,
    mattoni: 0,
    petrolio: 0,
    gas_naturale: 0,
    uranio: 0,
    oro: 0
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
    private userState: UserStateService,
    private ngZone: NgZone
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
      this.ngZone.runOutsideAngular(() => {
        this.matchSocket = new WebSocket(wsUrl);

        this.matchSocket.onopen = () => {
          console.log('[WS_MATCH] Connessione al server di gioco stabilita.');
          this.matchSocket?.send(JSON.stringify({ action: 'GET_INITIAL_STATE' }));
          this.ngZone.run(() => this.cdr.detectChanges());
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
              // Pre-calcola la path cache per le armate già in movimento al momento del caricamento
              this.matchArmies.forEach((a: any) => {
                if (a.path && a.path.length > 1) this.precomputeArmyPathCache(a);
              });
              const moving = this.matchArmies.find((a: any) => a.status === "moving");
              if (moving) console.log("INITIAL_STATE moving army:", moving.id, "startTime:", moving.startTime, "path:", moving.path?.length);
              this.renderArmies();
            }
            if (parsed.payload?.nations) {
              this.matchNations = parsed.payload.nations;
              this.applyTerritoryColors();
            }
            if (parsed.payload?.resources) {
              this.updatePlayerResources(parsed.payload.resources);
            }
            if (parsed.payload?.production) {
              this.resourceProduction = parsed.payload.production;
            }
            if (parsed.payload?.structures) {
              this.matchStructures = parsed.payload.structures;
              setTimeout(() => this.renderStructures(), 100);
            }
            if (parsed.payload?.regionsResources) {
              this.regionsResources = parsed.payload.regionsResources;
            }
            if (parsed.payload?.technologies) {
              this.userTechnologies = parsed.payload.technologies;
            }
            if (parsed.payload?.trainings) {
              this.playerTrainings = parsed.payload.trainings;
            }
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'RESEARCH_SUCCESS') {
            this.toastCtrl.create({
              message: 'Ricerca completata! Hai sbloccato una nuova tecnologia.',
              duration: 3000,
              position: 'bottom',
              color: 'success'
            }).then(t => t.present());
            if (parsed.payload?.technologies) {
              this.userTechnologies = parsed.payload.technologies;
            }
            if (parsed.payload?.risorse) {
              this.updatePlayerResources(parsed.payload.risorse);
            }
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'RECRUIT_UNIT_SUCCESS') {
            if (parsed.payload?.trainings) {
              this.playerTrainings = [...parsed.payload.trainings];
            }
            if (parsed.payload?.resources) {
              this.updatePlayerResources(parsed.payload.resources);
            }
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'RESOURCES_UPDATED') {
            if (parsed.data?.resources) {
              this.updatePlayerResources(parsed.data.resources);
            }
            if (parsed.data?.production) {
              this.resourceProduction = parsed.data.production;
            }
            if (parsed.data?.truppe) {
              this.playerTroops = parsed.data.truppe;
            }
            if (parsed.data?.fanti_rate !== undefined) {
              this.fantiRate = parsed.data.fanti_rate;
            }
            if (parsed.data?.armies_updated && parsed.data?.armies) {
              this.matchArmies = parsed.data.armies;
            }
            if (parsed.data?.addestramenti) {
              this.playerTrainings = parsed.data.addestramenti;
            }
            if (parsed.data?.strutture) {
              const playerStr = parsed.data.strutture.map((s: any) => ({ ...s, owner: this.userProfile.username }));
              // Keep non-player structures intact
              this.matchStructures = this.matchStructures.filter((s: any) => s.owner !== this.userProfile.username).concat(playerStr);
              setTimeout(() => this.renderStructures(), 100);
            }
            this.ngZone.run(() => this.cdr.detectChanges());
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
              // Pre-calcola la cache del path una sola volta appena ricevuto
              this.precomputeArmyPathCache(newArmies[armyIndex]);
              this.armyTetherCache.delete(armyId); // Invalida il tether per forzare il ricalcolo al nuovo target
              this.matchArmies = newArmies;
            }
            console.log(`[WS_MATCH] Movimento in corso verso ${targetName}. Arrivo stimato: ${etaMs}ms`);
            this.renderArmies();
            this.applyTerritoryColors(); // <-- Re-added to fix red layout on attack
            this.ngZone.run(() => this.cdr.detectChanges());
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
              delete newArmies[armyIndex]._pathCache; // Libera la cache
              this.armyTetherCache.delete(armyId); // Invalida tether cache per l'arrivo
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
            this.ngZone.run(() => this.cdr.detectChanges());
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
              delete newArmies[armyIndex]._pathCache; // Libera la cache
              this.matchArmies = newArmies;

              const hoverSource: any = this.map?.getSource('hovered-troop-path-source');
              if (hoverSource) {
                hoverSource.setData({ type: 'FeatureCollection', features: [] });
              }
              this.hideArmyHoverBanner();
            }
            console.log(`[WS_MATCH] Missione armata ${armyId} annullata.`);
            this.renderArmies();
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'COMBAT_CANCELLED') {
            const { armyId } = parsed.data;
            const armyIndex = this.matchArmies.findIndex(a => a.id === armyId);
            if (armyIndex !== -1 && this.matchArmies[armyIndex].status === 'in combattimento') {
              const newArmies = [...this.matchArmies];
              newArmies[armyIndex] = { ...newArmies[armyIndex] };
              newArmies[armyIndex].status = 'standby';
              delete newArmies[armyIndex].targetName;
              delete newArmies[armyIndex].missionMode;
              delete newArmies[armyIndex].path;
              delete newArmies[armyIndex].etaMs;
              delete newArmies[armyIndex].startTime;
              delete newArmies[armyIndex].next_round_time;
              delete newArmies[armyIndex]._pathCache; // Libera la cache
              this.matchArmies = newArmies;
              this.renderArmies();
              this.ngZone.run(() => this.cdr.detectChanges());
            }
          }

          if (parsed.type === 'TROOPS_SPAWNED') {
            const { userId, army } = parsed.data;
            if (userId === this.userProfile.username) {
              this.matchArmies.push(army);
              console.log(`[WS_MATCH] Nuova truppa generata a Palermo per l'utente ${userId}!`);
            }
            this.renderArmies();
            this.ngZone.run(() => this.cdr.detectChanges());
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

            const newArmies = [...myArmies, ...visibleEnemies];

            // Mantieni la path cache e altri flag visivi per evitare ricalcoli costanti e lag loop
            newArmies.forEach(newA => {
              const oldA = this.matchArmies.find(a => a.id === newA.id);
              if (oldA) {
                if (oldA._pathCache) newA._pathCache = oldA._pathCache;
                if (oldA._hasVisuallyArrived) newA._hasVisuallyArrived = oldA._hasVisuallyArrived;

                // Conserva i parametri di movimento locale se per qualche motivo il FOW_UPDATE
                // arriva prima che il DB abbia confermato il salvataggio dei nuovi dati
                if (!newA.missionMode && oldA.missionMode) newA.missionMode = oldA.missionMode;
                if (!newA.targetName && oldA.targetName) newA.targetName = oldA.targetName;
                if (!newA.path && oldA.path) newA.path = oldA.path;
                if (!newA.etaMs && oldA.etaMs) newA.etaMs = oldA.etaMs;
                if (!newA.startTime && oldA.startTime) newA.startTime = oldA.startTime;
                if (oldA.status === 'moving' || oldA.status === 'moving_to_border' || oldA.status === "Pronto all'attacco") {
                  if (newA.status !== oldA.status) newA.status = oldA.status;
                }
              }
            });

            this.matchArmies = newArmies;
            this.renderArmies();
            this.renderCitiesHp();
            this.applyTerritoryColors();
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'FOG_OF_WAR_STRUCTURES_UPDATE') {
            if (parsed.payload && Array.isArray(parsed.payload.visibleStructures)) {
              this.matchStructures = parsed.payload.visibleStructures;
              setTimeout(() => this.renderStructures(), 100);
              this.ngZone.run(() => this.cdr.detectChanges());
            }
          }

          if (parsed.type === 'PLAYER_JOINED') {
            console.log(`[WS_MATCH] Un nuovo giocatore si è unito: ${parsed.payload.newPlayer}`);
            if (parsed.payload?.nations) {
              this.matchNations = parsed.payload.nations;
              this.applyTerritoryColors();
            }
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'WAR_DECLARED' || parsed.type === 'TERRITORY_CONQUERED' || parsed.type === 'DIPLOMACY_UPDATED') {
            console.log(`[WS_MATCH] Aggiornamento mappa (${parsed.type})`);
            const updatedNations = parsed.nations || parsed.payload?.nations;
            if (updatedNations) {
              this.matchNations = updatedNations;
              this.applyTerritoryColors();

              if (parsed.type === 'TERRITORY_CONQUERED') {
                // Aggiorniamo i proprietari delle strutture già visibili senza leakare quelle nemiche
                for (const visibleStr of this.matchStructures) {
                  for (const n of this.matchNations) {
                    if (n.strutture && n.strutture.some((s: any) => s.id === visibleStr.id)) {
                      visibleStr.owner = n.username;
                    }
                  }
                }

                // Aggiungiamo eventuali strutture che sono passate a noi o ai nostri alleati
                const myPlayer = this.matchNations.find(p => p.username === this.userProfile.username);
                const myAllianceId = myPlayer ? myPlayer.id_alleanza : null;

                for (const n of this.matchNations) {
                  const isAlly = myAllianceId && String(n.id_alleanza) === String(myAllianceId);
                  if (n.username === this.userProfile.username || isAlly) {
                    if (n.strutture) {
                      for (const s of n.strutture) {
                        if (!this.matchStructures.some((ms: any) => ms.id === s.id)) {
                          this.matchStructures.push({ ...s, owner: n.username });
                        }
                      }
                    }
                  }
                }

                this.renderStructures();
              }
            }
            this.ngZone.run(() => this.cdr.detectChanges());
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

          if (parsed.type === 'BUILD_SUCCESS') {
            const isBuilding = parsed.payload.status === 'building';
            this.toastCtrl.create({
              message: isBuilding ? `Costruzione di ${parsed.payload.name} avviata!` : `Struttura ${parsed.payload.name} costruita con successo!`,
              duration: 3000,
              position: 'top',
              color: 'success'
            }).then(t => t.present());

            if (parsed.replacedStructureId) {
              const oldMarker = this.structureMarkers.get(parsed.replacedStructureId);
              if (oldMarker) { oldMarker.remove(); this.structureMarkers.delete(parsed.replacedStructureId); }
              this.matchStructures = this.matchStructures.filter(s => s.id !== parsed.replacedStructureId);
            }
            this.matchStructures = [...this.matchStructures, parsed.payload];

            setTimeout(() => this.renderStructures(), 100);
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'STRUCTURE_BUILT') {
            if (parsed.replacedStructureId) {
              const oldMarker = this.structureMarkers.get(parsed.replacedStructureId);
              if (oldMarker) { oldMarker.remove(); this.structureMarkers.delete(parsed.replacedStructureId); }
              this.matchStructures = this.matchStructures.filter(s => s.id !== parsed.replacedStructureId);
            }
            if (parsed.data.owner !== this.userProfile.username) {
              this.matchStructures = [...this.matchStructures, parsed.data];
              setTimeout(() => this.renderStructures(), 100);
              this.ngZone.run(() => this.cdr.detectChanges());
            }
          }

          if (parsed.type === 'STRUCTURE_COMPLETED') {
            const structureId = parsed.data.id;
            const existingIndex = this.matchStructures.findIndex(s => s.id === structureId);
            if (existingIndex !== -1) {
              this.matchStructures[existingIndex].status = 'built';
            } else {
              this.matchStructures.push(parsed.data);
            }
            if (parsed.data.owner === this.userProfile.username) {
              this.toastCtrl.create({
                message: `Struttura ${parsed.data.name} completata!`,
                duration: 3000,
                position: 'top',
                color: 'success'
              }).then(t => t.present());
            }
            setTimeout(() => this.renderStructures(), 100);
            this.ngZone.run(() => this.cdr.detectChanges());
          }

          if (parsed.type === 'ERROR') {
            console.error("[WS ERROR RICEVUTO]:", parsed);
            this.toastCtrl.create({
              message: parsed.error || 'Si è verificato un errore',
              duration: 3000,
              position: 'top',
              color: 'danger'
            }).then(t => t.present());
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
      }); // Close ngZone.runOutsideAngular
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
      this.ngZone.runOutsideAngular(() => {
        setTimeout(() => {
          this.initMap();

          // Un singolo resize assicurativo post-rendering
          setTimeout(() => {
            if (this.map) {
              this.map.resize();
            }
          }, 200);
        }, 50);
      });
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
  }

  onResearchTech(structureId: string) {
    console.log('[FRONTEND] Sending RESEARCH_TECH for:', structureId);
    if (this.matchSocket && this.matchSocket.readyState === WebSocket.OPEN) {
      console.log('[FRONTEND] Socket is OPEN, sending payload...');
      this.matchSocket.send(JSON.stringify({
        action: 'RESEARCH_TECH',
        payload: { structureId }
      }));
    } else {
      console.error('[FRONTEND] Socket is NOT OPEN!', this.matchSocket?.readyState);
    }
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
    let items = [];
    if (this.activeBuildCategory === 'risorse') {
      items = this.gameRules?.sheets?.find((s: any) => s.name === 'Estrattori')?.lines || [];
    } else {
      items = this.gameRules?.sheets?.find((s: any) => s.name === 'Strutture')?.lines || [];
    }

    return items.filter((item: any) => {
      const tier = item.tier || 1;
      const id = item.id_extractor || item.id_struttura;
      return tier === 1 || this.userTechnologies.includes(id);
    });
  }

  startConstruction(item: any) {
    this.selectedStructureForBuild = item;
    this.isBuildPanelOpen = false;
  }

  @HostListener('document:keydown.escape', ['$event'])
  onKeydownHandler(event: KeyboardEvent) {
    if (this.selectedStructureForBuild) {
      this.cancelConstruction();
    }
    if (this.isRadialMenuVisible) {
      this.closeRadialMenu();
    }
  }

  cancelConstruction() {
    this.selectedStructureForBuild = null;
    this.toastCtrl.create({
      message: 'Costruzione annullata.',
      duration: 2000,
      position: 'bottom',
      color: 'medium'
    }).then(t => t.present());
  }

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

    let zoomThrottleTimer: any = null;
    this.map.on('zoom', () => {
      if (zoomThrottleTimer) return;
      zoomThrottleTimer = setTimeout(() => {
        this.updateArmyMarkersScale();
        this.updateStructureMarkersScale();
        this.updateNationBannersVisibility();
        zoomThrottleTimer = null;
      }, 100);
    });

    this.map.on('movestart', () => {
      // this.closeRadialOnInteraction();
      // this.closeTroopsDropdownOnInteraction();
    });
  }

  calculateCurrentPosition(path: number[][], startTime: number, etaMs: number): { lng: number, lat: number } | null {
    if (!path || path.length < 2 || !etaMs || !startTime) return null;
    const elapsed = Date.now() - startTime;
    const progress = Math.max(0, Math.min(1, elapsed / etaMs));
    if (progress >= 1) return { lng: path[path.length - 1][0], lat: path[path.length - 1][1] };

    let totalDistance = 0;
    const segmentDistances: number[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const dx = path[i + 1][0] - path[i][0];
      const dy = path[i + 1][1] - path[i][1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      segmentDistances.push(dist);
      totalDistance += dist;
    }
    const targetDistance = progress * totalDistance;
    let currentDist = 0;
    let currentIndex = 0;
    let segmentProgress = 0;
    for (let i = 0; i < segmentDistances.length; i++) {
      if (currentDist + segmentDistances[i] >= targetDistance || i === segmentDistances.length - 1) {
        currentIndex = i;
        segmentProgress = segmentDistances[i] > 0 ? (targetDistance - currentDist) / segmentDistances[i] : 0;
        break;
      }
      currentDist += segmentDistances[i];
    }
    const p1 = path[currentIndex];
    const p2 = path[currentIndex + 1] || p1;
    const lng = p1[0] + (p2[0] - p1[0]) * segmentProgress;
    const lat = p1[1] + (p2[1] - p1[1]) * segmentProgress;
    return { lng, lat };
  }



  getArmyCoordinates(army: any): [number, number] | null {
    if ((army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco") && army.path && army.path.length > 1 && army.startTime && army.etaMs) {
      const pos = this.calculateCurrentPosition(army.path, army.startTime, army.etaMs);
      if (pos) return [pos.lng, pos.lat];
    }
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

  // --- RENDERING STRUTTURE SU MAPPA ---

  getStructureTooltipHTML(structure: any): string {
    let tierDisplay = '';
    let extDetails: any = null;
    let strDetails: any = null;
    let risorse: any[] = [];

    if (this.gameRules && this.gameRules.sheets) {
      const estrattori = this.gameRules.sheets.find((s: any) => s.name === 'Estrattori')?.lines || [];
      const strutture = this.gameRules.sheets.find((s: any) => s.name === 'Strutture')?.lines || [];
      risorse = this.gameRules.sheets.find((s: any) => s.name === 'Risorse')?.lines || [];

      extDetails = estrattori.find((s: any) => s.id_extractor === structure.structureId);
      if (extDetails && extDetails.tier !== undefined) {
        tierDisplay = ` <span style="color:#fcd34d; font-size:0.85em; margin-left: 5px;">[T${extDetails.tier}]</span>`;
      } else {
        strDetails = strutture.find((s: any) => s.id_struttura === structure.structureId);
        if (strDetails && strDetails.tier !== undefined) {
          tierDisplay = ` <span style="color:#fcd34d; font-size:0.85em; margin-left: 5px;">[T${strDetails.tier}]</span>`;
        }
      }
    }

    let html = `<div style="text-align: center; font-family: 'Rajdhani', sans-serif;">`;
    html += `<strong style="font-size: 1.1em; color: #60a5fa;">${structure.name}</strong>${tierDisplay} <span style="color:#a1a1aa; font-size:0.9em">(${structure.owner})</span><br/>`;

    if (structure.status === 'building') {
      if (structure.completionTime) {
        const timeLeftMs = Math.max(0, structure.completionTime - Date.now());
        const mins = Math.floor(timeLeftMs / 60000);
        const secs = Math.floor((timeLeftMs % 60000) / 1000);
        html += `<span style="color:#eab308; font-weight:bold;">IN COSTRUZIONE</span><br/><span style="font-size:0.9em; opacity:0.8;">Fine in: ${mins}m ${secs}s</span>`;
      } else {
        html += `<span style="color:#eab308; font-weight:bold;">IN COSTRUZIONE</span>`;
      }
    } else {
      if (extDetails) {
        const baseRes = risorse.find((r: any) => r.id === extDetails.risorsa_estratta);
        if (baseRes && baseRes.risorsa_per_ora) {
          const rulesMultiplier = this.gameRules.sheets.find((s: any) => s.name === 'Regole Generali')?.lines?.find((r: any) => r.id === 'strutture_multiplier')?.value || 1;
          const amount = baseRes.risorsa_per_ora * (extDetails.efficienza || 1) * rulesMultiplier;
          html += `<span style="color:#4ade80;">Estrae: ${amount} ${baseRes.name}/h</span>`;
        } else if (extDetails.risorsa_estratta) {
          html += `<span style="color:#4ade80;">Estrae: ${extDetails.risorsa_estratta}/h</span>`;
        }
      } else if (strDetails) {
        if (strDetails.categoria === 1) {
          html += `<span style="color:#f87171;">Addestramento truppe</span>`;
        } else if (strDetails.categoria === 0) {
          html += `<span style="color:#fb923c;">Produzione veicoli</span>`;
        } else if (strDetails.categoria === 2) {
          html += `<span style="color:#38bdf8;">Difesa territorio (HP: ${strDetails.HP})</span>`;
        }
      }
    }
    html += `</div>`;
    return html;
  }

  getStructureImage(name: string, structureId?: string): string {
    let png = 'fabbrica.png';
    name = (name || '').toLowerCase();

    if (structureId && this.gameRules && this.gameRules.sheets) {
      const estrattori = this.gameRules.sheets.find((s: any) => s.name === 'Estrattori')?.lines || [];
      const extDetails = estrattori.find((s: any) => s.id_extractor === structureId);
      if (extDetails && extDetails.risorsa_estratta) {
        const resType = extDetails.risorsa_estratta.toLowerCase();
        if (resType === 'legno') return 'segheria.png';
        if (resType === 'mattoni') return 'mattonificio.png';
        if (resType === 'acciaio') return 'acciaieria.png';
        if (resType === 'petrolio') return 'petrolio.png';
        if (resType === 'piombo') return 'carbone.png'; // Fallback per miniere senza icona dedicata
        if (resType === 'oro') return 'miniera_oro.png';
        if (resType === 'uranio') return 'arricchimento_uranio.png';
        if (resType === 'gas_naturale') return 'gas.png';
      }
    }

    if (name.includes('segheria') || name.includes('boschivo')) png = 'segheria.png';
    else if (name.includes('miniera') || name.includes('scavo') || name.includes('carbone')) {
      if (name.includes('oro')) png = 'miniera_oro.png';
      else png = 'carbone.png'; // Fallback per altre miniere (es. piombo)
    }
    else if (name.includes('mattonificio') || name.includes('fornace')) png = 'mattonificio.png';
    else if (name.includes('acciaieria') || name.includes('fonderia')) png = 'acciaieria.png';
    else if (name.includes('petrol') || name.includes('idrocarburi')) png = 'petrolio.png';
    else if (name.includes('gas')) png = 'gas.png';
    else if (name.includes('fortezza')) png = 'fortezza.png';
    else if (name.includes('caserma')) png = 'caserma.png';
    else if (name.includes('fabbrica') || name.includes('armamenti')) png = 'fabbrica.png';
    else if (name.includes('aeroporto')) {
      if (name.includes('2') || name.includes('avanzato')) png = 'airport2.png';
      else png = 'airport1.png';
    }
    else if (name.includes('porto')) {
      if (name.includes('nord')) png = 'port_nord.png';
      else if (name.includes('sud')) png = 'port_sud.png';
      else if (name.includes('ovest')) png = 'port_ovest.png';
      else png = 'port_est.png';
    }
    else if (name.includes('uranio')) png = 'arricchimento_uranio.png';
    else if (name.includes('radar')) {
      if (name.includes('aereo') || name.includes('volo')) png = 'radar_aereo.png';
      else png = 'radar_terrestre.png';
    }
    else if (name.includes('treno') || name.includes('stazione') || name.includes('ferrov')) {
      png = 'train_station.png';
    }
    else if (name.includes('hangar')) png = 'hangar.png';
    else if (name.includes('artiglieria') || name.includes('costiera')) png = 'difesa_costiera.png';
    else if (name.includes('sampt') || name.includes('missil') || name.includes('difes')) png = 'sampt.png';

    return png;
  }

  renderStructures() {
    if (!this.map) return;

    // Rimuoviamo i marker non più presenti
    const currentStructureIds = new Set(this.matchStructures.map(s => s.id));
    for (const [id, marker] of this.structureMarkers.entries()) {
      if (!currentStructureIds.has(id)) {
        marker.remove();
        this.structureMarkers.delete(id);
      }
    }

    this.matchStructures.forEach(structure => {
      let coords: [number, number] | null = null;
      if (structure.targetCoords && Array.isArray(structure.targetCoords) && structure.targetCoords.length >= 2) {
        coords = [Number(structure.targetCoords[0]), Number(structure.targetCoords[1])];
      }

      if (!coords) return;

      const isMine = structure.owner === this.userProfile.username;

      if (!this.structureMarkers.has(structure.id)) {
        const el = document.createElement('div');
        el.className = 'structure-marker-wrapper';
        el.style.position = 'relative';
        el.style.width = '0px';
        el.style.height = '0px';
        el.style.zIndex = '5'; // Sotto le armate (zIndex 10)

        // Wrapper per l'immagine
        const container = document.createElement('div');
        container.className = 'structure-container';
        container.style.width = '30px';
        container.style.height = '30px';
        container.style.position = 'absolute';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.style.cursor = 'pointer';

        let png = this.getStructureImage(structure.name, structure.structureId);
        if (structure.status === 'building') {
          png = 'workinprogress.png';
        }

        const img = document.createElement('img');
        img.src = `assets/2Dmodels/Buildings/${png}`;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.filter = isMine ? 'drop-shadow(0 0 5px #60a5fa)' : 'drop-shadow(0 0 5px #ef4444)';

        if (structure.status === 'building') {
          img.style.opacity = '0.5';
        }

        img.removeAttribute('title'); // Remove native tooltip

        const popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 20,
          className: 'structure-hover-popup'
        });

        img.addEventListener('mouseenter', () => {
          popup.setHTML(this.getStructureTooltipHTML(structure))
            .setLngLat(coords as [number, number])
            .addTo(this.map);
        });
        img.addEventListener('mouseleave', () => {
          popup.remove();
        });

        container.appendChild(img);
        el.appendChild(container);

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(coords)
          .addTo(this.map);

        // Store popup reference on the DOM element so we can update/remove it later
        (img as any)._structurePopup = popup;

        this.structureMarkers.set(structure.id, marker);
      } else {
        const marker = this.structureMarkers.get(structure.id);
        marker.setLngLat(coords);
        const img = marker.getElement().querySelector('img') as HTMLImageElement;
        if (img) {
          let png = this.getStructureImage(structure.name, structure.structureId);
          if (structure.status === 'building') {
            png = 'workinprogress.png';
          }
          img.src = `assets/2Dmodels/Buildings/${png}`;
          img.style.opacity = structure.status === 'building' ? '0.5' : '1';

          // Re-assign listeners
          const existingPopup = (img as any)._structurePopup;
          if (existingPopup) {
            img.onmouseenter = () => {
              existingPopup.setHTML(this.getStructureTooltipHTML(structure))
                .setLngLat(coords as [number, number])
                .addTo(this.map);
            };
          }
        }
      }
    });

    this.updateStructureMarkersScale();
  }

  recalculatePlayerTroops() {
    const totals: Record<string, number> = {};
    if (this.matchArmies && this.userProfile && this.userProfile.username) {
      const currentUsername = this.userProfile.username.toLowerCase();
      for (const army of this.matchArmies) {
        if (army.owner && army.owner.toLowerCase() === currentUsername && army.composition) {
          for (const [troopName, count] of Object.entries(army.composition)) {
            totals[troopName] = (totals[troopName] || 0) + (count as number);
          }
        }
      }
    }

    // Create sorted object so the dropdown looks nice
    const sortedTotals: Record<string, number> = {};
    Object.keys(totals).sort().forEach(k => sortedTotals[k] = totals[k]);
    this.playerTroops = sortedTotals;
  }

  // --- RENDERING ARMATE SU MAPPA ---
  renderArmies() {
    this.recalculatePlayerTroops();
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
        if (this.armyTetherCache.has(army.id)) {
          targetNodeCoords = this.armyTetherCache.get(army.id)!;
        } else {
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
          this.armyTetherCache.set(army.id, targetNodeCoords);
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
                // Stiamo comandando una conquista!
                this.selectedArmiesForMovement.forEach(armyId => {
                  const myArmy = this.matchArmies.find(a => a.id === armyId);
                  if (myArmy) {
                    this.onArmyMissionRequested({
                      armyId: myArmy.id,
                      mode: 'conquer',
                      targetName: army.id,
                      targetCoords: [coords[0], coords[1]],
                      composition: myArmy.composition
                    });
                  }
                });
                this.toastCtrl.create({
                  message: `Ordine di conquista inviato per ${this.selectedArmiesForMovement.length} armate!`,
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
                  message: 'Truppa nemica. Seleziona prima una tua truppa per conquistare.',
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

  updateStructureMarkersScale() {
    if (!this.map) return;
    const currentZoom = this.map.getZoom();
    const visibilityThreshold = 6;
    const visible = currentZoom >= visibilityThreshold;

    const minSize = 40;  // truppe: 32
    const maxSize = 90;  // truppe: 80
    const scaleFactor = Math.min(Math.max((currentZoom - 3) / (10 - 3), 0), 1);
    const dynamicSize = minSize + (maxSize - minSize) * scaleFactor;

    // structureMarkers salva i marker direttamente (non in oggetti wrapper)
    this.structureMarkers.forEach((marker: any) => {
      const el = marker.getElement();
      if (!el) return;
      el.style.display = visible ? 'block' : 'none';
      if (visible) {
        const container = el.querySelector('.structure-container') as HTMLElement;
        if (container) {
          container.style.width = `${dynamicSize}px`;
          container.style.height = `${dynamicSize}px`;
        }
      }
    });

    // Il build preview marker è sempre visibile (feedback interattivo)
    if (this.buildPreviewMarker) {
      const el = this.buildPreviewMarker.getElement();
      if (el) {
        const container = el.querySelector('.structure-container') as HTMLElement;
        if (container) {
          container.style.width = `${dynamicSize}px`;
          container.style.height = `${dynamicSize}px`;
        }
      }
    }
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
    if (Date.now() - this.radialMenuOpenedAt < 50) {
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
      case 'CONQUISTA':
        // Logica combattimento
        break;
      case 'DIPLOMAZIA':
        this.openChatWithRegionOwner();
        break;
    }

    this.isRadialMenuVisible = false;
  }

  openChatWithRegionOwner() {
    if (!this.selectedPointName) {
      this.toggleDiplomacyModal();
      return;
    }

    const feature = this.regionsGeoData?.features?.find((f: any) =>
      (f.properties.name?.toUpperCase() === this.selectedPointName) ||
      (f.properties.ADMIN?.toUpperCase() === this.selectedPointName) ||
      (f.properties.adm1_code?.toUpperCase() === this.selectedPointName) ||
      (f.id === this.selectedPointName)
    );
    const provId = feature ? (feature.properties.adm1_code || feature.properties.name || feature.id) : this.selectedPointName;

    const nation = this.matchNations?.find((n: any) => n.territori && n.territori.includes(provId));

    if (nation && nation.isOccupied && !String(nation.username || '').toLowerCase().includes('bot') && nation.username !== this.userProfile?.username) {
      this.isChatOpen = true;
      this.cdr.detectChanges();
      setTimeout(() => {
        if (this.chatComponent) {
          this.chatComponent.startDirectConversation(nation.username);
        }
      }, 50);
    } else {
      this.toggleDiplomacyModal();
    }
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

    const nation = this.matchNations?.find((n: any) => n.territori && n.territori.includes(provId));

    if (nation && nation.isOccupied) {
      if (nation.username.includes('bot')) {
        owner = '🤖 BOT';
      } else {
        owner = nation.username.toUpperCase();
      }
    }

    // Forza la chiusura di eventuali popup rimasti appesi nel DOM
    const existingPopups = document.querySelectorAll('.tactical-popup');
    existingPopups.forEach(p => p.remove());

    if (this.popupTimer) {
      clearTimeout(this.popupTimer);
      this.popupTimer = null;
    }

    if (this.activePopup) {
      this.activePopup.remove();
      this.activePopup = null;
    }

    let resourcesHtml = '';
    if (this.regionsResources && this.regionsResources[provId]) {
      const res = this.regionsResources[provId];
      let ultraRareHtml = '';
      if (res.ultra_rare) {
        ultraRareHtml = `<br><span style="color: #eab308; text-transform: capitalize;">${res.ultra_rare.replace('_', ' ')}</span> <span style="color: #facc15; font-size: 0.7rem; letter-spacing: 1px;">(ULTRA RARA)</span>`;
      }
      resourcesHtml = `
        <div style="margin-top: 8px;">
          <span style="font-size: 0.65rem; color: #86d7ff; font-weight: 900; letter-spacing: 1px; text-transform: uppercase;">Risorse Estraibili</span>
          <div style="font-size: 0.85rem; color: #ddd; margin-top: 2px;">
            <span style="color: #4ade80; text-transform: capitalize;">${res.more_common.replace('_', ' ')}</span> (comune)<br>
            <span style="color: #f87171; text-transform: capitalize;">${res.less_common.replace('_', ' ')}</span> (rara)${ultraRareHtml}
          </div>
        </div>
      `;
    }

    const provinceName = this.selectedPointName || provId || 'TERRITORIO SCONOSCIUTO';

    const popupHtml = `
      <div class="tactical-popup-container" style="display: flex; flex-direction: column; align-items: center;">
        <span style="font-size: 0.65rem; color: #86d7ff; font-weight: 900; letter-spacing: 1px; margin-bottom: 2px; text-transform: uppercase;">Provincia</span>
        <span style="font-size: 0.85rem; color: #facc15; font-weight: 900; font-family: 'Inter', sans-serif; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; width: 100%; text-align: center;">${provinceName}</span>
        <span style="font-size: 0.65rem; color: #86d7ff; font-weight: 900; letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase;">Dominio</span>
        <span style="font-size: 1.1rem; color: #fff; font-weight: 700; font-family: 'JetBrains Mono', monospace;">${owner}</span>
        ${resourcesHtml}
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

    const popupEl = this.activePopup.getElement();
    if (popupEl) {
      popupEl.style.zIndex = '9999'; // Al di sopra delle truppe (zIndex 10)
    }

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

  onRecruitUnitRequest(event: any) {
    console.log("Inviando richiesta RECRUIT_UNIT", event);
    if (this.matchSocket && this.matchSocket.readyState === WebSocket.OPEN) {
      this.matchSocket.send(JSON.stringify({
        action: 'RECRUIT_UNIT',
        matchId: this.currentMatchId,
        unitId: event.unitId,
        targetName: event.targetName,
        targetCoords: event.targetCoords,
        costMoney: event.costMoney,
        costSteel: event.costSteel,
        trainTime: event.trainTime
      }));
      this.toastCtrl.create({
        message: 'Richiesta di addestramento inviata...',
        duration: 2000,
        position: 'top',
        color: 'primary'
      }).then(t => t.present());
    } else {
      console.warn("WebSocket non pronto per RECRUIT_UNIT");
      this.toastCtrl.create({
        message: 'Connessione al server persa. Aggiorna la pagina.',
        duration: 3000,
        position: 'top',
        color: 'danger'
      }).then(t => t.present());
    }
  }

  saveArmiesToBackend() {
    if (this.matchSocket && this.matchSocket.readyState === WebSocket.OPEN) {
      this.matchSocket.send(JSON.stringify({
        action: 'SAVE_ARMIES',
        payload: {
          armies: this.matchArmies,
          playerTroops: this.playerTroops
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

    if (this.selectedStructureForBuild && this.map) {
      if (!this.buildPreviewMarker) {
        const el = document.createElement('div');
        el.className = 'structure-marker-wrapper';
        el.style.position = 'relative';
        el.style.width = '0px';
        el.style.height = '0px';
        el.style.zIndex = '5';

        const container = document.createElement('div');
        container.className = 'structure-container';
        container.style.width = '30px';
        container.style.height = '30px';
        container.style.position = 'absolute';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.style.pointerEvents = 'none';

        const name = this.selectedStructureForBuild.name || this.selectedStructureForBuild.nome || '';
        const structureId = this.selectedStructureForBuild.id_extractor || this.selectedStructureForBuild.id_struttura;
        const png = this.getStructureImage(name, structureId);

        const img = document.createElement('img');
        img.src = `assets/2Dmodels/Buildings/${png}`;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.filter = 'drop-shadow(0 0 5px #10b981)';
        img.style.opacity = '0.7';

        container.appendChild(img);
        el.appendChild(container);

        this.buildPreviewMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([e.lngLat.lng, e.lngLat.lat])
          .addTo(this.map);

        this.updateStructureMarkersScale();
      } else {
        this.buildPreviewMarker.setLngLat([e.lngLat.lng, e.lngLat.lat]);
      }
    } else if (this.buildPreviewMarker) {
      this.buildPreviewMarker.remove();
      this.buildPreviewMarker = null;
    }
  }

  centerMapOnArmy(armyId: string) {
    const marker = this.armyMarkers.get(armyId);
    if (marker && this.map) {
      const coords = marker.getLngLat();
      this.map.flyTo({ center: [coords.lng, coords.lat], zoom: 8, duration: 1500 });
    }
  }

  promptMovementOrConquest(targetName: string, targetCoords: string, lngLat: any) {
    if (!this.map || this.selectedArmiesForMovement.length === 0) return;

    const popupHtml = `
      <div style="padding: 12px; font-family: 'Inter', sans-serif; min-width: 200px; display:flex; flex-direction:column; gap:12px; background: rgba(17, 24, 39, 0.95); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); color: #f8fafc;">
        <h3 style="margin:0; font-size: 16px; font-weight: bold; color:#f1f5f9; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; text-align: center;">Ordine Armate</h3>
        <p style="margin:0; font-size:13px; color:#cbd5e1; text-align: center;">Bersaglio: <strong style="color: white;">${targetName}</strong></p>
        <div style="display:flex; gap:10px; justify-content:center; margin-top:4px;">
          <button id="btn-popup-move" style="background:linear-gradient(to right, #3b82f6, #2563eb); color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:bold; font-size: 14px; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3); transition: all 0.2s;">
            <ion-icon name="navigate"></ion-icon> Sposta
          </button>
          <button id="btn-popup-conquer" style="background:linear-gradient(to right, #ef4444, #dc2626); color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:bold; font-size: 14px; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3); transition: all 0.2s;">
            <ion-icon name="flag"></ion-icon> Conquista
          </button>
        </div>
      </div>
    `;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: [0, -10], className: 'strategic-popup-above' })
      .setLngLat([lngLat.lng, lngLat.lat])
      .setHTML(popupHtml)
      .addTo(this.map);

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        popup.remove();
      }
    };
    document.addEventListener('keydown', handleEsc);
    popup.on('close', () => {
      document.removeEventListener('keydown', handleEsc);
    });

    popup.getElement().style.zIndex = '9999';

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
      const btnMove = document.getElementById('btn-popup-move');
      const btnConquer = document.getElementById('btn-popup-conquer');

      if (btnConquer) {
        btnConquer.addEventListener('click', (e) => {
          e.stopPropagation();
          this.sendMissionOrder('conquer', targetName, targetCoords);
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

  private sendMissionOrder(mode: 'conquer' | 'move', targetName: string, targetCoords: string) {
    if (this.selectedArmiesForMovement.length === 0) return;

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
      message: `Ordine di ${mode === 'conquer' ? 'conquista' : 'movimento'} inviato per ${this.selectedArmiesForMovement.length} armate.`,
      duration: 2000,
      position: 'top',
      color: 'success'
    }).then(t => t.present());
    this.selectedArmiesForMovement = [];
    this.previousSelectedArmiesForMovement = [];
  }

  handleMapPointSelect(e: any) {
    console.log("Map clicked!", e.point);

    if (this.activePopup) {
      this.activePopup.remove();
      this.activePopup = null;
    }

    if (this.selectedStructureForBuild) {
      this.updatePointReadout(e, true);
      const targetCoords = [e.lngLat.lng, e.lngLat.lat];
      const targetName = this.selectedPointName || 'SCONOSCIUTO';

      if (targetName === 'SCONOSCIUTO') {
        this.toastCtrl.create({
          message: 'Seleziona un territorio valido.',
          duration: 2000,
          position: 'top',
          color: 'warning'
        }).then(t => t.present());
        return;
      }

      // Ownership validation is done by the backend (which safely resolves region names to IDs).

      // Invio websocket
      if (this.matchSocket && this.matchSocket.readyState === WebSocket.OPEN) {
        const payload = {
          action: 'BUILD_STRUCTURE',
          payload: {
            structureId: this.selectedStructureForBuild.id_struttura || this.selectedStructureForBuild.id_extractor,
            targetName: targetName,
            targetCoords: targetCoords
          }
        };
        this.matchSocket.send(JSON.stringify(payload));
      }

      this.selectedStructureForBuild = null;
      if (this.buildPreviewMarker) {
        this.buildPreviewMarker.remove();
        this.buildPreviewMarker = null;
      }
      return;
    }

    if (this.selectedArmiesForMovement.length > 0) {
      this.updatePointReadout(e, true);
      const targetCoords = this.formatMapCoordinates(e.lngLat.lng, e.lngLat.lat);
      const targetName = this.selectedPointName || 'OBIETTIVO';

      this.promptMovementOrConquest(targetName, targetCoords, e.lngLat);
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

      let resourceText = '--';
      if (this.regionsResources && this.regionsResources[f.id]) {
        const res = this.regionsResources[f.id];
        resourceText = res.more_common;
        if (res.ultra_rare) {
          resourceText += ` + ${res.ultra_rare}`;
        }
      }
      const outResCom = document.getElementById('out-res-com');
      if (outResCom) {
        outResCom.innerText = resourceText.replace(/_/g, ' ').toUpperCase();
        if (resourceText.includes('+')) {
          outResCom.style.color = '#eab308'; // highlight if ultra rare
          outResCom.style.textShadow = '0 0 5px rgba(234, 179, 8, 0.5)';
        } else {
          outResCom.style.color = '';
          outResCom.style.textShadow = '';
        }
      }

    } else {
      this.clearHoverState();
      if (persistSelection || this.isTouchLayout) {
        this.selectedPointName = '';
      }
      const outResCom = document.getElementById('out-res-com');
      if (outResCom) {
        outResCom.innerText = '--';
        outResCom.style.color = '';
        outResCom.style.textShadow = '';
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
    const fetchUrl = url;
    fetch(fetchUrl).then(res => res.json()).then(topology => {
      const geoData = topojson.feature(topology, topology.objects[Object.keys(topology.objects)[0]]);

      if (layerId === 'regioni-layer') {
        let nextId = 1;
        this.regionIdMap = new Map<string, number>();
        geoData.features.forEach((f: any) => {
          f.id = nextId++;
          const pId = f.properties.adm1_code || f.properties.name;
          if (pId) {
            this.regionIdMap.set(String(pId).toLowerCase(), f.id);
          }
        });
        this.regionsGeoData = geoData;
      }

      this.map.addSource(sourceId, { type: 'geojson', data: geoData });

      const paintConfig = layerId === 'regioni-layer' ? {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], '#00ccffff',
          ['!=', ['feature-state', 'color'], null], ['feature-state', 'color'],
          ['has', 'fillColor'], ['get', 'fillColor'],
          'rgba(150, 150, 150, 0.2)'
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 0.25,
          ['!=', ['feature-state', 'color'], null], 0.45,
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
    const fetchUrl = url;
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
    const fetchUrl = url;
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

    if (!this.map.isSourceLoaded('regioni')) {
      if (!(this as any)._waitingForRegioni) {
        (this as any)._waitingForRegioni = true;
        const onSourceData = (e: any) => {
          if (e.sourceId === 'regioni' && e.isSourceLoaded) {
            this.map.off('sourcedata', onSourceData);
            (this as any)._waitingForRegioni = false;
            this.applyTerritoryColors();
          }
        };
        this.map.on('sourcedata', onSourceData);
      }
      return;
    }

    if ((this as any)._applyTerritoryColorsTimer) {
      clearTimeout((this as any)._applyTerritoryColorsTimer);
    }
    (this as any)._applyTerritoryColorsTimer = setTimeout(() => {
      this._doApplyTerritoryColors();
    }, 100);
  }

  _doApplyTerritoryColors() {
    if (!this.nationMarkers) this.nationMarkers = [];
    const usedNationUsernames = new Set<string>();

    const colorMap: Record<string, string> = {};
    const currentUser = String(this.userProfile?.username || '').trim().toLowerCase();
    const currentAllianceId = this.currentAllianceId;

    this.matchNations.forEach((nation: any) => {
      if (!nation.isOccupied) return;

      let statusColor = '#eab308'; // Default non neutral (enemy)
      const occupier = String(nation.username || '').trim().toLowerCase();
      usedNationUsernames.add(occupier);

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

      if (Array.isArray(nation.territori)) {
        nation.territori.forEach((provId: string) => {
          colorMap[provId] = statusColor;
        });
      }

      if (Array.isArray(nation.territori) && nation.territori.length > 0) {
        const firstProvId = nation.territori[0];
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

            let marker = this.nationMarkers.find((m: any) => m.nationUsername === occupier);
            if (!marker) {
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
              el.innerText = occupier.includes('bot') ? '🤖 BOT' : nation.username.toUpperCase();

              marker = new maplibregl.Marker({ element: el })
                .setLngLat(centerPoint)
                .addTo(this.map);
              marker.nationUsername = occupier;
              this.nationMarkers.push(marker);
            } else {
              marker.setLngLat(centerPoint);
              const el = marker.getElement();
              el.style.border = `2px solid ${statusColor}`;
              el.innerText = occupier.includes('bot') ? '🤖 BOT' : nation.username.toUpperCase();
            }
          }
        }
      }
    });

    // Remove unused markers
    this.nationMarkers = this.nationMarkers.filter((m: any) => {
      if (!usedNationUsernames.has(m.nationUsername)) {
        m.remove();
        return false;
      }
      return true;
    });

    const attackedTerritories = new Set<string>();
    if (this.matchArmies) {
      this.matchArmies.forEach(army => {
        if (army.owner === currentUser || army.owner === this.userProfile?.username || !army.owner) {
          if (army.status === 'attacking' || army.status === 'in combattimento' || ((army.status === "Pronto alla conquista" || army.status === 'moving') && army.missionMode === 'conquer')) {
            if (army.targetName && army.targetName !== 'OBIETTIVO' && army.targetName !== 'SCONOSCIUTO') {
              attackedTerritories.add(army.targetName.toLowerCase());
            }
          }
        }
      });
    }

    // Remove old feature states to reset colors
    if (this.map.getSource('regioni')) {
      this.map.removeFeatureState({ source: 'regioni' });

      // Apply ownership colors
      for (const [pId, color] of Object.entries(colorMap)) {
        const numericId = this.regionIdMap.get(pId.toLowerCase());
        if (numericId !== undefined) {
          this.map.setFeatureState({ source: 'regioni', id: numericId }, { color: color });
        }
      }

      // Overwrite with attacked colors
      attackedTerritories.forEach(pId => {
        const numericId = this.regionIdMap.get(pId.toLowerCase());
        if (numericId !== undefined) {
          this.map.setFeatureState({ source: 'regioni', id: numericId }, { color: '#ef4444' });
        }
      });
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