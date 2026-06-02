import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ModalController, ToastController } from '@ionic/angular';

// Importazione del Service e del Modello
import { HomeService } from './home'; 
import { UserStateService } from '../user-state.service';
import { Subscription } from 'rxjs';
import { HomeData } from './home-data.model';

import { SettingsComponent } from '../profile/components/settings/settings.component';
import { NotificationsComponent } from './components/notifications/notifications.component';
import { ObjectivesComponent } from './components/objectives/objectives.component';
import { FriendsComponent } from './components/friends/friends.component';
import { CreateMatchComponent } from './components/create-match/create-match.component';
import { NewgamesComponent } from './components/newgames/newgames.component';
import { ActivegamesComponent } from './components/activegames/activegames.component';
import { LeaderboardComponent } from './components/leaderboard/leaderboard.component';

const AVATAR_ASSET_VERSION = '20260517';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterModule]
})
export class HomePage implements OnInit, OnDestroy, AfterViewInit {
  
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  currentPlayer: {
    name: string;
    region: string;
    rank: number;
    rank_regionale?: number;
    score: number;
    avatar: string;
  } = { name: 'Caricamento...', region: '', rank: 0, score: 0, avatar: this.avatarPath(1) };
  
  activeGames: any[] = [];
  leaderboardFull: any[] = [];
  leaderboardRegional: any[] = [];
  newGames: any[] = [];
  filteredNewGames: any[] = [];
  
  finishedGames = 0;
  leaderboardView: 'global' | 'regional' = 'global';
  quickActions = ['Profilo', 'Notifiche', 'Impostazioni', 'Amici', 'Partite attive', 'Storico Partite' ];
  lastJoinedMatchId: string | null = null;
  private countryFlagsMap: Record<string, string> = {};

  private avatarSub?: Subscription;

  constructor(
    private router: Router, 
    private titleService: Title,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private homeService: HomeService, // Iniezione del Service creato
    private userState: UserStateService
  ) { }

  private pollingInterval: any;

  ngOnInit() {
    this.titleService.setTitle('PWM | Homepage');
    this.refreshLastJoinedMatch();
    this.loadDashboardData(); // Carica i dati dal backend all'avvio
    this.loadJoinableMatches();
    this.loadCountryFlags();
    
    // Effettua un fetch ogni 2 minuti (120000 ms)
    this.pollingInterval = setInterval(() => {
      this.loadDashboardData();
      this.loadJoinableMatches();
    }, 120000);

    // Sottoscrizione per aggiornare l'avatar non appena viene cambiato
    this.avatarSub = this.userState.avatarId$.subscribe((id) => {
      if (id) this.currentPlayer.avatar = this.avatarPath(id);
    });
  }

  ionViewWillEnter() {
    this.refreshLastJoinedMatch();
    this.loadDashboardData();
    this.loadJoinableMatches();
  }

  private refreshLastJoinedMatch() {
    this.lastJoinedMatchId = localStorage.getItem('pwm_last_joined_match');
  }

  private avatarPath(avatarId: number) {
    return `assets/profile_icons/id_${avatarId}.jpeg?v=${AVATAR_ASSET_VERSION}`;
  }

  ngOnDestroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    if (this.avatarSub) this.avatarSub.unsubscribe();
  }

  /**
   * Recupera i dati dal backend tramite il Service
   */
  loadDashboardData() {
    this.homeService.getDashboardData().subscribe({
      next: (response) => {
        // Ora TypeScript sa che 'response' ha una proprietà 'data' di tipo 'HomeData'
        const info = response.data; 

        if (info.user_profile) {
          this.currentPlayer = {
            name: info.user_profile.username,
            region: info.user_profile.reg,
            rank: info.user_position,
            score: info.user_profile.elo_rating,
            avatar: info.user_profile.avatar_id ? this.avatarPath(info.user_profile.avatar_id) : this.avatarPath(1)
          };
          this.currentPlayer.rank_regionale = info.user_position_regionale;
        }

        // 2. Mappatura Partite Attive (Converte l'oggetto match1, match2... in array)
        if (info.match_attivi) {
          this.activeGames = Object.values(info.match_attivi).map((m: any) => {
            const playersCount = Number(m.numero_partecipanti) || 0;
            const playersLabel = playersCount === 1 ? `${playersCount} giocatore` : `${playersCount} giocatori`;
            const joinId = m.id_partita_hash || m.id_partita_visualizzato || m.id_partita || m.id_host || m.nome_match;
            const routeId = m.id_partita_visualizzato || m.id_partita_hash || m.id_partita || m.id_host || m.nome_match;
            // Extract playable regions from decoded struttura_partita if present
            let regionPlayable = '';
            try {
              if (m.struttura_partita && Array.isArray(m.struttura_partita.regioni)) {
                regionPlayable = m.struttura_partita.regioni.join(', ');
              }
            } catch (e) { regionPlayable = ''; }

            return {
              joinId,
              routeId,
              name: m.nome_match,
              creator: String(m.creator_username || m.creator_display_name || m.id_host || 'Sconosciuto').trim(),
              creatorDisplayName: m.creator_display_name || null,
              creatorAvatar: m.creator_avatar || null,
              players: playersCount,
              playersLabel,
              regionPlayable,
              startTime: m.data_creazione,
              timeCreatedFormatted: this.formatTimestamp(m.data_creazione),
              status: 'In corso'
            };
          });
        }

        // 3. Mappatura Leaderboard Globale
        if (info.leaderboard_globale) {
          this.leaderboardFull = info.leaderboard_globale.map((u: any, i: number) => ({
            rank: i + 1,
            player: u.username,
            score: u.elo_rating,
            region: u.reg
          }));
        }

        // Mappatura Leaderboard Regionale
        if (info.leaderboard_regionale) {
          this.leaderboardRegional = info.leaderboard_regionale.map((u: any, i: number) => ({
            rank: i + 1,
            player: u.username,
            score: u.elo_rating,
            region: u.reg
          }));
        }

        // 4. Mappatura Nuove Partite Create
        if (info.last_created_match) {
          this.newGames = Object.values(info.last_created_match).map((m: any) => {
            // Try to pick a human-friendly creator name from possible fields
            let creatorName = 'Sconosciuto';
            if (m.creator_display_name) creatorName = m.creator_display_name;
            else if (m.creator_username) creatorName = m.creator_username;
            else if (m.creator) creatorName = m.creator;
            else if (m.host_username) creatorName = m.host_username;
            else if (m.id_host) {
              if (typeof m.id_host === 'string') {
                // fallback to id string if no username available
                creatorName = m.id_host;
              } else if (typeof m.id_host === 'object') {
                creatorName = m.id_host.username || m.id_host.name || m.id_host.id || 'Sconosciuto';
              }
            }

            const playersCount = Number(m.numero_partecipanti) || 0;
            const playersLabel = playersCount === 1 ? `${playersCount} giocatore` : `${playersCount} giocatori`;
            const joinId = m.id_partita_hash || m.id_partita_visualizzato || m.id_partita || m.id_host || m.nome_match;
            const routeId = m.id_partita_visualizzato || m.id_partita_hash || m.id_partita || m.id_host || m.nome_match;
            // regioni giocabili
            let regionPlayable = '';
            try {
              if (m.struttura_partita && Array.isArray(m.struttura_partita.regioni)) {
                regionPlayable = m.struttura_partita.regioni.join(', ');
              }
            } catch (e) { regionPlayable = ''; }

            return {
              joinId,
              routeId,
              name: m.nome_match,
              creator: String(creatorName).trim(),
              creatorDisplayName: m.creator_display_name || null,
              creatorAvatar: m.creator_avatar || null,
              players: playersCount,
              playersLabel,
              regionPlayable,
              timeCreated: m.data_creazione,
              timeCreatedFormatted: this.formatTimestamp(m.data_creazione)
            };
          });
          this.filteredNewGames = [...this.newGames];
        }

        if (info.match_chiuse) {
          this.finishedGames = Object.keys(info.match_chiuse).length;
        }
      },
      error: (err) => {
        console.error("Errore nel caricamento dei dati della dashboard:", err);
        // Opzionale: gestire il reindirizzamento al login se il JWT è scaduto
      }
    });
  }

  loadJoinableMatches() {
    this.homeService.getJoinableMatches().subscribe({
      next: (response) => {
        console.log('Partite joinabili caricate periodicamente:', response);
      },
      error: (err) => {
        console.error('Errore nel fetch periodico a /joinable:', err);
      }
    });
  }

  filterNewGames(event: any) {
    const query = event.target.value?.toLowerCase() || '';
    if (!query) {
      this.filteredNewGames = [...this.newGames];
    } else {
      this.filteredNewGames = this.newGames.filter(game =>
        game.name.toLowerCase().includes(query) || game.creator.toString().toLowerCase().includes(query)
      );
    }
  }

  // === METODI PER IL PLAYBACK DEL VIDEO ===
  ngAfterViewInit() {
    this.playBackgroundVideo();
  }

  private formatTimestamp(input?: string | Date) {
    if (!input) return '';
    const d = (input instanceof Date) ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return String(input);
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  }

  ionViewDidEnter() {
    this.playBackgroundVideo();
  }

  private playBackgroundVideo() {
    const video = this.backgroundVideo?.nativeElement;
    if (!video) return;
    video.muted = true;
    video.playsInline = true;
    video.load();
    video.play().catch(() => undefined);
  }

  viewFullLeaderboard() {
    this.router.navigate(['/leaderboard']);
  }

  /**
   * Logica Leaderboard Rapida
   */
  getQuickLeaderboard() {
    const list = this.leaderboardFull;
    const top3 = list.slice(0, 3);
    const inTop = top3.some(p => p.player === this.currentPlayer.name);
    
    if (!inTop) {
      const playerEntry = { 
        rank: this.currentPlayer.rank, 
        player: this.currentPlayer.name, 
        score: this.currentPlayer.score, 
        region: this.currentPlayer.region 
      };
      return [...top3, playerEntry];
    }
    return top3;
  }

  getRegionalQuick() {
    const list = this.leaderboardRegional;
    const top3 = list.slice(0, 3);
    const inTop = top3.some(p => p.player === this.currentPlayer.name);
    
    if (!inTop) {
      top3.push({ 
        rank: this.currentPlayer.rank_regionale || this.currentPlayer.rank, 
        player: this.currentPlayer.name, 
        score: this.currentPlayer.score, 
        region: this.currentPlayer.region 
      });
    }
    return top3;
  }

  async loadCountryFlags() {
    try {
      const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,translations');
      const data = await response.json();
      const newMap: Record<string, string> = {};
      for (const c of data) {
        const code = (c.cca2 || '').toLowerCase();
        if (!code) continue;
        newMap[code] = code;
        if (c.translations?.ita?.common) {
          newMap[c.translations.ita.common.toLowerCase()] = code;
        }
        if (c.name?.common) {
          newMap[c.name.common.toLowerCase()] = code;
        }
      }
      this.countryFlagsMap = newMap;
    } catch (error) {
      console.error('Errore nel caricamento delle nazioni per la homepage:', error);
    }
  }

  flagEmoji(code: string) {
    if (!code) return '';
    const map: {[key: string]: string} = {
      'italia': 'it', 'italy': 'it',
      'spagna': 'es', 'spain': 'es',
      'francia': 'fr', 'france': 'fr',
      'germania': 'de', 'germany': 'de',
      'inghilterra': 'gb', 'england': 'gb',
      'usa': 'us', 'stati uniti': 'us',
      'andorra': 'ad'
    };
    const lowerCode = code.toLowerCase().trim();
    const c = this.countryFlagsMap[lowerCode] || map[lowerCode] || code.substring(0, 2);
    const OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);
    return c.toUpperCase().split('').map(char => String.fromCodePoint(char.charCodeAt(0) + OFFSET)).join('');
  }

  activeGameTimeText(game: any) {
    if (game.startTime) {
      const start = new Date(game.startTime);
      const diff = Math.max(0, Date.now() - start.getTime());
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(hours / 24);
      if (days > 0) return `${days}d ${hours % 24}h trascorse`;
      return `${hours} ore trascorse`;
    }
    return 'Inizio recente';
  }

  openActiveGame(game: any) {
    const routeId = game?.routeId || game?.joinId;
    if (!routeId) return;
    this.router.navigate(['/game/match', routeId]);
  }

  async handleQuickAction(action: string) {
    switch (String(action).trim().toLowerCase()) {
      case 'profilo': this.router.navigate(['/profile']); break;
      case 'notifiche': await this.openModal(NotificationsComponent); break;
      case 'impostazioni': await this.openModal(SettingsComponent); break;
      case 'amici': await this.openModal(FriendsComponent); break;
      case 'leaderboard': await this.openModal(LeaderboardComponent); break;
      case 'partite attive':
        this.router.navigate(['/history'], { queryParams: { tab: 'active' } });
        break;
      case 'storico partite':
        this.router.navigate(['/history'], { queryParams: { tab: 'finished' } });
        break;
      case 'nuove partite': await this.openModal(NewgamesComponent, { componentProps: { games: this.filteredNewGames } }); break;
    }
  }

  private async openModal(component: any, opts?: { componentProps?: any }) {
    const modal = await this.modalCtrl.create({
      component: component,
      cssClass: 'home-modal',
      ...(opts || {})
    });
    return await modal.present();
  }

  async openCreateMatch() {
    const modal = await this.modalCtrl.create({
      component: CreateMatchComponent,
      cssClass: 'home-modal'
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data?.created) {
      const toast = await this.toastCtrl.create({
        message: 'La partita è stata creata con successo',
        duration: 5000,
        position: 'top',
        cssClass: 'tactical-toast tactical-toast-success',
        icon: 'checkmark-circle-outline'
      });
      await toast.present();
      
      this.loadDashboardData();
      this.loadJoinableMatches();
      return;
    }

    if (data?.errorMessage) {
      const toast = await this.toastCtrl.create({
        message: data.errorMessage,
        duration: 5000,
        position: 'top',
        cssClass: 'tactical-toast tactical-toast-error',
        icon: 'alert-circle-outline'
      });
      await toast.present();
    }
  }

  viewCreatedGames() {
    this.router.navigate(['/game-browser']);
  }

  joinNewGame(game: any) {
    if (!game?.joinId) return;

    this.homeService.joinMatch(game.joinId).subscribe({
      next: () => {
        const routeId = game.routeId || game.joinId;
        localStorage.setItem('pwm_last_joined_match', routeId);
        this.lastJoinedMatchId = routeId;

        // Rimuove immediatamente la partita dalla lista "in attesa"
        this.newGames = this.newGames.filter((g: any) => g.joinId !== game.joinId);
        this.filteredNewGames = this.filteredNewGames.filter((g: any) => g.joinId !== game.joinId);

        // Ricarica i dati dalla dashboard: la partita comparirà in "partite attive"
        this.loadDashboardData();
      },
      error: (error) => {
        console.error('Errore durante il join della partita:', error);
      }
    });
  }

  async goToLastJoinedMatch() {
    const storedMatchId = this.lastJoinedMatchId || localStorage.getItem('pwm_last_joined_match');
    const activeByStored = this.activeGames.find((g: any) => g.routeId === storedMatchId || g.joinId === storedMatchId);
    const matchId = activeByStored?.routeId || storedMatchId || this.activeGames[0]?.routeId || this.activeGames[0]?.joinId;

    if (!matchId) {
      const toast = await this.toastCtrl.create({
        message: 'Non ti sei ancora connesso a nessuna partita!',
        duration: 4000,
        position: 'top',
        cssClass: 'tactical-toast tactical-toast-warning',
        icon: 'information-circle-outline'
      });
      await toast.present();
      return;
    }

    this.router.navigate(['/game/match', matchId]);
  }

  async ionViewWillLeave() {
    const topModal = await this.modalCtrl.getTop();
    if (topModal) await this.modalCtrl.dismiss();
  }
}