import { Component, Output, EventEmitter, OnInit, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-intelligence-modal',
  templateUrl: './intelligence-modal.component.html',
  styleUrls: ['./intelligence-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class IntelligenceModalComponent implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Input() playerResources: any;

  activeTab: 'espionage' | 'counter' | 'maintenance' = 'espionage';

  // --- STATO AGENTI ---
  spies = [
    { id: 1, name: 'Agente Echo', status: 'In missione', target: 'Settore Nord', daysUnpaid: 0 },
    { id: 2, name: 'Agente Shadow', status: 'Disponibile', target: '-', daysUnpaid: 1.5 },
    { id: 3, name: 'Agente Wraith', status: 'In attesa (2h)', target: '-', daysUnpaid: 0, isRecovering: true }
  ];

  dailyCostPerSpy = 500;

  // --- VARIABILI TRASCINAMENTO ---
  isDragging = false;
  dragStartX = 0; dragStartY = 0;
  transformX = 0; transformY = 0;

  ngOnInit() {
    console.log("INTELLIGENCE OS: Collegamento criptato stabilito...");
  }

  // --- LOGICA DI CALCOLO ABBANDONO (ESPONENZIALE) ---
  // Formula: P = 1 - e^(-k * t) dove k è una costante di sensibilità
  getDesertionRisk(daysUnpaid: number): number {
    if (daysUnpaid <= 0) return 0;
    const k = 0.5; // Regola la velocità di crescita del rischio
    const risk = (1 - Math.exp(-k * daysUnpaid)) * 100;
    return Math.round(risk);
  }

  // --- LOGICA DRAG & DROP ---
  onDragStart(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'ION-ICON' || target.closest('.nav-item')) return;
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
  onDragEnd() { this.isDragging = false; }

  closeModal() { this.close.emit(); }
}