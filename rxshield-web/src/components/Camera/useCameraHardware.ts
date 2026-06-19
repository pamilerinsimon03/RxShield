import { useState, useCallback, useRef, useEffect } from 'react';

export const useCameraHardware = () => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);

  const startStream = useCallback(async () => {
    setError(null);
    try {
      if (activeStreamRef.current) {
        return activeStreamRef.current;
      }

      if (!navigator.mediaDevices) {
        setError('Insecure Context: Camera access requires HTTPS or localhost. Please use USB Port Forwarding or configure secure origin flags on your mobile browser.');
        return null;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      activeStreamRef.current = mediaStream;
      return mediaStream;
    } catch (err) {
      console.error('Error accessing camera hardware:', err);
      let msg = 'Failed to access camera.';
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = 'Camera access denied. Please grant permissions in your browser.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg = 'No camera hardware found on this device.';
        } else {
          msg = err.message;
        }
      }
      setError(msg);
      return null;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      activeStreamRef.current = null;
    }
    setStream(null);
  }, []);

  useEffect(() => {
    return () => {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, []);

  return {
    stream,
    error,
    startStream,
    stopStream,
  };
};
