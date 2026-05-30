import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule, IonContent } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router'; // Aggiungi RouterLink
import { AuthApiService } from '../auth-api.service';
import { finalize } from 'rxjs/operators';
import { Title } from '@angular/platform-browser';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ReactiveFormsModule, RouterLink]
})
export class LoginPage implements OnInit, AfterViewInit, OnDestroy {

  // 1. Dichiara la variabile loginForm
  loginForm!: FormGroup;
  errorMessage = '';
  isSubmitting = false;
  showPassword = false;
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild(IonContent) content?: IonContent;

  private focusHandler = (ev: FocusEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target.closest('ion-input')) {
      setTimeout(async () => {
        try {
          const contentEl = await this.content?.getScrollElement();
          if (!contentEl) return;
          const targetRect = target.getBoundingClientRect();
          const contentRect = contentEl.getBoundingClientRect();
          const offset = contentEl.scrollTop + (targetRect.top - contentRect.top) - 120;
          this.content?.scrollToPoint(0, Math.max(0, Math.round(offset)), 300);
        } catch (e) { /* ignore */ }
      }, 50);
    }
  };

  // 2. Inietta il FormBuilder e il Router nel costruttore
  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
    private titleService: Title
  ) {}

  ngOnInit() {
    this.titleService.setTitle('PWM | Login');
    // 3. Inizializza il form e i suoi controlli (es. email e password)
    this.loginForm = this.formBuilder.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(12)]]
    });
  }

  ngAfterViewInit() {
    this.playBackgroundVideo();
    document.addEventListener('focusin', this.focusHandler);
  }

  ngOnDestroy() {
    document.removeEventListener('focusin', this.focusHandler);
  }

  ionViewDidEnter() {
    this.playBackgroundVideo();
  }

  private playBackgroundVideo() {
    const video = this.backgroundVideo?.nativeElement;
    if (!video) {
      return;
    }

    video.muted = true;
    video.playsInline = true;
    video.load();
    video.play().catch(() => undefined);
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  // 4. Aggiungi il metodo onSubmit richiamato dall'HTML
  onSubmit() {
    if (!this.loginForm.valid) {
      console.log('Il form contiene errori e non è valido.');
      return;
    }

    const { username, password } = this.loginForm.value;
    this.errorMessage = '';
    this.isSubmitting = true;
    this.authApi
      .login({ username, password })
      .pipe(finalize(() => {
        this.isSubmitting = false;
      }))
      .subscribe({
      next: () => {
        const nav = this.router.getCurrentNavigation?.() as any;
        const stateReturn = nav?.extras?.state?.returnUrl ?? (history && (history.state && history.state.returnUrl));
        const storedReturn = (() => {
          try { return sessionStorage.getItem('auth:returnUrl'); } catch (e) { return null; }
        })();
        const target = stateReturn || storedReturn || '/home';
        try { sessionStorage.removeItem('auth:returnUrl'); } catch (e) { /* ignore */ }
        this.router.navigateByUrl(target);
      },
      error: (error) => {
        const apiErrors = error?.error?.errors;
        if (Array.isArray(apiErrors) && apiErrors.length > 0) {
          this.errorMessage = apiErrors.join(' | ');
        } else if (error?.error?.error) {
          this.errorMessage = error.error.error;
        } else {
          this.errorMessage = 'Login fallito. Verifica le credenziali e riprova.';
        }
        console.error('Login fallito:', error);
      },
    });
  }

}