import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface AppSettings {
  masterVol: number;
  musicVol: number;
  sfxVol: number;
  voiceAssist: boolean;
  scanlines: boolean;
  animations: boolean;
  language: string;
  isStaticBg: boolean;
}

@Injectable({ providedIn: 'root' })
export class UserStateService {
  private avatarIdSubject = new BehaviorSubject<number>(1);
  avatarId$ = this.avatarIdSubject.asObservable();

  private settingsSubject: BehaviorSubject<AppSettings>;
  settings$: Observable<AppSettings>;

  constructor() {
    const initial = this.loadInitialSettings();
    this.settingsSubject = new BehaviorSubject<AppSettings>(initial);
    this.settings$ = this.settingsSubject.asObservable();
    this.applySettings(initial);
  }

  setAvatarId(id: number) {
    this.avatarIdSubject.next(id);
  }

  getSettings(): AppSettings {
    return this.settingsSubject.value;
  }

  updateSettings(partial: Partial<AppSettings>) {
    const updated = { ...this.settingsSubject.value, ...partial };
    this.settingsSubject.next(updated);
    localStorage.setItem('pwm_app_settings', JSON.stringify(updated));
    this.applySettings(updated);
  }

  private loadInitialSettings(): AppSettings {
    const saved = localStorage.getItem('pwm_app_settings');
    if (saved) {
      try {
        return {
          masterVol: 80,
          musicVol: 65,
          sfxVol: 80,
          voiceAssist: true,
          scanlines: false,
          animations: true,
          language: 'it',
          isStaticBg: false,
          ...JSON.parse(saved)
        };
      } catch (e) {
        // ignore and fallback
      }
    }
    return {
      masterVol: 80,
      musicVol: 65,
      sfxVol: 80,
      voiceAssist: true,
      scanlines: false,
      animations: true,
      language: 'it',
      isStaticBg: false
    };
  }

  private applySettings(settings: AppSettings) {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('static-bg', settings.isStaticBg);
    }
  }
}

