import { createWorker } from "tesseract.js";
import type { Worker } from "tesseract.js";
import type { OcrWord } from "./ocrCache";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("spa+eng").catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function recognizePage(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const pageWidth = canvas.width;
  const pageHeight = canvas.height;
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          if (!word.text.trim()) continue;
          words.push({
            text: word.text,
            x: word.bbox.x0 / pageWidth,
            y: word.bbox.y0 / pageHeight,
            width: (word.bbox.x1 - word.bbox.x0) / pageWidth,
            height: (word.bbox.y1 - word.bbox.y0) / pageHeight,
          });
        }
      }
    }
  }
  return words;
}
