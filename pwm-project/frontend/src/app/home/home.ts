import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from './home-data.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class HomeService {
  private apiUrl = environment.apiBaseUrl ? `${environment.apiBaseUrl}/home` : '/api/home';
  private matchApiUrl = environment.apiBaseUrl ? `${environment.apiBaseUrl}/match` : '/api/match';

  constructor(private http: HttpClient) { }

  // Tipizza il ritorno come ApiResponse
  getDashboardData(): Observable<ApiResponse> {
    return this.http.get<ApiResponse>(this.apiUrl, { withCredentials: true });
  }

  getActiveMatchesBrowserData(): Observable<ApiResponse> {
    return this.http.get<ApiResponse>(`${this.apiUrl}/active-matches`, { withCredentials: true });
  }

  joinMatch(matchId: string): Observable<any> {
    return this.http.post<any>(`${this.matchApiUrl}/${matchId}/join`, {}, { withCredentials: true });
  }

  getMatchPlayers(matchId: string): Observable<any> {
    return this.http.get<any>(`${this.matchApiUrl}/${matchId}/players`, { withCredentials: true });
  }

  getMatchAlliance(matchId: string): Observable<any> {
    return this.http.get<any>(`${this.matchApiUrl}/${matchId}/alliance`, { withCredentials: true });
  }

  joinMatchAlliance(matchId: string, allianceId: string | number): Observable<any> {
    return this.http.post<any>(`${this.matchApiUrl}/${matchId}/join/${allianceId}`, {}, { withCredentials: true });
  }

  leaveMatchAlliance(matchId: string, allianceId: string | number): Observable<any> {
    return this.http.post<any>(`${this.matchApiUrl}/${matchId}/leave/${allianceId}`, {}, { withCredentials: true });
  }

  kickMatchAlliance(matchId: string, allianceId: string | number, targetPlayerId: string, motivation = ''): Observable<any> {
    return this.http.post<any>(
      `${this.matchApiUrl}/${matchId}/kick/${allianceId}`,
      { targetPlayerId, motivation },
      { withCredentials: true },
    );
  }
}