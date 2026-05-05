import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { fromEvent, merge, Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements AfterViewInit, OnDestroy {
  isGameRoute = false;
  private audioRef?: ElementRef<HTMLAudioElement>;
  private audioUnlockSub?: Subscription;

  @ViewChild('bgAudio')
  set bgAudioRef(ref: ElementRef<HTMLAudioElement> | undefined) {
    this.audioRef = ref;
    if (ref && !this.isGameRoute) {
      this.ensureAudioPlayback();
    }
  }

  constructor(private router: Router) {
    this.isGameRoute = this.isGameUrl(this.router.url);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const nav = event as NavigationEnd;
        this.isGameRoute = this.isGameUrl(nav.urlAfterRedirects || nav.url);
        if (this.isGameRoute) {
          this.pauseAudio();
        } else {
          this.ensureAudioPlayback();
        }
      });
  }

  ngAfterViewInit() {
    this.ensureAudioPlayback();
  }

  ngOnDestroy() {
    this.audioUnlockSub?.unsubscribe();
  }

  private isGameUrl(url: string): boolean {
    return url.startsWith('/game');
  }

  private ensureAudioPlayback() {
    const audio = this.audioRef?.nativeElement;
    if (!audio) {
      return;
    }

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        this.waitForUserGesture();
      });
    }
  }

  private waitForUserGesture() {
    if (this.audioUnlockSub) {
      return;
    }

    const click$ = fromEvent(document, 'click');
    const touch$ = fromEvent(document, 'touchstart');
    this.audioUnlockSub = merge(click$, touch$)
      .pipe(take(1))
      .subscribe(() => {
        this.audioUnlockSub?.unsubscribe();
        this.audioUnlockSub = undefined;
        const audio = this.audioRef?.nativeElement;
        if (!audio) {
          return;
        }
        audio.play().catch(() => undefined);
      });
  }

  private pauseAudio() {
    const audio = this.audioRef?.nativeElement;
    if (!audio) {
      return;
    }
    audio.pause();
  }
}
