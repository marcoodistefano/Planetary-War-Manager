import { Component, Output, EventEmitter, Input, OnInit } from '@angular/core';
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

  closeModal() { this.close.emit(); }
}