import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router';
import { AuthApiService } from '../auth-api.service';
import { finalize } from 'rxjs/operators';
import { Title } from '@angular/platform-browser';

// Importazione dei componenti necessari per il selettore nazioni

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: true,
  imports: [
    IonicModule, 
    CommonModule, 
    FormsModule, 
    ReactiveFormsModule, 
    RouterLink
  ]
})
export class RegisterPage implements OnInit, AfterViewInit {

  // Usiamo '!' per dire a TS che il form verrà inizializzato nel constructor
  RegisterForm!: FormGroup;
  errorMessage = '';
  isSubmitting = false;
  countries: any[] = [];
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
    private titleService: Title
  ) {
    // Inizializziamo subito il form per evitare errori di "undefined" nel template
    this.initForm();
  }

  async ngOnInit() {
    this.titleService.setTitle('PWM | Registrazione');
    // Carichiamo le nazioni in background
    await this.loadCountries();
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

  initForm() {
    this.RegisterForm = this.formBuilder.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(12)]],
      region: [null, [Validators.required]]
    });
  }

  async loadCountries() {
    try {
      // Recupero nazioni con traduzioni in italiano
      const response = await fetch('https://restcountries.com/v3.1/all?fields=name,flag,cca2,translations');
      const data = await response.json();

      this.countries = data.map((c: any) => ({
        name: c.translations?.ita?.common || c.name.common,
        flag: c.flag,
        code: c.cca2
      })).sort((a: any, b: any) => a.name.localeCompare(b.name));

    } catch (error) {
      console.error('Errore nel caricamento delle nazioni dall\'API:', error);
      // Fallback in caso di problemi di rete
      this.countries = [{ name: 'Italia', code: 'IT', flag: '🇮🇹' }];
    }
  }

  onSubmit() {
    if (!this.RegisterForm.valid) {
      console.log('Protocollo di registrazione fallito: dati non validi.');
      return;
    }

    const { username, email, password } = this.RegisterForm.value;
    this.errorMessage = '';
    this.isSubmitting = true;
    this.authApi
      .register({ username, email, password })
      .pipe(finalize(() => {
        this.isSubmitting = false;
      }))
      .subscribe({
        next: () => {
          this.router.navigate(['/login']);
        },
        error: (error) => {
          const apiErrors = error?.error?.errors;
          if (Array.isArray(apiErrors) && apiErrors.length > 0) {
            this.errorMessage = apiErrors.join(' | ');
          } else if (error?.error?.error) {
            this.errorMessage = error.error.error;
          } else {
            this.errorMessage = 'Registrazione fallita. Verifica i dati e riprova.';
          }
          console.error('Registrazione fallita:', error);
        },
      });
  }
}