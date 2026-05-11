import { Component, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-newgames',
  templateUrl: './newgames.component.html',
  styleUrls: ['./newgames.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class NewgamesComponent implements OnInit {

  // Database temporaneo per simulazione visiva
  games: any[] = [
    { id: 1, name: 'Operazione Tempesta', players: '4/8', creator: 'Generale_Inverno', timeCreated: '2 min fa' },
    { id: 2, name: 'Assedio di Marte', players: '1/2', creator: 'RedRanger', timeCreated: '15 min fa' },
    { id: 3, name: 'Conflitto Globale', players: '12/16', creator: 'AlphaPrime', timeCreated: '1 ora fa' },
    { id: 4, name: 'Avamposto Omega', players: '7/10', creator: 'GhostProtocol', timeCreated: '3 ore fa' },
    { id: 5, name: 'Scontro Frontale', players: '2/4', creator: 'SniperWolf', timeCreated: '5 ore fa' }
  ];
  
  filteredGames: any[] = []; // Array per i risultati visibili

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    // All'avvio, mostra tutte le partite
    this.filteredGames = [...this.games];
  }

  // Metodo per la barra di ricerca custom
  filter(event: any) {
    const searchTerm = event.target.value.toLowerCase();
    this.filteredGames = this.games.filter(g => 
      g.name.toLowerCase().includes(searchTerm) || 
      g.creator.toLowerCase().includes(searchTerm)
    );
  }

  close() {
    this.modalCtrl.dismiss();
  }
}