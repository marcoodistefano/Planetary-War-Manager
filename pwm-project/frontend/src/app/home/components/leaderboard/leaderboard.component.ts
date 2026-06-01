import { Component, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { HomeService } from '../../home';
import { ApiResponse } from '../../home-data.model';

interface LeaderboardEntry {
  rank: number;
  region: string;
  player: string;
  score: number;
}

@Component({
  selector: 'app-leaderboard',
  templateUrl: './leaderboard.component.html',
  styleUrls: ['./leaderboard.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class LeaderboardComponent implements OnInit {
  
  leaderboard: LeaderboardEntry[] = [];
  currentView: 'global' | 'regional' = 'global';
  currentRegion = '';
  currentRegionCode = '';
  currentUsername = '';

  private globalLeaderboard: LeaderboardEntry[] = [];
  private regionalLeaderboard: LeaderboardEntry[] = [];
  private dynamicRegionMap: Record<string, string> = {};
  
  userPosition = 0;
  userPositionRegionale = 0;
  userElo = 1000;

  constructor(
    private modalCtrl: ModalController,
    private homeService: HomeService
  ) {}

  ngOnInit() {
    this.loadCountryFlags();
    this.loadData();
  }

  loadData() {
    this.homeService.getDashboardData().subscribe({
      next: (response: ApiResponse) => {
        const info = response.data;
        this.currentUsername = info.user_profile?.username || '';
        this.currentRegion = info.user_profile?.reg || '';
        this.currentRegionCode = this.normalizeRegionCode(this.currentRegion);
        this.userPosition = info.user_position;
        this.userPositionRegionale = info.user_position_regionale || info.user_position;
        this.userElo = info.user_profile?.elo_rating || 1000;

        this.globalLeaderboard = (info.leaderboard_globale || []).map((player: any, index: number) => ({
          rank: index + 1,
          region: this.normalizeRegionCode(player.reg),
          player: player.username,
          score: player.elo_rating
        }));

        this.regionalLeaderboard = (info.leaderboard_regionale || []).map((player: any, index: number) => ({
          rank: index + 1,
          region: this.normalizeRegionCode(player.reg),
          player: player.username,
          score: player.elo_rating
        }));

        this.syncLeaderboard();
      },
      error: (err) => {
        console.error('Errore nel caricamento della leaderboard:', err);
        this.globalLeaderboard = [];
        this.regionalLeaderboard = [];
        this.leaderboard = [];
      }
    });
  }

  switchView(view: 'global' | 'regional') {
    this.currentView = view;
    this.syncLeaderboard();
  }

  get dynamicRegionalLabel(): string {
    return this.currentRegionCode ? `REGIONALE ${this.currentRegionCode}` : 'REGIONALE';
  }

  get loggedInPlayer(): string {
    return this.currentUsername;
  }

  private syncLeaderboard() {
    const list = this.currentView === 'global' ? this.globalLeaderboard : this.regionalLeaderboard;
    const playerInList = list.some((entry) => entry.player === this.currentUsername);

    if (!playerInList && this.currentUsername) {
      const rankVal = this.currentView === 'global' ? this.userPosition : this.userPositionRegionale;
      this.leaderboard = [
        ...list,
        {
          rank: rankVal,
          region: this.currentRegionCode,
          player: this.currentUsername,
          score: this.userElo
        }
      ];
    } else {
      this.leaderboard = [...list];
    }
  }

  private normalizeRegionCode(region: string): string {
    if (!region) return '';

    const normalized = region.trim().toLowerCase();
    if (normalized.length === 2) {
      return normalized.toUpperCase();
    }

    const regionMap: Record<string, string> = {
      afghanistan: 'AF',
      albania: 'AL',
      algeria: 'DZ',
      andorra: 'AD',
      argentina: 'AR',
      australia: 'AU',
      austria: 'AT',
      belgium: 'BE',
      brazil: 'BR',
      canada: 'CA',
      china: 'CN',
      croatia: 'HR',
      denmark: 'DK',
      egypt: 'EG',
      england: 'GB',
      europe: 'EU',
      finland: 'FI',
      france: 'FR',
      germany: 'DE',
      greece: 'GR',
      hungary: 'HU',
      india: 'IN',
      indonesia: 'ID',
      ireland: 'IE',
      israel: 'IL',
      italy: 'IT',
      japan: 'JP',
      mexico: 'MX',
      netherlands: 'NL',
      norway: 'NO',
      poland: 'PL',
      portugal: 'PT',
      romania: 'RO',
      russia: 'RU',
      serbia: 'RS',
      spain: 'ES',
      sweden: 'SE',
      switzerland: 'CH',
      turkey: 'TR',
      uk: 'GB',
      'united kingdom': 'GB',
      usa: 'US',
      'united states': 'US'
    };

    return this.dynamicRegionMap[normalized] || regionMap[normalized] || normalized.substring(0, 2).toUpperCase();
  }

  async loadCountryFlags() {
    try {
      const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,translations');
      const data = await response.json();
      const newMap: Record<string, string> = {};
      for (const c of data) {
        const code = (c.cca2 || '').toUpperCase();
        if (!code) continue;
        if (c.translations?.ita?.common) {
          newMap[c.translations.ita.common.toLowerCase()] = code;
        }
        if (c.name?.common) {
          newMap[c.name.common.toLowerCase()] = code;
        }
      }
      this.dynamicRegionMap = newMap;
      this.loadData();
    } catch (error) {
      console.error('Errore nel caricamento delle nazioni per la leaderboard:', error);
    }
  }

  /**
   * Generatore Dinamico di Bandiere Olografiche
   * Converte un codice nazione di 2 lettere (es. 'IT') nella rispettiva Emoji
   * calcolando l'offset Unicode dei Regional Indicator Symbols.
   */
  flagEmoji(countryCode: string): string {
    // Se il codice non è valido o non è di due lettere, restituisce bandiera bianca
    if (!countryCode || countryCode.length !== 2) return '🏳️';
    
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0)); // 127397 è l'offset magico Unicode
      
    return String.fromCodePoint(...codePoints);
  }

  close() {
    this.modalCtrl.dismiss();
  }
}