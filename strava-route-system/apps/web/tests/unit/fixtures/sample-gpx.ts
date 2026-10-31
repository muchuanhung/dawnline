/** Small real-world GPX for parser/loader tests: a short ride along 忠孝東路, Taipei. */
const POINTS: [number, number][] = [
  [25.0464, 121.517],
  [25.0446, 121.5235],
  [25.042, 121.533],
  [25.0416, 121.5437],
  [25.0414, 121.551],
  [25.0412, 121.5577],
  [25.041, 121.565],
];

export function sampleGpx(): string {
  const pts = POINTS.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"><ele>10</ele></trkpt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="dawnline-test"><trk><name>測試路線</name><type>cycling</type><trkseg>${pts}</trkseg></trk></gpx>`;
}
