import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MapAssetsService {
  private cache = new Map<string, Promise<string>>();
  private geoJsonCache = new Map<string, any>();

  getText(url: string): Promise<string> {
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }

    const fetchPromise = fetch(url, { cache: 'force-cache' }).then(res => {
      if (!res.ok) {
        throw new Error(`Failed to fetch map asset: ${res.statusText}`);
      }
      return res.text();
    }).catch(err => {
      this.cache.delete(url); // Remove from cache on failure
      throw err;
    });

    this.cache.set(url, fetchPromise);
    return fetchPromise;
  }

  getGeoJson(key: string): any {
    return this.geoJsonCache.get(key);
  }

  setGeoJson(key: string, data: any): void {
    this.geoJsonCache.set(key, data);
  }

  clearGeoJsonCache(): void {
    this.geoJsonCache.clear();
  }
}
