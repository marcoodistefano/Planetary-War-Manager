import { Component, Output, EventEmitter, Input, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-market-modal',
  templateUrl: './market-modal.component.html',
  styleUrls: ['./market-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class MarketModalComponent implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Input() playerResources: { [key: string]: number } = {};

  activeTab: 'trade' | 'orders' | 'storage' = 'trade';

  // Configurazione prezzi mercato
  marketItems = [
    { id: 'legno', label: 'LEGNO', icon: '🪵', price: 15, quantity: 100 },
    { id: 'acciaio', label: 'ACCIAIO', icon: '🏗️', price: 45, quantity: 100 },
    { id: 'mattoni', label: 'MATTONI', icon: '🧱', price: 20, quantity: 100 },
    { id: 'petrolio', label: 'PETROLIO', icon: '🛢️', price: 85, quantity: 100 },
    { id: 'gas_naturale', label: 'GAS NATURALE', icon: '🔥', price: 60, quantity: 100 },
    { id: 'uranio', label: 'URANIO', icon: '☢️', price: 550, quantity: 100 }
  ];

  // Logic Drag
  isDragging = false;
  dragStartX = 0; dragStartY = 0;
  transformX = 0; transformY = 0;

  ngOnInit() {}

  changeQty(item: any, amount: number) {
    item.quantity = Math.max(0, item.quantity + amount);
  }

  buy(item: any) {
    const totalCost = item.price * item.quantity;
    if (this.playerResources['denaro'] >= totalCost) {
      console.log(`ACQUISTO: ${item.quantity} ${item.label}`);
      // ... resto del codice
    } else {
      alert("FONDI INSUFFICIENTI");
    }
  }

  sell(item: any) {
    console.log(`VENDITA: ${item.quantity} ${item.label}`);
  }

  // --- TRASCINAMENTO ---
  onDragStart(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('.nav-item')) return;
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