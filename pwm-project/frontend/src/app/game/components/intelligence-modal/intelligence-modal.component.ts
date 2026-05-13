import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-intelligence-modal',
  templateUrl: './intelligence-modal.component.html',
  styleUrls: ['./intelligence-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class IntelligenceModalComponent {
  @Output() close = new EventEmitter<void>();

  closeModal() {
    this.close.emit();
  }
}