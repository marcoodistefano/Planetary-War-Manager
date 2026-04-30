import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';   
import { IonicModule } from '@ionic/angular';   
import { Router, RouterLink } from '@angular/router'; // Aggiungi RouterLink

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ReactiveFormsModule, RouterLink]
})
export class LoginPage implements OnInit {

  // 1. Dichiara la variabile loginForm
  loginForm!: FormGroup;

  // 2. Inietta il FormBuilder e il Router nel costruttore
  constructor(private formBuilder: FormBuilder, private router: Router) { }

  ngOnInit() {
    // 3. Inizializza il form e i suoi controlli (es. email e password)
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  // 4. Aggiungi il metodo onSubmit richiamato dall'HTML
  onSubmit() {
    if (this.loginForm.valid) {
      console.log('Form inviato con successo!', this.loginForm.value);
      // Qui inserirai la logica per fare il login vero e proprio
      this.router.navigate(['/home']);
    } else {
      console.log('Il form contiene errori e non è valido.');
    }
  }

}