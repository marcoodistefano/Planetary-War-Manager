import { Component, Input, Output, EventEmitter, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface ChatMessage {
  sender: string;
  text: string;
  timestamp: Date;
  isPrivate: boolean;
  to?: string; 
}

@Component({
  selector: 'app-in-game-chat', // <-- CORRETTO
  templateUrl: './in-game-chat.component.html', // <-- CORRETTO
  styleUrls: ['./in-game-chat.component.scss'], // <-- CORRETTO
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class InGameChatComponent implements OnInit, AfterViewChecked { // <-- CORRETTO
  @Input() currentUser = 'Comandante_Alpha';
  @Input() playersInMatch: string[] = []; 
  @Output() close = new EventEmitter<void>();
  
  @ViewChild('chatScroll') private chatScrollContainer!: ElementRef;

  recipient: string = 'ALL'; 
  newMessage: string = '';
  
  messages: ChatMessage[] = [
    { sender: 'Sistema', text: 'Connessione al canale crittografato stabilita.', timestamp: new Date(), isPrivate: false },
    { sender: 'Aurelio', text: 'Qualcuno ha bisogno di uranio?', timestamp: new Date(), isPrivate: false },
    { sender: 'Morgana', text: 'Sto attaccando il settore Nord, copritemi.', timestamp: new Date(), isPrivate: false },
    { sender: 'Raven', text: 'Facciamo un patto di non aggressione?', timestamp: new Date(), isPrivate: true, to: 'Comandante_Alpha' } 
  ];

  ngOnInit() {
    if (this.playersInMatch.length === 0) {
      this.playersInMatch = ['Aurelio', 'Morgana', 'Raven', 'Sven'];
    }
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    try {
      this.chatScrollContainer.nativeElement.scrollTop = this.chatScrollContainer.nativeElement.scrollHeight;
    } catch(err) { }
  }

  sendMessage() {
    if (!this.newMessage.trim()) return;

    const isPrivate = this.recipient !== 'ALL';
    
    this.messages.push({
      sender: this.currentUser,
      text: this.newMessage,
      timestamp: new Date(),
      isPrivate: isPrivate,
      to: isPrivate ? this.recipient : undefined
    });

    this.newMessage = '';
  }

  replyTo(playerName: string) {
    if (playerName !== 'Sistema' && playerName !== this.currentUser) {
      this.recipient = playerName;
    }
  }

  closeChat() {
    this.close.emit();
  }
}