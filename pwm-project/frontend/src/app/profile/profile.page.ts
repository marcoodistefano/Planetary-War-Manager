import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { Title } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';
import { IconSelectorComponent } from './components/icon-selector/icon-selector.component';
import { ChangeNameComponent } from './components/change-name/change-name.component';
import { ChangePasswordComponent } from './components/change-password/change-password.component';
import { SettingsComponent } from './components/settings/settings.component';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterModule]
})
export class ProfilePage implements OnInit {

  // Variabili di stato per l'offuscamento dati
  showEmail: boolean = false;
  showFriendCode: boolean = false;

  user: any = {
    username: '',
    avatar: 'assets/icons/icon-1.png', // Default avatar
    email: '',
    reg: '',
    elo_rating: 0,
    elo_history: [1100, 1250, 1200, 1380, 1450], 
    territori_conquistati: 0,
    capitali_distrutte: 0,
    truppe_eliminate: 0,
    truppe_perse: 0,
    win_rate: 65 
  };

  constructor(
    private router: Router, 
    private titleService: Title,
    private modalCtrl: ModalController
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Profilo Comandante');
    this.loadUserData();
  }

  loadUserData() {
    this.user = {
      id_user: '550e8400-e29b-41d4-a716-446655440000',
      username: 'Generale_Inverno',
      avatar: 'assets/icons/icon-1.png',
      email: 'gen@mail.com',
      reg: 'Europa',
      elo_rating: 1450,
      elo_history: [1100, 1250, 1200, 1380, 1450],
      codice_amico: 'AMICO-X8F9',
      territori_conquistati: 142,
      capitali_distrutte: 12,
      truppe_eliminate: 15420,
      truppe_perse: 8430,
      win_rate: 65
    };
  }

  async changeAvatar() {
  const modal = await this.modalCtrl.create({
    component: IconSelectorComponent,
    cssClass: 'tactical-modal' // <--- DEVE ESSERE tactical-modal!
  });
  await modal.present();

  const { data } = await modal.onDidDismiss();
  if (data) {
    console.log("Nuovo Avatar selezionato:", data);
    this.user.avatar = data; 
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
  logout() { this.router.navigate(['/login']); }
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
}