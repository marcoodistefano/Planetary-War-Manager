// 1. Aggiungi HostListener agli import
import { Component, Input, Output, EventEmitter, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-tech-tree',
  templateUrl: './tech-tree.component.html',
  styleUrls: ['./tech-tree.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class TechTreeComponent implements OnInit {
  @Input() gameRules: any;
  @Input() playerResources: any;
  @Output() close = new EventEmitter<void>();
  
  activeBranch = 'hq';
  selectedNode: any = null;

  // --- VARIABILI PER IL TRASCINAMENTO (DRAG) ---
  isDragging = false;
  dragStartX = 0;
  dragStartY = 0;
  transformX = 0;
  transformY = 0;

  isPanning = false;
  panStartX = 0;
  panStartY = 0;
  scrollLeft = 0;
  scrollTop = 0;

  // --- LOGICA PANNING INTERNO ---
  onPanStart(event: MouseEvent) {
    this.isPanning = true;
    const container = event.currentTarget as HTMLElement;
    // Calcoliamo la posizione iniziale del mouse rispetto al contenitore
    this.panStartX = event.pageX - container.offsetLeft;
    this.panStartY = event.pageY - container.offsetTop;
    // Salviamo la posizione attuale della scrollbar
    this.scrollLeft = container.scrollLeft;
    this.scrollTop = container.scrollTop;
  }

  onPanMove(event: MouseEvent) {
    if (!this.isPanning) return;
    event.preventDefault(); // Evita di evidenziare il testo mentre trascini
    
    const container = event.currentTarget as HTMLElement;
    const x = event.pageX - container.offsetLeft;
    const y = event.pageY - container.offsetTop;
    
    // Calcoliamo lo spostamento (moltiplicatore x1.5 per renderlo più fluido)
    const walkX = (x - this.panStartX) * 1.5; 
    const walkY = (y - this.panStartY) * 1.5;
    
    // Aggiorniamo la scrollbar nativa
    container.scrollLeft = this.scrollLeft - walkX;
    container.scrollTop = this.scrollTop - walkY;
  }

  onPanEnd() {
    this.isPanning = false;
  }

  ngOnInit() {
    console.log("Academy OS: Analisi database game_rules...");
  }

  // --- LOGICA DRAG & DROP ---
  onDragStart(event: MouseEvent) {
    // Evitiamo che il drag parta se clicchi su un bottone o un'icona nella sidebar
    const target = event.target as HTMLElement;
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

  setBranch(branch: string) {
    this.activeBranch = branch;
  }

  // Organizza i dati del CDB in tracce T1 -> T2 -> T3
  getFilteredTracks() {
    if (!this.gameRules) return [];
    
    const tracks: any[] = [];

    if (this.activeBranch === 'hq') {
      // Traccia HQ (Fortezza)
      const steps = this.gameRules.sheets.find((s: any) => s.name === 'Strutture').lines
                    .filter((l: any) => l.id_struttura.includes('fortezza'))
                    .sort((a: any, b: any) => a.tier - b.tier);
      tracks.push({ name: 'CENTRO DI COMANDO', steps });
    }

    if (this.activeBranch === 'economy') {
      // Tracce Estrattori (Segheria, Miniera, ecc.)
      const allExtractors = this.gameRules.sheets.find((s: any) => s.name === 'Estrattori').lines;
      const resourceTypes = ['legno', 'piombo', 'mattoni', 'acciaio', 'petrolio', 'gas_naturale'];
      
      resourceTypes.forEach(res => {
        const steps = allExtractors.filter((ex: any) => ex.risorsa_estratta === res).sort((a: any, b: any) => a.tier - b.tier);
        if(steps.length > 0) tracks.push({ name: 'INDUSTRIA: ' + res.toUpperCase(), steps });
      });
    }

    if (this.activeBranch === 'military') {
      const allStr = this.gameRules.sheets.find((s: any) => s.name === 'Strutture').lines;
      
      tracks.push({ 
        name: 'FORZE TERRESTRI', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('caserma')).sort((a: any, b: any) => a.tier - b.tier) 
      });
      
      tracks.push({ 
        name: 'OPERAZIONI NAVALI', 
        // Usando startsWith, 'aeroporto' viene ignorato!
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('porto')).sort((a: any, b: any) => a.tier - b.tier) 
      });
      
      tracks.push({ 
        name: 'SUPREMAZIA AEROSPAZIALE', 
        steps: allStr.filter((l: any) => l.id_struttura.startsWith('aeroporto')).sort((a: any, b: any) => a.tier - b.tier) 
      });
    }

    if (this.activeBranch === 'logistics') {
      const allStr = this.gameRules.sheets.find((s: any) => s.name === 'Strutture').lines;
      
      // Filtriamo per ferrovie, strade o centri logistici
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
    return this.gameRules.sheets.find((s: any) => s.name === 'Truppe').lines.filter((t: any) => t.prodotta_in === id);
  }

  hasResources(node: any): boolean {
    return this.playerResources.denaro >= (node.costo_denaro || 0);
  }

  canUnlock(node: any): boolean {
    // Qui andrebbe la logica per controllare se la tech precedente è sbloccata
    return true; 
  }

  selectNode(node: any) {
    this.selectedNode = node;
  }

  confirmResearch(node: any) {
    console.log("Inizio Ricerca:", node.nome || node.name);
    // Logica di avvio...
  }

  closeModal() {
    this.close.emit();
  }
}