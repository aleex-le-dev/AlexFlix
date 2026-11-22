import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { motion } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

const VIEW = 288;
const OUTPUT = 256;
const MAX_ZOOM = 4;

interface Box {
  x: number;
  y: number;
  zoom: number;
}

/** Recadrage carré façon Netflix : glisser pour déplacer, molette / pincement / curseur pour zoomer. */
export function ImageCropper({ file, onCancel, onConfirm }: Props) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<Box>({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const base = Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
      setImage(img);
      setBox({ x: (VIEW - img.naturalWidth * base) / 2, y: (VIEW - img.naturalHeight * base) / 2, zoom: 1 });
    };
    img.onerror = () => setError('Format d’image non pris en charge (utilisez JPG, PNG ou WebP).');
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const baseScale = image ? Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight) : 1;

  const clamp = useCallback(
    (next: Box): Box => {
      if (!image) return next;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom));
      const scale = baseScale * zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      return {
        zoom,
        x: Math.min(0, Math.max(VIEW - width, next.x)),
        y: Math.min(0, Math.max(VIEW - height, next.y))
      };
    },
    [image, baseScale]
  );

  const zoomTo = useCallback(
    (zoom: number, anchorX = VIEW / 2, anchorY = VIEW / 2) => {
      setBox((current) => {
        const target = Math.min(MAX_ZOOM, Math.max(1, zoom));
        const ratio = target / current.zoom;
        return clamp({ zoom: target, x: anchorX - (anchorX - current.x) * ratio, y: anchorY - (anchorY - current.y) * ratio });
      });
    },
    [clamp]
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: box.zoom };
      drag.current = null;
      return;
    }
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, originX: box.x, originY: box.y };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      zoomTo((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance);
      return;
    }
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    setBox((value) =>
      clamp({ ...value, x: current.originX + event.clientX - current.startX, y: current.originY + event.clientY - current.startY })
    );
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    zoomTo(box.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), event.clientX - rect.left, event.clientY - rect.top);
  };

  const confirm = (): void => {
    if (!image) return;
    const scale = baseScale * box.zoom;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('Traitement de l’image impossible.');
      return;
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, -box.x / scale, -box.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUTPUT, OUTPUT);
    onConfirm(canvas.toDataURL('image/jpeg', 0.88));
  };

  const scale = baseScale * box.zoom;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Recadrer l'image"
    >
      <div className="w-full max-w-sm rounded-lg bg-[#181818] p-6 shadow-2xl ring-1 ring-white/10">
        <h2 className="text-2xl font-medium text-white">Recadrer l’image</h2>
        <p className="mt-1 text-sm text-neutral-400">Glissez pour déplacer, zoomez avec la molette ou le curseur.</p>

        <div
          className="relative mx-auto mt-5 cursor-grab touch-none overflow-hidden rounded-md bg-black active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {image && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
              style={{
                width: image.naturalWidth * scale,
                height: image.naturalHeight * scale,
                transform: `translate(${box.x}px, ${box.y}px)`
              }}
            />
          )}
          <div className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-inset ring-white/70" />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button type="button" onClick={() => zoomTo(box.zoom / 1.2)} aria-label="Dézoomer" className="text-neutral-300 hover:text-white">
            <Minus className="h-5 w-5" />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={box.zoom}
            onChange={(event) => zoomTo(Number(event.target.value))}
            aria-label="Zoom"
            className="ap-range flex-1"
          />
          <button type="button" onClick={() => zoomTo(box.zoom * 1.2)} aria-label="Zoomer" className="text-neutral-300 hover:text-white">
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-[#e87c03]">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={confirm}
            disabled={!image}
            className="flex-1 bg-white py-2 text-sm font-semibold uppercase tracking-[0.15em] text-black transition hover:bg-ap-red hover:text-white disabled:opacity-50"
          >
            Valider
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border border-neutral-500 py-2 text-sm uppercase tracking-[0.15em] text-neutral-300 transition hover:border-white hover:text-white"
          >
            Annuler
          </button>
        </div>
      </div>
    </motion.div>
  );
}
