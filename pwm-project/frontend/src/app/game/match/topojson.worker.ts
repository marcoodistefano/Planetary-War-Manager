/// <reference lib="webworker" />
import * as topojson from 'topojson-client';

addEventListener('message', ({ data }) => {
  const { topology, id } = data;
  const objectKey = Object.keys(topology.objects)[0];
  const geoData = (topojson as any).feature(topology, topology.objects[objectKey]);
  postMessage({ geoData, id });
});
