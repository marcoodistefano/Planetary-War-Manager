import { Component, OnInit } from '@angular/core';
import { ModalController, IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-friends',
  templateUrl: './friends.component.html',
  styleUrls: ['./friends.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule]
})
export class FriendsComponent {
  currentTab: 'online' | 'all' | 'requests' = 'online';
  searchQuery: string = '';
  friendCodeInput: string = '';
  showAddFriendPopup: boolean = false;

  // Real data from API
  friends: Array<any> = [];
  requests: Array<any> = [];

  constructor(private modalCtrl: ModalController, private http: HttpClient, private toastCtrl: ToastController) {}

  ngOnInit(): void {
    this.loadFriends();
    this.loadRequests();
  }

  private avatarPath(avatarId: number) {
    const AVATAR_ASSET_VERSION = '20260517';
    return `assets/profile_icons/id_${avatarId}.jpeg?v=${AVATAR_ASSET_VERSION}`;
  }

  get filteredFriends() {
    let list = this.friends;
    if (this.currentTab === 'online') list = list.filter(f => f.status === 'online');
    
    if (this.searchQuery.trim()) {
      list = list.filter(f => f.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }
    return list;
  }

  sendRequest() {
    if (this.friendCodeInput.trim().length > 2) {
      const payload = { friendId: this.friendCodeInput.trim() };
      this.http.post('/api/friends/requests/sendByCode', payload, { withCredentials: true }).subscribe({
        next: (res: any) => {
          console.log('Richiesta inviata', res);
          this.friendCodeInput = '';
          this.showAddFriendPopup = false;
          this.loadRequests();
        },
        error: async (err) => {
          console.error('Errore invio richiesta', err);
          const msg = err?.error?.error || err?.error?.message || 'Errore invio richiesta';
          (await this.toastCtrl.create({ message: msg, duration: 3000 })).present();
        }
      });
    }
  }

  loadFriends() {
    this.http.get('/api/friends/list', { withCredentials: true }).subscribe({
      next: (res: any) => {
        if (res && res.status === 200) {
          this.friends = (res.data || []).map((f: any) => ({
            name: f.username || f.name || 'Unknown',
            rank: f.elo_rating || '---',
            avatar: f.avatar_id ? this.avatarPath(f.avatar_id) : this.avatarPath(1),
            raw: f
          }));
        } else if (res && res.data) {
          this.friends = (res.data || []);
        }
      },
      error: (err) => { console.error('Errore caricamento amici', err); this.friends = []; }
    });
  }

  loadRequests() {
    this.http.get('/api/friends/requests', { withCredentials: true }).subscribe({
      next: (res: any) => {
        if (res && res.status === 200) {
          this.requests = (res.data || []).map((r: any) => ({
            name: r.username || r.name || 'Unknown',
            avatar: r.avatar_id ? this.avatarPath(r.avatar_id) : this.avatarPath(1),
            requestId: r.id_request || r.id_richiesta || r.id_richieste,
            requesterUsername: r.username
          }));
        } else {
          this.requests = (res.data || []) || [];
        }
      },
      error: (err) => { console.error('Errore caricamento richieste', err); this.requests = []; }
    });
  }

  respondToRequest(requestId: any, accept: boolean) {
    const payload = { requestId, accept };
    const headers = { username: '' } as any;
    // find requester username for this request id
    const reqItem = this.requests.find(r => r.requestId === requestId);
    if (reqItem && reqItem.requesterUsername) headers.username = reqItem.requesterUsername;

    this.http.post('/api/friends/requests/respond', payload, { withCredentials: true, headers }).subscribe({
      next: async (res: any) => {
        console.log('Risposta inviata', res);
        (await this.toastCtrl.create({ message: res?.data?.message || 'Risposta inviata', duration: 2000 })).present();
        this.loadRequests();
        this.loadFriends();
      },
      error: async (err) => {
        console.error('Errore risposta richiesta', err);
        const msg = err?.error?.error || err?.error?.message || 'Errore risposta richiesta';
        (await this.toastCtrl.create({ message: msg, duration: 3000 })).present();
      }
    });
  }

  removeFriend(friend: any) {
    // Prefer numeric id if available, otherwise fallback to codice_amico or username
    const candidate = friend.raw?.id_user || friend.raw?.id || friend.raw?.codice_amico || friend.raw?.username || friend.name;
    const payload = { friendId: candidate };
    this.http.post('/api/friends/remove', payload, { withCredentials: true }).subscribe({
      next: async (res: any) => {
        console.log('Amico rimosso', res);
        (await this.toastCtrl.create({ message: res?.data?.message || 'Amico rimosso', duration: 2000 })).present();
        this.loadFriends();
      },
      error: async (err) => {
        console.error('Errore rimozione amico', err);
        const msg = err?.error?.error || err?.error?.message || 'Errore rimozione amico';
        (await this.toastCtrl.create({ message: msg, duration: 3000 })).present();
      }
    });
  }

  close() { this.modalCtrl.dismiss(); }
}