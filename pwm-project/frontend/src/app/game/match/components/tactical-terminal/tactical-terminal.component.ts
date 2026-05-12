import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-tactical-terminal',
  templateUrl: './tactical-terminal.component.html',
  styleUrls: ['./tactical-terminal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TacticalTerminalComponent {
  @Input() profile: any;
  @Input() audioSettings: any;
  @Input() uiSettings: any;
  @Output() close = new EventEmitter<void>();

  activeTab: 'profile' | 'settings' = 'profile';

  setTab(tab: 'profile' | 'settings') {
    this.activeTab = tab;
  }

  closeTerminal() {
    this.close.emit();
  }
}