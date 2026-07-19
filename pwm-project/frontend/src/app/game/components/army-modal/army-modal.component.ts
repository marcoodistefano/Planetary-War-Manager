import { Component, Output, EventEmitter, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HomeService } from '../../../home/home';

type ArmyTab = 'management' | 'operations' | 'garrison' | 'recruitment' | 'logistics' | 'storico';
type MissionMode = 'move' | 'conquer' | 'cancel';

interface ArmyGroup {
  id: string;
  name: string;
  composition: { [key: string]: number };
  status: 'standby' | 'moving' | 'attacking';
  missionMode?: MissionMode;
  targetName?: string;
  targetCoords?: string;
  currentLocation?: any;
  owner?: string;
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
export class ArmyModalComponent implements OnInit, OnDestroy, OnChanges {
  @Output() close = new EventEmitter<void>();
  @Output() playerTroopsChange = new EventEmitter<{ [key: string]: number }>();
  @Output() armiesChange = new EventEmitter<ArmyGroup[]>();
  @Output() missionRequested = new EventEmitter<ArmyMissionRequest>();
  @Output() createArmyRequest = new EventEmitter<{ troopKey: string, troopCount: number, targetName?: string, targetCoords?: string, armyName?: string, armyId: string }>();
  @Output() disbandArmyRequest = new EventEmitter<{ armyId: string }>();
  @Output() centerOnArmy = new EventEmitter<string>();
  @Output() recruitUnitRequest = new EventEmitter<any>();
  @Input() playerTroops: { [key: string]: number } = {};
  @Input() armies: ArmyGroup[] = [];
  @Input() fantiRate: number = 0;
  @Input() trainings: any[] = [];
  @Input() matchStructures: any[] = [];
  @Input() gameRules: any = null;
  @Input() selectedTargetName = '';
  @Input() selectedTargetCoords = '--';
  @Input() selectedArmyId = '';
  @Input() initialTab: ArmyTab = 'management';
  @Input() currentMatchId = '';
  @Input() currentUsername = '';
  @Input() capitalName = '';

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

  selectedRecruitLocations: { [unitId: string]: any } = {};
  validStructuresCache: { [unitId: string]: any[] } = {};

  // Catalogo reclutamento popolato da gameRules
  recruitmentCatalog: any[] = [];

  maintenanceTotal = 4250; // Valore simulato

  combatTimers: { [armyId: string]: string } = {};
  movementTimers: { [armyId: string]: string } = {};
  trainingTimers: { [index: number]: string } = {};
  private timerInterval: any;

  constructor(private homeService: HomeService, private cdr: ChangeDetectorRef) {}

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

      if ((army.status === 'moving' || (army as any).status === 'moving_to_border' || (army as any).status === "Pronto alla conquista") && (army as any).startTime && (army as any).etaMs) {
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

    if (this.trainings) {
      this.trainings.forEach((t, i) => {
        if (t.endTime) {
          const diff = t.endTime - now;
          if (diff > 0) {
            const hours = Math.floor(diff / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            const timeStr = hours > 0 
                ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                : `${minutes}:${seconds.toString().padStart(2, '0')}`;
            this.trainingTimers[i] = timeStr;
          } else {
            this.trainingTimers[i] = 'Completato';
          }
        }
      });
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['gameRules']) {
      this.buildRecruitmentCatalog();
    }
    if (changes['playerTroops'] || changes['armies'] || changes['selectedTargetName'] || changes['selectedTargetCoords'] || changes['initialTab'] || changes['matchStructures']) {
      this.syncFromInputs(false);
      this.updateValidStructuresCache();
    }
    if (changes['trainings']) {
       this.updateValidStructuresCache();
       this.cdr.detectChanges();
    }
  }

  updateValidStructuresCache() {
    this.validStructuresCache = {};
    if (!this.recruitmentCatalog) return;
    for (const unit of this.recruitmentCatalog) {
       this.validStructuresCache[unit.id] = this.getValidStructuresForUnit(unit);
       if (this.validStructuresCache[unit.id].length > 0 && !this.selectedRecruitLocations[unit.id]) {
           this.selectedRecruitLocations[unit.id] = this.validStructuresCache[unit.id][0];
       }
    }
  }

  compareStructures(s1: any, s2: any): boolean {
    return s1 && s2 ? s1.id === s2.id : s1 === s2;
  }

  buildRecruitmentCatalog() {
    if (!this.gameRules) return;
    const truppeSheet = this.gameRules.sheets.find((s: any) => s.name === 'Truppe');
    if (!truppeSheet) return;

    // Definiamo le icone base e le descrizioni (o potremmo prenderle dal json se ci fossero)
    const extraInfo: any = {
      'fante': { icon: '🪖', description: 'Unità di fanteria base. Generata anche passivamente.' },
      'lmv': { icon: '🚘', description: 'Veicolo leggero da ricognizione.' },
      'speciali': { icon: '🥷', description: 'Forze speciali d\'élite.' },
      'artiglieria': { icon: '🎯', description: 'Supporto dalla distanza.' },
      'apc': { icon: '🛡️', description: 'Trasporto truppe corazzato.' },
      'sam_mobile': { icon: '🚀', description: 'Difesa contraerea mobile.' },
      'carro_armato': { icon: '🚜', description: 'Forza d\'urto pesante.' },
      'missile_crociera': { icon: '🛰️', description: 'Missile tattico a lungo raggio.' },
      'missile_balistico': { icon: '🚀', description: 'Missile strategico intercontinentale.' },
      'icbm': { icon: '☢️', description: 'Arma di distruzione di massa.' },
      // Unità Navali (Mare)
      'corvetta': { icon: '🚢', description: 'Corvetta di pattugliamento costiero.' },
      'fregata': { icon: '🚢', description: 'Fregata multiruolo pesante.' },
      'cargo_navale': { icon: '🚢', description: 'Nave cargo per trasporto truppe.' },
      'cacciatorpediniere': { icon: '🚢', description: 'Nave da combattimento cacciatorpediniere.' },
      'sommergibile': { icon: '🐙', description: 'Sommergibile stealth d\'attacco.' },
      'portaerei': { icon: '🚢', description: 'Portaerei strategica per supporto aereo.' },
      // Unità Aeree (Aria)
      'drone': { icon: '🛸', description: 'Drone da ricognizione aerea.' },
      'elicottero': { icon: '🚁', description: 'Elicottero d\'attacco tattico.' },
      'caccia': { icon: '✈️', description: 'Caccia da superiorità aerea.' },
      'aereo_cargo': { icon: '✈️', description: 'Aereo da trasporto pesante.' },
      'bombardiere': { icon: '✈️', description: 'Bombardiere strategico.' },
      'bombardiere_stealth': { icon: '✈️', description: 'Bombardiere stealth invisibile ai radar.' }
    };

    const newCatalog = [];
    for (const unit of truppeSheet.lines) {
      if (!unit.id_truppa) continue;
      if (unit.id_truppa === 'fante') continue; // I fanti vengono generati passivamente ogni ora
      if (unit.prodotta_in && (
        unit.prodotta_in.startsWith('caserma') ||
        unit.prodotta_in.startsWith('fabbrica') ||
        unit.prodotta_in.startsWith('tenda') ||
        unit.prodotta_in.startsWith('porto') ||
        unit.prodotta_in.startsWith('aeroporto')
      )) {
        newCatalog.push({
          id: unit.id_truppa,
          name: unit.nome || unit.id_truppa,
          tier: unit.tier || 1,
          icon: extraInfo[unit.id_truppa]?.icon || '⚔️',
          description: extraInfo[unit.id_truppa]?.description || 'Unità militare.',
          costMoney: unit.costo_denaro || 0,
          costSteel: unit.costo_acciaio || 0,
          costLead: unit.costo_piombo || 0,
          costOil: unit.costo_petrolio || 0,
          costUranium: unit.costo_uranio || 0,
          hp: unit.HP || 100,
          damage: unit.danno_base || 10,
          trainTime: unit.tempo_addestramento || 0,
          requiredBuilding: unit.prodotta_in
        });
      }
    }
    this.recruitmentCatalog = newCatalog;
  }

  get availableTroopEntries() {
    return Object.entries(this.availableTroops)
      .filter(([, count]) => Number(count) > 0)
      .sort((left, right) => left[0].localeCompare(right[0]));
  }

  isAirArmy(army: any): boolean {
    if (!army) return false;
    if (army.composition) {
      if (army.composition['caccia'] || army.composition['bombardiere'] || army.composition['elicottero'] || army.composition['drone'] || army.composition['bombardiere_stealth'] || army.composition['aereo_cargo']) return true;
    }
    if (army.id_modello && typeof army.id_modello === 'string') {
      const mod = army.id_modello.toLowerCase();
      if (mod.includes('caccia') || mod.includes('aircraft') || mod.includes('bomb') || mod.includes('elicottero') || mod.includes('drone') || mod.includes('f35')) return true;
    }
    return false;
  }

  get totalAvailableTroops() {
    return Object.values(this.availableTroops).reduce((total, value) => total + Number(value || 0), 0);
  }

  get selectedArmy() {
    return this.myArmies.find((army) => army.id === this.activeArmyId) || this.myArmies[0] || null;
  }

  get selectedArmyCount() {
    return this.selectedArmy ? Object.values(this.selectedArmy.composition).reduce((total, value) => total + Number(value || 0), 0) : 0;
  }

  getArmyHp(army: any): { current: number, max: number } {
    if (!army || !army.composition) return { current: 0, max: 0 };
    let maxHp = 0;
    for (const [troopId, count] of Object.entries(army.composition)) {
      // FIX STRUTTURALE-5: cerca prima nel catalogo, poi direttamente in gameRules
      // (i fanti sono esclusi dal recruitmentCatalog perché generati passivamente,
      //  ma hanno HP definiti nel foglio 'Truppe')
      let unit = this.recruitmentCatalog.find(u => u.id === troopId);
      if (!unit && this.gameRules?.sheets) {
        const truppeSheet = this.gameRules.sheets.find((s: any) => s.name === 'Truppe');
        const raw = truppeSheet?.lines?.find((l: any) => l.id_truppa === troopId);
        if (raw) {
          unit = { hp: raw.HP || 100, damage: raw.danno_base || 10 } as any;
        }
      }
      if (unit && Number(count) > 0) {
        maxHp += (unit.hp || 100) * Number(count);
      }
    }
    const currentHp = army.hp !== undefined ? army.hp : maxHp;
    return { current: Math.round(currentHp), max: maxHp };
  }

  getArmyDamage(army: any): number {
    if (!army || !army.composition) return 0;
    let dmg = 0;
    for (const [troopId, count] of Object.entries(army.composition)) {
      // FIX STRUTTURALE-5: stessa logica di getArmyHp per consistenza
      let unit = this.recruitmentCatalog.find(u => u.id === troopId);
      if (!unit && this.gameRules?.sheets) {
        const truppeSheet = this.gameRules.sheets.find((s: any) => s.name === 'Truppe');
        const raw = truppeSheet?.lines?.find((l: any) => l.id_truppa === troopId);
        if (raw) {
          unit = { hp: raw.HP || 100, damage: raw.danno_base || 10 } as any;
        }
      }
      if (unit && Number(count) > 0) {
        dmg += (unit.damage || 0) * Number(count);
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
    } else if (!this.activeArmyId && this.myArmies.length > 0) {
      this.activeArmyId = this.myArmies[0].id;
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
      if (!this.activeArmyId && this.myArmies.length > 0) {
        this.activeArmyId = this.myArmies[0].id;
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
    return army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto alla conquista" || army.status === 'in combattimento';
  }

  cancelMovement(armyId: string) {
    this.missionRequested.emit({ armyId, mode: 'cancel' });
  }

  createArmy() {
    const troopKey = String(this.selectedTroopKey || '').trim();
    const troopCount = Math.max(1, Math.floor(Number(this.selectedTroopCount) || 0));

    if (!troopKey || troopCount <= 0) return;

    if ((this.playerTroops[troopKey] || 0) < troopCount) {
        alert('Non hai truppe sufficienti di questo tipo nelle riserve per formare il gruppo.');
        return;
    }

    let targetLoc = this.selectedTargetName || this.selectedTargetCoords;
    if (!targetLoc || targetLoc === '--') {
       const myStructures = this.matchStructures?.filter(s => s.owner === this.currentUsername) || [];
       if (myStructures.length > 0) {
           targetLoc = myStructures[0].targetName || myStructures[0].regionId;
       } else {
           alert("Seleziona prima un territorio sulla mappa per schierare l'armata.");
           return;
       }
    }

    const armyId = this.generateUUID();
    
    this.createArmyRequest.emit({
        troopKey,
        troopCount,
        targetName: this.selectedTargetName || targetLoc,
        targetCoords: this.selectedTargetCoords && this.selectedTargetCoords !== '--' ? this.selectedTargetCoords : undefined,
        armyName: this.armyName.trim() || `Armata ${this.armies.length + 1}`,
        armyId
    });

    this.armyName = '';
    this.selectedTroopCount = 1;
    this.activeTab = 'management';
  }

  disbandArmy(armyId: string) {
    const army = this.armies.find((entry) => entry.id === armyId);
    if (!army) {
      return;
    }

    if (army.status !== 'standby') {
        alert('Puoi sciogliere solo le armate in standby.');
        return;
    }

    this.disbandArmyRequest.emit({ armyId });
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
      status: this.selectedMissionMode === 'conquer' ? 'attacking' : 'moving',
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
    if (army.status === 'moving' || (army as any).status === 'moving_to_border' || (army as any).status === "Pronto alla conquista") {
      return 'IN MOVIMENTO';
    }

    if (army.status === 'attacking' || (army as any).status === 'in_battaglia' || (army as any).status === 'in combattimento') {
      return 'IN COMBATTIMENTO';
    }

    return 'IN STANDBY';
  }

  getArmyStatusIcon(army: ArmyGroup) {
    if (army.status === 'moving' || (army as any).status === 'moving_to_border' || (army as any).status === "Pronto alla conquista") {
      return 'navigate-outline';
    }

    if (army.status === 'attacking' || (army as any).status === 'in_battaglia' || (army as any).status === 'in combattimento') {
      return 'flame-outline';
    }

    return 'ellipse-outline';
  }

  getValidStructuresForUnit(unit: any): any[] {
    if (!this.matchStructures || !unit.requiredBuilding) return [];
    const reqBase = unit.requiredBuilding.split('_')[0];
    const reqTier = parseInt(unit.requiredBuilding.split('_t')[1]) || 1;

    return this.matchStructures.filter((s: any) => {
      if (s.owner !== this.currentUsername || s.status !== 'built') return false;
      const sBase = s.structureId.split('_')[0];
      const sTier = parseInt(s.structureId.split('_t')[1]) || 1;
      return sBase === reqBase && sTier >= reqTier;
    });
  }

  /**
   * Controlla se è già in corso un addestramento nella struttura (targetName) specificata.
   * Se targetName è omesso, controlla qualsiasi struttura (usato solo per i fanti).
   */
  isTrainingInProgress(targetName?: string): boolean {
    if (!this.trainings || this.trainings.length === 0) return false;
    if (!targetName) return this.trainings.length > 0;
    return this.trainings.some((t: any) => t.targetName === targetName);
  }

  getInProgressTrainingTime(targetName?: string): string {
    if (!this.trainings || this.trainings.length === 0) return '';
    for (let i = 0; i < this.trainings.length; i++) {
      const t = this.trainings[i];
      // Se è specificato un targetName, mostra il timer solo per quella struttura
      if (targetName && t.targetName !== targetName) continue;
      if (this.trainingTimers[i] && this.trainingTimers[i] !== 'Completato') {
        return this.trainingTimers[i];
      }
    }
    return '';
  }

  hasRequiredStructure(unit: any): boolean {
    if (!unit.requiredBuilding) return true;
    const cache = this.validStructuresCache[unit.id];
    return cache && cache.length > 0;
  }

  canRecruit(unit: any): boolean {
    if (!this.hasRequiredStructure(unit)) return false;
    if (unit.id === 'fante') return true; // i fanti non usano caserme dedicate

    // Blocca solo se la caserma SPECIFICA selezionata per questa unit ha già un addestramento
    const selectedStruct = this.selectedRecruitLocations[unit.id];
    const targetName = selectedStruct?.targetName || selectedStruct?.regionId || this.selectedTargetName;
    return !this.isTrainingInProgress(targetName);
  }

  recruitUnit(unit: any) {
    if (!this.canRecruit(unit)) {
      console.warn("Requisiti struttura non soddisfatti per " + unit.name);
      return;
    }

    let targetName = this.selectedTargetName;
    let targetCoords = this.selectedTargetCoords;

    if (unit.requiredBuilding) {
      const selectedStruct = this.selectedRecruitLocations[unit.id];
      if (selectedStruct) {
         targetName = selectedStruct.targetName || selectedStruct.regionId;
         targetCoords = selectedStruct.targetCoords ? `${selectedStruct.targetCoords[0]}, ${selectedStruct.targetCoords[1]}` : '--';
      }
    }

    console.log(`RECLUTAMENTO AVVIATO: ${unit.name} a ${targetName}`);
    this.recruitUnitRequest.emit({
      unitId: unit.id,
      targetName: targetName,
      targetCoords: targetCoords,
      costMoney: unit.costMoney,
      costSteel: unit.costSteel,
      trainTime: unit.trainTime
    });
  }

  centerOnArmyMap(army: ArmyGroup) {
    this.centerOnArmy.emit(army.id);
    this.closeModal();
  }

  closeModal() { this.close.emit(); }

  get myArmies() {
    const curUserNorm = String(this.currentUsername || '').trim().toLowerCase();
    return this.armies.filter((a) => String((a as any).owner || '').trim().toLowerCase() === curUserNorm);
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}