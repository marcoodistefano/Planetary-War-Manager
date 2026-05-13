import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular'; // <-- FONDAMENTALE per le icone

@Component({
  selector: 'app-army-modal',
  templateUrl: './army-modal.component.html',
  styleUrls: ['./army-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule] // <-- Inserito qui
})
export class ArmyModalComponent {
  
  // Emettitore per comunicare alla MatchPage di chiudere la modale
  @Output() close = new EventEmitter<void>();

  // Il metodo mancante che il tuo HTML stava cercando!
  closeModal() {
    this.close.emit();
  }
}