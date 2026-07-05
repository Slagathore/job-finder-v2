import { BrowserWindow } from 'electron';
import * as fs from 'fs';

/**
 * Render an HTML file to PDF using Electron's native printToPDF (no Playwright
 * dependency). Loads the on-disk HTML in a hidden window so relative assets and
 * fonts resolve, then writes the PDF next to it.
 */
export async function htmlFileToPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: false } });
  try {
    await win.loadFile(htmlPath);
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { marginType: 'default' },
    });
    fs.writeFileSync(pdfPath, data);
  } finally {
    win.destroy();
  }
}
