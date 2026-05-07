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

  constructor(private modalCtrl: ModalController) {}

  // Metodo mancante rilevato dall'errore
  confirmCreation() {
    console.log('Protocollo avviato...');
    this.modalCtrl.dismiss({ created: true });
  }

  // Metodo mancante rilevato dall'errore
  close() {
    this.modalCtrl.dismiss();
  }
}