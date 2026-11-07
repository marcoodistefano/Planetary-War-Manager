import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms'; 
import { CommonModule } from '@angular/common';
import { AuthApiService } from '../../../auth/auth-api.service';

@Component({
  selector: 'app-change-name',
  templateUrl: './change-name.component.html',
  styleUrls: ['./change-name.component.scss'], // <--- MANCAVA QUESTA RIGA!
  standalone: true, 
  imports: [IonicModule, FormsModule, CommonModule] 
})
export class ChangeNameComponent {
  newName: string = '';
  errorMessage = '';
  isSaving = false;

  constructor(
    private modalCtrl: ModalController,
    private authService: AuthApiService,
  ) {}

  confirm() {
    const username = this.newName.trim();
    if (!/^[A-Za-z0-9_]{3,32}$/.test(username) || this.isSaving) return;

    this.isSaving = true;
    this.errorMessage = '';
    this.authService.updateUsername(username).subscribe({
      next: () => this.modalCtrl.dismiss(username),
      error: (error) => {
        this.isSaving = false;
        this.errorMessage = error.status === 409
          ? 'Username già in uso.'
          : error.error?.error || 'Impossibile aggiornare lo username.';
      },
    });
  }

  close() {
    this.modalCtrl.dismiss();
  }
}