declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfResult { text: string; numpages: number; info: any; }
  function pdf(data: Buffer): Promise<PdfResult>;
  export = pdf;
}
declare module 'mammoth';
