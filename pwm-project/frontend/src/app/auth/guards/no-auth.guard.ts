import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { catchError, map, of, take } from 'rxjs';
import { AuthApiService } from '../auth-api.service';

export const noAuthGuard: CanMatchFn = () => {
  const authApi = inject(AuthApiService);
  const router = inject(Router);

  return authApi.getProfile().pipe(
    take(1),
    map(() => {
      // Se il profilo esiste (JWT valido), reindirizza a /home
      return router.createUrlTree(['/home']);
    }),
    catchError(() => {
      // Se fallisce (no JWT o JWT scaduto), consenti l'accesso alla pagina corrente (es. /login)
      return of(true);
    })
  );
};
