import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-change-password',
  templateUrl: './change-password.component.html',
  styleUrls: ['./change-password.component.scss'], // Assicurati che il percorso sia corretto
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule]
})
export class ChangePasswordComponent {
  passData = { old: '', new: '', confirm: '' };

  constructor(private modalCtrl: ModalController) {}

  save() {
    // Validazione base prima di chiudere
    if (this.passData.new === this.passData.confirm && this.passData.new.length >= 8) {
      this.modalCtrl.dismiss({
        old: this.passData.old,
        new: this.passData.new
      });
    }
  }

  close() {
    this.modalCtrl.dismiss();
  }
}