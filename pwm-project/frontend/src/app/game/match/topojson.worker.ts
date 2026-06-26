/// <reference lib="webworker" />
import * as topojson from 'topojson-client';

addEventListener('message', ({ data }) => {
  try {
    const topology = JSON.parse(data.topologyText);
    
    if (data.layerType === 'archs') {
      let allFeatures: any[] = [];
      const featureMap = new Map<string, any>();
      
      Object.keys(topology.objects).forEach(objKey => {
        const geoData: any = (topojson as any).feature(topology, topology.objects[objKey]);
        const features = geoData?.features || (geoData?.type === 'Feature' ? [geoData] : []);
        
        features.forEach((f: any) => {
          const id = f.properties?.id || f.id;
          if (id) {
            featureMap.set(id, f);
          } else {
            allFeatures.push(f);
          }
        });
      });
      
      allFeatures = allFeatures.concat(Array.from(featureMap.values()));
      const geoData = { type: 'FeatureCollection', features: allFeatures };
      postMessage({ geoData, id: data.id });
    } else {
      const objectName = Object.keys(topology.objects || {})[0];
      if (!objectName) {
        postMessage({ geoData: null, id: data.id });
        return;
      }
      const geoData = (topojson as any).feature(topology, topology.objects[objectName]);
      postMessage({ geoData, id: data.id });
    }
  } catch (error) {
    console.error('Worker error parsing TopoJSON:', error);
  }
});
