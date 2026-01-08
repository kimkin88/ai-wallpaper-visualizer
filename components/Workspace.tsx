
import React, { useRef, useEffect, useState } from 'react';
import { Point, CalibrationData, ToolMode } from '../types';

interface WorkspaceProps {
  image: string | null;
  mode: ToolMode;
  calibration: CalibrationData;
  wallMask: Point[];
  onCalibrationUpdate: (data: CalibrationData) => void;
  onMaskUpdate: (points: Point[]) => void;
}

const Workspace: React.FC<WorkspaceProps> = ({ 
  image, 
  mode, 
  calibration, 
  wallMask, 
  onCalibrationUpdate, 
  onMaskUpdate 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgObj, setImgObj] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (image) {
      const img = new Image();
      img.src = image;
      img.onload = () => {
        setImgObj(img);
        render();
      };
    }
  }, [image]);

  useEffect(() => {
    render();
  }, [imgObj, mode, calibration, wallMask]);

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imgObj) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxWidth = containerRef.current?.clientWidth || 800;
    const scale = maxWidth / imgObj.width;
    canvas.width = imgObj.width * scale;
    canvas.height = imgObj.height * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgObj, 0, 0, canvas.width, canvas.height);

    // Draw Calibration Line (Brass color)
    if (calibration.p1) {
      ctx.strokeStyle = '#967b4f'; 
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]); // Dashed line for a professional survey look
      ctx.beginPath();
      const p1 = calibration.p1;
      const p2 = calibration.p2 || calibration.p1;
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // Endpoints
      ctx.fillStyle = '#967b4f';
      ctx.beginPath();
      ctx.arc(p1.x * canvas.width, p1.y * canvas.height, 4, 0, Math.PI * 2);
      ctx.fill();
      if (calibration.p2) {
        ctx.beginPath();
        ctx.arc(p2.x * canvas.width, p2.y * canvas.height, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw Mask Polygon (Subtle Slate/Dark color)
    if (wallMask.length > 0) {
      ctx.fillStyle = 'rgba(26, 26, 26, 0.2)';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(wallMask[0].x * canvas.width, wallMask[0].y * canvas.height);
      wallMask.forEach((p, i) => {
        if (i > 0) ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
      });
      if (wallMask.length > 2) ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Points
      ctx.fillStyle = '#1a1a1a';
      wallMask.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current || !imgObj) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (mode === ToolMode.CALIBRATE) {
      if (!calibration.p1 || (calibration.p1 && calibration.p2)) {
        onCalibrationUpdate({ ...calibration, p1: { x, y }, p2: null });
      } else {
        onCalibrationUpdate({ ...calibration, p2: { x, y } });
      }
    } else if (mode === ToolMode.SELECT_WALL) {
      onMaskUpdate([...wallMask, { x, y }]);
    }
  };

  if (!image) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-[600px] border fromental-border bg-white">
        <div className="w-16 h-16 border fromental-border rounded-full flex items-center justify-center mb-6">
          <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-400">Awaiting architectural context</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden bg-white">
      <canvas 
        ref={canvasRef} 
        onMouseDown={handleMouseDown}
        className="block max-w-full h-auto mx-auto border fromental-border"
      />
      {mode !== ToolMode.IDLE && (
        <div className="absolute top-6 left-6 bg-black text-white px-5 py-2 text-[10px] font-bold uppercase tracking-widest shadow-2xl">
          {mode === ToolMode.CALIBRATE ? 'Active Calibration' : 'Wall Mapping'}
        </div>
      )}
    </div>
  );
};

export default Workspace;
