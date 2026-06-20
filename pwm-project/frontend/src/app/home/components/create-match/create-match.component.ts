import { Component } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Importato per ngModel
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-create-match',
  templateUrl: './create-match.component.html',
  styleUrls: ['./create-match.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule]
})
export class CreateMatchComponent {
  readonly duplicateMatchErrorMessage = 'Non puoi creare una nuova partita perché ne hai già una attiva.\nRiprova nel momento in cui la partita precedentemente creata non sará terminata!';

  readonly regionOptions = [
    'World',
    'Europe',
    'Asia',
    'Africa',
    'Oceania',
    'America North',
    'America South',
    'Antartica',
  ];

  private readonly regionOrder = new Map(this.regionOptions.map((region, index) => [region, index]));

  private readonly validRegionComboKeys = new Set([
    this.regionKey(['World']),
    this.regionKey(['Europe']),
    this.regionKey(['Asia']),
    this.regionKey(['Africa']),
    this.regionKey(['Oceania']),
    this.regionKey(['America North']),
    this.regionKey(['America South']),
    this.regionKey(['Antartica']),
    this.regionKey(['Europe', 'Asia']),
    this.regionKey(['Europe', 'Africa']),
    this.regionKey(['Asia', 'Africa']),
    this.regionKey(['Europe', 'Asia', 'Africa']),
    this.regionKey(['Asia', 'Oceania']),
    this.regionKey(['Africa', 'Antartica']),
    this.regionKey(['Oceania', 'Antartica']),
    this.regionKey(['Africa', 'Oceania', 'Antartica']),
    this.regionKey(['America North', 'America South']),
    this.regionKey(['America North', 'America South', 'Asia']),
    this.regionKey(['America North', 'America South', 'Europe']),
    this.regionKey(['America North', 'America South', 'Africa']),
    this.regionKey(['America North', 'America South', 'Europe', 'Africa']),
    this.regionKey(['America North', 'America South', 'Europe', 'Africa', 'Asia']),
    this.regionKey(['America North', 'America South', 'Antartica'])
  ]);

  // Modello dati per il match
  matchData = {
    missione: '',
    regioni: ['World'],
    maxPlayers: '10',
    modalita: 'Tutti contro tutti',
    vittoriaSoglia: 50,
    isSquad: false,
    hasElo: true,
    alleanze: true,
    durata: '1 giorno',
    moltiplicatore: 'x1',
    avvio: 'Immediato'
  };

  popoverOptions: any = {
    side: 'bottom',
    alignment: 'center',
    size: 'cover',
    showBackdrop: false,
    cssClass: 'tactical-popover-menu'
  };

  maxPlayers = ['10', '20', '30', '50', '100', '250', '500', '1v1', '2v2', '3v3', '4v4', '5v5', '10v10', '25v25', '50v50'];
  durataMax = ['1 ora', '6 ore', '12 ore', '1 giorno', '3 giorni', '5 giorni', '7 giorni', '10 giorni', '14 giorni', '32 giorni', '60 giorni', '90 giorni', '120 giorni', 'Nessun limite'];
  moltiplicatori = ['x1', 'x2', 'x3', 'x4', 'x5', 'x10', 'x20', 'x30', 'x40', 'x50', 'x60', 'x100', 'x200', 'x500', 'x1000', 'Produzione Istantanea'];
  modalitaGioco = ['Tutti contro tutti', 'Capture the Flag', 'King of the Hill', 'Domination', 'Destruction'];

  constructor(
    private modalCtrl: ModalController,
    private http: HttpClient
  ) { }

  isRegionSelected(region: string) {
    return this.matchData.regioni.includes(region);
  }

  private regionKey(regions: string[]) {
    return regions
      .slice()
      .sort((left, right) => (this.regionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (this.regionOrder.get(right) ?? Number.MAX_SAFE_INTEGER))
      .join('|');
  }

  private isValidRegionSelection(regions: string[]) {
    const selectedRegions = [...new Set(regions.filter((region) => this.regionOrder.has(region)))];

    if (selectedRegions.length === 0) {
      return false;
    }

    if (selectedRegions.includes('World')) {
      return selectedRegions.length === 1;
    }

    return this.validRegionComboKeys.has(this.regionKey(selectedRegions));
  }

  canSelectRegion(region: string) {
    if (this.isRegionSelected(region)) {
      return true;
    }

    if (region === 'World') {
      return true;
    }

    return this.isValidRegionSelection([...this.matchData.regioni.filter((selectedRegion) => selectedRegion !== 'World'), region]);
  }

  toggleRegion(region: string) {
    if (region === 'World') {
      this.matchData.regioni = ['World'];
      return;
    }

    const currentRegions = this.matchData.regioni.filter((selectedRegion) => selectedRegion !== 'World');
    const regionIndex = currentRegions.indexOf(region);

    if (regionIndex >= 0) {
      if (currentRegions.length === 1) {
        return;
      }

      currentRegions.splice(regionIndex, 1);
      if (this.isValidRegionSelection(currentRegions)) {
        this.matchData.regioni = currentRegions;
      }
      return;
    }

    const nextRegions = [...currentRegions, region];
    if (this.isValidRegionSelection(nextRegions)) {
      this.matchData.regioni = nextRegions;
    }
  }

  get selectedRegionsLabel() {
    return this.matchData.regioni.join(' + ');
  }

  async confirmCreation() {
    console.log('Trasmissione ordini di battaglia...');

    try {
      const response: any = await firstValueFrom(
        this.http.post('/api/match/create', this.matchData, {
          withCredentials: true
        })
      );

      console.log('Risposta Cluster:', response);

      try {
        await firstValueFrom(
          this.http.get('/api/match/joinable', {
            withCredentials: true
          })
        );
        console.log('Partite joinabili aggiornate con successo.');
      } catch (joinableError) {
        console.error('Errore durante il fetch di /joinable:', joinableError);
      }

      this.modalCtrl.dismiss({
        created: true,
        matchId: response?.data?.matchId
      });
    } catch (error) {
      console.error('Errore durante la trasmissione:', error);

      const status = (error as { status?: number })?.status;
      if (status === 400) {
        this.modalCtrl.dismiss({
          created: false,
          errorMessage: this.duplicateMatchErrorMessage
        });
      }
    }



  }

  close() {
    this.modalCtrl.dismiss();
  }
}