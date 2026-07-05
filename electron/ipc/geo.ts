import { ipcMain } from 'electron';
import { geocodeText, geocodeJobs } from '../geo/geocode';

let geocoding = false;

export function registerGeoHandlers() {
  ipcMain.handle('geo:resolve', async (_e, query: string) => {
    try {
      const r = await geocodeText(query);
      return r ?? { error: 'Could not resolve that location.' };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('geo:geocodeJobs', async (_e, limit?: number) => {
    if (geocoding) return { error: 'Geocoding already in progress.' };
    geocoding = true;
    try { return await geocodeJobs(limit ?? 60); }
    catch (e: any) { return { error: e?.message ?? String(e) }; }
    finally { geocoding = false; }
  });
}
