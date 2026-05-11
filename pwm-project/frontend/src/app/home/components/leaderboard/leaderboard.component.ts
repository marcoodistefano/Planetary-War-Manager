import { Component, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-leaderboard',
  templateUrl: './leaderboard.component.html',
  styleUrls: ['./leaderboard.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class LeaderboardComponent implements OnInit {
  
  leaderboard: any[] = []; 
  currentView: 'global' | 'regional' = 'global';

  // Dati fittizi - Rete Globale (Utilizzando codici nazione ISO 3166-1 alpha-2)
  mockGlobal = [
    { rank: 1, region: 'JP', player: 'CyberNinja', score: 2450 }, // Giappone
    { rank: 2, region: 'US', player: 'Maverick', score: 2380 },   // Stati Uniti
    { rank: 3, region: 'IT', player: 'Generale_Inverno', score: 2100 }, // Italia
    { rank: 4, region: 'BR', player: 'ElComandante', score: 1950 }, // Brasile
    { rank: 5, region: 'AU', player: 'DropBear', score: 1890 },   // Australia
    { rank: 6, region: 'CA', player: 'GhostProtocol', score: 1850 }, // Canada
    { rank: 7, region: 'DE', player: 'IronWall', score: 1820 }    // Germania
  ];

  // Dati fittizi - Rete Regionale (Es. Server Europei)
  mockRegional = [
    { rank: 1, region: 'IT', player: 'Generale_Inverno', score: 2100 }, // Italia
    { rank: 2, region: 'DE', player: 'IronWall', score: 1820 }, // Germania
    { rank: 3, region: 'SE', player: 'VikingActual', score: 1750 }, // Svezia
    { rank: 4, region: 'GR', player: 'Spartan01', score: 1690 }, // Grecia
    { rank: 5, region: 'FR', player: 'RedBaron', score: 1610 }, // Francia
    { rank: 6, region: 'GB', player: 'Centurion', score: 1580 }, // Regno Unito
    { rank: 7, region: 'ES', player: 'NightOwl', score: 1520 }  // Spagna
  ];

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.leaderboard = this.currentView === 'global' ? this.mockGlobal : this.mockRegional;
  }

  switchView(view: 'global' | 'regional') {
    this.currentView = view;
    this.loadData();
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