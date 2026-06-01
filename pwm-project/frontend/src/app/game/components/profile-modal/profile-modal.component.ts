import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';

const AVATAR_ASSET_VERSION = '20260517';

@Component({
  selector: 'app-profile-modal',
  templateUrl: './profile-modal.component.html',
  styleUrls: ['./profile-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class ProfileModalComponent {
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

  constructor(private router: Router) {}

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