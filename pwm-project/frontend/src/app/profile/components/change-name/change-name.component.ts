import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms'; 
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-change-name',
  templateUrl: './change-name.component.html',
  styleUrls: ['./change-name.component.scss'], // <--- MANCAVA QUESTA RIGA!
  standalone: true, 
  imports: [IonicModule, FormsModule, CommonModule] 
})
export class ChangeNameComponent {
  newName: string = '';

  constructor(private modalCtrl: ModalController) {}

  confirm() {
    if (this.newName.trim().length >= 3) {
      this.modalCtrl.dismiss(this.newName);
    }
  }

  close() {
    this.modalCtrl.dismiss();
  }
}