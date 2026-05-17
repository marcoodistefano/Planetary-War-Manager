import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { Title } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';
import { IconSelectorComponent } from './components/icon-selector/icon-selector.component';
import { ChangeNameComponent } from './components/change-name/change-name.component';
import { ChangePasswordComponent } from './components/change-password/change-password.component';
import { SettingsComponent } from './components/settings/settings.component';
import { AuthApiService } from '../auth/auth-api.service';
import { UserStateService } from '../user-state.service';

const AVATAR_ASSET_VERSION = '20260517';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterModule]
})
export class ProfilePage implements OnInit, AfterViewInit {

  // === RIFERIMENTO AL VIDEO DI SFONDO ===
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  // Variabili di stato per l'offuscamento dati
  showEmail: boolean = false;
  showFriendCode: boolean = false;

  user: any = {
    username: 'Caricamento...',
    avatar: this.avatarPath(1),
    email: '...',
    reg: '...',
    elo_rating: 0,
    elo_history: [0, 0, 0, 0, 0], 
    territori_conquistati: 0,
    capitali_distrutte: 0,
    truppe_eliminate: 0,
    truppe_perse: 0,
    win_rate: 0,
    codice_amico: '...'
  };

  constructor(
    private router: Router, 
    private titleService: Title,
    private modalCtrl: ModalController,
    private authService: AuthApiService, // Il servizio che useremo per la chiamata
    private userState: UserStateService
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Profilo Comandante');
    this.loadUserData();
  }

  ionViewWillEnter() {
    this.loadUserData();
  }

  private avatarPath(avatarId: number) {
    return `assets/profile_icons/id_${avatarId}.jpeg?v=${AVATAR_ASSET_VERSION}`;
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

  loadUserData() {
    // Chiamata al nuovo endpoint tramite il servizio
    this.authService.getProfile().subscribe({
      next: (response: any) => {
        if (response && response.status === 200) {
          const profile = response.data.profile;
          const stats = response.data.combat_stats;

          // Mappiamo i dati del backend (JSON) sulle variabili del frontend
          this.user = {
            username: profile.username,
            email: profile.email,
            reg: profile.reg,
            elo_rating: profile.elo_rating,
            codice_amico: profile.codice_amico,
            
            // Lavoriamo con ID numerico nel DB e formiamo il prefisso id_ qui
            avatar: profile.avatar_id
              ? this.avatarPath(profile.avatar_id)
              : this.avatarPath(1),

            // Mappatura delle statistiche
            elo_history: stats.elo_history,
            territori_conquistati: stats.territories,
            capitali_distrutte: stats.capitals,
            truppe_eliminate: stats.kills,
            truppe_perse: stats.deaths,
            win_rate: stats.win_rate
          };
        }
      },
      error: (err) => {
        console.error("Errore nel recupero dei dati del profilo:", err);
        // Opzionale: Reindirizzare al login se l'utente non è autorizzato (Token scaduto)
        if (err.status === 401) {
          this.router.navigate(['/login']);
        }
      }
    });
  }

  async changeAvatar() {
  const modal = await this.modalCtrl.create({
    component: IconSelectorComponent,
    cssClass: 'tactical-modal' // <--- DEVE ESSERE tactical-modal!
  });
  await modal.present();

  const { data } = await modal.onDidDismiss();
  if (data) {
    console.log("Nuovo Avatar selezionato (path):", data);
    
    // Estraiamo l'ID dall'URL. Dall'URL 'assets/profile_icons/id_2.jpeg', vogliamo ottenere il numero '2'
    const fileName = data.split('/').pop(); 
    const idWithPrefix = fileName ? fileName.split('.')[0] : null; 
    const avatarId = idWithPrefix ? parseInt(idWithPrefix.replace('id_', ''), 10) : null; // 2

    if (avatarId && !isNaN(avatarId)) {
      this.authService.updateAvatar(avatarId.toString()).subscribe({
        next: (res) => {
          console.log("Avatar aggiornato nel DB!");
          // Aggiorna lo stato locale e notifica le altre pagine
          this.user.avatar = this.avatarPath(avatarId);
          this.userState.setAvatarId(avatarId);
        },
        error: (err) => {
          console.error("Errore salvataggio avatar:", err);
        }
      });
    } else {
      console.warn("Impossibile determinare l'ID numerico dell'avatar.");
    }
  }
}

  // Assicurati che sia così per TUTTI E TRE
async changeUsername() {
  const modal = await this.modalCtrl.create({
    component: ChangeNameComponent,
    cssClass: 'tactical-modal' // <--- DEVE ESSERE QUI
  });
  return await modal.present();
}

async changePassword() {
  const modal = await this.modalCtrl.create({
    component: ChangePasswordComponent,
    cssClass: 'tactical-modal' // <--- E ANCHE QUI
  });
  return await modal.present();
}

  toggleEmailVisibility() {
    this.showEmail = !this.showEmail;
  }

  toggleFriendCodeVisibility() {
    this.showFriendCode = !this.showFriendCode;
  }

  editProfile() { console.log('Accesso al pannello configurazione protocolli...'); }
  logout() { 
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }
  openMatchHistory() { console.log("Apertura Archivio: Recupero snapshot PostgreSQL per il Timelapse..."); }
  manageFriends() { console.log("Accesso alla Rete Diplomatica: Caricamento lista amici pending/accepted..."); }
  
  
  async openSettings() {
    const modal = await this.modalCtrl.create({
      component: SettingsComponent,
      cssClass: 'tactical-modal'
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data) {
      console.log("Applicazione nuove impostazioni...", data);
      
      // QUI DIREMO AL SERVIZIO DI CAMBIARE LINGUA:
      // this.translate.use(data.language);
      
      // E lo salveremo nel browser per ricordarlo al prossimo accesso:
      // localStorage.setItem('sys_lang', data.language);
    }
    }

  async ionViewWillLeave() {
    try {
      // Controlla se c'è una modale attualmente in cima allo stack visivo
      const topModal = await this.modalCtrl.getTop();
      
      // Se esiste una modale aperta, forzane la chiusura
      if (topModal) {
        await this.modalCtrl.dismiss();
      }
    } catch (error) {
      console.error('Errore durante la chiusura della modale:', error);
    }
  }
}