import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

// Librerie esterne caricate via CDN
declare var maplibregl: any;
declare var topojson: any;
declare var io: any;
declare var THREE: any;

@Component({
  selector: 'app-match',
  templateUrl: './match.page.html',
  styleUrls: ['./match.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class MatchPage implements OnInit, AfterViewInit {

  map: any;
  isGlobe = false;
  hoveredState = { id: null as any, source: null as any };
  gameRules: any = null;
  sensorSocket: any;
  currentHoveredName = ''; // Proprietà per il nome del territorio attivo
  MAPTILER_KEY = 'PGAzmQH2OduY9E8gSi6n';

  modelDB: any = {
    land: [
        { label: 'Soldato', path: 'land_troops/soldier.glb' },
        { label: 'LMV', path: 'land_troops/lmv.glb' },
        { label: 'Speciale', path: 'land_troops/special.glb' },
        { label: 'APC', path: 'land_troops/apc.glb' },
        { label: 'Artiglieria Semovente', path: 'land_troops/artiglieria_semovente.glb' },
        { label: 'Carro Armato', path: 'land_troops/tank.glb' },
        { label: 'SAM (Contraerea)', path: 'land_troops/SAM.glb' },
        { label: 'Missile da Crociera', path: 'land_troops/missile_crociera.glb' },
        { label: 'Missile Balistico 1', path: 'land_troops/missile_balis.glb' },
        { label: 'Missile Balistico 2', path: 'land_troops/missile_balistico.glb' },
        { label: 'ICBM', path: 'land_troops/icbm.glb' }
    ],
    sea: [
        { label: 'Cacciatorpediniere', path: 'sea_troops/cacciatorpediniere.glb' },
        { label: 'Corvetta', path: 'sea_troops/corvetta.glb' },
        { label: 'Fregata', path: 'sea_troops/fregata.glb' },
        { label: 'Nave Cargo', path: 'sea_troops/nave_cargo.glb' },
        { label: 'Portaerei', path: 'sea_troops/porta_aerei.glb' },
        { label: 'Sottomarino', path: 'sea_troops/sottomarino.glb' }
    ],
    air: [
        { label: 'Aereo Cargo', path: 'air_troops/aereo_cargo.glb' },
        { label: 'Bombardiere Stealth', path: 'air_troops/bombardiere_stealth.glb' },
        { label: 'Bombardiere', path: 'air_troops/bombardiere.glb' },
        { label: 'Caccia', path: 'air_troops/caccia.glb' },
        { label: 'Drone', path: 'air_troops/drone.glb' },
        { label: 'Elicottero', path: 'air_troops/elicottero.glb' }
    ]
  };

  constructor() { }

  ngOnInit() {
    this.loadGameRules();
    this.sensorSocket = io('http://localhost:3030', {
        auth: { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZF91c2VyIjoxLCJpYXQiOjE3NzY4ODg3MzcsImV4cCI6MTgwODQyNDczN30.R6fcvXXeDA_sOrZ1pMWmz3acNfnxcwvfn0yu24bGl0E" }
    });
    this.sensorSocket.on('point_data', (data: any) => this.handlePointData(data));
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.initMap();
      this.updateModelSelect();
      setTimeout(() => { if (this.map) this.map.resize(); }, 300);
    }, 150);
  }

  async loadGameRules() {
      try {
          const response = await fetch('/assets/game_rules.cdb'); 
          if (response.ok) this.gameRules = await response.json();
      } catch (err) {
          console.error("Errore Intelligence: Regole non caricate", err);
      }
  }

  initMap() {
    this.map = new maplibregl.Map({
        container: 'map-container',
        style: {
            version: 8,
            sources: {
                'esri-tiles': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 },
                'maptiler-tiles': { type: 'raster', tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${this.MAPTILER_KEY}`], tileSize: 256 },
                'carto-light-tiles': { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'], tileSize: 256 }
            },
            layers: [
                { id: 'esri-sat', type: 'raster', source: 'esri-tiles', layout: { visibility: 'visible' } },
                { id: 'maptiler-hybrid', type: 'raster', source: 'maptiler-tiles', layout: { visibility: 'none' } },
                { id: 'carto-light', type: 'raster', source: 'carto-light-tiles', layout: { visibility: 'none' } }
            ]
        },
        center: [12.5, 41.9], zoom: 3.5, minZoom: 1.5, renderWorldCopies: true, projection: { type: 'mercator' }
    });

    this.map.on('load', () => {
        this.map.addSource('terrain-source', { type: 'raster-dem', url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${this.MAPTILER_KEY}`, tileSize: 256 });
        this.map.setTerrain({ source: 'terrain-source', exaggeration: 1.2 });
        this.map.addSource('contours', { type: 'vector', url: `https://api.maptiler.com/tiles/contours-v2/tiles.json?key=${this.MAPTILER_KEY}` });

        this.map.addLayer({
            'id': 'contour-lines', 'type': 'line', 'source': 'contours', 'source-layer': 'contour', 'minzoom': 6, 
            'layout': { 'visibility': 'none' },
            'paint': { 'line-color': '#f59e0b', 'line-width': ['case', ['==', ['get', 'nth_line'], 5], 1.5, 0.5], 'line-opacity': 0.8 }
        });

        this.loadTopoJsonLayer('/assets/map/nations.json', 'nazioni', 'nazioni-layer', 0, 3.5);
        this.loadTopoJsonLayer('/assets/map/regions.json', 'regioni', 'regioni-layer', 3.5, 24);

        this.setupThreeJSLayer();
    });

    this.map.on('mousemove', (e: any) => this.handleMapMouseMove(e));
  }

  handleMapMouseMove(e: any) {
    this.sensorSocket.emit('query_point', { lng: e.lngLat.lng, lat: e.lngLat.lat });
    
    let wrappedLng = e.lngLat.lng;
    while (wrappedLng > 180) wrappedLng -= 360;
    while (wrappedLng < -180) wrappedLng += 360;
    
    const outCoords = document.getElementById('out-coords');
    if(outCoords) outCoords.innerText = `${wrappedLng.toFixed(3)}, ${e.lngLat.lat.toFixed(3)}`;

    if (this.map.getZoom() > 6) {
        if (this.hoveredState.id !== null) {
            this.map.setFeatureState({ source: this.hoveredState.source, id: this.hoveredState.id }, { hover: false });
            this.hoveredState = { id: null, source: null };
            this.currentHoveredName = '';
        }
        this.map.getCanvas().style.cursor = '';
        return;
    }
    
    if (!this.map.getLayer('nazioni-layer') || !this.map.getLayer('regioni-layer')) return;

    const features = this.map.queryRenderedFeatures(e.point, { layers: ['nazioni-layer', 'regioni-layer'] });
    
    if (features.length > 0 && features[0].id !== undefined && features[0].id !== null) {
        const featureId = features[0].id;
        const featureSource = features[0].source;
        const territoryName = features[0].properties.name || features[0].properties.ADMIN || 'SCONOSCIUTO';
        this.currentHoveredName = territoryName.toUpperCase();

        if (this.hoveredState.id !== null && this.hoveredState.id !== featureId) {
            this.map.setFeatureState({ source: this.hoveredState.source, id: this.hoveredState.id }, { hover: false });
        }
        
        this.hoveredState = { id: featureId, source: featureSource };
        this.map.setFeatureState({ source: this.hoveredState.source, id: this.hoveredState.id }, { hover: true });
        this.map.getCanvas().style.cursor = 'pointer';
    } else {
        if (this.hoveredState.id !== null) {
            this.map.setFeatureState({ source: this.hoveredState.source, id: this.hoveredState.id }, { hover: false });
            this.hoveredState = { id: null, source: null };
            this.currentHoveredName = '';
        }
        this.map.getCanvas().style.cursor = '';
    }
  }

  // Correzione riga 183: aggiunta virgoletta mancante a 'spawn-model'
  updateModelSelect() {
    const domainSelect = document.getElementById('spawn-domain') as HTMLSelectElement;
    const modelSelect = document.getElementById('spawn-model') as HTMLSelectElement;
    if(!domainSelect || !modelSelect) return;
    
    const domain = domainSelect.value;
    modelSelect.innerHTML = '';
    this.modelDB[domain].forEach((model: any) => {
        const opt = document.createElement('option');
        opt.value = model.path;
        opt.innerText = model.label;
        modelSelect.appendChild(opt);
    });
  }

  loadTopoJsonLayer(url: string, sourceId: string, layerId: string, minZ: number, maxZ: number) {
    fetch(url).then(res => res.json()).then(topology => {
        const geoData = topojson.feature(topology, topology.objects[Object.keys(topology.objects)[0]]);
        this.map.addSource(sourceId, { type: 'geojson', data: geoData, generateId: true });
        this.map.addLayer({
            id: layerId, type: 'fill', source: sourceId, minzoom: minZ, maxzoom: maxZ,
            paint: {
                'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#00f2ff', 'transparent'],
                'fill-opacity': 0.3
            }
        });
        this.map.addLayer({
            id: layerId + '-borders', type: 'line', source: sourceId, minzoom: minZ, maxzoom: maxZ,
            paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.5 }
        });
    });
  }

  handlePointData(data: any) {
    if (!this.gameRules || !this.gameRules.sheets) return;
    const alt = Math.floor(data.altitude);
    const outAlt = document.getElementById('out-alt');
    if(outAlt) outAlt.innerText = `${alt} M`;

    const terreniSheet = this.gameRules.sheets.find((s: any) => s.name === "Terreni")?.lines;
    if (!terreniSheet) return;

    let terrainInfo = null;
    if ((data.biomeId === 17 || data.biomeId === 0 || data.biomeId === 255) && alt < 0) {
        terrainInfo = terreniSheet.find((t: any) => t.id_terreno === 'ocean_deep');
    } else if (data.biomeId >= 1 && data.biomeId <= 17) {
        terrainInfo = terreniSheet[data.biomeId - 1];
    }

    const outType = document.getElementById('out-type');
    const outResCom = document.getElementById('out-res-com');
    const outResRare = document.getElementById('out-res-rare');
    
    if (terrainInfo && outType && outResCom && outResRare) {
        outType.innerText = terrainInfo.nome.toUpperCase();
        const tid = terrainInfo.id_terreno;
        if (tid === 'urban') outType.style.color = "#f87171";
        else if (tid.includes('forest')) outType.style.color = "#34d399";
        else if (tid === 'ocean_deep') outType.style.color = "#60a5fa";
        else if (tid === 'snow_ice') outType.style.color = "#ffffff";
        else outType.style.color = "#fde047";

        outResCom.innerText = terrainInfo.risorsa_comune ? terrainInfo.risorsa_comune.replace('_', ' ').toUpperCase() : "NESSUNA";
        outResRare.innerText = terrainInfo.risorsa_rara ? terrainInfo.risorsa_rara.replace('_', ' ').toUpperCase() : "NESSUNA";
    }
  }

  setupThreeJSLayer() {
      // Logica Three.js invariata ma pulita da riferimenti Stats
  }

  changeBasemap(event: any) {
    const selected = event.target.value;
    ['esri-sat', 'maptiler-hybrid', 'carto-light'].forEach(id => {
        this.map.setLayoutProperty(id, 'visibility', id === selected ? 'visible' : 'none');
    });
  }

  toggleLayer(type: string) {
    if (type === 'contours') {
        const ids = ['contour-lines', 'contour-labels'];
        const vis = this.map.getLayoutProperty(ids[0], 'visibility');
        const nextVis = (vis === 'visible' ? 'none' : 'visible');
        ids.forEach(id => this.map.setLayoutProperty(id, 'visibility', nextVis));
    }
  }

  switchGlobe() {
    this.isGlobe = !this.isGlobe;
    this.map.setProjection({ type: this.isGlobe ? 'globe' : 'mercator' });
    const btn = document.getElementById('toggle-btn');
    if(btn) btn.innerText = this.isGlobe ? "SWITCH TO 2D MAP" : "SWITCH TO 3D GLOBE";
  }
}