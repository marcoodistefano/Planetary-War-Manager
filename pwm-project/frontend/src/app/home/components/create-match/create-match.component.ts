import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Importato per ngModel
import { HttpClient, HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-create-match',
  templateUrl: './create-match.component.html',
  styleUrls: ['./create-match.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule]
})
export class CreateMatchComponent {
  // Modello dati per il match
  matchData = {
    missione: '',
    regione: 'World',
    mapSize: 'Medium',
    maxPlayers: '10',
    modalita: 'Tutti contro tutti',
    vittoriaSoglia: 50,
    isSquad: false,
    hasElo: true,
    alleanze: true,
    durata: '1 giorno',
    moltiplicatore: 'x1',
    avvio: 'Immediato',
    quorum: 2
  };

  regioni = ['World', 'Europe', 'Asia', 'Africa', 'Oceania', 'America North', 'America South', 'Antartica'];
  maxPlayers = ['10', '20', '30', '50', '100', '250', '500', '1v1', '2v2', '3v3', '4v4', '5v5', '10v10', '25v25', '50v50'];
  durataMax = ['1 ora', '6 ore', '12 ore', '1 giorno', '3 giorni', '5 giorni', '7 giorni', '10 giorni', '14 giorni', '32 giorni', '60 giorni', '90 giorni', '120 giorni', 'Nessun limite'];
  moltiplicatori = ['x1', 'x2', 'x3', 'x4', 'x5', 'x10', 'x20', 'x30', 'x40', 'x50', 'x60', 'x100', 'x200', 'x500', 'x1000', 'Produzione Istantanea'];
  modalitaGioco = ['Tutti contro tutti', 'Capture the Flag', 'King of the Hill', 'Domination', 'Destruction'];

  constructor(
    private modalCtrl: ModalController,
    private http: HttpClient
  ) {}

  async confirmCreation() {
    console.log('Trasmissione ordini di battaglia...');

    // Simuliamo l'ID utente (nella realtà verrebbe dal servizio di autenticazione)
    const headers = { 'x-user-id': 'USER_12345' };

    try {
      const response: any = await this.http.post('http://localhost:3000/match/create', this.matchData, { headers }).toPromise();
      console.log('Risposta Cluster:', response);
      this.modalCtrl.dismiss({ created: true, matchId: response.data.matchId });
    } catch (error) {
      console.error('Errore durante la trasmissione:', error);
    }
  }

  close() {
    this.modalCtrl.dismiss();
  }
}