import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule, IonContent } from '@ionic/angular';   
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthApiService } from '../auth-api.service';
import { finalize } from 'rxjs/operators';
import { Title } from '@angular/platform-browser';

@Component({
  selector: 'app-recover-password',
  templateUrl: './recover-password.page.html',
  styleUrls: ['./recover-password.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ReactiveFormsModule, RouterLink]
})
// Assicurati che la classe sia scritta ESATTAMENTE così
export class RecoverPasswordPage implements OnInit, AfterViewInit, OnDestroy {

  recoverForm!: FormGroup;
  resetForm!: FormGroup;
  errorMessage = '';
  successMessage = '';
  isSubmitting = false;
  token: string | null = null;
  showNewPassword = false;
  showConfirmPassword = false;
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

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private authApi: AuthApiService,
    private titleService: Title
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Recupero Password');
    this.recoverForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
    });

    this.resetForm = this.formBuilder.group({
      newPassword: ['', [Validators.required, Validators.minLength(12)]],
      confirmPassword: ['', [Validators.required]],
    }, { validators: this.passwordMatchValidator });

    this.route.queryParams.subscribe(params => {
      this.token = params['token'] || null;
      if (!this.token) {
        this.resetForm?.reset();
      }
    });
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('newPassword')?.value === g.get('confirmPassword')?.value
      ? null : { mismatch: true };
  }

  toggleNewPasswordVisibility() {
    this.showNewPassword = !this.showNewPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // QUESTO È IL METODO CHE IL COMPILATORE NON TROVA:
  ngAfterViewInit() {
    this.playBackgroundVideo();
    document.addEventListener('focusin', this.focusHandler);
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

  onSubmit() {
    if (!this.recoverForm.valid) return;

    const { email } = this.recoverForm.value;
    this.errorMessage = '';
    this.successMessage = '';
    this.isSubmitting = true;

    // Chiamata API aggiornata per inviare solo l'email
    this.authApi
      .recoveryPassword({ email }) 
      .pipe(finalize(() => this.isSubmitting = false))
      .subscribe({
        next: () => {
          this.successMessage = 'Protocollo avviato. Controlla la tua email per il link di ripristino.';
          setTimeout(() => this.router.navigate(['/login']), 5000);
        },
        error: (error) => {
          this.errorMessage = error?.error?.error || 'Impossibile inviare il link. Verifica l\'indirizzo e riprova.';
          console.error('Errore recupero:', error);
        },
      });
  }

  onResetSubmit() {
    if (!this.resetForm.valid || !this.token) return;

    const { newPassword } = this.resetForm.value;
    this.errorMessage = '';
    this.successMessage = '';
    this.isSubmitting = true;

    this.authApi
      .resetPassword(this.token, newPassword)
      .pipe(finalize(() => this.isSubmitting = false))
      .subscribe({
        next: () => {
          this.successMessage = 'Password reimpostata con successo. Reindirizzamento in corso...';
          setTimeout(() => this.router.navigate(['/login']), 3000);
        },
        error: (error) => {
          this.errorMessage = error?.error?.errors?.[0] || 'Impossibile reimpostare la password. Il link potrebbe essere scaduto.';
          console.error('Errore reset:', error);
        }
      });
  }

  ngOnDestroy() {
    document.removeEventListener('focusin', this.focusHandler);
  }
}
