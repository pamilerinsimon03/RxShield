import React, { useEffect, useRef, useState } from 'react';
import { useCameraHardware } from './useCameraHardware';
import { captureAndCropFrame, binarizeImageData } from './cameraUtils';
import { useWorkflowState } from '@/context/WorkflowStateContext';
import { Camera, RefreshCw, AlertTriangle } from 'lucide-react';

export const CameraViewfinder: React.FC = () => {
  const { stream, error, startStream, stopStream } = useCameraHardware();
  const { state, runInference, resetWorkflow } = useWorkflowState();
  const [isCaptured, setIsCaptured] = useState<boolean>(false);
  const [binarizedCrop, setBinarizedCrop] = useState<ImageData | null>(null);

  const [scanMode, setScanMode] = useState<'line' | 'block'>('line');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    startStream();
    return () => {
      stopStream();
    };
  }, [startStream, stopStream]);

  useEffect(() => {
    if (videoRef.current && stream && !isCaptured) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isCaptured]);

  // If workflow is reset externally (e.g. from header Reset), restart the camera stream
  useEffect(() => {
    if (state.phase === 'IDLE' && isCaptured) {
      setIsCaptured(false);
      setBinarizedCrop(null);
      startStream();
    }
  }, [state.phase, isCaptured, startStream]);

  // Draw binarized crop to preview canvas once it mounts in the DOM
  useEffect(() => {
    if (binarizedCrop && previewCanvasRef.current) {
      const canvas = previewCanvasRef.current;
      canvas.width = binarizedCrop.width;
      canvas.height = binarizedCrop.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(binarizedCrop, 0, 0);
      }
    }
  }, [binarizedCrop]);

  const handleCapture = () => {
    if (!videoRef.current || !hiddenCanvasRef.current) return;

    // 1. Capture and crop center text strip/block depending on scanMode
    const cropRatioY = scanMode === 'line' ? 0.40 : 0.25;
    const cropRatioH = scanMode === 'line' ? 0.20 : 0.50;
    const rawCrop = captureAndCropFrame(videoRef.current, hiddenCanvasRef.current, cropRatioY, cropRatioH);
    if (!rawCrop) return;

    // 2. Stop camera stream immediately (Static Capture Economy)
    stopStream();
    setIsCaptured(true);

    // 3. Clone the raw pixel buffer for the background worker track
    const rawDataForWorker = new Uint8ClampedArray(rawCrop.data);

    // 4. Apply high-speed static threshold binarization for UI preview only (prevents UI freeze)
    const binarized = binarizeImageData(rawCrop, 128);
    setBinarizedCrop(binarized);

    // 5. Send raw pixel buffer to hybrid OCR parser
    runInference(rawDataForWorker, binarized.width, binarized.height, scanMode);
  };

  const handleRetake = () => {
    setIsCaptured(false);
    setBinarizedCrop(null);
    resetWorkflow();
    startStream();
  };

  return (
    <div className="flex-1 flex flex-col justify-between overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2 shrink-0">
        <span className="text-xs font-bold text-slate-900 uppercase flex items-center gap-1.5">
          <Camera className="w-4 h-4 text-blue-600" />
          On-Device Document Capture
        </span>
        
        {/* Scan Mode Toggle */}
        <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200">
          <button
            onClick={() => setScanMode('line')}
            disabled={isCaptured}
            className={`px-2 py-0.5 text-[10px] font-bold rounded-sm transition-all ${
              scanMode === 'line'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 disabled:opacity-50'
            }`}
          >
            Line Scan
          </button>
          <button
            onClick={() => setScanMode('block')}
            disabled={isCaptured}
            className={`px-2 py-0.5 text-[10px] font-bold rounded-sm transition-all ${
              scanMode === 'block'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 disabled:opacity-50'
            }`}
          >
            Block Scan
          </button>
        </div>

        <span className="text-[10px] font-mono text-slate-600 hidden sm:inline">
          WASM BINARIZER ACTIVE
        </span>
      </div>

      {/* Viewport Box */}
      <div className="flex-1 bg-slate-950 relative flex items-center justify-center overflow-hidden min-h-[140px] rounded-none border border-slate-800">
        {error ? (
          // Error Panel
          <div className="p-4 flex flex-col items-center justify-center text-center text-rose-500">
            <AlertTriangle className="w-8 h-8 mb-2" />
            <span className="text-xs font-bold uppercase tracking-wider mb-1">Camera Initialization Fault</span>
            <p className="text-[11px] text-slate-400 max-w-[240px] leading-relaxed">{error}</p>
          </div>
        ) : !isCaptured ? (
          // Video Live Stream
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* SVG Alignment Bounding Box reticle */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              {/* Overlay with transparent center strip */}
              <div className="absolute inset-0 flex flex-col">
                <div 
                  style={{ flexGrow: scanMode === 'line' ? 4 : 2.5 }} 
                  className="bg-black/50 transition-all duration-300" 
                /> {/* Top dim */}
                <div 
                  style={{ height: scanMode === 'line' ? '20%' : '50%' }} 
                  className="flex shrink-0 transition-all duration-300 animate-fade-in"
                > {/* Middle Row */}
                  <div className="w-8 bg-black/50" /> {/* Left dim */}
                  <div className="flex-1 border-y-2 border-dashed border-red-500 bg-red-500/5 relative">
                    {/* Corner Reticles */}
                    <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-red-500" />
                    <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-red-500" />
                    <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-red-500" />
                    <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-red-500" />
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-bold text-red-500 tracking-wider uppercase drop-shadow-sm select-none px-2 text-center">
                      {scanMode === 'line' 
                        ? "Position Handwritten Line Here" 
                        : "Position Prescription Block Here"}
                    </span>
                  </div>
                  <div className="w-8 bg-black/50" /> {/* Right dim */}
                </div>
                <div 
                  style={{ flexGrow: scanMode === 'line' ? 4 : 2.5 }} 
                  className="bg-black/50 transition-all duration-300" 
                /> {/* Bottom dim */}
              </div>
            </div>
            
            <div className="absolute top-2 left-2 text-[9px] font-mono text-slate-400 bg-black/60 px-2 py-0.5 rounded-sm">
              STREAM: ACTIVE
            </div>
          </>
        ) : (
          // Static Binarized Preview
          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-slate-900">
            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase mb-2">Binarized Character Matrix</span>
            <div className="border border-slate-700 bg-white p-1 rounded-sm max-w-full overflow-x-auto shadow-md flex justify-center">
              <canvas ref={previewCanvasRef} className="max-h-24 w-auto object-contain bg-white" />
            </div>
            <span className="text-[9px] font-mono text-slate-500 mt-2">
              Dimensions: {previewCanvasRef.current?.width || 0}x{previewCanvasRef.current?.height || 0} | Gray-1bit
            </span>
          </div>
        )}

        {state.isProcessing && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] font-mono text-blue-300 uppercase tracking-widest">
              Extracting logit arrays...
            </span>
          </div>
        )}
      </div>

      {/* Control Buttons Bar */}
      <div className="mt-3 flex items-center justify-center shrink-0">
        {!isCaptured ? (
          <button
            onClick={handleCapture}
            disabled={!stream || state.isProcessing}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-300 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider rounded-md transition-colors flex items-center justify-center gap-1.5 focus:outline-none"
          >
            <Camera className="w-4 h-4" />
            Trigger Camera Shutter
          </button>
        ) : (
          <button
            onClick={handleRetake}
            disabled={state.isProcessing}
            className="w-full py-2 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-700 text-xs font-bold uppercase tracking-wider rounded-md transition-colors flex items-center justify-center gap-1.5 focus:outline-none"
          >
            <RefreshCw className="w-4 h-4" />
            Retake Snapshot
          </button>
        )}
      </div>

      {/* Hidden processing canvas */}
      <canvas ref={hiddenCanvasRef} className="hidden" />
    </div>
  );
};
