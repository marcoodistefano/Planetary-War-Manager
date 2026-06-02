import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AuthApiService } from './auth/auth-api.service';
import { isPublicAuthRoute } from './auth/auth-route.config';
import { NavigationEnd, Router } from '@angular/router';
import { fromEvent, merge, of, Subscription } from 'rxjs';
import { catchError, filter, take } from 'rxjs/operators';
import { UserStateService } from './user-state.service';

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
  private settingsSub?: Subscription;

  @ViewChild('bgAudio')
  set bgAudioRef(ref: ElementRef<HTMLAudioElement> | undefined) {
    this.audioRef = ref;
    if (ref && !this.isGameRoute) {
      this.ensureAudioPlayback();
      this.updateAudioVolume();
    }
  }

  constructor(
    private router: Router,
    private authApi: AuthApiService,
    private userState: UserStateService,
  ) {
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
          this.updateAudioVolume();
        }
      });

    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd), take(1))
      .subscribe(() => {
        this.checkSessionOnBoot();
      });

    this.settingsSub = this.userState.settings$.subscribe(() => {
      this.updateAudioVolume();
    });
  }

  ngAfterViewInit() {
    this.ensureAudioPlayback();
    this.updateAudioVolume();
  }

  ngOnDestroy() {
    this.audioUnlockSub?.unsubscribe();
    this.settingsSub?.unsubscribe();
  }

  private isGameUrl(url: string): boolean {
    return url.startsWith('/game');
  }


  private checkSessionOnBoot() {
    if (isPublicAuthRoute(this.router.url)) {
      return;
    }

    this.authApi.getProfile().pipe(
      take(1),
      catchError(() => {
        const returnUrl = this.router.url || '/home';
        try {
          sessionStorage.setItem('auth:returnUrl', returnUrl);
        } catch (e) {
          // ignore
        }
        void this.router.navigate(['/login']);
        return of(false);
      })
    ).subscribe();
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

  private updateAudioVolume() {
    const audio = this.audioRef?.nativeElement;
    if (!audio) {
      return;
    }
    const settings = this.userState.getSettings();
    // Music volume is calculated by multiplying Master Volume * Music Volume
    audio.volume = (settings.masterVol / 100) * (settings.musicVol / 100);
  }
}
