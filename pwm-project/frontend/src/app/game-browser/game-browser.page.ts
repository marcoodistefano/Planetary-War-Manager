import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { Title } from '@angular/platform-browser';

@Component({
  selector: 'app-game-browser',
  templateUrl: './game-browser.page.html',
  styleUrls: ['./game-browser.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, RouterModule]
})
export class GameBrowserPage implements OnInit, AfterViewInit {
  view: 'active' | 'finished' = 'active';
  
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  // Aggiunta del campo region ai dati mock
  mockMatches = [
    { id: 1000, name: 'Operazione Alpha 1', creator: 'Comandante_V', joined: 12, total: 12, region: 'Mondo' },
    { id: 1001, name: 'Operazione Alpha 2', creator: 'Comandante_V', joined: 12, total: 12, region: 'Italia' },
    { id: 1002, name: 'Operazione Alpha 3', creator: 'Comandante_V', joined: 12, total: 12, region: 'Cina' },
    { id: 1003, name: 'Operazione Alpha 4', creator: 'Comandante_V', joined: 12, total: 12, region: 'Russia' },
    { id: 1004, name: 'Operazione Alpha 5', creator: 'Comandante_V', joined: 12, total: 12, region: 'USA' }
  ];

  constructor(private titleService: Title) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Archivio Operazioni');
  }

  ngAfterViewInit() {
    this.playBackgroundVideo();
  }

  ionViewDidEnter() {
    this.playBackgroundVideo();
  }

  private playBackgroundVideo() {
    const video = this.backgroundVideo?.nativeElement;
    if (video) {
      video.muted = true;
      video.playsInline = true;
      video.load();
      video.play().catch(() => undefined);
    }
  }
}