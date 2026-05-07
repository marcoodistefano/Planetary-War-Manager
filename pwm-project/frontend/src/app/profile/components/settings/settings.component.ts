import { Component } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class SettingsComponent {
  settings = {
    masterVol: 80,
    musicVol: 65,
    voiceAssist: true,
    scanlines: false,
    animations: true,
    language: 'it'
  };

  // NUOVA VARIABILE PER IL MENU
  isLangMenuOpen = false;

  constructor(private modalCtrl: ModalController) {}

  // NUOVO METODO PER SELEZIONARE LA LINGUA
  selectLang(lang: string) {
    this.settings.language = lang;
    this.isLangMenuOpen = false;
  }

  save() {
    this.modalCtrl.dismiss(this.settings);
  }

  close() {
    this.modalCtrl.dismiss();
  }
}