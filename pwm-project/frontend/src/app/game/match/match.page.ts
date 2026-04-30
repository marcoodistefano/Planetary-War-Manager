import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; // <-- Aggiungi questo
import { FormsModule } from '@angular/forms';   // <-- Aggiungi questo
import { IonicModule } from '@ionic/angular';   // <-- IL SEGRETO È QUI

@Component({
  selector: 'app-match',
  templateUrl: './match.page.html',
  styleUrls: ['./match.page.scss'],
  standalone: true,
  // Aggiungi esattamente questa riga qui sotto:
  imports: [IonicModule, CommonModule, FormsModule]
})
export class MatchPage implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}
