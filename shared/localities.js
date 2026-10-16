/**
 * Seed localities for Kochi with approximate centroid coordinates.
 * NOTE: Marked approximate, verify before commercial use.
 */
export const LOCALITIES = [
  { key: 'kakkanad', name: 'Kakkanad', cityKey: 'kochi', lat: 10.0159, lng: 76.3419 },
  { key: 'edappally', name: 'Edappally', cityKey: 'kochi', lat: 10.0243, lng: 76.3081 },
  { key: 'vyttila', name: 'Vyttila', cityKey: 'kochi', lat: 9.9676, lng: 76.3197 },
  { key: 'kaloor', name: 'Kaloor', cityKey: 'kochi', lat: 9.9939, lng: 76.2975 },
  { key: 'palarivattom', name: 'Palarivattom', cityKey: 'kochi', lat: 10.0033, lng: 76.3089 },
  { key: 'fort_kochi', name: 'Fort Kochi', cityKey: 'kochi', lat: 9.9658, lng: 76.2421 },
  { key: 'aluva', name: 'Aluva', cityKey: 'kochi', lat: 10.1076, lng: 76.3516 },
  { key: 'tripunithura', name: 'Tripunithura', cityKey: 'kochi', lat: 9.95, lng: 76.345 },
  { key: 'maradu', name: 'Maradu', cityKey: 'kochi', lat: 9.9328, lng: 76.3267 },
  { key: 'thevara', name: 'Thevara', cityKey: 'kochi', lat: 9.9333, lng: 76.2981 }
];

export const CITIES = [
  { key: 'kochi', name: 'Kochi', state: 'Kerala' }
];

/**
 * Finds a locality by key.
 * @param {string} key 
 */
export function getLocalityByKey(key) {
  return LOCALITIES.find(l => l.key === key) || null;
}
