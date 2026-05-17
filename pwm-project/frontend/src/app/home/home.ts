import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from './home-data.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class HomeService {
  private apiUrl = environment.apiBaseUrl ? `${environment.apiBaseUrl}/home` : '/api/home';

  constructor(private http: HttpClient) { }

  // Tipizza il ritorno come ApiResponse
  getDashboardData(): Observable<ApiResponse> {
    return this.http.get<ApiResponse>(this.apiUrl, { withCredentials: true });
  }
}