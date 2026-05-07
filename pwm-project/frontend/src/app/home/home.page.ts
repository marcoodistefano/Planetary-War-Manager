import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ModalController } from '@ionic/angular';
import { SettingsComponent } from '../profile/components/settings/settings.component';
import { NotificationsComponent } from './components/notifications/notifications.component';
import { ObjectivesComponent } from './components/objectives/objectives.component';
import { FriendsComponent } from './components/friends/friends.component';
import { CreateMatchComponent } from './components/create-match/create-match.component';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterModule]
})
export class HomePage implements OnInit, AfterViewInit {
  
  // === VARIABILI PER SFONDO VIDEO ===
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  // Simulated data: include region/nation for flag display
  leaderboardGlobal = [
    { rank: 1, player: 'Aurelio', score: 12840, region: 'IT' },
    { rank: 2, player: 'Morgana', score: 12410, region: 'FR' },
    { rank: 3, player: 'Raven', score: 12180, region: 'ES' },
    { rank: 4, player: 'Giulia', score: 11800, region: 'IT' },
    { rank: 5, player: 'Sven', score: 11000, region: 'SE' },
  ];

  // Full leaderboard (for regional view we'll filter this)
  leaderboardFull = this.leaderboardGlobal.concat([
    { rank: 6, player: 'Olga', score: 10800, region: 'RU' },
    { rank: 7, player: 'Chen', score: 10400, region: 'CN' },
  ]);

  // default quick regional uses same source but will be filtered by currentPlayer.region
  leaderboardRegional = [
    { rank: 1, player: 'Lombardia', score: 9820, region: 'IT' },
    { rank: 2, player: 'Piemonte', score: 9540, region: 'IT' },
    { rank: 3, player: 'Lazio', score: 9310, region: 'IT' },
  ];

  quickActions = [
    'Notifiche',
    'Impostazioni',
    'Obiettivi',
    'Amici',
  ];

  // include either turnNumber or a startTime to display the requested friendly time text
  activeGames = [
    { name: 'Conquista del Nord', players: '8/10', turnNumber: null, startTime: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), status: 'In corso' },
    { name: 'Sfida regionale', players: '6/8', turnNumber: 12, startTime: null, status: 'In pausa' },
    { name: 'Campagna globale', players: '10/12', turnNumber: null, startTime: new Date(Date.now() - (2 * 24 + 5) * 3600 * 1000).toISOString(), status: 'In corso' },
    { name: 'Frontiera est', players: '4/6', turnNumber: 4, startTime: null, status: 'In attesa' },
    { name: 'Dominio finale', players: '12/12', turnNumber: null, startTime: new Date(Date.now() - (36 * 3600 * 1000)).toISOString(), status: 'Urgente' },
  ];

  newGames = [
    { name: 'Operazione Alba', creator: 'DarkLord99', players: '1/12', timeCreated: '10 min fa' },
    { name: 'Partita di Prova', creator: 'NuovoGamer', players: '2/8', timeCreated: '1 ora fa' },
    { name: 'Alleanze Fragili', creator: 'Strategist', players: '4/10', timeCreated: '2 ore fa' },
    { name: 'Conflitto Globale', creator: 'GeneraleX', players: '5/20', timeCreated: '5 ore fa' },
    { name: 'Risorse Limitate', creator: 'EcoWarrior', players: '3/6', timeCreated: 'Ieri' }
  ];

  filteredNewGames = [...this.newGames];
  searchQuery = '';
filterNewGames(event: any) {
    const query = event.target.value?.toLowerCase() || '';
    if (!query) {
      this.filteredNewGames = [...this.newGames];
    } else {
      this.filteredNewGames = this.newGames.filter(game =>
        game.name.toLowerCase().includes(query) || game.creator.toLowerCase().includes(query)
      );
    }
  }

  
  finishedGames = 37;

  // current logged-in player (for regional filtering and quick list inclusion)
  currentPlayer = { name: 'Marco Rossi', region: 'IT', rank: 42, score: 3240 };

  // UI state
  leaderboardView: 'global' | 'regional' = 'global';

  constructor(
    private router: Router, 
    private titleService: Title,
    private modalCtrl: ModalController
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Homepage');
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
    if (!video) {
      return;
    }
    video.muted = true;
    video.playsInline = true;
    video.load();
    video.play().catch(() => undefined);
  }

  viewFullLeaderboard() {
    // TODO: navigate to full leaderboard page when available.
    // placeholder: open /leaderboard
    window.location.href = '/leaderboard';
  }

  // return array of entries to show in quick leaderboard: top 3 plus player if not in top3
  getQuickLeaderboard() {
    const list = this.leaderboardFull.slice().sort((a, b) => b.score - a.score);
    const top3 = list.slice(0, 3).map((p, i) => ({ ...p, rank: i + 1 }));
    const playerIndex = list.findIndex(p => p.player === this.currentPlayer.name);
    if (playerIndex === -1) {
      // if player not in global list, show their synthesized position
      return top3.concat([{ rank: this.currentPlayer.rank, player: this.currentPlayer.name, score: this.currentPlayer.score, region: this.currentPlayer.region }]);
    }
    if (playerIndex < 3) return top3;
    const playerEntry = { rank: playerIndex + 1, player: this.currentPlayer.name, score: this.currentPlayer.score, region: this.currentPlayer.region };
    return top3.concat([playerEntry]);
  }

  // For regional view: filter full leaderboard by current player's region and return top entries
  getRegionalQuick() {
    const list = this.leaderboardFull.filter(p => p.region === this.currentPlayer.region).sort((a, b) => b.score - a.score);
    const top3 = list.slice(0, 3).map((p, i) => ({ ...p, rank: i + 1 }));
    const inTop = list.some(p => p.player === this.currentPlayer.name);
    if (!inTop) {
      // show player position for regional (simulate rank lower than 3)
      const simulatedRank = list.length + 1; // not in list -> after
      top3.push({ rank: simulatedRank, player: this.currentPlayer.name, score: this.currentPlayer.score, region: this.currentPlayer.region });
    }
    return top3;
  }

  // simple flag emoji mapping by country code
  flagEmoji(code: string) {
    if (!code) return '';
    const OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.charCodeAt(0) + OFFSET)).join('');
  }

  // format active game time text
  activeGameTimeText(game: any) {
    if (game.turnNumber && Number.isInteger(game.turnNumber)) {
      return `${game.turnNumber}ª ora di gioco`;
    }
    if (game.startTime) {
      const start = new Date(game.startTime);
      const diff = Math.max(0, Date.now() - start.getTime());
      const days = Math.floor(diff / (24 * 3600 * 1000));
      const hours = Math.floor((diff % (24 * 3600 * 1000)) / 3600000);
      if (days > 0) return `sono passati ${days} giorni e ${hours} ore dall'inizio della partita`;
      return `sono passate ${hours} ore dall'inizio della partita`;
    }
    return '';
  }

  // Funzione universale per gestire i pulsanti HUD
  async handleQuickAction(action: string) {
    switch (action) {
      case 'Notifiche':
        await this.openModal(NotificationsComponent);
        break;
      case 'Impostazioni':
        await this.openModal(SettingsComponent);
        break;
      case 'Obiettivi':
        await this.openModal(ObjectivesComponent);
        break;
      case 'Amici':
        await this.openModal(FriendsComponent);
        break;
    }
  }

  // Metodo helper per aprire i modali con lo stile tactical
  private async openModal(component: any) {
    const modal = await this.modalCtrl.create({
      component: component,
      cssClass: 'tactical-modal' // Usa la classe globale che abbiamo creato
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
}

