import { Component, Output, EventEmitter, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

type ArmyTab = 'management' | 'operations' | 'garrison' | 'recruitment' | 'logistics';
type MissionMode = 'move' | 'attack';

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
  targetName: string;
  targetCoords: string;
  composition: { [key: string]: number };
}

@Component({
  selector: 'app-army-modal',
  templateUrl: './army-modal.component.html',
  styleUrls: ['./army-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class ArmyModalComponent implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Output() playerTroopsChange = new EventEmitter<{ [key: string]: number }>();
  @Output() armiesChange = new EventEmitter<ArmyGroup[]>();
  @Output() missionRequested = new EventEmitter<ArmyMissionRequest>();
  @Input() playerTroops: { [key: string]: number } = {};
  @Input() armies: ArmyGroup[] = [];
  @Input() selectedTargetName = '';
  @Input() selectedTargetCoords = '--';
  @Input() selectedArmyId = '';
  @Input() initialTab: ArmyTab = 'management';

  activeTab: ArmyTab = 'management';
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
    { id: 'fante', name: 'Fante', tier: 1, icon: '🪖', costMoney: 150, costSteel: 0, description: 'Unità di fanteria base. Versatile e poco costosa.' },
    { id: 'veicolo_leggero', name: 'Veicolo Leggero', tier: 1, icon: '🏎️', costMoney: 800, costSteel: 200, description: 'Mezzo veloce per ricognizione e attacchi rapidi.' },
    { id: 'carro_armato', name: 'Carro Armato', tier: 2, icon: '🚜', costMoney: 2500, costSteel: 1200, description: 'Forza d\'urto pesante. Indispensabile per gli assedi.' },
    { id: 'caccia', name: 'Caccia', tier: 3, icon: '✈️', costMoney: 5000, costSteel: 800, description: 'Dominio aereo. Colpisce bersagli di terra e aria.' }
  ];

  maintenanceTotal = 4250; // Valore simulato

  ngOnInit() {
    this.syncFromInputs(true);
    console.log("MILITARY OS: Protocolli di comando attivati...");
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

  selectArmy(armyId: string) {
    this.activeArmyId = armyId;
    this.activeTab = 'operations';
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

    const nextArmy: ArmyGroup = {
      id: `army-${Date.now()}`,
      name: this.armyName.trim() || `Armata ${this.armies.length + 1}`,
      composition: { [troopKey]: troopCount },
      status: 'standby'
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
  }

  getArmyTotal(army: ArmyGroup) {
    return Object.values(army.composition).reduce((total, value) => total + Number(value || 0), 0);
  }

  getArmyStatusLabel(army: ArmyGroup) {
    if (army.status === 'moving') {
      return 'IN MOVIMENTO';
    }

    if (army.status === 'attacking') {
      return 'IN ATTACCO';
    }

    return 'IN ATTESA';
  }

  getArmyStatusIcon(army: ArmyGroup) {
    if (army.status === 'moving') {
      return 'navigate-outline';
    }

    if (army.status === 'attacking') {
      return 'flame-outline';
    }

    return 'ellipse-outline';
  }

  recruitUnit(unit: any) {
    console.log(`RECLUTAMENTO AVVIATO: ${unit.name}`);
    // Logica di backend qui
  }

  closeModal() { this.close.emit(); }
}