import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { HomeService } from '../home/home';
import { UserStateService } from '../user-state.service';
import { ApiResponse } from '../home/home-data.model';

interface LeaderboardEntry {
  rank: number;
  region: string;
  player: string;
  score: number;
  regionCode?: string;
  regionName?: string;
}

const AVATAR_ASSET_VERSION = '20260517';

@Component({
  selector: 'app-leaderboard-page',
  templateUrl: './leaderboard.page.html',
  styleUrls: ['./leaderboard.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class LeaderboardPage implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  currentPlayer: {
    name: string;
    region: string;
    rank: number;
    rank_regionale?: number;
    score: number;
    avatar: string;
    regionCode?: string;
    regionName?: string;
  } = { name: 'Caricamento...', region: '', rank: 0, score: 0, avatar: this.avatarPath(1) };
  currentView: 'global' | 'regional' = 'global';
  currentRegion = '';
  currentRegionCode = '';
  currentUsername = '';
  searchTerm = '';
  pageSize = 50;
  currentPage = 1;

  leaderboard: LeaderboardEntry[] = [];
  filteredLeaderboard: LeaderboardEntry[] = [];

  private globalLeaderboard: LeaderboardEntry[] = [];
  private regionalLeaderboard: LeaderboardEntry[] = [];
  private pollingInterval: any;
  private avatarSub?: Subscription;
  private dynamicRegionMap: Record<string, string> = {};

  constructor(
    private homeService: HomeService,
    private userState: UserStateService,
    private titleService: Title,
    private router: Router
  ) {}

  ngOnInit() {
    this.titleService.setTitle('PWM | Leaderboard');
    this.loadCountryFlags();
    this.avatarSub = this.userState.avatarId$.subscribe(() => undefined);
  }

  ngAfterViewInit() {
    this.playBackgroundVideo();
  }

  ngOnDestroy() {
    this.stopPolling();
    this.avatarSub?.unsubscribe();
  }

  ionViewDidEnter() {
    this.playBackgroundVideo();
  }

  ionViewWillEnter() {
    this.loadData();
    this.startPolling();
  }

  ionViewWillLeave() {
    this.stopPolling();
  }

  private startPolling() {
    this.stopPolling();
    this.pollingInterval = setInterval(() => {
      this.loadData(true);
    }, 120000);
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  goHome() {
    this.router.navigate(['/home']);
  }

  loadData(forceRefresh = false) {
    this.homeService.getDashboardData(forceRefresh).subscribe({
      next: (response: ApiResponse) => {
        const info = response.data;
        this.currentUsername = info.user_profile?.username || '';
        this.currentRegion = info.user_profile?.reg || '';
        this.currentRegionCode = this.normalizeRegionCode(this.currentRegion);

        if (info.user_profile) {
          const userRegionCode = this.normalizeRegionCode(info.user_profile.reg || '');
          this.currentPlayer = {
            name: info.user_profile.username,
            region: info.user_profile.reg,
            rank: info.user_position,
            rank_regionale: info.user_position_regionale,
            score: info.user_profile.elo_rating,
            avatar: info.user_profile.avatar_id ? this.avatarPath(info.user_profile.avatar_id) : this.avatarPath(1),
            regionCode: userRegionCode,
            regionName: this.regionFullName(info.user_profile.reg || '', userRegionCode)
          };
        }

        this.globalLeaderboard = (info.leaderboard_globale || []).map((player: any, index: number) => {
          const code = this.normalizeRegionCode(player.reg);
          return {
            rank: index + 1,
            region: code,
            regionCode: code,
            regionName: this.regionFullName(player.reg || '', code),
            player: player.username,
            score: player.elo_rating
          } as LeaderboardEntry;
        });

        this.regionalLeaderboard = (info.leaderboard_regionale || []).map((player: any, index: number) => {
          const code = this.normalizeRegionCode(player.reg);
          return {
            rank: index + 1,
            region: code,
            regionCode: code,
            regionName: this.regionFullName(player.reg || '', code),
            player: player.username,
            score: player.elo_rating
          } as LeaderboardEntry;
        });

        this.syncLeaderboard();
      },
      error: (err) => {
        console.error('Errore nel caricamento della leaderboard:', err);
        this.globalLeaderboard = [];
        this.regionalLeaderboard = [];
        this.leaderboard = [];
        this.filteredLeaderboard = [];
      }
    });
  }

  private avatarPath(avatarId: number) {
    return `assets/profile_icons/id_${avatarId}.jpeg?v=${AVATAR_ASSET_VERSION}`;
  }

  switchView(view: 'global' | 'regional') {
    this.currentView = view;
    this.currentPage = 1;
    this.syncLeaderboard();
  }

  onSearchChange(event: any) {
    this.searchTerm = (event?.target?.value || '').toString();
    this.currentPage = 1;
    this.applyFilters();
  }

  goToPage(page: number) {
    this.currentPage = Math.min(Math.max(1, page), this.totalPages);
  }

  nextPage() {
    this.goToPage(this.currentPage + 1);
  }

  previousPage() {
    this.goToPage(this.currentPage - 1);
  }

  get dynamicRegionalLabel(): string {
    return this.currentRegionCode ? `Regionale - ${this.currentRegionCode}` : 'Regionale';
  }

  get viewLabel(): string {
    return this.currentView === 'global' ? 'Globale' : this.dynamicRegionalLabel;
  }

  get totalEntries(): number {
    return this.filteredLeaderboard.length;
  }

  get previewLeaderboard(): LeaderboardEntry[] {
    return this.filteredLeaderboard.slice(0, 5);
  }

  get currentPlayerEntry(): LeaderboardEntry | undefined {
    return this.leaderboard.find((entry) => entry.player === this.currentUsername);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredLeaderboard.length / this.pageSize));
  }

  get pageStart(): number {
    if (this.filteredLeaderboard.length === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredLeaderboard.length);
  }

  get pageRangeLabel(): string {
    return this.filteredLeaderboard.length === 0 ? '0 - 0' : `${this.pageStart} - ${this.pageEnd}`;
  }

  get pagedLeaderboard(): LeaderboardEntry[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredLeaderboard.slice(start, start + this.pageSize);
  }

  get pageNumbers(): number[] {
    const windowSize = 5;
    const halfWindow = Math.floor(windowSize / 2);
    let start = Math.max(1, this.currentPage - halfWindow);
    let end = Math.min(this.totalPages, start + windowSize - 1);

    if (end - start < windowSize - 1) {
      start = Math.max(1, end - windowSize + 1);
    }

    const pages: number[] = [];
    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }
    return pages;
  }

  private syncLeaderboard() {
    const list = this.currentView === 'global' ? this.globalLeaderboard : this.regionalLeaderboard;
    const playerInList = list.some((entry) => entry.player === this.currentUsername);

    if (!playerInList && this.currentUsername) {
      const rankVal = this.currentView === 'global' ? this.currentPlayer.rank : (this.currentPlayer.rank_regionale || this.currentPlayer.rank);
      this.leaderboard = [
        ...list,
        {
          rank: rankVal,
          region: this.currentPlayer.regionCode || this.currentPlayer.region || '',
          regionCode: this.currentPlayer.regionCode || '',
          regionName: this.currentPlayer.regionName || '',
          player: this.currentUsername,
          score: this.currentPlayer.score
        }
      ];
    } else {
      this.leaderboard = [...list];
    }
    this.applyFilters();
  }

  private applyFilters() {
    const query = this.searchTerm.trim().toLowerCase();
    if (!query) {
      this.filteredLeaderboard = [...this.leaderboard];
      this.currentPage = Math.min(this.currentPage, this.totalPages);
      return;
    }

    this.filteredLeaderboard = this.leaderboard.filter((entry) => {
      const regionText = (entry.regionName || entry.region || '').toString().toLowerCase();
      return (
        entry.player.toLowerCase().includes(query) ||
        regionText.includes(query) ||
        (entry.regionCode || '').toString().toLowerCase().includes(query) ||
        String(entry.rank).includes(query) ||
        String(entry.score).includes(query)
      );
    });

    this.currentPage = Math.min(this.currentPage, this.totalPages);
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
    const CACHE_KEY = 'pwm_country_flags';
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) { this.dynamicRegionMap = JSON.parse(cached); this.loadData(); return; }
    try {
      const res = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,translations');
      const data = await res.json();
      const newMap: Record<string, string> = {};
      data.forEach((country: any) => {
        newMap[country.cca2] = country.translations?.ita?.common || country.name.common;
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(newMap));
      this.dynamicRegionMap = newMap;
      this.loadData();
    } catch (e) { console.error('Errore bandiere:', e); this.loadData(); }
  }

  private regionFullName(region: string, code?: string): string {
    const codeKey = (code || '').toUpperCase();
    const nameMap: Record<string, string> = {
      AF: 'Afghanistan',
      AL: 'Albania',
      DZ: 'Algeria',
      AD: 'Andorra',
      AR: 'Argentina',
      AU: 'Australia',
      AT: 'Austria',
      BE: 'Belgio',
      BR: 'Brasile',
      CA: 'Canada',
      CN: 'Cina',
      HR: 'Croazia',
      DK: 'Danimarca',
      EG: 'Egitto',
      GB: 'Regno Unito',
      EU: 'Europa',
      FI: 'Finlandia',
      FR: 'Francia',
      DE: 'Germania',
      GR: 'Grecia',
      HU: 'Ungheria',
      IN: 'India',
      ID: 'Indonesia',
      IE: 'Irlanda',
      IL: 'Israele',
      IT: 'Italia',
      JP: 'Giappone',
      MX: 'Messico',
      NL: 'Paesi Bassi',
      NO: 'Norvegia',
      PL: 'Polonia',
      PT: 'Portogallo',
      RO: 'Romania',
      RU: 'Russia',
      RS: 'Serbia',
      ES: 'Spagna',
      SE: 'Svezia',
      CH: 'Svizzera',
      TR: 'Turchia',
      US: 'Stati Uniti'
    };

    if (codeKey && nameMap[codeKey]) return nameMap[codeKey];

    if (region && typeof region === 'string') {
      // fallback: capitalize words
      return region
        .toLowerCase()
        .split(/[^a-zA-Z -]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    return 'N/D';
  }

  flagEmoji(countryCode?: string): string {
    if (!countryCode || countryCode.length !== 2) return '🏳️';

    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map((char) => 127397 + char.charCodeAt(0));

    return String.fromCodePoint(...codePoints);
  }

  private playBackgroundVideo() {
    const video = this.backgroundVideo?.nativeElement;
    if (!video) return;
    video.muted = true;
    video.playsInline = true;
    video.load();
    video.play().catch(() => undefined);
  }
}
