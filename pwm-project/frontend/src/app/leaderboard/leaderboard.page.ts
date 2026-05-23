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

  currentPlayer = { name: 'Caricamento...', region: '', rank: 0, score: 0, avatar: this.avatarPath(1) };
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

  constructor(
    private homeService: HomeService,
    private userState: UserStateService,
    private titleService: Title,
    private router: Router
  ) {}

  ngOnInit() {
    this.titleService.setTitle('PWM | Leaderboard');
    this.loadData();

    this.pollingInterval = setInterval(() => {
      this.loadData();
    }, 120000);

    this.avatarSub = this.userState.avatarId$.subscribe(() => undefined);
  }

  ngAfterViewInit() {
    this.playBackgroundVideo();
  }

  ngOnDestroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    if (this.avatarSub) {
      this.avatarSub.unsubscribe();
    }
  }

  ionViewDidEnter() {
    this.playBackgroundVideo();
  }

  ionViewWillLeave() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  goHome() {
    this.router.navigate(['/home']);
  }

  loadData() {
    this.homeService.getDashboardData().subscribe({
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
            score: info.user_profile.elo_rating,
            avatar: info.user_profile.avatar_id ? this.avatarPath(info.user_profile.avatar_id) : this.avatarPath(1)
          };
          // attach readable region info for the current player
          (this.currentPlayer as any).regionCode = userRegionCode;
          (this.currentPlayer as any).regionName = this.regionFullName(info.user_profile.reg || '', userRegionCode);
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
    this.leaderboard = this.currentView === 'global' ? this.globalLeaderboard : this.regionalLeaderboard;
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

    return regionMap[normalized] || normalized.substring(0, 2).toUpperCase();
  }

  private regionFullName(region: string, code?: string): string {
    const codeKey = (code || '').toUpperCase();
    const nameMap: Record<string, string> = {
      AF: 'Afghanistan',
      AL: 'Albania',
      DZ: 'Algeria',
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
