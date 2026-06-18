import { Component, Output, EventEmitter, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HomeService } from '../../../home/home';

type ArmyTab = 'management' | 'operations' | 'garrison' | 'recruitment' | 'logistics' | 'storico';
type MissionMode = 'move' | 'attack' | 'cancel';

interface ArmyGroup {
  id: string;
  name: string;
  composition: { [key: string]: number };
  status: 'standby' | 'moving' | 'attacking';
  missionMode?: MissionMode;
  targetName?: string;
  targetCoords?: string;
}

interface ArmyMissionRequest {
  armyId: string;
  mode: MissionMode;
  targetName?: string;
  targetCoords?: string;
  composition?: { [key: string]: number };
}

@Component({
  selector: 'app-army-modal',
  templateUrl: './army-modal.component.html',
  styleUrls: ['./army-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class ArmyModalComponent implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  @Output() playerTroopsChange = new EventEmitter<{ [key: string]: number }>();
  @Output() armiesChange = new EventEmitter<ArmyGroup[]>();
  @Output() missionRequested = new EventEmitter<ArmyMissionRequest>();
  @Output() centerOnArmy = new EventEmitter<string>();
  @Input() playerTroops: { [key: string]: number } = {};
  @Input() armies: ArmyGroup[] = [];
  @Input() selectedTargetName = '';
  @Input() selectedTargetCoords = '--';
  @Input() selectedArmyId = '';
  @Input() initialTab: ArmyTab = 'management';
  @Input() currentMatchId = '';
  @Input() currentUsername = '';

  activeTab: ArmyTab = 'management';
  graveyardLosses: any[] = [];
  graveyardKills: any[] = [];
  availableTroops: { [key: string]: number } = {};
  activeArmyId = '';
  armyName = '';
  selectedTroopKey = '';
  selectedTroopCount = 1;
  selectedMissionMode: MissionMode = 'move';
  missionCoords = '';
  missionTargetName = '';

  // Catalogo reclutamento
  recruitmentCatalog = [
    { id: 'fante', name: 'Fante', tier: 1, icon: '🪖', costMoney: 150, costSteel: 0, description: 'Unità di fanteria base. Versatile e poco costosa.', hp: 100, damage: 50 },
    { id: 'lmv', name: 'Veicolo Leggero', tier: 1, icon: '🏎️', costMoney: 800, costSteel: 200, description: 'Mezzo veloce per ricognizione e attacchi rapidi.', hp: 300, damage: 0 },
    { id: 'carro_armato', name: 'Carro Armato', tier: 2, icon: '🚜', costMoney: 2500, costSteel: 1200, description: 'Forza d\'urto pesante. Indispensabile per gli assedi.', hp: 2500, damage: 500 },
    { id: 'caccia', name: 'Caccia', tier: 3, icon: '✈️', costMoney: 5000, costSteel: 800, description: 'Dominio aereo. Colpisce bersagli di terra e aria.', hp: 1200, damage: 1000 }
  ];

  maintenanceTotal = 4250; // Valore simulato

  combatTimers: { [armyId: string]: string } = {};
  movementTimers: { [armyId: string]: string } = {};
  private timerInterval: any;

  constructor(private homeService: HomeService) {}

  ngOnInit() {
    this.syncFromInputs(true);
    console.log("MILITARY OS: Protocolli di comando attivati...");
    this.timerInterval = setInterval(() => {
      this.updateCombatTimers();
    }, 1000);
  }

  ngOnDestroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  updateCombatTimers() {
    const now = Date.now();
    for (const army of this.armies) {
      if ((army as any).status === 'in combattimento' && (army as any).next_round_time) {
        const targetTime = new Date((army as any).next_round_time).getTime();
        const diff = targetTime - now;
        if (diff > 0) {
          const minutes = Math.floor(diff / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          this.combatTimers[army.id] = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
          this.combatTimers[army.id] = 'Attacco in corso...';
        }
      } else {
        delete this.combatTimers[army.id];
      }

      if ((army.status === 'moving' || (army as any).status === 'moving_to_border' || (army as any).status === "Pronto all'attacco") && (army as any).startTime && (army as any).etaMs) {
        const endMovementTime = (army as any).startTime + (army as any).etaMs;
        const diff = endMovementTime - now;
        if (diff > 0) {
          const hours = Math.floor(diff / 3600000);
          const minutes = Math.floor((diff % 3600000) / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          const timeStr = hours > 0 
              ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
              : `${minutes}:${seconds.toString().padStart(2, '0')}`;
          this.movementTimers[army.id] = timeStr;
        } else {
          delete this.movementTimers[army.id];
        }
      } else {
        delete this.movementTimers[army.id];
      }
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['playerTroops'] || changes['armies'] || changes['selectedTargetName'] || changes['selectedTargetCoords'] || changes['initialTab']) {
      this.syncFromInputs(false);
    }
  }

  get availableTroopEntries() {
    return Object.entries(this.availableTroops)
      .filter(([, count]) => Number(count) > 0)
      .sort((left, right) => left[0].localeCompare(right[0]));
  }

  get totalAvailableTroops() {
    return Object.values(this.availableTroops).reduce((total, value) => total + Number(value || 0), 0);
  }

  get selectedArmy() {
    return this.armies.find((army) => army.id === this.activeArmyId) || this.armies[0] || null;
  }

  get selectedArmyCount() {
    return this.selectedArmy ? Object.values(this.selectedArmy.composition).reduce((total, value) => total + Number(value || 0), 0) : 0;
  }

  getArmyHp(army: any): { current: number, max: number } {
    if (!army || !army.composition) return { current: 0, max: 0 };
    let maxHp = 0;
    for (const [troopId, count] of Object.entries(army.composition)) {
      const unit = this.recruitmentCatalog.find(u => u.id === troopId);
      if (unit && Number(count) > 0) {
        maxHp += unit.hp * Number(count);
      }
    }
    const currentHp = army.hp !== undefined ? army.hp : maxHp;
    return { current: Math.round(currentHp), max: maxHp };
  }

  getArmyDamage(army: any): number {
    if (!army || !army.composition) return 0;
    let dmg = 0;
    for (const [troopId, count] of Object.entries(army.composition)) {
      const unit = this.recruitmentCatalog.find(u => u.id === troopId);
      if (unit && Number(count) > 0) {
        dmg += unit.damage * Number(count);
      }
    }
    return dmg;
  }

  private syncFromInputs(resetTab: boolean) {
    this.availableTroops = { ...(this.playerTroops || {}) };
    this.missionTargetName = this.selectedTargetName;
    this.missionCoords = this.selectedTargetCoords && this.selectedTargetCoords !== '--'
      ? this.selectedTargetCoords
      : this.missionCoords;

    if (resetTab) {
      this.activeTab = this.initialTab || 'management';
    }

    if (!this.selectedTroopKey) {
      this.selectedTroopKey = this.availableTroopEntries[0]?.[0] || '';
    }

    if (this.selectedArmyId) {
      this.activeArmyId = this.selectedArmyId;
    } else if (!this.activeArmyId && this.armies.length > 0) {
      this.activeArmyId = this.armies[0].id;
    }
  }

  getUnitIcon(unitName: string): string {
    const unit = this.recruitmentCatalog.find(u => u.name === unitName);
    return unit ? unit.icon : '👥';
  }

  setTab(tab: ArmyTab) {
    this.activeTab = tab;

    if (tab === 'storico') {
      this.loadGraveyard();
    }

    if (tab === 'operations') {
      this.missionCoords = this.selectedTargetCoords && this.selectedTargetCoords !== '--'
        ? this.selectedTargetCoords
        : this.missionCoords;
      this.missionTargetName = this.selectedTargetName || this.missionTargetName;
      if (!this.activeArmyId && this.armies.length > 0) {
        this.activeArmyId = this.armies[0].id;
      }
    }
  }

  loadGraveyard() {
    if (!this.currentMatchId || !this.currentUsername) return;
    this.homeService.getGraveyard(this.currentMatchId, this.currentUsername).subscribe({
      next: (res) => {
        if (res.status === '200' && res.data) {
          if (Array.isArray(res.data)) {
            // Backward compatibility
            this.graveyardLosses = res.data;
            this.graveyardKills = [];
          } else {
            this.graveyardLosses = res.data.losses || [];
            this.graveyardKills = res.data.kills || [];
          }
        }
      },
      error: (err) => console.error("Errore caricamento storico:", err)
    });
  }

  selectArmy(armyId: string) {
    this.activeArmyId = armyId;
    this.activeTab = 'operations';
  }

  isArmyMoving(army: any): boolean {
    return army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco" || army.status === 'in combattimento';
  }

  cancelMovement(armyId: string) {
    this.missionRequested.emit({ armyId, mode: 'cancel' });
  }

  createArmy() {
    const troopKey = String(this.selectedTroopKey || '').trim();
    const troopCount = Math.max(1, Math.floor(Number(this.selectedTroopCount) || 0));
    const availableCount = Number(this.availableTroops[troopKey] || 0);

    if (!troopKey || availableCount < troopCount) {
      return;
    }

    const nextTroops = { ...this.availableTroops };
    const remaining = availableCount - troopCount;

    if (remaining > 0) {
      nextTroops[troopKey] = remaining;
    } else {
      delete nextTroops[troopKey];
    }

    let spawnCoords: any = undefined;
    if (this.selectedTargetCoords && this.selectedTargetCoords !== '--') {
      spawnCoords = this.selectedTargetCoords;
    } else if (this.selectedTargetName) {
      spawnCoords = this.selectedTargetName;
    }

    const nextArmy: ArmyGroup = {
      id: this.generateUUID(),
      name: this.armyName.trim() || `Armata ${this.armies.length + 1}`,
      composition: { [troopKey]: troopCount },
      status: 'standby',
      currentLocation: spawnCoords
    };

    this.availableTroops = nextTroops;
    this.armies = [nextArmy, ...this.armies];
    this.activeArmyId = nextArmy.id;
    this.armyName = '';
    this.selectedTroopCount = 1;
    this.playerTroopsChange.emit(this.availableTroops);
    this.armiesChange.emit(this.armies);
    this.activeTab = 'management';
  }

  disbandArmy(armyId: string) {
    const army = this.armies.find((entry) => entry.id === armyId);
    if (!army) {
      return;
    }

    const nextTroops = { ...this.availableTroops };

    Object.entries(army.composition).forEach(([troopKey, troopCount]) => {
      nextTroops[troopKey] = Number(nextTroops[troopKey] || 0) + Number(troopCount || 0);
    });

    this.availableTroops = nextTroops;
    this.armies = this.armies.filter((entry) => entry.id !== armyId);
    this.activeArmyId = this.armies[0]?.id || '';
    this.playerTroopsChange.emit(this.availableTroops);
    this.armiesChange.emit(this.armies);
    this.activeTab = 'management';
  }

  sendArmyOrder() {
    const army = this.selectedArmy;
    const targetCoords = String(this.missionCoords || this.selectedTargetCoords || '').trim();

    if (!army || !targetCoords || targetCoords === '--') {
      return;
    }

    const updatedArmy: ArmyGroup = {
      ...army,
      status: this.selectedMissionMode === 'attack' ? 'attacking' : 'moving',
      missionMode: this.selectedMissionMode,
      targetName: this.missionTargetName || this.selectedTargetName,
      targetCoords
    };

    this.armies = this.armies.map((entry) => entry.id === army.id ? updatedArmy : entry);
    this.activeArmyId = updatedArmy.id;
    this.armiesChange.emit(this.armies);
    this.missionRequested.emit({
      armyId: updatedArmy.id,
      mode: this.selectedMissionMode,
      targetName: updatedArmy.targetName || 'OBIETTIVO',
      targetCoords,
      composition: updatedArmy.composition
    });
    this.closeModal();
  }

  getArmyTotal(army: ArmyGroup) {
    return Object.values(army.composition).reduce((total, value) => total + Number(value || 0), 0);
  }

  getArmyStatusLabel(army: ArmyGroup) {
    if (army.status === 'moving' || (army as any).status === 'moving_to_border' || (army as any).status === "Pronto all'attacco") {
      return 'IN MOVIMENTO';
    }

    if (army.status === 'attacking' || (army as any).status === 'in_battaglia' || (army as any).status === 'in combattimento') {
      return 'IN COMBATTIMENTO';
    }

    return 'IN STANDBY';
  }

  getArmyStatusIcon(army: ArmyGroup) {
    if (army.status === 'moving' || (army as any).status === 'moving_to_border' || (army as any).status === "Pronto all'attacco") {
      return 'navigate-outline';
    }

    if (army.status === 'attacking' || (army as any).status === 'in_battaglia' || (army as any).status === 'in combattimento') {
      return 'flame-outline';
    }

    return 'ellipse-outline';
  }

  recruitUnit(unit: any) {
    console.log(`RECLUTAMENTO AVVIATO: ${unit.name}`);
    // Logica di backend qui
  }

  centerOnArmyMap(army: ArmyGroup) {
    this.centerOnArmy.emit(army.id);
    this.closeModal();
  }

  closeModal() { this.close.emit(); }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}