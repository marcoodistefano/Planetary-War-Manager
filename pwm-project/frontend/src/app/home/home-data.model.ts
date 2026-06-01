// src/app/home/home-data.model.ts

export interface UserProfile {
  username: string;
  reg: string;
  elo_rating: number;
  avatar_id?: number;
  email?: string;
  id_user?: string;
}

export interface HomeData {
  // Aggiunto per contenere i dati dell'utente loggato estratti dal JWT
  user_profile?: UserProfile; 
  
  leaderboard_regionale: any[];
  leaderboard_globale: any[];
  user_position: number;
  user_position_regionale?: number;
  
  // Mappe degli oggetti match1, match2 ecc. creati da buildMatchMap nel backend
  match_attivi: { [key: string]: any }; 
  last_created_match: { [key: string]: any };
  match_chiuse?: { [key: string]: any };
  
  friends_information: any[];
}

export interface ApiResponse {
  status: number;
  message: string;
  data: HomeData; // Qui dentro ci sono i dati reali
}