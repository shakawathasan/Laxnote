/**
 * LexNote Document Import, PDF Reader & Free OCR Engine
 * Uses PDF.js for client-side PDF text extraction and Tesseract.js for free local OCR.
 * Enforces robust file type validation, size checks, and graceful error handling.
 */

const ALLOWED_MIME_TYPES = {
  'application/pdf': 'PDF Document',
  'text/plain': 'Plain Text File',
  'text/markdown': 'Markdown File',
  'image/jpeg': 'JPEG Image',
  'image/jpg': 'JPEG Image',
  'image/png': 'PNG Image',
  'image/webp': 'WebP Image',
  'image/bmp': 'BMP Image'
};

const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md', '.jpeg', '.jpg', '.png', '.webp', '.bmp'];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * Validates file format and size
 */
export function validateUploadedFile(file) {
  if (!file) {
    throw new Error('No file selected.');
  }

  const name = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some(ext => name.endsWith(ext));
  const hasValidMime = ALLOWED_MIME_TYPES[file.type] || hasValidExt;

  if (!hasValidExt && !hasValidMime) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : 'unknown';
    throw new Error(
      `Unsupported file type "${ext}". LexNote accepts PDF files (.pdf), plain text (.txt, .md), and document photos (.jpg, .png, .webp).`
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Please select a file under 25 MB.`);
  }

  return true;
}

/**
 * Extract text from an uploaded file (PDF, TXT, or Image OCR)
 */
export async function extractTextFromFile(file, onProgress = () => {}) {
  validateUploadedFile(file);

  const name = file.name.toLowerCase();

  // 1. Text or Markdown files
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    onProgress({ status: 'reading', progress: 50, message: 'Reading text file...' });
    const text = await file.text();
    onProgress({ status: 'complete', progress: 100, message: 'Text loaded successfully' });
    return {
      fileName: file.name,
      fileType: 'txt',
      pageCount: 1,
      text: text.trim(),
      pages: [{ pageNumber: 1, text: text.trim() }]
    };
  }

  // 2. PDF Document via PDF.js
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdfText(file, onProgress);
  }

  // 3. Image OCR via Tesseract.js
  if (file.type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].some(ext => name.endsWith(ext))) {
    return extractImageOcr(file, onProgress);
  }

  throw new Error('Unsupported format for text extraction.');
}

/**
 * Extract PDF text page-by-page using PDF.js
 */
async function extractPdfText(file, onProgress) {
  if (!window.pdfjsLib) {
    throw new Error('PDF.js reader engine is still initializing. Please wait a moment and try again.');
  }

  onProgress({ status: 'loading', progress: 10, message: 'Loading PDF document...' });

  const arrayBuffer = await file.arrayBuffer();

  try {
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

    const pages = [];
    const fullTextChunks = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      onProgress({
        status: 'extracting',
        progress: Math.floor(10 + (pageNum / numPages) * 85),
        message: `Extracting page ${pageNum} of ${numPages}...`
      });

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      pages.push({
        pageNumber: pageNum,
        text: pageText
      });

      fullTextChunks.push(`--- [Page ${pageNum}] ---\n${pageText}`);
    }

    const combinedText = fullTextChunks.join('\n\n');

    onProgress({ status: 'complete', progress: 100, message: `Extracted ${numPages} pages successfully.` });

    return {
      fileName: file.name,
      fileType: 'pdf',
      pageCount: numPages,
      text: combinedText,
      pages
    };
  } catch (err) {
    console.error('PDF extraction failed:', err);
    if (err.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Please provide an unencrypted PDF.');
    }
    throw new Error(`Could not parse PDF document: ${err.message || 'File may be corrupted or unreadable'}`);
  }
}

/**
 * Perform free OCR on images using Tesseract.js
 */
async function extractImageOcr(file, onProgress) {
  if (!window.Tesseract) {
    throw new Error('Tesseract OCR engine is not ready. Please verify your connection or refresh the page.');
  }

  onProgress({ status: 'initializing', progress: 15, message: 'Initializing OCR worker for Bengali & English...' });

  try {
    // Recognize with English + Bengali models
    const worker = await window.Tesseract.createWorker(['eng', 'ben'], 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.floor(20 + (m.progress || 0) * 75);
          onProgress({ status: 'recognizing', progress: pct, message: `Recognizing legal text (${pct}%)...` });
        }
      }
    });

    const imageUrl = URL.createObjectURL(file);
    const result = await worker.recognize(imageUrl);
    await worker.terminate();
    URL.revokeObjectURL(imageUrl);

    const extractedText = (result.data && result.data.text) ? result.data.text.trim() : '';

    if (!extractedText) {
      throw new Error('OCR completed, but no readable text could be recognized. Ensure the scan is clear, oriented correctly, and well lit.');
    }

    onProgress({ status: 'complete', progress: 100, message: 'OCR completed successfully.' });

    return {
      fileName: file.name,
      fileType: 'image-ocr',
      pageCount: 1,
      confidence: result.data.confidence,
      text: extractedText,
      pages: [{ pageNumber: 1, text: extractedText }]
    };
  } catch (err) {
    console.error('OCR processing error:', err);
    throw new Error(`OCR processing failed: ${err.message || 'Unable to recognize image characters.'}`);
  }
}
