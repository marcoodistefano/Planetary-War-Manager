import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard } from './auth/guards/auth.guard';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then(m => m.HomePage),
    canMatch: [authGuard]
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.page').then(m => m.LoginPage)
  },
  {
    path: 'register',
    loadComponent: () => import('./auth/register/register.page').then(m => m.RegisterPage)
  },
  {
    path: 'login/recovery/username',
    loadComponent: () => import('./auth/recover-password/recover-password.page').then(m => m.RecoverPasswordPage)
  },
  {
    path: 'login/recovery/password',
    loadComponent: () => import('./auth/recover-password/recover-password.page').then(m => m.RecoverPasswordPage)
  },
  {
    path: 'auth/login',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'auth/register',
    redirectTo: 'register',
    pathMatch: 'full'
  },
  {
    path: 'auth/login/recovery/username',
    redirectTo: 'login/recovery/username',
    pathMatch: 'full'
  },
  {
    path: 'auth/login/recovery/password',
    redirectTo: 'login/recovery/password',
    pathMatch: 'full'
  },
  {
    path: 'game/match',
    loadComponent: () => import('./game/match/match.page').then(m => m.MatchPage),
    canMatch: [authGuard]
  },
  {
    path: 'game/match/:id',
    loadComponent: () => import('./game/match/match.page').then(m => m.MatchPage),
    canMatch: [authGuard]
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.page').then(m => m.ProfilePage),
    canMatch: [authGuard]
  },
  {
    path: 'history',
    loadComponent: () => import('./history/history.page').then(m => m.HistoryPage),
    canMatch: [authGuard]
  },
  {
    path: 'game-browser',
    loadComponent: () => import('./game-browser/game-browser.page').then(m => m.GameBrowserPage),
    canMatch: [authGuard]
  },
  {
    path: 'leaderboard',
    loadComponent: () => import('./leaderboard/leaderboard.page').then(m => m.LeaderboardPage),
    canMatch: [authGuard]
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
