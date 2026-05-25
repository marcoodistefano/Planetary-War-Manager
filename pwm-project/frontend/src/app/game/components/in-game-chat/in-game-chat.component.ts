import { Component, Input, Output, EventEmitter, OnDestroy, OnInit, AfterViewChecked, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../../environments/environment';

export interface ChatMessage {
  sender: string;
  text: string;
  timestamp: Date;
  isPrivate: boolean;
  to?: string;
  scope: 'global' | 'alliance' | 'direct';
  channelKey: string;
  isSystem?: boolean;
}

interface ChatChannel {
  key: string;
  scope: ChatMessage['scope'];
  label: string;
  recipient: string | null;
  available: boolean;
}

@Component({
  selector: 'app-in-game-chat',
  templateUrl: './in-game-chat.component.html',
  styleUrls: ['./in-game-chat.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class InGameChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @Input() currentUser = 'Comandante_Alpha';
  @Input() playersInMatch: string[] = [];
  @Input() allianceId: string | null = null;
  @Input() allianceLabel = 'ALLEANZA';
  @Input() matchId: string | null = null;
  @Input() set panelVisible(value: boolean) {
    const nextValue = !!value;
    const wasVisible = this._panelVisible;
    this._panelVisible = nextValue;

    if (nextValue && !wasVisible) {
      this.markActiveChannelAsRead();
    }
  }
  get panelVisible(): boolean {
    return this._panelVisible;
  }
  @Output() close = new EventEmitter<void>();
  @Output() unreadCountChange = new EventEmitter<number>();

  @ViewChild('chatScroll') private chatScrollContainer!: ElementRef;

  private socket?: WebSocket;
  private reconnectTimer?: number;
  private presenceRefreshTimer?: number;
  private shouldReconnect = true;
  private activeChannelLoadedFor = '';
  private lastRenderedCount = 0;
  private _panelVisible = false;

  resolvedMatchId = '';
  connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  isComposerOpen = false;
  activeScope: 'global' | 'alliance' | 'direct' = 'global';
  activeDirectRecipient: string | null = null;
  recentContacts: string[] = [];
  connectedUsers: string[] = [];
  newMessage = '';
  visibleMessages: ChatMessage[] = [];
  channels: ChatChannel[] = [];
  messagesByChannel = new Map<string, ChatMessage[]>();
  unreadByChannel = new Map<string, number>();

  constructor(
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.resolvedMatchId = this.matchId || this.route.snapshot.paramMap.get('id') || localStorage.getItem('pwm_last_joined_match') || '';
    this.buildChannels();
    this.selectChannel('global');
    this.connectSocket();
    this.emitUnreadState();
  }

  ngOnDestroy() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }
    if (this.presenceRefreshTimer) {
      window.clearInterval(this.presenceRefreshTimer);
    }
    this.socket?.close();
  }

  ngAfterViewChecked() {
    if (this.visibleMessages.length !== this.lastRenderedCount) {
      this.lastRenderedCount = this.visibleMessages.length;
      this.scrollToBottom();
    }
  }

  get hasAllianceChannel(): boolean {
    return !!this.allianceId;
  }

  get activeChannel(): ChatChannel | undefined {
    return this.channels.find((channel) => channel.key === this.activeChannelKey()) || this.channels[0];
  }

  get directTargets(): string[] {
    const roster = new Set(
      this.playersInMatch
        .map((name) => String(name || '').trim())
        .filter((name) => name && name !== this.currentUser && name.toLowerCase() !== 'sistema'),
    );

    const names = [...this.recentContacts, ...this.playersInMatch]
      .map((name) => String(name || '').trim())
      .filter((name) => name && roster.has(name));

    return [...new Set(names)];
  }

  get matchRoster(): string[] {
    return [...new Set(
      this.playersInMatch
        .map((name) => String(name || '').trim())
        .filter((name) => name && name.toLowerCase() !== 'sistema')
    )];
  }

  get visibleRoster(): string[] {
    return this.connectedUsers.length ? this.connectedUsers : this.matchRoster;
  }

  get composerPlaceholder(): string {
    if (this.activeScope === 'alliance') {
      return `Messaggio verso ${this.allianceLabel}...`;
    }

    if (this.activeScope === 'direct') {
      return this.activeDirectRecipient ? `Messaggio privato a ${this.activeDirectRecipient}...` : 'Seleziona un player con +';
    }

    return 'Trasmetti sul canale globale...';
  }

  get channelStatusLabel(): string {
    if (!this.resolvedMatchId) {
      return 'MATCH NON SELEZIONATO';
    }

    if (this.connectionStatus === 'connected') {
      return 'SINCRONIZZATO';
    }

    if (this.connectionStatus === 'connecting') {
      return 'COLLEGAMENTO';
    }

    return 'OFFLINE';
  }

  get totalUnreadCount(): number {
    let total = 0;
    for (const count of this.unreadByChannel.values()) {
      total += count;
    }
    return total;
  }

  unreadCountFor(channelKey: string): number {
    return this.unreadByChannel.get(channelKey) || 0;
  }

  displayUnreadCount(count: number): string {
    return count > 99 ? '99+' : String(count);
  }

  private buildChannels() {
    this.channels = [
      {
        key: this.channelKey('global'),
        scope: 'global',
        label: 'GLOBALE',
        recipient: 'ALL',
        available: true,
      },
      {
        key: this.channelKey('alliance', this.allianceId),
        scope: 'alliance',
        label: this.allianceLabel,
        recipient: this.allianceId,
        available: this.hasAllianceChannel,
      },
    ];
  }

  private connectSocket() {
    if (!this.resolvedMatchId) {
      this.connectionStatus = 'disconnected';
      this.ensureChannelHistoryLoaded();
      return;
    }

    this.connectionStatus = 'connecting';
    const wsBaseUrl = this.getGatewayWsBaseUrl();
    const wsUrl = `${wsBaseUrl}/chat/${encodeURIComponent(this.resolvedMatchId)}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.connectionStatus = 'connected';
        this.ensureChannelHistoryLoaded();
        this.refreshConnectedUsers();
        if (!this.presenceRefreshTimer) {
          this.presenceRefreshTimer = window.setInterval(() => this.refreshConnectedUsers(), 8000);
        }
        this.emitUnreadState();
        this.cdr.detectChanges();
      };

      this.socket.onmessage = (event) => this.handleSocketMessage(event.data);

      this.socket.onerror = () => {
        this.connectionStatus = 'disconnected';
        this.cdr.detectChanges();
      };

      this.socket.onclose = () => {
        this.connectionStatus = 'disconnected';
        this.cdr.detectChanges();

        if (this.shouldReconnect) {
          this.reconnectTimer = window.setTimeout(() => this.connectSocket(), 2500);
        } else if (this.presenceRefreshTimer) {
          window.clearInterval(this.presenceRefreshTimer);
          this.presenceRefreshTimer = undefined;
        }
      };
    } catch (error) {
      this.connectionStatus = 'disconnected';
      this.ensureChannelHistoryLoaded();
    }
  }

  private handleSocketMessage(rawData: unknown) {
    let parsed: any;

    try {
      parsed = typeof rawData === 'string' ? JSON.parse(rawData) : JSON.parse(String(rawData));
    } catch (error) {
      return;
    }

    if (parsed?.type === 'ERROR') {
      const systemMessage = this.buildSystemMessage(parsed.error || 'Errore di comunicazione');
      this.pushMessage(systemMessage, systemMessage.channelKey);
      this.visibleMessages = [...(this.messagesByChannel.get(systemMessage.channelKey) || [])];
      this.cdr.detectChanges();
      return;
    }

    if (parsed?.type !== 'NEW_MESSAGE' || !parsed?.data) {
      return;
    }

    const message = this.mapServiceMessage(parsed.data);
    const channelKey = this.resolveChannelKeyFromMessage(message);

    // Strict routing rules:
    // - Global messages only go to the global channel
    // - Direct (private) messages are shown ONLY if the current user is sender or recipient
    if (message.scope === 'direct') {
      const me = String(this.currentUser || '').trim();
      const sender = String(message.sender || '').trim();
      const recipient = String(message.to || '').trim();

      // If the private message doesn't involve the current user, ignore it
      if (me && sender !== me && recipient !== me) {
        return; // drop message not meant to this client
      }
    }

    if (message.scope === 'global') {
      // Force channel key for global
      if (channelKey !== this.channelKey('global')) {
        // remap to global to avoid accidental duplication
        this.pushMessage(message, this.channelKey('global'));
        this.recordRecentContactFromMessage(message);
        this.handleUnreadForIncomingMessage(this.channelKey('global'));
        if (this.channelKey('global') === this.activeChannelKey()) {
          this.visibleMessages = [...(this.messagesByChannel.get(this.channelKey('global')) || [])];
        }
        return;
      }
    }

    // Default: push to resolved channel
    this.pushMessage(message, channelKey);
    this.recordRecentContactFromMessage(message);
    this.handleUnreadForIncomingMessage(channelKey);

    if (channelKey === this.activeChannelKey()) {
      this.visibleMessages = [...(this.messagesByChannel.get(channelKey) || [])];
    }

    this.cdr.detectChanges();
  }

  private mapServiceMessage(message: any): ChatMessage {
    const sender = String(message?.sender_username || message?.sender || message?.id_user_send || 'Sistema');
    const recipient = message?.destinatario ? String(message.destinatario) : undefined;
    const scope = this.normalizeScope(message?.tipo, recipient);
    const channelKey = this.channelKey(scope, scope === 'direct' ? recipient || sender : recipient);

    return {
      sender,
      text: String(message?.content || message?.text || ''),
      timestamp: this.parseTimestamp(message?.time_stamp || message?.timestamp),
      isPrivate: scope === 'direct',
      to: recipient,
      scope,
      channelKey,
      isSystem: sender.toLowerCase() === 'sistema',
    };
  }

  private normalizeScope(tipo: unknown, destinatario?: string): ChatMessage['scope'] {
    if (tipo === 2 || tipo === '2' || destinatario === 'ALL') {
      return 'global';
    }

    if (tipo === 1 || tipo === '1' || (this.allianceId && destinatario === this.allianceId)) {
      return 'alliance';
    }

    return 'direct';
  }

  private parseTimestamp(value: unknown): Date {
    const parsed = value ? new Date(String(value)) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private resolveChannelKeyFromMessage(message: ChatMessage): string {
    if (message.scope === 'global') {
      return this.channelKey('global');
    }

    if (message.scope === 'alliance') {
      return this.channelKey('alliance', this.allianceId);
    }

    const partner = message.sender === this.currentUser ? (message.to || '') : message.sender;
    return this.channelKey('direct', partner || message.to || message.sender);
  }

  private buildSystemMessage(text: string): ChatMessage {
    return {
      sender: 'Sistema',
      text,
      timestamp: new Date(),
      isPrivate: false,
      scope: 'global',
      channelKey: this.channelKey('global'),
      isSystem: true,
    };
  }

  channelKey(scope: ChatMessage['scope'], recipient?: string | null): string {
    if (scope === 'global') {
      return 'global';
    }

    if (scope === 'alliance') {
      return `alliance:${String(recipient || this.allianceId || 'none').trim().toLowerCase()}`;
    }

    return `direct:${String(recipient || '').trim().toLowerCase()}`;
  }

  private activeChannelKey(): string {
    if (this.activeScope === 'alliance') {
      return this.channelKey('alliance', this.allianceId);
    }

    if (this.activeScope === 'direct') {
      return this.channelKey('direct', this.activeDirectRecipient);
    }

    return this.channelKey('global');
  }

  private pushMessage(message: ChatMessage, channelKey: string) {
    const existing = this.messagesByChannel.get(channelKey) || [];
    const nextMessages = [...existing, { ...message, channelKey }];
    this.messagesByChannel.set(channelKey, nextMessages);
    if (channelKey === this.activeChannelKey()) {
      this.visibleMessages = [...nextMessages];
    }
  }

  private handleUnreadForIncomingMessage(channelKey: string) {
    if (this._panelVisible && channelKey === this.activeChannelKey()) {
      return;
    }

    const nextCount = (this.unreadByChannel.get(channelKey) || 0) + 1;
    this.unreadByChannel.set(channelKey, nextCount);
    this.emitUnreadState();
  }

  private markChannelAsRead(channelKey: string) {
    if (this.unreadByChannel.has(channelKey)) {
      this.unreadByChannel.delete(channelKey);
      this.emitUnreadState();
    }
  }

  private markActiveChannelAsRead() {
    this.markChannelAsRead(this.activeChannelKey());
  }

  private emitUnreadState() {
    this.unreadCountChange.emit(this.totalUnreadCount);
  }

  private recordRecentContactFromMessage(message: ChatMessage) {
    if (message.scope !== 'direct') {
      return;
    }

    const contact = message.sender === this.currentUser ? String(message.to || '') : String(message.sender || '');
    const normalized = contact.trim();
    if (!normalized || normalized === this.currentUser || normalized.toLowerCase() === 'sistema') {
      return;
    }

    this.recentContacts = [normalized, ...this.recentContacts.filter((item) => item !== normalized)].slice(0, 8);
  }

  private ensureChannelHistoryLoaded() {
    const key = this.activeChannelKey();
    if (this.activeChannelLoadedFor === key) {
      this.visibleMessages = [...(this.messagesByChannel.get(key) || [])];
      if (this._panelVisible) {
        this.markChannelAsRead(key);
      }
      return;
    }

    this.loadActiveChannelHistory();
  }

  private async loadActiveChannelHistory() {
    if (!this.resolvedMatchId) {
      this.visibleMessages = [];
      return;
    }

    const channel = this.activeChannel;
    if (!channel || (channel.scope === 'alliance' && !channel.available)) {
      this.visibleMessages = [];
      return;
    }

    if (channel.scope === 'direct' && !this.activeDirectRecipient) {
      this.visibleMessages = [];
      return;
    }

    const params = new URLSearchParams({
      matchId: this.resolvedMatchId,
      tipo: channel.scope === 'global' ? '2' : channel.scope === 'alliance' ? '1' : '0',
      destinatario: String(channel.recipient || (channel.scope === 'global' ? 'ALL' : this.activeDirectRecipient || '')),
      limit: '80',
    });

    try {
      const response = await fetch(`${this.getGatewayHttpBaseUrl()}/chat/history?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        this.visibleMessages = [...(this.messagesByChannel.get(channel.key) || [])];
        return;
      }

      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const messages = items.map((item: any) => this.mapServiceMessage(item));

      this.messagesByChannel.set(channel.key, messages);
      this.activeChannelLoadedFor = channel.key;
      this.visibleMessages = [...messages];

      for (const message of messages) {
        this.recordRecentContactFromMessage(message);
      }

      if (!messages.length && channel.scope === 'global') {
        const starter = this.buildSystemMessage('Connessione al canale crittografato stabilita.');
        this.messagesByChannel.set(channel.key, [starter]);
        this.visibleMessages = [starter];
      }

      if (this._panelVisible) {
        this.markChannelAsRead(channel.key);
      }

      this.cdr.detectChanges();
    } catch (error) {
      this.visibleMessages = [...(this.messagesByChannel.get(channel.key) || [])];
      this.cdr.detectChanges();
    }
  }

  private async refreshConnectedUsers() {
    if (!this.resolvedMatchId) {
      this.connectedUsers = this.matchRoster;
      return;
    }

    try {
      const response = await fetch(
        `${this.getGatewayHttpBaseUrl()}/chat/presence?matchId=${encodeURIComponent(this.resolvedMatchId)}`,
        { credentials: 'include' },
      );

      if (!response.ok) {
        this.connectedUsers = this.matchRoster;
        return;
      }

      const payload = await response.json();
      const users: string[] = Array.isArray(payload?.users)
        ? payload.users
            .map((entry: any) => String(entry?.username || '').trim())
            .filter((name: string) => name)
        : [];

      this.connectedUsers = users.length ? [...new Set(users)] : this.matchRoster;
      this.cdr.detectChanges();
    } catch (error) {
      this.connectedUsers = this.matchRoster;
    }
  }

  selectChannel(scope: 'global' | 'alliance' | 'direct', recipient?: string | null) {
    if (scope === 'alliance' && !this.hasAllianceChannel) {
      return;
    }

    this.activeScope = scope;
    this.activeDirectRecipient = scope === 'direct' ? String(recipient || '').trim() : null;
    this.isComposerOpen = false;
    this.activeChannelLoadedFor = '';
    this.loadActiveChannelHistory();
    if (this._panelVisible) {
      this.markActiveChannelAsRead();
    }
  }

  openNewDirectComposer() {
    this.isComposerOpen = !this.isComposerOpen;
  }

  startDirectConversation(playerName: string) {
    const target = String(playerName || '').trim();
    if (!target || target === this.currentUser) {
      return;
    }

    this.activeScope = 'direct';
    this.activeDirectRecipient = target;
    this.isComposerOpen = false;
    this.activeChannelLoadedFor = '';

    if (!this.recentContacts.includes(target)) {
      this.recentContacts = [target, ...this.recentContacts].slice(0, 8);
    }

    this.loadActiveChannelHistory();
    if (this._panelVisible) {
      this.markActiveChannelAsRead();
    }
  }

  sendMessage() {
    const content = this.newMessage.trim();
    if (!content) return;

    const channel = this.activeChannel;
    if (!channel) return;

    if (channel.scope === 'alliance' && !channel.available) {
      this.newMessage = '';
      return;
    }

    if (channel.scope === 'direct' && !this.activeDirectRecipient) {
      this.isComposerOpen = true;
      return;
    }

    const payload = {
      tipo: channel.scope === 'global' ? 2 : channel.scope === 'alliance' ? 1 : 0,
      destinatario: channel.scope === 'global' ? 'ALL' : channel.recipient || this.activeDirectRecipient,
      content,
      matchId: this.resolvedMatchId,
    };

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    } else {
      fetch(`${this.getGatewayHttpBaseUrl()}/chat/message`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => undefined);

      const optimisticMessage: ChatMessage = {
        sender: this.currentUser,
        text: content,
        timestamp: new Date(),
        isPrivate: channel.scope === 'direct',
        to: channel.scope === 'global' ? undefined : String(channel.recipient || this.activeDirectRecipient || ''),
        scope: channel.scope,
        channelKey: channel.key,
      };

      this.pushMessage(optimisticMessage, channel.key);
      this.recordRecentContactFromMessage(optimisticMessage);
      this.visibleMessages = [...(this.messagesByChannel.get(channel.key) || [])];
      if (this._panelVisible) {
        this.markChannelAsRead(channel.key);
      }
      this.cdr.detectChanges();
    }

    this.newMessage = '';
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.cdr.detectChanges();
    }
  }

  private getGatewayHttpBaseUrl(): string {
    const configured = String(environment.apiBaseUrl || '').replace(/\/$/, '');
    return configured || '';
  }

  private getGatewayWsBaseUrl(): string {
    const httpBase = this.getGatewayHttpBaseUrl();
    if (httpBase) {
      return httpBase.replace(/^http(s?):\/\//i, 'ws$1://');
    }

    return window.location.origin.replace(/^http(s?):\/\//i, 'ws$1://');
  }

  replyTo(playerName: string) {
    const target = String(playerName || '').trim();
    if (!target || target === 'Sistema' || target === this.currentUser) {
      return;
    }

    this.startDirectConversation(target);
  }

  closeChat() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.close.emit();
  }

  private scrollToBottom(): void {
    try {
      this.chatScrollContainer.nativeElement.scrollTop = this.chatScrollContainer.nativeElement.scrollHeight;
    } catch (error) {
      return;
    }
  }
}