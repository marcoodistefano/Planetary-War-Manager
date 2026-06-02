import { Component, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserStateService, AppSettings } from '../../../user-state.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class SettingsComponent implements OnInit {
  settings!: AppSettings;

  // NUOVA VARIABILE PER IL MENU
  isLangMenuOpen = false;

  constructor(
    private modalCtrl: ModalController,
    private userState: UserStateService
  ) {}

  ngOnInit() {
    this.userState.settings$.subscribe((settings: AppSettings) => {
      this.settings = { ...settings };
    });
  }

  onSettingChange() {
    if (this.settings.masterVol === null || this.settings.masterVol === undefined) {
      return;
    }
    if (this.settings.masterVol < 0) {
      this.settings.masterVol = 0;
    } else if (this.settings.masterVol > 100) {
      this.settings.masterVol = 100;
    }
    this.userState.updateSettings(this.settings);
  }

  // NUOVO METODO PER SELEZIONARE LA LINGUA
  selectLang(lang: string) {
    this.settings.language = lang;
    this.isLangMenuOpen = false;
    this.onSettingChange();
  }

  save() {
    this.userState.updateSettings(this.settings);
    this.modalCtrl.dismiss(this.settings);
  }

  close() {
    this.modalCtrl.dismiss();
  }
}