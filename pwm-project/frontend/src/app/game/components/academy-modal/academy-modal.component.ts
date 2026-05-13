import { Component, Input, Output, EventEmitter, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-academy-modal',
  templateUrl: './academy-modal.component.html',
  styleUrls: ['./academy-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class AcademyModalComponent implements OnInit {
  
  // --- INPUT DAL MATCH PAGE ---
  @Input() gameRules: any;
  @Input() playerResources: any;
  
  // --- OUTPUT PER LA CHIUSURA ---
  @Output() close = new EventEmitter<void>();
  
  activeBranch = 'hq';
  selectedNode: any = null;

  // --- VARIABILI PER IL TRASCINAMENTO (DRAG DELLA MODALE) ---
  isDragging = false;
  dragStartX = 0;
  dragStartY = 0;
  transformX = 0;
  transformY = 0;

  // --- VARIABILI PER IL PANNING (SPOSTAMENTO MAPPA INTERNA) ---
  isPanning = false;
  panStartX = 0;
  panStartY = 0;
  scrollLeft = 0;
  scrollTop = 0;

  constructor() {}

  ngOnInit() {
    console.log("Academy OS: Analisi database game_rules inizializzata...");
  }

  // --- LOGICA PANNING (Spostamento contenuti interni) ---
  onPanStart(event: MouseEvent) {
    this.isPanning = true;
    const container = event.currentTarget as HTMLElement;
    this.panStartX = event.pageX - container.offsetLeft;
    this.panStartY = event.pageY - container.offsetTop;
    this.scrollLeft = container.scrollLeft;
    this.scrollTop = container.scrollTop;
  }

  onPanMove(event: MouseEvent) {
    if (!this.isPanning) return;
    event.preventDefault(); 
    
    const container = event.currentTarget as HTMLElement;
    const x = event.pageX - container.offsetLeft;
    const y = event.pageY - container.offsetTop;
    
    const walkX = (x - this.panStartX) * 1.5; 
    const walkY = (y - this.panStartY) * 1.5;
    
    container.scrollLeft = this.scrollLeft - walkX;
    container.scrollTop = this.scrollTop - walkY;
  }

  onPanEnd() {
    this.isPanning = false;
  }

  // --- LOGICA DRAG & DROP (Spostamento dell'intera finestra) ---
  onDragStart(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // Evitiamo che il drag parta se clicchi su pulsanti o icone
    if (target.tagName === 'BUTTON' || target.tagName === 'ION-ICON' || target.closest('.nav-item')) {
      return;
    }

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
  onDragEnd() {
    this.isDragging = false;
  }

  // --- LOGICA DEL TECH TREE ---
  setBranch(branch: string) {
    this.activeBranch = branch;
    this.selectedNode = null; // Resetta la selezione quando cambi ramo
  }

  getFilteredTracks() {
    if (!this.gameRules || !this.gameRules.sheets) return [];
    
    const tracks: any[] = [];

    if (this.activeBranch === 'hq') {
      const steps = this.gameRules.sheets.find((s: any) => s.name === 'Strutture')?.lines
                    .filter((l: any) => l.id_struttura.includes('fortezza'))
                    .sort((a: any, b: any) => a.tier - b.tier);
      tracks.push({ name: 'CENTRO DI COMANDO', steps });
    }

    if (this.activeBranch === 'economy') {
      const allExtractors = this.gameRules.sheets.find((s: any) => s.name === 'Estrattori')?.lines || [];
      const resourceTypes = ['legno', 'piombo', 'mattoni', 'acciaio', 'petrolio', 'gas_naturale'];
      
      resourceTypes.forEach(res => {
        const steps = allExtractors.filter((ex: any) => ex.risorsa_estratta === res).sort((a: any, b: any) => a.tier - b.tier);
        if(steps.length > 0) tracks.push({ name: 'INDUSTRIA: ' + res.toUpperCase(), steps });
      });
    }

    if (this.activeBranch === 'military') {
      const allStr = this.gameRules.sheets.find((s: any) => s.name === 'Strutture')?.lines || [];
      
      tracks.push({ 
        name: 'FORZE TERRESTRI', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('caserma')).sort((a: any, b: any) => a.tier - b.tier) 
      });
      
      tracks.push({ 
        name: 'OPERAZIONI NAVALI', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('porto')).sort((a: any, b: any) => a.tier - b.tier) 
      });
      
      tracks.push({ 
        name: 'SUPREMAZIA AEROSPAZIALE', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('aeroporto')).sort((a: any, b: any) => a.tier - b.tier) 
      });
    }

    if (this.activeBranch === 'logistics') {
      const allStr = this.gameRules.sheets.find((s: any) => s.name === 'Strutture')?.lines || [];
      
      tracks.push({ 
        name: 'RETE DI TRASPORTO STRADALE', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('strada')).sort((a: any, b: any) => a.tier - b.tier) 
      });
      
      tracks.push({ 
        name: 'RETE FERROVIARIA', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('ferrovia')).sort((a: any, b: any) => a.tier - b.tier) 
      });

      tracks.push({ 
        name: 'HANGAR', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('hangar')).sort((a: any, b: any) => a.tier - b.tier) 
      });
    }

    return tracks;
  }

  getUnitsForTech(node: any) {
    if(!this.gameRules) return [];
    const id = node.id_struttura || node.id_extractor;
    return this.gameRules.sheets.find((s: any) => s.name === 'Truppe')?.lines.filter((t: any) => t.prodotta_in === id) || [];
  }

  hasResources(node: any): boolean {
    if (!node || !this.playerResources) return false;
    return this.playerResources.denaro >= (node.costo_denaro || 0);
  }

  canUnlock(node: any): boolean {
    // Logica futura per i pre-requisiti
    return true; 
  }

  selectNode(node: any) {
    this.selectedNode = node;
  }

  confirmResearch(node: any) {
    console.log("Inizio Ricerca confermato per:", node.nome || node.name);
    // Qui andrà la chiamata al backend via socket
  }

  closeModal() {
    this.close.emit();
  }
}