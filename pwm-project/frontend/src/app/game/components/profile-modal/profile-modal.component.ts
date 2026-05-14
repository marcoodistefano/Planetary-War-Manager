import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';

@Component({
  selector: 'app-profile-modal',
  templateUrl: './profile-modal.component.html',
  styleUrls: ['./profile-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class ProfileModalComponent {
  @Input() profile: any = {
    username: 'GHOST_OPERATIVE',
    rank: 'COMANDANTE SUPREMO',
    experience: 75,
    matchesWon: 142,
    matchesLost: 29
  };

  @Input() audioSettings: any = { music: 50, sfx: 80 };
  @Output() close = new EventEmitter<void>();

  activeTab: 'profile' | 'settings' = 'profile';

  // --- LOGICA DRAG & DROP (Allineata a Intelligence) ---
  isDragging = false;
  dragStartX = 0; dragStartY = 0;
  transformX = 0; transformY = 0;

  constructor(private router: Router) {}

  onDragStart(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // Blocca il drag se si interagisce con elementi attivi
    if (
      target.tagName === 'BUTTON' || 
      target.tagName === 'INPUT' || 
      target.tagName === 'ION-ICON' || 
      target.closest('.nav-item')
    ) return;
    
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

  setTab(tab: 'profile' | 'settings') {
    this.activeTab = tab;
  }

  closeTerminal() {
    this.close.emit();
  }

  navigateToFullProfile() {
    this.close.emit();
    this.router.navigate(['/profile']);
  }
}