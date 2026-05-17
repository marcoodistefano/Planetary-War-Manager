import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ModalController } from '@ionic/angular';

// Importazione del Service e del Modello
import { HomeService } from './home'; 
import { HomeData } from './home-data.model';

import { SettingsComponent } from '../profile/components/settings/settings.component';
import { NotificationsComponent } from './components/notifications/notifications.component';
import { ObjectivesComponent } from './components/objectives/objectives.component';
import { FriendsComponent } from './components/friends/friends.component';
import { CreateMatchComponent } from './components/create-match/create-match.component';
import { NewgamesComponent } from './components/newgames/newgames.component';
import { ActivegamesComponent } from './components/activegames/activegames.component';
import { LeaderboardComponent } from './components/leaderboard/leaderboard.component';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterModule]
})
export class HomePage implements OnInit, AfterViewInit {
  
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  // Stato iniziale dell'utente (sarà sovrascritto dal DB)
  currentPlayer = { name: 'Caricamento...', region: '', rank: 0, score: 0 };
  
  activeGames: any[] = [];
  leaderboardFull: any[] = [];
  newGames: any[] = [];
  filteredNewGames: any[] = [];
  
  finishedGames = 0;
  leaderboardView: 'global' | 'regional' = 'global';
  quickActions = ['Profilo', 'Notifiche', 'Impostazioni', 'Obiettivi', 'Amici'];

  constructor(
    private router: Router, 
    private titleService: Title,
    private modalCtrl: ModalController,
    private homeService: HomeService // Iniezione del Service creato
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Homepage');
    this.loadDashboardData(); // Carica i dati dal backend all'avvio
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
            score: info.user_profile.elo_rating
          };
        }

        // 2. Mappatura Partite Attive (Converte l'oggetto match1, match2... in array)
        if (info.match_attivi) {
          this.activeGames = Object.values(info.match_attivi).map((m: any) => ({
            name: m.nome_match,
            players: m.numero_partecipanti,
            startTime: m.data_creazione,
            status: 'In corso'
          }));
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

        // 4. Mappatura Nuove Partite Create
        if (info.last_created_match) {
          this.newGames = Object.values(info.last_created_match).map((m: any) => ({
            name: m.nome_match,
            creator: m.id_host, // Potresti voler risolvere l'host in un nome reale se disponibile
            players: `${m.numero_partecipanti}`,
            timeCreated: m.data_creazione
          }));
          this.filteredNewGames = [...this.newGames];
        }
      },
      error: (err) => {
        console.error("Errore nel caricamento dei dati della dashboard:", err);
        // Opzionale: gestire il reindirizzamento al login se il JWT è scaduto
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
    const playerIndex = list.findIndex(p => p.player === this.currentPlayer.name);
    
    if (playerIndex === -1 || playerIndex < 3) return top3;
    
    const playerEntry = { 
      rank: this.currentPlayer.rank, 
      player: this.currentPlayer.name, 
      score: this.currentPlayer.score, 
      region: this.currentPlayer.region 
    };
    return [...top3, playerEntry];
  }

  getRegionalQuick() {
    const list = this.leaderboardFull.filter(p => p.region === this.currentPlayer.region);
    const top3 = list.slice(0, 3);
    const inTop = top3.some(p => p.player === this.currentPlayer.name);
    
    if (!inTop) {
      top3.push({ 
        rank: this.currentPlayer.rank, // O un rango calcolato specificamente per la regione
        player: this.currentPlayer.name, 
        score: this.currentPlayer.score, 
        region: this.currentPlayer.region 
      });
    }
    return top3;
  }

  flagEmoji(code: string) {
    if (!code) return '';
    const map: {[key: string]: string} = {
      'italia': 'it', 'italy': 'it',
      'spagna': 'es', 'spain': 'es',
      'francia': 'fr', 'france': 'fr',
      'germania': 'de', 'germany': 'de',
      'inghilterra': 'gb', 'england': 'gb',
      'usa': 'us', 'stati uniti': 'us'
    };
    const c = map[code.toLowerCase()] || code.substring(0, 2);
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

  async handleQuickAction(action: string) {
    switch (action) {
      case 'Profilo': this.router.navigate(['/profile']); break;
      case 'Notifiche': await this.openModal(NotificationsComponent); break;
      case 'Impostazioni': await this.openModal(SettingsComponent); break;
      case 'Obiettivi': await this.openModal(ObjectivesComponent); break;
      case 'Amici': await this.openModal(FriendsComponent); break;
      case 'Leaderboard': await this.openModal(LeaderboardComponent); break;
      case 'Partite Attive': await this.openModal(ActivegamesComponent); break;
      case 'Nuove Partite': await this.openModal(NewgamesComponent); break;
    }
  }

  private async openModal(component: any) {
    const modal = await this.modalCtrl.create({
      component: component,
      cssClass: 'tactical-modal'
    });
    return await modal.present();
  }

  async openCreateMatch() {
    const modal = await this.modalCtrl.create({
      component: CreateMatchComponent,
      cssClass: 'tactical-modal'
    });
    return await modal.present();
  }

  viewActiveGames() {
    this.router.navigate(['/game-browser'], { queryParams: { tab: 'active' } });
  }

  viewFinishedGames() {
    this.router.navigate(['/game-browser'], { queryParams: { tab: 'finished' } });
  }

  async ionViewWillLeave() {
    const topModal = await this.modalCtrl.getTop();
    if (topModal) await this.modalCtrl.dismiss();
  }
}