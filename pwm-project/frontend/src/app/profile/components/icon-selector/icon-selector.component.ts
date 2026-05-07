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
  // Trasformiamo l'array in oggetti pre-elaborati
  icons = Array.from({ length: 20 }, (_, i) => ({
    path: `assets/icons/icon-${i + 1}.png`,
    id: i + 1
  }));

  constructor(private modalCtrl: ModalController) {}

  select(iconPath: string) {
    this.modalCtrl.dismiss(iconPath);
  }

  close() {
    this.modalCtrl.dismiss();
  }
}