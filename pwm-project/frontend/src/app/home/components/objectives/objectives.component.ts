import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { AuthApiService } from '../../../auth/auth-api.service';

@Component({
  selector: 'app-objectives',
  templateUrl: './objectives.component.html',
  styleUrls: ['./objectives.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class ObjectivesComponent {
  objectives: any[] = [];
  errorMessage = '';

  constructor(
    private modalCtrl: ModalController,
    private authApi: AuthApiService,
  ) {
    this.loadObjectives();
  }

  loadObjectives() {
    this.authApi.getAchievements().subscribe({
      next: (response) => {
        this.objectives = (response.data || []).map((objective: any) => ({
          ...objective,
          desc: objective.description,
          progress: objective.requirement?.target
            ? Math.round((objective.progress / objective.requirement.target) * 100)
            : 0,
          rewardLabel: objective.reward?.type === 'elo'
            ? `${objective.reward.value} ELO`
            : objective.reward?.type || 'Ricompensa',
          icon: objective.requirement?.metric === 'kills_total' ? 'skull-outline' : 'map-outline',
        }));
      },
      error: () => { this.errorMessage = 'Impossibile recuperare gli obiettivi.'; },
    });
  }

  claim(objective: any) {
    if (!objective.completed || objective.claimed) return;
    this.authApi.claimAchievement(objective.id).subscribe({
      next: () => this.loadObjectives(),
      error: () => { this.errorMessage = 'Ricompensa non ancora riscattabile.'; },
    });
  }

  close() {
    this.modalCtrl.dismiss();
  }
}