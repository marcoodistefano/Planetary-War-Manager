import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; // <-- Aggiungi questo
import { FormsModule } from '@angular/forms';   // <-- Aggiungi questo
import { IonicModule } from '@ionic/angular';   // <-- IL SEGRETO È QUI

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  standalone: true,
  // Aggiungi esattamente questa riga qui sotto:
  imports: [IonicModule, CommonModule, FormsModule]
})
export class HistoryPage implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}
