import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-friends',
  templateUrl: './friends.component.html',
  styleUrls: ['./friends.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class FriendsComponent {
  currentTab: 'online' | 'all' | 'requests' = 'online';
  searchQuery: string = '';
  friendCodeInput: string = '';
  showAddFriendPopup: boolean = false;

  // Mock Dati Rete Diplomatica
  friends = [
    { name: 'Aurelio_Tac', status: 'online', avatar: 'assets/icons/icon-2.png', rank: 'Generale' },
    { name: 'Morgana_V', status: 'online', avatar: 'assets/icons/icon-3.png', rank: 'Colonnello' },
    { name: 'Raven_Sky', status: 'offline', avatar: 'assets/icons/icon-4.png', rank: 'Maggiore' },
    { name: 'Sven_Utd', status: 'offline', avatar: 'assets/icons/icon-5.png', rank: 'Soldato' },
  ];

  requests = [
    { name: 'X_DarkLord_X', avatar: 'assets/icons/icon-8.png' },
    { name: 'Shadow_Operative', avatar: 'assets/icons/icon-12.png' }
  ];

  constructor(private modalCtrl: ModalController) {}

  get filteredFriends() {
    let list = this.friends;
    if (this.currentTab === 'online') list = list.filter(f => f.status === 'online');
    
    if (this.searchQuery.trim()) {
      list = list.filter(f => f.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }
    return list;
  }

  sendRequest() {
    if (this.friendCodeInput.length > 5) {
      console.log("Protocollo invio amicizia a:", this.friendCodeInput);
      this.friendCodeInput = '';
      this.showAddFriendPopup = false;
      // Qui andrebbe la chiamata API
    }
  }

  close() { this.modalCtrl.dismiss(); }
}