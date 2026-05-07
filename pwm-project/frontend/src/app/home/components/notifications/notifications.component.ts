import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class NotificationsComponent {
  // Dati simulati per i log operativi
  notifications = [
    { type: 'danger', time: '14:20', msg: 'Rilevato attacco al Settore 7. Schierare truppe immediatamente.' },
    { type: 'warning', time: '12:05', msg: 'Risorse energetiche al 20%. Attivare protocollo risparmio.' },
    { type: 'success', time: '10:45', msg: 'Trattato di non aggressione firmato con la fazione Orion.' },
    { type: 'primary', time: '08:00', msg: 'Sincronizzazione olografica completata. Sistema operativo stabile.' }
  ];

  constructor(private modalCtrl: ModalController) {}

  close() {
    this.modalCtrl.dismiss();
  }
}