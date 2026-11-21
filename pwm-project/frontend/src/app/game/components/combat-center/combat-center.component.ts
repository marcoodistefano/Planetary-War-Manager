import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-combat-center',
  templateUrl: './combat-center.component.html',
  styleUrls: ['./combat-center.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CombatCenterComponent implements OnInit, OnDestroy {
  @Input() armies: any[] = [];
  @Input() username = '';
  @Input() tacticalDecisions: any[] = [];
  @Input() combatEvents: any[] = [];
  @Output() retreat = new EventEmitter<string>();
  @Output() centerOnArmy = new EventEmitter<string>();
  @Output() tacticalDecision = new EventEmitter<{ decision: any, choice: string }>();

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

  get activeCombats(): any[] {
    const currentUser = this.username.trim().toLowerCase();
    return (this.armies || []).filter(army => {
      const owner = String(army.owner || '').trim().toLowerCase();
      const state = army.state || army.status;
      return owner === currentUser && ['combat', 'combattimento', 'in combattimento', 'engaging'].includes(state);
    });
  }

  get retreatingArmies(): any[] {
    const currentUser = this.username.trim().toLowerCase();
    return (this.armies || []).filter(army => {
      const owner = String(army.owner || '').trim().toLowerCase();
      const state = army.state || army.status;
      return owner === currentUser && ['retreating', 'returning', 'cooldown'].includes(state);
    });
  }

  get hasCombatContent(): boolean {
    return this.activeCombats.length > 0 || this.tacticalDecisions.length > 0 || this.retreatingArmies.length > 0;
  }

  getArmyUnits(army: any): number {
    return Object.values(army.composition || {}).reduce((total: number, count: any) => total + Number(count || 0), 0);
  }

  getHpLabel(army: any): string {
    return army.hp === undefined ? '--' : `${Math.max(0, Math.round(army.hp))} HP`;
  }

  getHpPercent(army: any): number {
    if (army.hp === undefined || army.maxHp === undefined || army.maxHp === 0) return 50;
    return Math.max(0, Math.min(100, (army.hp / army.maxHp) * 100));
  }

  getNextRoundLabel(army: any): string {
    if (!army.next_round_time) return '--';
    const remaining = new Date(army.next_round_time).getTime() - this.now;
    if (remaining <= 0) return 'Ora';
    return `${Math.floor(remaining / 60000)}m ${Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0')}s`;
  }

  getLatestEvent(army: any): any | null {
    const relevant = (this.combatEvents || []).filter(event =>
      event.players?.includes(this.username) || event.attacker === army.name || event.defender === army.name
    );
    return relevant.length > 0 ? relevant[relevant.length - 1] : null;
  }

  /** Ultimi 3 round di combattimento per questa armata (dal più recente al più vecchio) */
  getRoundHistory(army: any): any[] {
    return (this.combatEvents || [])
      .filter(event => event.attacker === army.name || event.defender === army.name)
      .slice(-3)
      .reverse();
  }

  getRoundDamageLabel(event: any, army: any): string {
    const isAttacker = event.attacker === army.name;
    const dmg = Number(event.damage ?? 0);
    return isAttacker ? `ATT ${dmg > 0 ? '-' + dmg : '0'} HP` : `DIF -${dmg} HP`;
  }

  getRoundResultLabel(event: any): string {
    if (event.result === 'distrutta') return 'DISTRUTTA';
    if (event.result === 'sopravvissuta') return 'SOPRAVVISSUTA';
    if (event.result === 'ritirata') return 'RITIRATA';
    return event.result || '--';
  }

  getRoundResultClass(event: any): string {
    if (event.result === 'distrutta') return 'result-destroyed';
    if (event.result === 'sopravvissuta') return 'result-survived';
    return 'result-other';
  }

  getCombatDistance(army: any): string {
    const combat = this.getLatestEvent(army)?.combat;
    return combat?.distanceKm === null || combat?.distanceKm === undefined ? '--' : `${combat.distanceKm} km`;
  }

  getCombatRange(army: any): string {
    const combat = this.getLatestEvent(army)?.combat;
    const range = combat?.attackerRangeKm ?? combat?.defenderRangeKm;
    return range === null || range === undefined ? '--' : `${range} km`;
  }

  getRetreatStateLabel(army: any): string {
    const state = army.state || army.status;
    if (state === 'retreating') return 'In ritirata';
    if (state === 'returning') return 'Rientro base';
    if (state === 'cooldown') return 'Rifornimento';
    return 'Ritiro';
  }

  getRetreatEta(army: any): string {
    if (army.startTime && army.etaMs) {
      const remaining = new Date(army.startTime).getTime() + Number(army.etaMs) - this.now;
      if (remaining <= 0) return 'Arrivata';
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      return mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;
    }
    return '--';
  }
}
