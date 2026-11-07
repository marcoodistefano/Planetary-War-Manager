import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-order-center',
  templateUrl: './order-center.component.html',
  styleUrls: ['./order-center.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderCenterComponent implements OnInit, OnDestroy {
  @Input() armies: any[] = [];
  @Input() username = '';
  @Input() orderEvents: Record<string, Array<{ label: string; timestamp: string }>> = {};
  @Output() close = new EventEmitter<void>();
  @Output() centerOnArmy = new EventEmitter<string>();
  @Output() cancelMission = new EventEmitter<string>();

  statusFilter: 'all' | 'moving' | 'combat' | 'returning' = 'all';

  now = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.timer = setInterval(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
    }, 1000);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  get activeOrders(): any[] {
    const currentUser = this.username.trim().toLowerCase();
    return (this.armies || []).filter(army => {
      const owner = String(army.owner || '').trim().toLowerCase();
      return owner === currentUser && this.isActive(army);
    });
  }

  get displayedOrders(): any[] {
    if (this.statusFilter === 'all') return this.activeOrders;
    return this.activeOrders.filter(army => {
      const state = army.state || army.status;
      if (this.statusFilter === 'combat') return ['combat', 'combattimento', 'in combattimento', 'engaging'].includes(state);
      if (this.statusFilter === 'returning') return ['retreating', 'returning', 'cooldown'].includes(state);
      return ['moving', 'moving_to_border', 'Pronto alla conquista', "Pronto all'attacco"].includes(state);
    });
  }

  isActive(army: any): boolean {
    const state = army.state || army.status;
    return ['moving', 'moving_to_border', 'Pronto alla conquista', "Pronto all'attacco", 'engaging', 'combat', 'combattimento', 'in combattimento', 'retreating', 'returning', 'cooldown'].includes(state);
  }

  getStatusLabel(army: any): string {
    const state = army.state || army.status;
    const labels: Record<string, string> = {
      moving: 'In movimento',
      moving_to_border: 'Verso il confine',
      'Pronto alla conquista': 'In avvicinamento',
      "Pronto all'attacco": 'In ingaggio',
      engaging: 'In ingaggio',
      combat: 'In combattimento',
      combattimento: 'In combattimento',
      'in combattimento': 'In combattimento',
      retreating: 'In ritirata',
      returning: 'Rientro',
      cooldown: 'Rifornimento'
    };
    return labels[state] || 'Attiva';
  }

  getStatusIcon(army: any): string {
    const state = army.state || army.status;
    if (['combat', 'combattimento', 'in combattimento'].includes(state)) return 'flash-outline';
    if (['retreating', 'returning'].includes(state)) return 'return-up-back-outline';
    if (state === 'cooldown') return 'time-outline';
    return 'navigate-outline';
  }

  getMissionLabel(army: any): string {
    if (army.missionType === 'conquer' || army.missionMode === 'conquer') return 'Conquista';
    if (army.missionType === 'attack_army') return 'Attacco';
    if (army.missionType === 'return' || army.missionMode === 'return') return 'Rientro';
    return 'Spostamento';
  }

  getArmyTotal(army: any): number {
    return Object.values(army.composition || {}).reduce((total: number, count: any) => total + Number(count || 0), 0);
  }

  getLastEvent(army: any): { label: string; timestamp: string } | null {
    const events = this.orderEvents[army.id] || [];
    return events.length > 0 ? events[events.length - 1] : null;
  }

  getEtaLabel(army: any): string {
    if (army.next_round_time && ['combat', 'combattimento', 'in combattimento'].includes(army.state || army.status)) {
      return this.formatDuration(new Date(army.next_round_time).getTime() - this.now);
    }

    if (army.startTime && army.etaMs) {
      return this.formatDuration(new Date(army.startTime).getTime() + Number(army.etaMs) - this.now);
    }

    return '--';
  }

  private formatDuration(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Ora';
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
}
