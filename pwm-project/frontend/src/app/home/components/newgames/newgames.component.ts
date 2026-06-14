import { Component, Input, OnInit } from '@angular/core';
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

  @Input() games: any[] | undefined;

  sortKey: 'date' | 'players' | 'region' = 'date';
  sortDirection: 'asc' | 'desc' = 'desc';



  filteredGames: any[] = []; // Array per i risultati visibili

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    // Mostra le partite reali dal backend
    const source = Array.isArray(this.games) ? [...this.games] : [];
    this.filteredGames = this.sortGames(source);
  }

  // Metodo per la barra di ricerca custom
  filter(event: any) {
    const searchTerm = event.target.value.toLowerCase();
    const source = Array.isArray(this.games) ? this.games : [];
    this.filteredGames = this.sortGames(source.filter(g => 
      String(g.name).toLowerCase().includes(searchTerm) || 
      String(g.creator).toLowerCase().includes(searchTerm)
    ));
  }

  sortBy(key: 'date' | 'players' | 'region') {
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDirection = key === 'date' ? 'desc' : 'asc';
    }
    const source = Array.isArray(this.games) ? this.games : [];
    this.filteredGames = this.sortGames(source);
  }

  private sortGames(games: any[]) {
    const directionFactor = this.sortDirection === 'asc' ? 1 : -1;
    return [...games].sort((a, b) => {
      if (this.sortKey === 'players') {
        const aPlayers = Number(a.players) || 0;
        const bPlayers = Number(b.players) || 0;
        return (aPlayers - bPlayers) * directionFactor;
      }

      if (this.sortKey === 'region') {
        const aRegion = String(a.regionPlayable || '').toLowerCase();
        const bRegion = String(b.regionPlayable || '').toLowerCase();
        return aRegion.localeCompare(bRegion) * directionFactor;
      }

      const aDate = new Date(a.timeCreated || a.timeCreatedFormatted || 0).getTime();
      const bDate = new Date(b.timeCreated || b.timeCreatedFormatted || 0).getTime();
      return (aDate - bDate) * directionFactor;
    });
  }

  close() {
    this.modalCtrl.dismiss();
  }

  joinGame(game: any) {
    this.modalCtrl.dismiss(game);
  }
}