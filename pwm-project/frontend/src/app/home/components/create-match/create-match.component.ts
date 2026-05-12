import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-create-match',
  templateUrl: './create-match.component.html',
  styleUrls: ['./create-match.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CreateMatchComponent {

  // Parametri di configurazione estratti dal motore Eru.js
  regioni = ['World', 'Europe', 'Asia', 'Africa', 'Oceania', 'America North', 'America South', 'Antartica', 'Middle East', 'Italy', 'Old World', 'Pangea', 'Russia', 'Custom'];
  maxPlayers = ['10', '20', '30', '50', '100', '250', '500', '1v1', '2v2', '3v3', '4v4', '5v5', '10v10', '25v25', '50v50'];
  durataMax = ['1 ora', '6 ore', '12 ore', '1 giorno', '3 giorni', '5 giorni', '7 giorni', '10 giorni', '14 giorni', '32 giorni', '60 giorni', '90 giorni', '120 giorni', 'Nessun limite'];
  moltiplicatori = ['x1', 'x2', 'x3', 'x4', 'x5', 'x10', 'x20', 'x30', 'x40', 'x50', 'x60', 'x100', 'x200', 'x500', 'x1000', 'Produzione Istantanea'];
  modalitaGioco = ['Tutti contro tutti', 'Capture the Flag', 'King of the Hill', 'Domination', 'Destruction'];

  constructor(private modalCtrl: ModalController) {}

  confirmCreation() {
    console.log('Protocollo avviato con i parametri Eru...');
    this.modalCtrl.dismiss({ created: true });
  }

  close() {
    this.modalCtrl.dismiss();
  }
}