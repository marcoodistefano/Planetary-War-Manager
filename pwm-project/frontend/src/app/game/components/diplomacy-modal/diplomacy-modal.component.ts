import { Component, Output, EventEmitter, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-diplomacy-modal',
  templateUrl: './diplomacy-modal.component.html',
  styleUrls: ['./diplomacy-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class DiplomacyModalComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  // Tabs
  activeTab: 'status' | 'treaties' | 'search' | 'requests' = 'status';

  // Dati simulati Alleanza
  myAlliance = {
    name: 'LEGIO FULMINATA',
    tag: 'LGF',
    level: 12,
    members: [
      { name: 'Comandante_Alpha', rank: 'Leader', status: 'online' },
      { name: 'Ufficiale_Alpha', rank: 'Ufficiale', status: 'online' },
      { name: 'Recluta_1', rank: 'Recluta', status: 'online' },
      { name: 'Ufficiale_Beta', rank: 'Ufficiale', status: 'online' },
      { name: 'Morgana', rank: 'Recluta', status: 'offline' }
    ],
    treaties: [
      { partner: 'Iron Vanguard', type: 'Non-Aggressione', duration: '4d 12h' },
      { partner: 'Shadow Alliance', type: 'Patto Militare', duration: '12d 5h' }
    ]
  };

  // --- VARIABILI PER IL TRASCINAMENTO (COPIATO DA TECH-TREE) ---
  isDragging = false;
  dragStartX = 0;
  dragStartY = 0;
  transformX = 0;
  transformY = 0;

  ngOnInit() {
    console.log("DIPLOMACY OS: Protocolli Diplomatici inizializzati...");
  }

  // --- LOGICA DRAG & DROP (COPIATO DA TECH-TREE) ---
  onDragStart(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // Evitiamo che il drag parta se clicchi su pulsanti o icone o nav-item
    if (target.tagName === 'BUTTON' || target.tagName === 'ION-ICON' || target.closest('.nav-item') || target.tagName === 'INPUT' || target.tagName === 'ION-SEARCHBAR') {
      return;
    }

    this.isDragging = true;
    this.dragStartX = event.clientX - this.transformX;
    this.dragStartY = event.clientY - this.transformY;
  }

  @HostListener('document:mousemove', ['$event'])
  onDragMove(event: MouseEvent) {
    if (!this.isDragging) return;
    this.transformX = event.clientX - this.dragStartX;
    this.transformY = event.clientY - this.dragStartY;
  }

  @HostListener('document:mouseup')
  onDragEnd() {
    this.isDragging = false;
  }

  closeModal() {
    this.close.emit();
  }
}