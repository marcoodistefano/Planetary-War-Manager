import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MatchStateService {
  private matchSocket?: WebSocket;
  private socketUrl: string = '';

  // Emette i messaggi parsati in JSON
  public messages$ = new Subject<any>();
  // Emette lo stato della connessione
  public connectionStatus$ = new Subject<boolean>();

  constructor() {}

  public connect(url: string) {
    if (this.matchSocket && (this.matchSocket.readyState === WebSocket.OPEN || this.matchSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.socketUrl = url;
    this.matchSocket = new WebSocket(url);

    this.matchSocket.onopen = () => {
      console.log('[MatchStateService] WebSocket Connected');
      this.connectionStatus$.next(true);
      this.send({ action: 'GET_INITIAL_STATE' });
    };

    this.matchSocket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.messages$.next(parsed);
      } catch (e) {
        console.error('[MatchStateService] JSON Parse error:', e);
      }
    };

    this.matchSocket.onerror = (error) => {
      console.error('[MatchStateService] WebSocket Error', error);
      this.connectionStatus$.next(false);
    };

    this.matchSocket.onclose = () => {
      console.log('[MatchStateService] WebSocket Closed');
      this.connectionStatus$.next(false);
    };
  }

  public send(payload: any) {
    if (this.matchSocket && this.matchSocket.readyState === WebSocket.OPEN) {
      this.matchSocket.send(JSON.stringify(payload));
    } else {
      console.warn('[MatchStateService] Cannot send, socket not open');
    }
  }

  public disconnect() {
    if (this.matchSocket) {
      this.matchSocket.close();
      this.matchSocket = undefined;
    }
  }
}
