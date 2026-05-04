import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router';

// Importazione dei componenti necessari per il selettore nazioni
import { 
  IonicSelectableComponent, 
  IonicSelectableItemTemplateDirective 
} from 'ionic-selectable';

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
    RouterLink,
    IonicSelectableComponent,
    IonicSelectableItemTemplateDirective
  ]
})
export class RegisterPage implements OnInit, AfterViewInit {

  // Usiamo '!' per dire a TS che il form verrà inizializzato nel constructor
  RegisterForm!: FormGroup;
  countries: any[] = [];
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  constructor(private formBuilder: FormBuilder, private router: Router) {
    // Inizializziamo subito il form per evitare errori di "undefined" nel template
    this.initForm();
  }

  async ngOnInit() {
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
      password: ['', [Validators.required, Validators.minLength(6)]],
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
    if (this.RegisterForm.valid) {
      console.log('Accesso al sistema PWM autorizzato. Dati inviati:', this.RegisterForm.value);
      // Qui andrà la logica del servizio di autenticazione
      this.router.navigate(['/login']);
    } else {
      console.log('Protocollo di registrazione fallito: dati non validi.');
    }
  }
}