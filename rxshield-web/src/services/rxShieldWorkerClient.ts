import { WorkerRequest, WorkerResponse } from './workerInterface';

export type WorkerCallback = (response: WorkerResponse<any>) => void;

export class RxShieldWorkerClient {
  private worker: Worker | null = null;
  private callback: WorkerCallback;

  constructor(callback: WorkerCallback) {
    this.callback = callback;
    this.initializeWorker();
  }

  private initializeWorker(): void {
    if (typeof window !== 'undefined') {
      try {
        this.worker = new Worker(
          new URL('../workers/inference.worker.js', import.meta.url)
        );
        
        this.worker.onmessage = (event: MessageEvent<WorkerResponse<any>>): void => {
          this.callback(event.data);
        };
        
        this.worker.onerror = (event: ErrorEvent): void => {
          this.callback({
            status: 'ERROR',
            step: 'COMPLETE',
            data: null,
            error: event.message || 'Worker runtime error'
          });
        };
      } catch (err) {
        this.callback({
          status: 'ERROR',
          step: 'COMPLETE',
          data: null,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }

  public send(request: WorkerRequest, transferables?: Transferable[]): void {
    if (!this.worker) {
      this.initializeWorker();
    }
    
    if (this.worker) {
      this.worker.postMessage(request, transferables || []);
    } else {
      this.callback({
        status: 'ERROR',
        step: 'COMPLETE',
        data: null,
        error: 'Web Worker is not initialized or supported in this environment.'
      });
    }
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
