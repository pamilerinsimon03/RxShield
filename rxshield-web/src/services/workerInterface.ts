export type WorkerRequestType = 'RUN_INFERENCE' | 'QUERY_DATABASE' | 'RESET_PIPELINE';

export type WorkerPipelineStep = 'EXTRACTION' | 'VALIDATION' | 'COMPLETE';

export type WorkerResponseStatus = 'SUCCESS' | 'ERROR';

export interface WorkerRequestPayload {
  imageBuffer?: Uint8ClampedArray;
  width?: number;
  height?: number;
  queryString?: string;
  queryParams?: Array<string | number>;
  scenario?: 'SCENARIO_A' | 'SCENARIO_B' | 'SCENARIO_C';
}

export interface WorkerRequest {
  type: WorkerRequestType;
  payload: WorkerRequestPayload;
}

export interface WorkerResponse<T = unknown> {
  status: WorkerResponseStatus;
  step: WorkerPipelineStep;
  data: T;
  error?: string;
}
