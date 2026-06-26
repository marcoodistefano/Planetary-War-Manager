import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MapAssetsService {
  private cache = new Map<string, any>();

  async getText(url: string): Promise<string> {
    const hit = this.cache.get(url);
    if (hit) return hit;
    const res = await fetch(url, { cache: 'force-cache' });
    const data = await res.text();
    this.cache.set(url, data);
    return data;
  }
}
