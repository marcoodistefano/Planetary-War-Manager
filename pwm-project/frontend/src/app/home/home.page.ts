import { Component } from '@angular/core';
import { CommonModule } from '@angular/common'; // <-- Aggiungi questo
import { FormsModule } from '@angular/forms';   // <-- Aggiungi questo
import { IonicModule } from '@ionic/angular';   // <-- IL SEGRETO È QUI

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  // Aggiungi esattamente questa riga qui sotto:
  imports: [IonicModule, CommonModule, FormsModule]
})
export class HomePage {

  constructor() {}

}
