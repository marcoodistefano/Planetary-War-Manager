import { Component, Output, EventEmitter, OnInit, OnChanges, Input, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HomeService } from '../../../home/home';

interface AllianceMemberView {
  name: string;
  status: 'online' | 'offline';
  rank: string;
  isOwner?: boolean;
}

interface MatchAllianceView {
  id_alleanza?: string | number;
  nome_alleanza?: string;
  nome_logo?: string;
  numero_partecipanti?: number;
  members?: string[];
  leader_name?: string;
}

@Component({
  selector: 'app-diplomacy-modal',
  templateUrl: './diplomacy-modal.component.html',
  styleUrls: ['./diplomacy-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class DiplomacyModalComponent implements OnInit, OnChanges {
  private readonly allianceNameMaxLength = 32;

  @Output() close = new EventEmitter<void>();
  @Output() alliancesChanged = new EventEmitter<void>();
  @Input() alliances: MatchAllianceView[] = [];
  @Input() matchPlayers: string[] = [];
  @Input() matchNations: any[] = [];
  @Input() currentUser = '';
  @Input() matchId = '';

  activeTab: 'status' | 'manage' | 'search' | 'players' = 'status';

  selectedAllianceIndex = 0;
  allianceActionError = '';
  allianceActionSuccess = '';
  isUpdatingAlliance = false;
  newAllianceName = '';
  searchQuery = '';

  constructor(private homeService: HomeService) {}

  ngOnInit() {
    this.syncSelectedAlliance();
    console.log('DIPLOMACY OS: Protocolli Diplomatici inizializzati...');
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['alliances'] || changes['currentUser'] || changes['matchPlayers']) {
      this.syncSelectedAlliance();
    }
  }

  get selectedAlliance(): MatchAllianceView | null {
    return this.alliances[this.selectedAllianceIndex] || null;
  }

  get allNations(): any[] {
    if (!this.matchNations || !this.matchNations.length) return [];
    return this.matchNations
      .filter(n => n.isOccupied)
      .map(n => {
        const name = String(n.name || 'NAZIONE SCONOSCIUTA').toUpperCase();
        const rawOwner = String(n.playerId || '');
        const isBot = rawOwner.toLowerCase().includes('bot');
        const owner = isBot ? rawOwner.replace(/_bot/gi, '') : rawOwner;
        return {
          name,
          owner: owner.toUpperCase(),
          isBot
        };
      })
      .sort((a, b) => a.owner.localeCompare(b.owner));
  }

  get selectedAllianceMembers(): AllianceMemberView[] {
    const alliance = this.selectedAlliance;
    if (!alliance?.members?.length) {
      return [];
    }

    const onlineRoster = new Set(this.matchPlayers.map((name) => String(name || '').trim().toLowerCase()));
    const currentUser = String(this.currentUser || '').trim().toLowerCase();

    return alliance.members
      .map((member) => String(member || '').trim())
      .filter((member) => Boolean(member))
      .map((member) => {
        const isOwner = Boolean(alliance.leader_name && member.toLowerCase() === alliance.leader_name.toLowerCase());
        let rankStr = 'Membro';
        if (member.toLowerCase() === currentUser) {
          rankStr = isOwner ? 'TU (Proprietario)' : 'TU';
        } else {
          rankStr = isOwner ? 'Proprietario' : (onlineRoster.has(member.toLowerCase()) ? 'Attivo' : 'Membro');
        }
        
        return {
          name: member,
          rank: rankStr,
          isOwner: isOwner,
          status: onlineRoster.has(member.toLowerCase()) ? 'online' : 'offline',
        };
      });
  }

  get selectedAllianceTitle(): string {
    const alliance = this.selectedAlliance;
    return alliance?.nome_alleanza || 'NESSUNA ALLEANZA';
  }

  get selectedAllianceTag(): string {
    const alliance = this.selectedAlliance;
    const name = String(alliance?.nome_alleanza || '').trim();
    if (!name) {
      return 'N/A';
    }

    return name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 4)
      .toUpperCase();
  }
  
  get filteredAlliances(): MatchAllianceView[] {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) return this.alliances;

    return this.alliances.filter(alliance => {
      const name = (alliance.nome_alleanza || '').toLowerCase();
      const tag = name
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0])
        .join('')
        .slice(0, 4)
        .toLowerCase();
        
      return name.includes(query) || tag.includes(query);
    });
  }

  get selectedAllianceLevel(): number {
    const alliance = this.selectedAlliance;
    return Math.max(1, Number(alliance?.numero_partecipanti || 0));
  }

  get currentAllianceIndex(): number {
    const currentUser = String(this.currentUser || '').trim().toLowerCase();
    if (!currentUser) {
      return -1;
    }

    return this.alliances.findIndex((alliance) =>
      Array.isArray(alliance.members) && alliance.members.some((member) => String(member || '').trim().toLowerCase() === currentUser),
    );
  }

  get currentAlliance(): MatchAllianceView | null {
    return this.currentAllianceIndex >= 0 ? this.alliances[this.currentAllianceIndex] : null;
  }

  get currentAllianceTitle(): string {
    return this.currentAlliance?.nome_alleanza || 'NESSUNA ALLEANZA';
  }

  private syncSelectedAlliance() {
    if (!this.alliances.length) {
      this.selectedAllianceIndex = 0;
      return;
    }

    const currentUser = String(this.currentUser || '').trim().toLowerCase();
    const matchedIndex = this.alliances.findIndex((alliance) =>
      Array.isArray(alliance.members) && alliance.members.some((member) => String(member || '').trim().toLowerCase() === currentUser),
    );

    this.selectedAllianceIndex = matchedIndex >= 0 ? matchedIndex : Math.min(this.selectedAllianceIndex, this.alliances.length - 1);
  }

  private getAllianceId(alliance: MatchAllianceView | null | undefined): string {
    return String(alliance?.id_alleanza ?? '').trim();
  }

  isCurrentAlliance(alliance: MatchAllianceView | null | undefined): boolean {
    if (!alliance) {
      return false;
    }

    const allianceId = this.getAllianceId(alliance);
    const currentAllianceId = this.getAllianceId(this.currentAlliance);
    return allianceId !== '' && allianceId === currentAllianceId;
  }

  canJoinAlliance(alliance: MatchAllianceView | null | undefined): boolean {
    return !this.isCurrentAlliance(alliance);
  }

  private normalizeAllianceName(value: string): string {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private validateAllianceName(value: string): string | null {
    if (!value) {
      return 'Inserisci un nome alleanza valido.';
    }

    if (value.length > this.allianceNameMaxLength) {
      return `Il nome alleanza non puo superare ${this.allianceNameMaxLength} caratteri.`;
    }

    if (!/^[a-zA-Z0-9 _.'-]+$/.test(value)) {
      return 'Il nome alleanza contiene caratteri non consentiti.';
    }

    return null;
  }

  selectAlliance(index: number) {
    if (index < 0 || index >= this.alliances.length) {
      return;
    }

    this.selectedAllianceIndex = index;
  }

  joinAlliance(alliance: MatchAllianceView | null | undefined) {
    const allianceId = this.getAllianceId(alliance);
    if (!this.matchId || !allianceId) {
      this.allianceActionError = 'Alleanza o match non disponibili.';
      return;
    }

    if (this.isCurrentAlliance(alliance)) {
      this.allianceActionError = 'Sei già in questa alleanza.';
      return;
    }

    this.allianceActionError = '';
    this.allianceActionSuccess = '';
    this.isUpdatingAlliance = true;

    this.homeService.joinMatchAlliance(this.matchId, allianceId).subscribe({
      next: () => {
        this.isUpdatingAlliance = false;
        this.allianceActionSuccess = 'Ingresso nell\'alleanza completato.';
        this.alliancesChanged.emit();
      },
      error: (error) => {
        this.isUpdatingAlliance = false;
        const backendMessage =
          error?.error?.message ||
          error?.error?.error ||
          error?.error?.details ||
          (typeof error?.error === 'string' ? error.error : '') ||
          '';
        this.allianceActionError = backendMessage || error?.message || 'Impossibile unirsi all\'alleanza.';
      }
    });
  }

  createAlliance() {
    if (!this.matchId) {
      this.allianceActionError = 'Match non disponibile.';
      return;
    }

    if (this.currentAlliance) {
      this.allianceActionError = 'Sei gia in un\'alleanza.';
      return;
    }

    const allianceName = this.normalizeAllianceName(this.newAllianceName);
    const validationError = this.validateAllianceName(allianceName);
    if (validationError) {
      this.allianceActionError = validationError;
      return;
    }

    this.newAllianceName = allianceName;

    this.allianceActionError = '';
    this.allianceActionSuccess = '';
    this.isUpdatingAlliance = true;

    this.homeService.createMatchAlliance(this.matchId, allianceName).subscribe({
      next: () => {
        this.isUpdatingAlliance = false;
        this.newAllianceName = '';
        this.allianceActionSuccess = 'Alleanza creata con successo.';
        this.alliancesChanged.emit();
      },
      error: (error) => {
        this.isUpdatingAlliance = false;
        const backendMessage =
          error?.error?.message ||
          error?.error?.error ||
          error?.error?.details ||
          (typeof error?.error === 'string' ? error.error : '') ||
          '';
        this.allianceActionError = backendMessage || error?.message || 'Impossibile creare l\'alleanza.';
      }
    });
  }

  leaveAlliance(alliance: MatchAllianceView | null | undefined) {
    const allianceId = this.getAllianceId(alliance);
    if (!this.matchId || !allianceId) {
      this.allianceActionError = 'Alleanza o match non disponibili.';
      return;
    }

    if (!this.isCurrentAlliance(alliance)) {
      this.allianceActionError = 'Non sei membro di questa alleanza.';
      return;
    }

    this.allianceActionError = '';
    this.allianceActionSuccess = '';
    this.isUpdatingAlliance = true;

    this.homeService.leaveMatchAlliance(this.matchId, allianceId).subscribe({
      next: () => {
        this.isUpdatingAlliance = false;
        this.allianceActionSuccess = 'Hai lasciato l\'alleanza.';
        this.alliancesChanged.emit();
      },
      error: (error) => {
        this.isUpdatingAlliance = false;
        const backendMessage =
          error?.error?.message ||
          error?.error?.error ||
          error?.error?.details ||
          (typeof error?.error === 'string' ? error.error : '') ||
          '';
        this.allianceActionError = backendMessage || error?.message || 'Impossibile lasciare l\'alleanza.';
      }
    });
  }

  closeModal() {
    this.close.emit();
  }
}