import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { catchError, map, of, take } from 'rxjs';
import { AuthApiService } from '../auth-api.service';

export const authGuard: CanMatchFn = (route, segments: UrlSegment[]) => {
  const authApi = inject(AuthApiService);
  const router = inject(Router);
  const returnUrl = `/${segments.map(segment => segment.path).join('/')}`;

  return authApi.getProfile().pipe(
    take(1),
    map(() => true),
    catchError(() => {
      const to = returnUrl || '/home';
      try {
        sessionStorage.setItem('auth:returnUrl', to);
      } catch (e) {
        // ignore storage errors
      }
      return of(router.createUrlTree(['/login']));
    })
  );
};