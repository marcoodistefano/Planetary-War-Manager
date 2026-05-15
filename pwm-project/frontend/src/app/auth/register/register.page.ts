import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';     
import { Router, RouterLink } from '@angular/router';
import { AuthApiService } from '../auth-api.service';
import { IonicModule, IonSearchbar } from '@ionic/angular';
import { finalize } from 'rxjs/operators';
import { Title } from '@angular/platform-browser';

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

  // Variabili del Form
  RegisterForm!: FormGroup;
  errorMessage = '';
  isSubmitting = false;
  showPassword = false;
  
  // Variabili per il Modale delle Nazioni
  countries: any[] = [];
  filteredCountries: any[] = [];
  selectedCountry: any = null;
  isCountryModalOpen = false;

  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('countrySearchbar') searchbar?: IonSearchbar;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
    private titleService: Title
  ) {
    this.initForm();
  }

  async ngOnInit() {
    this.titleService.setTitle('PWM | Registrazione');
    await this.loadCountries();
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
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

      // Inizializza la lista filtrata per il modale
      this.filteredCountries = [...this.countries];

    } catch (error) {
      console.error('Errore nel caricamento delle nazioni dall\'API:', error);
      // Fallback in caso di problemi di rete
      this.countries = [{ name: 'Italia', code: 'IT', flag: '🇮🇹' }];
      this.filteredCountries = [...this.countries];
    }
  }

  // === METODI PER LA GESTIONE DEL MODALE NAZIONI ===

 openCountryModal() {
    this.filteredCountries = [...this.countries]; 
    this.isCountryModalOpen = true;
  }

  // NUOVO METODO: Forza il focus sulla barra di ricerca
  focusSearchbar() {
    // Un microscopico delay assicura che il rendering del DOM sia terminato
    setTimeout(() => {
      this.searchbar?.setFocus();
    }, 150);
  }

  closeCountryModal() {
    this.isCountryModalOpen = false;
  }

  filterCountries(event: any) {
    const query = event.target.value?.toLowerCase() || '';
    if (!query) {
      this.filteredCountries = [...this.countries];
    } else {
      this.filteredCountries = this.countries.filter(c => c.name.toLowerCase().includes(query));
    }
  }

  selectCountry(country: any) {
    this.selectedCountry = country; 
    this.RegisterForm.patchValue({ region: country.code }); 
    this.closeCountryModal(); 
  }

  // === INVIO DATI ===

  onSubmit() {
    if (!this.RegisterForm.valid) {
      console.log('Protocollo di registrazione fallito: dati non validi.');
      return;
    }

    const { username, email, password, region } = this.RegisterForm.value;
    this.errorMessage = '';
    this.isSubmitting = true;
    this.authApi
      .register({ username, email, password, region })
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