// tactical-terminal.component.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular'; // <--- Aggiunto ModalController
import { Router } from '@angular/router';

@Component({
  selector: 'app-tactical-terminal',
  templateUrl: './tactical-terminal.component.html',
  styleUrls: ['./tactical-terminal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TacticalTerminalComponent {
  @Input() profile: any;
  @Input() audioSettings: any;
  @Input() uiSettings: any;
  @Output() close = new EventEmitter<void>();

  activeTab: 'profile' | 'settings' = 'profile';

  constructor(
    private router: Router,
    private modalCtrl: ModalController // <--- Inietta il ModalController
  ) {}

  setTab(tab: 'profile' | 'settings') {
    this.activeTab = tab;
  }

  // Modificato per chiudere effettivamente la modale
  async closeTerminal() {
    this.close.emit(); // Notifica comunque il genitore se necessario
    await this.modalCtrl.dismiss(); // Chiude fisicamente la modale Ionic
  }

  // Navigazione con chiusura garantita
  async navigateToFullProfile() {
    // 1. Chiudiamo la modale (il comando await assicura che l'animazione inizi/avvenga)
    await this.modalCtrl.dismiss(); 
    
    // 2. Reindirizziamo alla pagina del profilo
    this.router.navigate(['/profile']); 
  }
}