import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';

@Component({
  selector: 'app-tactical-terminal',
  templateUrl: './tactical-terminal.component.html',
  styleUrls: ['./tactical-terminal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TacticalTerminalComponent {
  // Aggiunti valori Placeholder di default
  @Input() profile: any = {
    username: 'GHOST_OPERATIVE',
    rank: 'COMANDANTE SUPREMO',
    experience: 78,
    matchesWon: 142,
    matchesLost: 29
  };

  @Input() audioSettings: any = { music: 65, sfx: 85 };
  @Input() uiSettings: any = { showAdvancedLabels: true };
  
  @Output() close = new EventEmitter<void>();

  activeTab: 'profile' | 'settings' = 'profile';

  constructor(
    private router: Router,
    private modalCtrl: ModalController
  ) {}

  setTab(tab: 'profile' | 'settings') {
    this.activeTab = tab;
  }

  closeTerminal() {
    this.close.emit();
  }

  async navigateToFullProfile() {
    // 1. Emette l'evento "close" al genitore (match.page.ts) che imposterà isProfileModalOpen = false
    this.close.emit(); 
    
    // 2. Naviga verso la rotta del profilo
    this.router.navigate(['/profile']); 
  }
}