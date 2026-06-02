import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { UserStateService, AppSettings } from '../../../user-state.service';
import { Subscription } from 'rxjs';

const AVATAR_ASSET_VERSION = '20260517';

@Component({
  selector: 'app-profile-modal',
  templateUrl: './profile-modal.component.html',
  styleUrls: ['./profile-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class ProfileModalComponent implements OnInit, OnDestroy {
  @Input() profile: any = {
    username: 'Caricamento...',
    rank: 'COMANDANTE SUPREMO',
    experience: 0,
    matchesWon: 0,
    matchesLost: 0,
    avatar: null,
    avatar_id: null
  };

  @Input() audioSettings: any = { music: 50, sfx: 80 };
  @Output() close = new EventEmitter<void>();

  activeTab: 'profile' | 'settings' = 'profile';
  settings!: AppSettings;
  private settingsSub?: Subscription;

  constructor(
    private router: Router,
    private userState: UserStateService
  ) {}

  ngOnInit() {
    this.settingsSub = this.userState.settings$.subscribe((settings: AppSettings) => {
      this.settings = { ...settings };
      // Fallback binding for audioSettings to support any legacy bindings or visual parts
      this.audioSettings.music = this.settings.musicVol;
      this.audioSettings.sfx = this.settings.sfxVol;
    });
  }

  ngOnDestroy() {
    this.settingsSub?.unsubscribe();
  }

  onSettingChange() {
    // Sincronizza i cambiamenti delle impostazioni
    this.settings.musicVol = this.audioSettings.music;
    this.settings.sfxVol = this.audioSettings.sfx;
    this.userState.updateSettings(this.settings);
  }

  setTab(tab: 'profile' | 'settings') {
    this.activeTab = tab;
  }

  closeTerminal() {
    this.close.emit();
  }

  getProfileAvatarSrc(): string | null {
    const avatarValue = this.profile?.avatar;

    if (typeof avatarValue === 'string' && avatarValue.trim()) {
      return avatarValue.trim();
    }

    const avatarId = this.profile?.avatar_id ?? this.profile?.avatarId;
    const parsedAvatarId = Number(avatarId);

    if (Number.isFinite(parsedAvatarId) && parsedAvatarId > 0) {
      return `assets/profile_icons/id_${parsedAvatarId}.jpeg?v=${AVATAR_ASSET_VERSION}`;
    }

    return null;
  }

  navigateToFullProfile() {
    this.close.emit();
    this.router.navigate(['/profile']);
  }
}