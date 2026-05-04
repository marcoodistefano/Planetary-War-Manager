import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router'; // Aggiungi RouterLink

@Component({
  selector: 'app-recover-password',
  templateUrl: './recover-password.page.html',
  styleUrls: ['./recover-password.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ReactiveFormsModule, RouterLink]
})
export class RecoverPasswordPage implements OnInit {

  // 1. Dichiara la variabile loginForm
  recoverForm!: FormGroup;

  // 2. Inietta il FormBuilder e il Router nel costruttore
  constructor(private formBuilder: FormBuilder, private router: Router) { }

  ngOnInit() {
    // 3. Inizializza il form e i suoi controlli (es. email e password)
    this.recoverForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  // 4. Aggiungi il metodo onSubmit richiamato dall'HTML
  onSubmit() {
    if (this.recoverForm.valid) {
      console.log('Recupero password attivato!', this.recoverForm.value);
      // Qui inserirai la logica per fare il login vero e proprio
        this.router.navigate(['/auth/login']);
    } else {
      console.log('Il form contiene errori e non è valido.');
    }
  }

}