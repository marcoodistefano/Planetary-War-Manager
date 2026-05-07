import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-objectives',
  templateUrl: './objectives.component.html',
  styleUrls: ['./objectives.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class ObjectivesComponent {
  // Mock dei dati: Missioni del Comando Supremo
  objectives = [
    { 
      id: 1, 
      title: 'Espansione Territoriale', 
      desc: 'Conquista 10 nuovi territori in partite globali.', 
      progress: 70, 
      reward: '500 CR', 
      icon: 'map-outline' 
    },
    { 
      id: 2, 
      title: 'Supremazia Bellica', 
      desc: 'Elimina un totale di 50.000 unità nemiche.', 
      progress: 45, 
      reward: 'Rank Up', 
      icon: 'skull-outline' 
    },
    { 
      id: 3, 
      title: 'Diplomazia Armata', 
      desc: 'Crea 3 alleanze stabili in partite di durata superiore a 48h.', 
      progress: 100, 
      reward: '200 CR', 
      icon: 'hand-left-outline' 
    },
    { 
      id: 4, 
      title: 'Ingegnere di Settore', 
      desc: 'Potenzia 5 basi al livello massimo.', 
      progress: 20, 
      reward: 'Tech Point', 
      icon: 'construct-outline' 
    }
  ];

  constructor(private modalCtrl: ModalController) {}

  close() {
    this.modalCtrl.dismiss();
  }
}