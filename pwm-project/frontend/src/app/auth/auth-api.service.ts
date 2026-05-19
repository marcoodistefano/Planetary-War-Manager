import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginPayload {
  username: string;
  password: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  region : string;
}

export interface RecoveryPasswordPayload {
  email: string;
  username?: string;
  newPassword?: string;
}

export interface AuthResponse {
  message: string;
  dato_x_sicuro?: Record<string, unknown>;
  isValid?: boolean;
  errors?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly baseUrl: string;

  constructor(private http: HttpClient) {
    this.baseUrl = (environment.apiBaseUrl || '').replace(/\/$/, '');
  }

  login(payload: LoginPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, payload, { withCredentials: true });
  }

  register(payload: RegisterPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/register`, payload, { withCredentials: true });
  }

  recoveryPassword(payload: RecoveryPasswordPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login/recovery/password`, payload, { withCredentials: true });
  }

  logout(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/logout`, {}, { withCredentials: true });
  }

  getProfile() {
    return this.http.get(`${this.baseUrl}/player/profile`, { 
      withCredentials: true 
    });
  }

  updateAvatar(avatarId: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/player/profile/avatar`, { avatarId }, { withCredentials: true });
  }
}
