import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router'; // Aggiungi RouterLink
import { AuthApiService } from '../auth-api.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ReactiveFormsModule, RouterLink]
})
export class LoginPage implements OnInit, AfterViewInit {

  // 1. Dichiara la variabile loginForm
  loginForm!: FormGroup;
  errorMessage = '';
  isSubmitting = false;
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  // 2. Inietta il FormBuilder e il Router nel costruttore
  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
  ) {}

  ngOnInit() {
    // 3. Inizializza il form e i suoi controlli (es. email e password)
    this.loginForm = this.formBuilder.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(12)]]
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
        this.router.navigate(['/home']);
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