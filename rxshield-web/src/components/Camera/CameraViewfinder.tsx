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

    // Convert binarized ImageData to base64 Data URL to pass to context results view
    let binarizedDataUrl = '';
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = binarized.width;
      tempCanvas.height = binarized.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.putImageData(binarized, 0, 0);
        binarizedDataUrl = tempCanvas.toDataURL('image/png');
      }
    } catch (e) {
      console.warn('Failed to convert canvas to data URL for preview:', e);
    }

    // 5. Send raw pixel buffer to hybrid OCR parser with the binarized thumbnail URL
    runInference(rawDataForWorker, binarized.width, binarized.height, scanMode, binarizedDataUrl);
  };

  const handleRetake = () => {
    setIsCaptured(false);
    setBinarizedCrop(null);
    resetWorkflow();
    startStream();
  };

  return (
    <div className="flex-1 flex flex-col justify-between overflow-hidden">
      {/* Title & Toggle Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3 shrink-0">
        <span className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1.5 tracking-wider">
          <Camera className="w-4 h-4 text-trust-teal" />
          On-Device Document Capture
        </span>
        
        {/* Premium Segmented Slider Mode Switcher */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/50">
          <button
            onClick={() => setScanMode('line')}
            disabled={isCaptured}
            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all select-none focus:outline-none ${
              scanMode === 'line'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-200/20'
                : 'text-slate-500 hover:text-slate-700 disabled:opacity-50'
            }`}
          >
            Line Scan
          </button>
          <button
            onClick={() => setScanMode('block')}
            disabled={isCaptured}
            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all select-none focus:outline-none ${
              scanMode === 'block'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-200/20'
                : 'text-slate-500 hover:text-slate-700 disabled:opacity-50'
            }`}
          >
            Block Scan
          </button>
        </div>
      </div>

      {/* Viewport Box */}
      <div className="flex-1 bg-slate-950 relative flex items-center justify-center overflow-hidden min-h-[180px] rounded-xl border border-slate-800 shadow-inner">
        {error ? (
          // Error Panel
          <div className="p-5 flex flex-col items-center justify-center text-center text-alert-red animate-fade-in">
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
                  <div className="w-6 bg-black/50" /> {/* Left dim */}
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
                  <div className="w-6 bg-black/50" /> {/* Right dim */}
                </div>
                <div 
                  style={{ flexGrow: scanMode === 'line' ? 4 : 2.5 }} 
                  className="bg-black/50 transition-all duration-300" 
                /> {/* Bottom dim */}
              </div>
            </div>
            
            <div className="absolute top-3 left-3 text-[9px] font-mono text-slate-300 bg-black/60 px-2 py-0.5 rounded border border-white/10">
              STREAM: ACTIVE
            </div>

            {/* Floating Tactile Shutter Button */}
            <button
              onClick={handleCapture}
              disabled={!stream || state.isProcessing}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-trust-teal hover:bg-trust-teal-hover active:scale-95 text-white py-2.5 px-8 rounded-full shadow-lg shadow-trust-teal/30 transition-all flex items-center justify-center gap-1.5 focus:outline-none disabled:opacity-50 z-20 cursor-pointer border border-teal-500/20"
            >
              <Camera className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider pr-0.5">Capture</span>
            </button>
          </>
        ) : (
          // Static Binarized Preview
          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-slate-900 animate-fade-in">
            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase mb-2.5">Binarized Character Matrix</span>
            <div className="border border-slate-700 bg-white p-1 rounded shadow-md flex justify-center">
              <canvas ref={previewCanvasRef} className="max-h-24 w-auto object-contain bg-white" />
            </div>
            <span className="text-[9px] font-mono text-slate-500 mt-2">
              Dimensions: {previewCanvasRef.current?.width || 0}x{previewCanvasRef.current?.height || 0} | Gray-1bit
            </span>

            {/* Floating Tactile Retake Button */}
            <button
              onClick={handleRetake}
              disabled={state.isProcessing}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-800/90 hover:bg-slate-800 text-white py-2.5 px-8 rounded-full shadow-lg transition-all flex items-center justify-center gap-1.5 focus:outline-none disabled:opacity-50 z-20 cursor-pointer border border-slate-700/20"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Retake Scan</span>
            </button>
          </div>
        )}

        {state.isProcessing && (
          <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center gap-2.5 z-30">
            <div className="w-8 h-8 border-2 border-trust-teal border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono text-teal-300 uppercase tracking-widest animate-pulse">
              Extracting logit arrays...
            </span>
          </div>
        )}
      </div>

      {/* Hidden processing canvas */}
      <canvas ref={hiddenCanvasRef} className="hidden" />
    </div>
  );
};
