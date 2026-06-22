import { Component, Input, Output, EventEmitter, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';

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
  @Input() userTechnologies: string[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() research = new EventEmitter<string>();
  
  activeBranch = 'hq';
  selectedNode: any = null;

  constructor(private toastCtrl: ToastController) {}

  async presentToast(msg: string, color: string = 'warning') {
    const toast = await this.toastCtrl.create({
      message: msg,
      duration: 3000,
      position: 'top',
      color: color
    });
    toast.present();
  }

  // --- VARIABILI PER IL PANNING (SCROLL ORIZZONTALE/VERTICALE INTERNO) ---

  isPanning = false;
  panStartX = 0;
  panStartY = 0;
  scrollLeft = 0;
  scrollTop = 0;
  hasMoved = false;

  // --- LOGICA PANNING INTERNO ---
  onPanStart(event: MouseEvent) {
    this.isPanning = true;
    this.hasMoved = false;
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
    
    const container = event.currentTarget as HTMLElement;
    const x = event.pageX - container.offsetLeft;
    const y = event.pageY - container.offsetTop;

    if (Math.abs(x - this.panStartX) > 5 || Math.abs(y - this.panStartY) > 5) {
      this.hasMoved = true;
      event.preventDefault(); // Evita di evidenziare il testo mentre trascini
    }
    
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

    if (this.activeBranch === 'tutti') {

      const steps = this.gameRules.sheets.find((s: any) => s.name === 'Strutture').lines
                    .filter((l: any) => l.id_struttura.includes('fortezza'))
                    .sort((a: any, b: any) => a.tier - b.tier);
      tracks.push({ name: 'CENTRO DI COMANDO', steps });

      const allExtractors = this.gameRules.sheets.find((s: any) => s.name === 'Estrattori').lines;
      const resourceTypes = ['legno', 'piombo', 'mattoni', 'acciaio', 'petrolio', 'gas_naturale'];
      
      resourceTypes.forEach(res => {
        const steps = allExtractors.filter((ex: any) => ex.risorsa_estratta === res).sort((a: any, b: any) => a.tier - b.tier);
        if(steps.length > 0) tracks.push({ name: 'INDUSTRIA: ' + res.toUpperCase(), steps });
      });

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
    if (!this.playerResources) return false;
    
    const costs = [
      { id: 'denaro', req: Number(node.costo_denaro) || 0, avail: Number(this.playerResources.denaro) || 0 },
      { id: 'legno', req: Number(node.costo_legno) || 0, avail: Number(this.playerResources.legno) || 0 },
      { id: 'mattoni', req: Number(node.costo_mattoni) || 0, avail: Number(this.playerResources.mattoni || this.playerResources.mattone) || 0 },
      { id: 'acciaio', req: Number(node.costo_acciaio) || 0, avail: Number(this.playerResources.acciaio) || 0 },
      { id: 'petrolio', req: Number(node.costo_petrolio) || 0, avail: Number(this.playerResources.petrolio) || 0 },
      { id: 'piombo', req: Number(node.costo_piombo || node.costo_piombio) || 0, avail: Number(this.playerResources.piombo) || 0 },
      { id: 'gas', req: Number(node.costo_gas) || 0, avail: Number(this.playerResources.gas_naturale || this.playerResources.gas) || 0 },
      { id: 'uranio', req: Number(node.costo_uranio) || 0, avail: Number(this.playerResources.uranio) || 0 },
      { id: 'oro', req: Number(node.costo_oro) || 0, avail: Number(this.playerResources.oro) || 0 }
    ];

    for (let c of costs) {
      if (c.avail < c.req) return false;
    }
    return true;
  }

  isUnlocked(node: any): boolean {
    const tier = node.tier || 1;
    if (tier === 1) return true;
    const id = node.id_struttura || node.id_extractor;
    return this.userTechnologies.includes(id);
  }

  canUnlock(node: any): boolean {
    const tier = node.tier || 1;
    if (tier <= 2) return true;
    const reqPrevStructure = node.richiede_struttura || node.richiede_estrattore;
    if (reqPrevStructure) {
      return this.userTechnologies.includes(reqPrevStructure);
    }
    return true; 
  }

  selectNode(node: any) {
    this.selectedNode = node;
  }

  onNodeClick(node: any) {
    if (this.hasMoved) {
      console.log('[TECH-TREE] Click ignorato perché è in corso un trascinamento (pan).');
      return;
    }
    
    console.log('[TECH-TREE] onNodeClick() triggerato per:', node.name || node.nome);
    console.log('[TECH-TREE] isUnlocked:', this.isUnlocked(node));
    console.log('[TECH-TREE] canUnlock:', this.canUnlock(node));
    console.log('[TECH-TREE] hasResources:', this.hasResources(node));
    
    if (!this.isUnlocked(node) && this.canUnlock(node) && this.hasResources(node)) {
      console.log('[TECH-TREE] Condizioni soddisfatte, chiamo confirmResearch().');
      this.presentToast(`Invio richiesta di ricerca per: ${node.name || node.nome}`, 'primary');
      this.confirmResearch(node);
    } else {
      console.log('[TECH-TREE] Condizioni non soddisfatte, chiamo selectNode().');
      
      let reason = '';
      if (this.isUnlocked(node)) {
        // Niente errore se clicco un nodo sbloccato, apro solo i dettagli.
      } else if (!this.canUnlock(node)) {
        reason = 'Devi prima sbloccare i requisiti precedenti.';
        this.presentToast(`Ricerca non permessa: ${reason}`, 'warning');
      } else if (!this.hasResources(node)) {
        const missing: string[] = [];
        const costs = [
          { id: 'Denaro', req: Number(node.costo_denaro) || 0, avail: Number(this.playerResources.denaro) || 0 },
          { id: 'Legno', req: Number(node.costo_legno) || 0, avail: Number(this.playerResources.legno) || 0 },
          { id: 'Mattoni', req: Number(node.costo_mattoni) || 0, avail: Number(this.playerResources.mattoni || this.playerResources.mattone) || 0 },
          { id: 'Acciaio', req: Number(node.costo_acciaio) || 0, avail: Number(this.playerResources.acciaio) || 0 },
          { id: 'Petrolio', req: Number(node.costo_petrolio) || 0, avail: Number(this.playerResources.petrolio) || 0 },
          { id: 'Piombo', req: Number(node.costo_piombo || node.costo_piombio) || 0, avail: Number(this.playerResources.piombo) || 0 },
          { id: 'Gas', req: Number(node.costo_gas) || 0, avail: Number(this.playerResources.gas_naturale || this.playerResources.gas) || 0 },
          { id: 'Uranio', req: Number(node.costo_uranio) || 0, avail: Number(this.playerResources.uranio) || 0 },
          { id: 'Oro', req: Number(node.costo_oro) || 0, avail: Number(this.playerResources.oro) || 0 }
        ];
        costs.forEach(c => { if (c.avail < c.req) missing.push(`${c.id} (${c.avail}/${c.req})`); });
        reason = `Ti mancano: ${missing.join(', ')}`;
        this.presentToast(`Risorse insufficienti: ${reason}`, 'warning');
      }
      
      this.selectNode(node);
    }
  }

  confirmResearch(node: any) {
    const id = node.id_struttura || node.id_extractor;
    console.log('[TECH-TREE] confirmResearch() con ID:', id);
    this.research.emit(id);
    this.selectedNode = null;
  }

  closeModal() {
    this.close.emit();
  }
}