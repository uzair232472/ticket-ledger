import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { CameraOff, RefreshCw, SwitchCamera, Zap, ZapOff } from 'lucide-react';

/**
 * Live camera QR reader. Opens the rear camera as soon as it mounts and calls onDecode(text) for each new
 * code (the same code is ignored for 2.5 s so one pass held in front of the lens counts once). While
 * `paused`, frames are not read. Uses the browser's BarcodeDetector where available, jsQR otherwise.
 * Camera access needs HTTPS (or localhost).
 */
export default function QrCamera({ onDecode, paused = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const pausedRef = useRef(paused);
  const lastRef = useRef({ text: '', at: 0 });
  const [facing, setFacing] = useState('environment');
  const [error, setError] = useState(null); // { title, text }
  const [starting, setStarting] = useState(true);
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [attempt, setAttempt] = useState(0);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let detector = null;

    const stop = () => {
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const start = async () => {
      setStarting(true);
      setError(null);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError({
          title: 'Camera needs a secure connection',
          text: 'Open TicketLedger over https:// (or on localhost) to use the camera. You can still type the ticket code below.',
        });
        setStarting(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.() || {};
        setTorch({ supported: Boolean(caps.torch), on: false });
        if ('BarcodeDetector' in window) {
          try {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          } catch {
            detector = null;
          }
        }
        setStarting(false);
        loop();
      } catch (err) {
        const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
        const missing = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
        setError(
          denied
            ? { title: 'Camera access is blocked', text: 'Allow camera access for this site in the browser’s address bar or settings, then press Try again.' }
            : missing
              ? { title: 'No camera found', text: 'This device has no camera we can use. Type the ticket code below instead.' }
              : { title: 'The camera couldn’t start', text: 'Another app may be using it. Close it and press Try again.' },
        );
        setStarting(false);
      }
    };

    const emit = (text) => {
      const now = Date.now();
      if (!text || (text === lastRef.current.text && now - lastRef.current.at < 2500)) return;
      lastRef.current = { text, at: now };
      onDecode?.(text);
    };

    let busy = false;
    const loop = () => {
      raf = requestAnimationFrame(async () => {
        const video = videoRef.current;
        if (cancelled || !video) return;
        if (!pausedRef.current && !busy && video.readyState >= 2 && video.videoWidth) {
          busy = true;
          try {
            if (detector) {
              const codes = await detector.detect(video);
              if (codes[0]?.rawValue) emit(codes[0].rawValue);
            } else {
              const canvas = canvasRef.current;
              // Downscale for speed; QR passes stay readable at this size
              const scale = Math.min(1, 640 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code?.data) emit(code.data);
            }
          } catch {
            /* a frame that couldn't be read */
          } finally {
            busy = false;
          }
        }
        loop();
      });
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch.on }] });
      setTorch((t) => ({ ...t, on: !t.on }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  return (
    <div className="tl-qrcam">
      <video ref={videoRef} className="tl-qrcam-video" playsInline muted autoPlay aria-label="Camera view" />
      <canvas ref={canvasRef} hidden />
      {!error && (
        <div className="tl-qrcam-frame" aria-hidden="true">
          <span className="is-tl" /><span className="is-tr" /><span className="is-bl" /><span className="is-br" />
          {!paused && !starting && <i className="tl-qrcam-line" />}
        </div>
      )}
      {starting && !error && <p className="tl-qrcam-status" role="status"><RefreshCw className="w-5 h-5 tl-dash-spin" aria-hidden="true" /> Opening the camera…</p>}
      {error && (
        <div className="tl-qrcam-error" role="alert">
          <CameraOff className="w-10 h-10" aria-hidden="true" />
          <strong>{error.title}</strong>
          <p>{error.text}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again</button>
        </div>
      )}
      {!error && !starting && (
        <div className="tl-qrcam-tools">
          <button type="button" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} aria-label="Switch camera">
            <SwitchCamera className="w-5 h-5" aria-hidden="true" />
          </button>
          {torch.supported && (
            <button type="button" onClick={toggleTorch} aria-pressed={torch.on} aria-label={torch.on ? 'Turn the light off' : 'Turn the light on'}>
              {torch.on ? <ZapOff className="w-5 h-5" aria-hidden="true" /> : <Zap className="w-5 h-5" aria-hidden="true" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
