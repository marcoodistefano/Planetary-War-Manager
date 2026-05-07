import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router';
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
export class RecoverPasswordPage implements OnInit, AfterViewInit {

  recoverForm!: FormGroup;
  errorMessage = '';
  successMessage = '';
  isSubmitting = false;
  @ViewChild('backgroundVideo') backgroundVideo?: ElementRef<HTMLVideoElement>;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authApi: AuthApiService,
    private titleService: Title
  ) { }

  ngOnInit() {
    this.titleService.setTitle('PWM | Recupero Password');
    this.recoverForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  // QUESTO È IL METODO CHE IL COMPILATORE NON TROVA:
  ngAfterViewInit() {
    this.playBackgroundVideo();
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
          // Opzionale: reindirizzamento dopo qualche secondo
          setTimeout(() => this.router.navigate(['/login']), 5000);
        },
        error: (error) => {
          this.errorMessage = error?.error?.error || 'Impossibile inviare il link. Verifica l\'indirizzo e riprova.';
          console.error('Errore recupero:', error);
        },
      });
  }
}