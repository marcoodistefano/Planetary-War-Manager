import { Injectable } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private router: Router) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: unknown) => {
        if (this.shouldRedirectToLogin(request, error)) {
          const currentUrl = this.router.url || '/home';
          try {
            sessionStorage.setItem('auth:returnUrl', currentUrl);
          } catch (e) {
            // ignore
          }
          this.router.navigate(['/login']);
        }

        return throwError(() => error);
      })
    );
  }

  private shouldRedirectToLogin(request: HttpRequest<unknown>, error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
      return false;
    }

    const protectedAuthErrors = [
      '/auth/login',
      '/auth/register',
      '/auth/login/recovery/password',
      '/auth/login/recovery/username',
    ];

    return !protectedAuthErrors.some((path) => request.url.includes(path));
  }
}