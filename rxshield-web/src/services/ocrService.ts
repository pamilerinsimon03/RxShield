import * as Comlink from 'comlink';
import type { VisionWorkerApi } from '@/workers/vision.worker';

export class OcrService {
  private worker: Worker | null = null;
  private api: Comlink.Remote<VisionWorkerApi> | null = null;

  constructor() {
    this.initializeWorker();
  }

  private initializeWorker(): void {
    if (typeof window !== 'undefined') {
      try {
        this.worker = new Worker(
          new URL('../workers/vision.worker.ts', import.meta.url),
          { type: 'module' }
        );
        this.api = Comlink.wrap<VisionWorkerApi>(this.worker);
      } catch (err) {
        console.error('Failed to spawn vision worker:', err);
      }
    }
  }

  public async init(): Promise<boolean> {
    if (!this.api) {
      this.initializeWorker();
    }
    if (this.api) {
      return this.api.initModel();
    }
    return false;
  }

  public async runOcr(
    rgbaBuffer: Uint8ClampedArray,
    width: number,
    height: number
  ): Promise<{ text: string; confidence: number }> {
    if (!this.api) {
      this.initializeWorker();
    }
    if (!this.api) {
      throw new Error('Vision worker is not initialized.');
    }
    // Use Comlink.transfer to avoid copying the buffer
    return this.api.runOcr(
      Comlink.transfer(rgbaBuffer, [rgbaBuffer.buffer]),
      width,
      height
    );
  }

  public async setDrugDb(
    allDrugNames: string[],
    drugToGenericMap: Record<string, string>,
    protocolGenerics: string[]
  ): Promise<void> {
    if (!this.api) {
      this.initializeWorker();
    }
    if (this.api) {
      await this.api.setDrugDb(allDrugNames, drugToGenericMap, protocolGenerics);
    }
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.api = null;
    }
  }
}
