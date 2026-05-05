import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Title } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';

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
    private titleService: Title
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Profilo Comandante');
    this.loadUserData();
  }

  loadUserData() {
    this.user = {
      id_user: '550e8400-e29b-41d4-a716-446655440000',
      username: 'Generale_Inverno',
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

  toggleEmailVisibility() {
    this.showEmail = !this.showEmail;
  }

  toggleFriendCodeVisibility() {
    this.showFriendCode = !this.showFriendCode;
  }

  changeUsername() { console.log("Controllo cooldown 6 mesi per cambio username..."); }
  changePassword() { console.log("Generazione token alfanumerico temporaneo per reset..."); }
  changeAvatar() { console.log("Accesso alla collezione di 20 avatar tattici..."); }
  editProfile() { console.log('Accesso al pannello configurazione protocolli...'); }
  logout() { this.router.navigate(['/login']); }
  openMatchHistory() { console.log("Apertura Archivio: Recupero snapshot PostgreSQL per il Timelapse..."); }
  manageFriends() { console.log("Accesso alla Rete Diplomatica: Caricamento lista amici pending/accepted..."); }
  openSettings() { console.log("Inizializzazione Preferenze di Sistema: Lettura file .JSON locale..."); }
}