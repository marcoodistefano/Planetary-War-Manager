import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HomeService } from '../home/home';

@Component({
  selector: 'app-game-browser',
  templateUrl: './game-browser.page.html',
  styleUrls: ['./game-browser.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, RouterModule]
})
export class GameBrowserPage implements OnInit, AfterViewInit {
  searchQuery = '';
  activeMatches: any[] = [];
  visibleMatches: any[] = [];
  
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  constructor(
    private titleService: Title,
    private homeService: HomeService,
    private router: Router
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Partite Disponibili');
    this.loadMatches();
  }

  ngAfterViewInit() {
    this.playBackgroundVideo();
  }

  ionViewDidEnter() {
    this.playBackgroundVideo();
  }

  onSearch(event: any) {
    this.searchQuery = String(event?.target?.value || '').trim().toLowerCase();
    this.applyFilters();
  }

  joinMatch(match: any) {
    if (!match?.joinId) return;

    this.homeService.joinMatch(match.joinId).subscribe({
      next: () => {
        const routeId = match.routeId || match.joinId;
        localStorage.setItem('pwm_last_joined_match', routeId);
        this.router.navigate(['/game/match', routeId]);
      },
      error: (error) => {
        console.error('Errore durante il join della partita:', error);
      }
    });
  }

  private loadMatches() {
    this.homeService.getActiveMatchesBrowserData().subscribe({
      next: (response) => {
        const mapMatches = (collection: { [key: string]: any } | undefined) => {
          if (!collection) return [];
          return Object.values(collection).map((m: any) => {
            const playersCount = Number(m.numero_partecipanti) || 0;
            const playersLabel = playersCount === 1 ? `${playersCount} giocatore` : `${playersCount} giocatori`;
            const regionPlayable = Array.isArray(m.struttura_partita?.regioni) ? m.struttura_partita.regioni.join(', ') : '';
            const creator = String(m.creator_display_name || m.creator_username || m.id_host || 'Sconosciuto').trim();
            const timeCreated = this.formatTimestamp(m.data_creazione);
            const joinId = m.id_partita_hash || m.id_partita_visualizzato || m.id_partita || m.id_host || m.nome_match;
            const routeId = m.id_partita_visualizzato || m.id_partita_hash || m.id_partita || m.id_host || m.nome_match;

            return {
              id: routeId,
              joinId,
              routeId,
              name: m.nome_match,
              creator,
              creatorDisplayName: m.creator_display_name || null,
              players: playersCount,
              playersLabel,
              regionPlayable,
              status: 'Aperta',
              timeCreated,
              startTime: m.data_creazione,
              outcome: null,
            };
          });
        };

        this.activeMatches = mapMatches(response.data).sort((a, b) => new Date(b.startTime || b.timeCreated).getTime() - new Date(a.startTime || a.timeCreated).getTime());
        this.applyFilters();
      },
      error: (err) => {
        console.error('Errore nel caricamento delle partite disponibili:', err);
        this.activeMatches = [];
        this.applyFilters();
      }
    });
  }

  private applyFilters() {
    const source = this.activeMatches;
    if (!this.searchQuery) {
      this.visibleMatches = [...source];
      return;
    }

    this.visibleMatches = source.filter(match => {
      const haystack = [
        match.name,
        match.creator,
        match.creatorDisplayName,
        match.regionPlayable,
        match.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(this.searchQuery);
    });
  }

  private formatTimestamp(input?: string | Date) {
    if (!input) return '';
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return String(input);
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  }

  private playBackgroundVideo() {
    const video = this.backgroundVideo?.nativeElement;
    if (video) {
      video.muted = true;
      video.playsInline = true;
      video.load();
      video.play().catch(() => undefined);
    }
  }
}