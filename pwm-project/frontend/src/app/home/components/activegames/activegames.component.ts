import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

@Component({
  selector: 'app-activegames',
  templateUrl: './activegames.component.html',
  styleUrls: ['./activegames.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ActivegamesComponent implements OnInit {
  
  @Input() activeGames: any[] = []; // Riceve i dati dalla home via componentProps

  // Dati fittizi di backup nel caso il componente venga aperto senza parametri
  fallbackGames: any[] = [
    { id: 101, name: 'Conflitto in Eurasia', players: '3/8', status: 'IN CORSO', turnNumber: 12 },
    { id: 102, name: 'Difesa del Settore 7', players: '5/5', status: 'TURNO 4', startTime: new Date(Date.now() - 7200000) }, // 2 ore fa
    { id: 103, name: 'Campagna del Deserto', players: '2/6', status: 'IN CORSO', turnNumber: 3 }
  ];

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    // Se l'array è vuoto, usa i fittizi per mostrare l'interfaccia
    if (!this.activeGames || this.activeGames.length === 0) {
      this.activeGames = this.fallbackGames;
    }
  }

  close() {
    this.modalCtrl.dismiss();
  }

  // Funzione di formattazione tempo
  activeGameTimeText(game: any) {
    if (game.turnNumber) return `${game.turnNumber}ª ora di gioco`;
    if (game.startTime) {
      const hours = Math.floor((Date.now() - new Date(game.startTime).getTime()) / 3600000);
      return `sono passate ${hours} ore dall'inizio`;
    }
    return 'Tempo sconosciuto';
  }
}