import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createWorker } from 'tesseract.js';
import { firstValueFrom } from 'rxjs';
import { ModelInfo } from '@rawclaw/shared';

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);
  private readonly visionModelAllowlist = [
    'llama3.2-vision',
    'llava',
    'moondream',
    'bakllava',
    'llava-phi3',
  ];

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Extract text from a document or image.
   * All failures are contained - never throws.
   * Returns { text, method, error } so caller can handle gracefully.
   */
  async extractText(buffer: Buffer, mimeType: string): Promise<{
    text: string;
    method: string;
    error?: string;
  }> {
    try {
      if (mimeType === 'application/pdf') {
        const pdfResult = await this.extractFromPdf(buffer);

        // If PDF has extractable text, return it
        if (pdfResult.text.trim().length > 0) {
          return { text: pdfResult.text, method: 'local_pdf_text' };
        }

        // Empty PDF with no text - scanned PDF
        // NOTE: scanned PDF OCR requires PDF-to-image rasterization (not implemented)
        this.logger.log('PDF has no extractable text. Scanned PDF OCR is not implemented in this pass.');
        return {
          text: '',
          method: 'extraction_failed',
          error: 'Scanned PDF detected. This document appears to be an image saved as a PDF. Local OCR for scanned PDFs is not yet enabled — please provide a text-based PDF or an image (JPG/PNG).',
        };
      }

      // Image types only from here
      if (!mimeType.startsWith('image/')) {
        return {
          text: '',
          method: 'extraction_failed',
          error: `The file type "${mimeType}" is not supported for text extraction. Please use PDF, JPG, or PNG.`,
        };
      }

      // 1. Try Local Ollama Vision OCR (if a vision model is available)
      const visionModel = await this.findLocalVisionModel();
      if (visionModel) {
        const text = await this.extractWithOllamaVision(buffer, visionModel);
        if (text && text.trim().length > 0) {
          return { text, method: 'local_vision_ocr' };
        }
      }

      // 2. Fallback to Local Tesseract for actual images only
      const tesseractText = await this.extractWithTesseract(buffer);
      if (tesseractText && tesseractText.trim().length > 0) {
        return { text: tesseractText, method: 'local_tesseract_ocr' };
      }

      // 3. Cloud OCR - not implemented in this pass
      return {
        text: '',
        method: 'extraction_failed',
        error: 'OCR failed to extract readable text from this image. The image may be too low resolution or in an unsupported format.',
      };
    } catch (error: any) {
      this.logger.error(`Extraction threw unexpectedly: ${error?.message || error}`);
      return {
        text: '',
        method: 'extraction_failed',
        error: error?.message || 'Unknown extraction error',
      };
    }
  }

  private async findLocalVisionModel(): Promise<string | null> {
    const agentUrl = this.configService.get<string>('AGENT_PORT') ||
      this.configService.get<string>('agentUrl') ||
      'http://localhost:8001';
    try {
      const res = await firstValueFrom(
        this.httpService.get<{ models: ModelInfo[] }>(`${agentUrl}/api/models`, { timeout: 2000 })
      );

      const found = res.data.models?.find(m =>
        this.visionModelAllowlist.some(slug => m.id.toLowerCase().includes(slug))
      );

      return found ? found.id : null;
    } catch (e) {
      return null;
    }
  }

  private async extractWithOllamaVision(buffer: Buffer, modelId: string): Promise<string> {
    const agentUrl = this.configService.get<string>('AGENT_PORT') ||
      this.configService.get<string>('agentUrl') ||
      'http://localhost:8001';
    const base64Image = buffer.toString('base64');

    try {
      const prompt = 'Read the provided image and output ONLY the text found in it. Retain the layout structure where possible. Do not add any commentary or labels.';

      const res = await firstValueFrom(
        this.httpService.post<{ response: string }>(`${agentUrl}/api/generate`, {
          model: modelId,
          prompt,
          images: [base64Image],
          stream: false,
        }, { timeout: 30000 })
      );

      return res.data.response || '';
    } catch (e: any) {
      this.logger.warn(`Ollama Vision OCR failed: ${e?.message}`);
      return '';
    }
  }

  private async extractWithTesseract(buffer: Buffer): Promise<string> {
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      worker = await createWorker('eng');
      const { data: { text } } = await worker.recognize(buffer);
      return text || '';
    } catch (e: any) {
      this.logger.warn(`Tesseract OCR failed: ${e?.message || e}`);
      return '';
    } finally {
      if (worker) {
        try { await worker.terminate(); } catch { /* ignore */ }
      }
    }
  }

  private async extractFromPdf(buffer: Buffer): Promise<{ text: string; error?: string }> {
    try {
      const mod = await import('pdf-parse');
      // pdf-parse v2 uses a class-based API. 
      const PDFParseClass = mod.PDFParse || (mod.default as any)?.PDFParse;

      if (!PDFParseClass) {
        throw new Error('PDFParse class not found in pdf-parse module');
      }

      const parser = new PDFParseClass({ 
        data: new Uint8Array(buffer),
        verbosity: 0 
      });
      
      const data = await parser.getText();
      return { text: data.text || '' };
    } catch (e: any) {
      this.logger.warn(`PDF extraction failed: ${e?.message || e}`);
      return { text: '', error: e?.message };
    }
  }
}
