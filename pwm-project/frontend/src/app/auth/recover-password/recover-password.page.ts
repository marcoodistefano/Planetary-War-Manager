import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router'; // Aggiungi RouterLink
import { AuthApiService } from '../auth-api.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-recover-password',
  templateUrl: './recover-password.page.html',
  styleUrls: ['./recover-password.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ReactiveFormsModule, RouterLink]
})
export class RecoverPasswordPage implements OnInit, AfterViewInit {

  // 1. Dichiara la variabile loginForm
  recoverForm!: FormGroup;
  errorMessage = '';
  successMessage = '';
  isSubmitting = false;
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  // 2. Inietta il FormBuilder e il Router nel costruttore
  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
  ) { }

  ngOnInit() {
    // 3. Inizializza il form e i suoi controlli (es. email e password)
    this.recoverForm = this.formBuilder.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      newPassword: ['', [Validators.required, Validators.minLength(12)]],
    });
  }

  ngAfterViewInit() {
    this.playBackgroundVideo();
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

  // 4. Aggiungi il metodo onSubmit richiamato dall'HTML
  onSubmit() {
    if (!this.recoverForm.valid) {
      console.log('Il form contiene errori e non è valido.');
      return;
    }

    const { username, email, newPassword } = this.recoverForm.value;
    this.errorMessage = '';
    this.successMessage = '';
    this.isSubmitting = true;
    this.authApi
      .recoveryPassword({ username, email, newPassword })
      .pipe(finalize(() => {
        this.isSubmitting = false;
      }))
      .subscribe({
        next: () => {
          this.successMessage = 'Password aggiornata con successo. Puoi accedere.';
          this.router.navigate(['/login']);
        },
        error: (error) => {
          const apiErrors = error?.error?.errors;
          if (Array.isArray(apiErrors) && apiErrors.length > 0) {
            this.errorMessage = apiErrors.join(' | ');
          } else if (error?.error?.error) {
            this.errorMessage = error.error.error;
          } else {
            this.errorMessage = 'Recupero password fallito. Verifica i dati e riprova.';
          }
          console.error('Recupero password fallito:', error);
        },
      });
  }

}