import { Component, Output, EventEmitter, Input, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-army-modal',
  templateUrl: './army-modal.component.html',
  styleUrls: ['./army-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class ArmyModalComponent implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Input() playerTroops: { [key: string]: number } = {};

  activeTab: 'garrison' | 'recruitment' | 'logistics' = 'garrison';

  // Catalogo reclutamento
  recruitmentCatalog = [
    { id: 'fante', name: 'Fante', tier: 1, icon: '🪖', costMoney: 150, costSteel: 0, description: 'Unità di fanteria base. Versatile e poco costosa.' },
    { id: 'veicolo_leggero', name: 'Veicolo Leggero', tier: 1, icon: '🏎️', costMoney: 800, costSteel: 200, description: 'Mezzo veloce per ricognizione e attacchi rapidi.' },
    { id: 'carro_armato', name: 'Carro Armato', tier: 2, icon: '🚜', costMoney: 2500, costSteel: 1200, description: 'Forza d\'urto pesante. Indispensabile per gli assedi.' },
    { id: 'caccia', name: 'Caccia', tier: 3, icon: '✈️', costMoney: 5000, costSteel: 800, description: 'Dominio aereo. Colpisce bersagli di terra e aria.' }
  ];

  maintenanceTotal = 4250; // Valore simulato

  // Drag logic
  isDragging = false;
  dragStartX = 0; dragStartY = 0;
  transformX = 0; transformY = 0;

  ngOnInit() {
    console.log("MILITARY OS: Protocolli di comando attivati...");
  }

  getUnitIcon(unitName: string): string {
    const unit = this.recruitmentCatalog.find(u => u.name === unitName);
    return unit ? unit.icon : '👥';
  }

  recruitUnit(unit: any) {
    console.log(`RECLUTAMENTO AVVIATO: ${unit.name}`);
    // Logica di backend qui
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