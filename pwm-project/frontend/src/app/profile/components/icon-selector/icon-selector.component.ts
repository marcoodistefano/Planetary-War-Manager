import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-icon-selector',
  templateUrl: './icon-selector.component.html',
  styleUrls: ['./icon-selector.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class IconSelectorComponent {
  // Aggiornato a 37 icone con estensione .jpeg e prefisso id_
  icons = Array.from({ length: 37 }, (_, i) => ({
    path: `assets/profile_icons/id_${i + 1}.jpeg?v=20260517`,
    id: i + 1
  }));

  constructor(private modalCtrl: ModalController) {}

  select(iconPath: string) {
    // Restituisce il percorso dell'icona selezionata al componente chiamante
    this.modalCtrl.dismiss(iconPath);
  }

  close() {
    this.modalCtrl.dismiss();
  }
}