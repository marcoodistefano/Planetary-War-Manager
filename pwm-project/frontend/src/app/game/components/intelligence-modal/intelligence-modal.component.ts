import { Component, Output, EventEmitter, OnInit, Input } from '@angular/core';
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

  closeModal() { this.close.emit(); }
}