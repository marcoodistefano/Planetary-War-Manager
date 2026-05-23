import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Title } from '@angular/platform-browser';

import { HomeService } from '../home/home';

type HistoryView = 'all' | 'active' | 'finished';

interface HistoryMatch {
  id: string;
  joinId: string;
  routeId: string;
  name: string;
  creator: string;
  creatorDisplayName: string | null;
  regionPlayable: string;
  playersLabel: string;
  status: string;
  outcome: string | null;
  timeCreated: string;
  startTime?: string;
  phase: 'active' | 'finished';
  phaseLabel: string;
  resultText: string;
}

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, RouterModule]
})
export class HistoryPage implements OnInit {

  view: HistoryView = 'all';
  searchQuery = '';
  allMatches: HistoryMatch[] = [];
  visibleMatches: HistoryMatch[] = [];
  activeCount = 0;
  finishedCount = 0;
  victoryCount = 0;
  defeatCount = 0;

  constructor(
    private titleService: Title,
    private homeService: HomeService,
    private route: ActivatedRoute,
    private router: Router
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Storico Personale');
    const initialTab = this.route.snapshot.queryParamMap.get('tab');
    if (initialTab === 'active' || initialTab === 'finished') {
      this.view = initialTab;
    }
    this.loadHistory();
  }

  switchView(view: HistoryView) {
    this.view = view;
    this.applyFilters();
  }

  onSearch(event: any) {
    this.searchQuery = String(event?.target?.value || '').trim().toLowerCase();
    this.applyFilters();
  }

  openMatch(match: HistoryMatch) {
    const routeId = match.routeId || match.joinId;
    if (!routeId) return;
    this.router.navigate(['/game/match', routeId]);
  }

  private loadHistory() {
    this.homeService.getDashboardData().subscribe({
      next: (response) => {
        const info = response.data;

        const mapMatches = (collection: { [key: string]: any } | undefined, phase: 'active' | 'finished') => {
          if (!collection) return [];

          return Object.values(collection).map((m: any) => {
            const playersCount = Number(m.numero_partecipanti) || 0;
            const playersLabel = playersCount === 1 ? `${playersCount} giocatore` : `${playersCount} giocatori`;
            const regionPlayable = Array.isArray(m.struttura_partita?.regioni) ? m.struttura_partita.regioni.join(', ') : '';
            const creator = String(m.creator_display_name || m.creator_username || m.id_host || 'Sconosciuto').trim();
            const timeCreated = this.formatTimestamp(m.data_creazione);
            const joinId = m.id_partita_hash || m.id_partita_visualizzato || m.id_partita || m.id_host || m.nome_match;
            const routeId = m.id_partita_visualizzato || m.id_partita_hash || m.id_partita || m.id_host || m.nome_match;
            const outcome = phase === 'finished' ? (m.outcome || m.stato || 'Terminata') : null;

            return {
              id: routeId,
              joinId,
              routeId,
              name: m.nome_match,
              creator,
              creatorDisplayName: m.creator_display_name || null,
              regionPlayable,
              playersLabel,
              status: phase === 'active' ? 'In corso' : (outcome || 'Terminata'),
              outcome,
              timeCreated,
              startTime: m.data_creazione,
              phase,
              phaseLabel: phase === 'active' ? 'OPERATIVA' : 'CONCLUSA',
              resultText: phase === 'active' ? 'In corso' : (outcome || 'Terminata'),
            } as HistoryMatch;
          });
        };

        const activeMatches = mapMatches(info.match_attivi, 'active');
        const finishedMatches = mapMatches(info.match_chiuse, 'finished');

        this.activeCount = activeMatches.length;
        this.finishedCount = finishedMatches.length;
        this.victoryCount = finishedMatches.filter((match) => (match.outcome || '').toLowerCase().includes('vinta')).length;
        this.defeatCount = finishedMatches.filter((match) => (match.outcome || '').toLowerCase().includes('eliminato')).length;

        this.allMatches = [...activeMatches, ...finishedMatches].sort(
          (a, b) => new Date(b.startTime || b.timeCreated).getTime() - new Date(a.startTime || a.timeCreated).getTime()
        );

        this.applyFilters();
      },
      error: (err) => {
        console.error('Errore nel caricamento dello storico personale:', err);
        this.allMatches = [];
        this.visibleMatches = [];
        this.activeCount = 0;
        this.finishedCount = 0;
        this.victoryCount = 0;
        this.defeatCount = 0;
      }
    });
  }

  private applyFilters() {
    const source = this.view === 'all'
      ? this.allMatches
      : this.allMatches.filter((match) => match.phase === this.view);

    if (!this.searchQuery) {
      this.visibleMatches = [...source];
      return;
    }

    this.visibleMatches = source.filter((match) => {
      const haystack = [
        match.name,
        match.creator,
        match.creatorDisplayName,
        match.regionPlayable,
        match.status,
        match.resultText,
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

}
