/**
 * Compact US area-code → approximate metro centroid map, so a bare 3-digit
 * input geocodes to a place (PLAN.md §6.3). Not exhaustive — covers Cole's DFW
 * codes plus major metros; unknown codes fall through to text geocoding.
 */
export interface AreaPoint { lat: number; lng: number; label: string; }

export const AREA_CODES: Record<string, AreaPoint> = {
  // Dallas–Fort Worth (Cole)
  '214': { lat: 32.7767, lng: -96.7970, label: 'Dallas, TX' },
  '469': { lat: 32.7767, lng: -96.7970, label: 'Dallas, TX' },
  '972': { lat: 32.7767, lng: -96.7970, label: 'Dallas, TX' },
  '817': { lat: 32.7555, lng: -97.3308, label: 'Fort Worth, TX' },
  '682': { lat: 32.7555, lng: -97.3308, label: 'Fort Worth, TX' },
  '940': { lat: 33.2148, lng: -97.1331, label: 'Denton, TX' },
  '945': { lat: 32.7767, lng: -96.7970, label: 'Dallas, TX' },
  // Texas other
  '512': { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' },
  '737': { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' },
  '713': { lat: 29.7604, lng: -95.3698, label: 'Houston, TX' },
  '210': { lat: 29.4241, lng: -98.4936, label: 'San Antonio, TX' },
  // Major US metros
  '212': { lat: 40.7128, lng: -74.0060, label: 'New York, NY' },
  '646': { lat: 40.7128, lng: -74.0060, label: 'New York, NY' },
  '718': { lat: 40.6782, lng: -73.9442, label: 'Brooklyn, NY' },
  '415': { lat: 37.7749, lng: -122.4194, label: 'San Francisco, CA' },
  '650': { lat: 37.4419, lng: -122.1430, label: 'Palo Alto, CA' },
  '408': { lat: 37.3382, lng: -121.8863, label: 'San Jose, CA' },
  '510': { lat: 37.8044, lng: -122.2712, label: 'Oakland, CA' },
  '213': { lat: 34.0522, lng: -118.2437, label: 'Los Angeles, CA' },
  '310': { lat: 34.0195, lng: -118.4912, label: 'Santa Monica, CA' },
  '206': { lat: 47.6062, lng: -122.3321, label: 'Seattle, WA' },
  '503': { lat: 45.5152, lng: -122.6784, label: 'Portland, OR' },
  '303': { lat: 39.7392, lng: -104.9903, label: 'Denver, CO' },
  '312': { lat: 41.8781, lng: -87.6298, label: 'Chicago, IL' },
  '617': { lat: 42.3601, lng: -71.0589, label: 'Boston, MA' },
  '202': { lat: 38.9072, lng: -77.0369, label: 'Washington, DC' },
  '305': { lat: 25.7617, lng: -80.1918, label: 'Miami, FL' },
  '404': { lat: 33.7490, lng: -84.3880, label: 'Atlanta, GA' },
  '602': { lat: 33.4484, lng: -112.0740, label: 'Phoenix, AZ' },
  '615': { lat: 36.1627, lng: -86.7816, label: 'Nashville, TN' },
  '612': { lat: 44.9778, lng: -93.2650, label: 'Minneapolis, MN' },
  '801': { lat: 40.7608, lng: -111.8910, label: 'Salt Lake City, UT' },
  '702': { lat: 36.1699, lng: -115.1398, label: 'Las Vegas, NV' },
};

export function lookupAreaCode(code: string): AreaPoint | null {
  return AREA_CODES[code.trim()] ?? null;
}
