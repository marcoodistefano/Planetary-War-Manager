import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserStateService {
  private avatarIdSubject = new BehaviorSubject<number>(1);
  avatarId$ = this.avatarIdSubject.asObservable();

  setAvatarId(id: number) {
    this.avatarIdSubject.next(id);
  }
}
