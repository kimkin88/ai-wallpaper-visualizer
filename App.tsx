import React, { useState, useEffect, useMemo } from "react";
import {
  ToolMode,
  AppState,
  Point,
  CalibrationData,
  SwatchType,
} from "./types";
import Workspace from "./components/Workspace";
import { renderWallpaper } from "./services/geminiService";

async function hash(password: string) {
  const buf = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    roomImage: null,
    swatchImage: null,
    swatchType: SwatchType.INDIVIDUAL,
    panoramaSpecs: {
      rollWidthCm: 70,
      totalRolls: 7,
      designHeightCm: 325,
    },
    individualRollSpecs: {
      widthCm: 53,
      lengthM: 10,
    },
    calibration: { p1: null, p2: null, realWorldValueCm: 0 },
    wallMask: [],
    // Fix: Remove 'boolean =' which was causing a type/value confusion error in object initialization
    isRendering: false,
    renderedResult: null,
    errorMessage: null,
  });

  const [mode, setMode] = useState<ToolMode>(ToolMode.IDLE);
  const [hasApiKey, setHasApiKey] = useState(false);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const PASSWORD_HASH = process.env.PASSWORD_HASH;

  useEffect(() => {
    checkApiKey();
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem("auth_hash");
    if (stored && stored === PASSWORD_HASH) {
      setIsAuthenticated(true);
    }
  }, []);

  const checkApiKey = async () => {
    // @ts-ignore
    const hasKey = await window.aistudio?.hasSelectedApiKey();
    setHasApiKey(!!hasKey);
  };

  const handleOpenKeyDialog = async () => {
    // @ts-ignore
    await window.aistudio?.openSelectKey();
    setHasApiKey(true);
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "room" | "swatch"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setState((prev) => ({
        ...prev,
        [type === "room" ? "roomImage" : "swatchImage"]: base64,
        renderedResult: null,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleRender = async () => {
    if (!state.roomImage || !state.swatchImage) {
      alert("Please upload both a room photo and a wallpaper swatch.");
      return;
    }

    setState((prev) => ({ ...prev, isRendering: true, errorMessage: null }));

    try {
      const calibrationInfo = `The user indicated that the line drawn covers a real-world length of ${
        state.calibration.realWorldValueCm
      } cm. Use this to scale the ${
        state.swatchType === SwatchType.INDIVIDUAL
          ? "standard repeat pattern"
          : "mural"
      } correctly.`;
      const maskPrompt =
        state.wallMask.length > 0
          ? "The wallpaper must be applied strictly within the polygon guide provided by the user (rough guide). This might be a partial wall, for example stopping at a duo rail or skirting."
          : "Wallpaper the primary wall surface accurately.";

      const result = await renderWallpaper(
        state.roomImage,
        state.swatchImage,
        calibrationInfo,
        maskPrompt,
        state.swatchType,
        state.panoramaSpecs
      );

      setState((prev) => ({
        ...prev,
        renderedResult: result,
        isRendering: false,
      }));
    } catch (error: any) {
      if (error.message === "KEY_RESET_REQUIRED") {
        setHasApiKey(false);
        setState((prev) => ({
          ...prev,
          isRendering: false,
          errorMessage: "API Key reset required. Please select your key again.",
        }));
      } else {
        setState((prev) => ({
          ...prev,
          isRendering: false,
          errorMessage: error.message,
        }));
      }
    }
  };

  const pixelsPerCm = useMemo(() => {
    if (
      !state.calibration.p1 ||
      !state.calibration.p2 ||
      !state.calibration.realWorldValueCm
    )
      return null;
    const dx = state.calibration.p1.x - state.calibration.p2.x;
    const dy = state.calibration.p1.y - state.calibration.p2.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    return pixelDist / state.calibration.realWorldValueCm;
  }, [state.calibration]);

  const estimateProject = useMemo(() => {
    if (!pixelsPerCm || state.wallMask.length < 3) return null;

    let areaNormalized = 0;
    for (let i = 0; i < state.wallMask.length; i++) {
      const j = (i + 1) % state.wallMask.length;
      areaNormalized += state.wallMask[i].x * state.wallMask[j].y;
      areaNormalized -= state.wallMask[j].x * state.wallMask[i].y;
    }
    areaNormalized = Math.abs(areaNormalized) / 2;

    const dxCal = Math.abs(state.calibration.p1!.x - state.calibration.p2!.x);
    const dyCal = Math.abs(state.calibration.p1!.y - state.calibration.p2!.y);
    const distCalNormalized = Math.sqrt(dxCal * dxCal + dyCal * dyCal);
    const cmPerNormalizedUnit =
      state.calibration.realWorldValueCm / distCalNormalized;

    const areaCm2 =
      areaNormalized * (cmPerNormalizedUnit * cmPerNormalizedUnit);
    const areaM2 = areaCm2 / 10000;

    const minX = Math.min(...state.wallMask.map((p) => p.x));
    const maxX = Math.max(...state.wallMask.map((p) => p.x));
    const widthCm = (maxX - minX) * cmPerNormalizedUnit;

    const minY = Math.min(...state.wallMask.map((p) => p.y));
    const maxY = Math.max(...state.wallMask.map((p) => p.y));
    const heightCm = (maxY - minY) * cmPerNormalizedUnit;

    let requiredRolls = 0;
    if (state.swatchType === SwatchType.PANORAMA) {
      requiredRolls = Math.ceil(widthCm / state.panoramaSpecs.rollWidthCm);
    } else {
      const rollAreaM2 =
        (state.individualRollSpecs.widthCm / 100) *
        state.individualRollSpecs.lengthM;
      requiredRolls = Math.ceil((areaM2 * 1.1) / rollAreaM2);
    }

    return {
      area: areaM2.toFixed(2),
      width: widthCm.toFixed(1),
      height: heightCm.toFixed(1),
      rolls: requiredRolls,
    };
  }, [
    pixelsPerCm,
    state.wallMask,
    state.calibration,
    state.swatchType,
    state.panoramaSpecs,
    state.individualRollSpecs,
  ]);

  const setCalibrationPreset = (val: number) => {
    setState((prev) => ({
      ...prev,
      calibration: { ...prev.calibration, realWorldValueCm: val },
    }));
  };

  const authenticate = async () => {
    const inputHash = await hash(passwordInput);

    if (inputHash === PASSWORD_HASH) {
      sessionStorage.setItem("auth_hash", inputHash);
      setIsAuthenticated(true);
    } else {
      alert("Incorrect password.");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="border p-10 w-96 text-center">
          <h2 className="text-lg font-bold mb-6 tracking-widest">
            Enter Password
          </h2>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            className="border w-full p-3 mb-4 text-sm tracking-widest outline-none"
            placeholder="Password"
          />
          <button
            onClick={authenticate}
            className="w-full py-3 bg-black text-white text-xs uppercase tracking-widest"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col fromental-bg">
      {/* Centered Logo Header */}
      <header className="bg-white border-b fromental-border py-12 px-4 text-center">
        <h1 className="luxury-font text-5xl font-bold tracking-[0.4em] fromental-brass-text select-none">
          FROMENTAL
        </h1>
      </header>

      <div className="flex flex-col lg:flex-row flex-1">
        {/* Sidebar */}
        <aside className="w-full lg:w-[400px] bg-white border-b lg:border-r fromental-border p-10 flex flex-col gap-10 overflow-y-auto">
          {/* Auth Warning */}
          {!hasApiKey && (
            <div className="border fromental-border p-6 text-center">
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-4">
                API Access Required
              </p>
              <button
                onClick={handleOpenKeyDialog}
                className="w-full py-4 border fromental-border text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
              >
                Select API Key
              </button>
            </div>
          )}

          {/* Media Selection */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-6 text-slate-400">
              1. Media Configuration
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <input
                type="file"
                onChange={(e) => handleFileUpload(e, "room")}
                className="hidden"
                id="room-upload"
                accept="image/*"
              />
              <label
                htmlFor="room-upload"
                className={`flex items-center justify-between p-4 border cursor-pointer transition-all ${
                  state.roomImage
                    ? "border-[#967b4f]"
                    : "fromental-border hover:bg-slate-50"
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {state.roomImage ? "Room Image Loaded" : "Upload Room Photo"}
                </span>
                {state.roomImage && (
                  <div className="w-1.5 h-1.5 rounded-full fromental-brass" />
                )}
              </label>

              <input
                type="file"
                onChange={(e) => handleFileUpload(e, "swatch")}
                className="hidden"
                id="swatch-upload"
                accept="image/*"
              />
              <label
                htmlFor="swatch-upload"
                className={`flex items-center justify-between p-4 border cursor-pointer transition-all ${
                  state.swatchImage
                    ? "border-[#967b4f]"
                    : "fromental-border hover:bg-slate-50"
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {state.swatchImage
                    ? "Swatch Asset Loaded"
                    : "Upload Wallpaper"}
                </span>
                {state.swatchImage && (
                  <div className="w-1.5 h-1.5 rounded-full fromental-brass" />
                )}
              </label>
            </div>
          </section>

          {/* Product Selector */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-slate-400">
              2. Wallpaper Type
            </h3>
            <div className="flex border fromental-border p-1">
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    swatchType: SwatchType.INDIVIDUAL,
                  }))
                }
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
                  state.swatchType === SwatchType.INDIVIDUAL
                    ? "fromental-bg text-black"
                    : "text-slate-400 hover:text-black"
                }`}
              >
                Individual Roll
              </button>
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    swatchType: SwatchType.PANORAMA,
                  }))
                }
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
                  state.swatchType === SwatchType.PANORAMA
                    ? "fromental-bg text-black"
                    : "text-slate-400 hover:text-black"
                }`}
              >
                Panorama Mural
              </button>
            </div>

            <div className="mt-4 p-5 fromental-bg border fromental-border grid grid-cols-2 gap-4">
              {state.swatchType === SwatchType.PANORAMA ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">
                      Roll Width (cm)
                    </span>
                    <input
                      type="number"
                      value={state.panoramaSpecs.rollWidthCm}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          panoramaSpecs: {
                            ...prev.panoramaSpecs,
                            rollWidthCm: Number(e.target.value),
                          },
                        }))
                      }
                      className="bg-transparent text-xs font-bold py-1 border-b fromental-border outline-none focus:border-[#967b4f] transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">
                      Design Height (cm)
                    </span>
                    <input
                      type="number"
                      value={state.panoramaSpecs.designHeightCm}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          panoramaSpecs: {
                            ...prev.panoramaSpecs,
                            designHeightCm: Number(e.target.value),
                          },
                        }))
                      }
                      className="bg-transparent text-xs font-bold py-1 border-b fromental-border outline-none focus:border-[#967b4f] transition-colors"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">
                      Roll Width (cm)
                    </span>
                    <input
                      type="number"
                      value={state.individualRollSpecs.widthCm}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          individualRollSpecs: {
                            ...prev.individualRollSpecs,
                            widthCm: Number(e.target.value),
                          },
                        }))
                      }
                      className="bg-transparent text-xs font-bold py-1 border-b fromental-border outline-none focus:border-[#967b4f] transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">
                      Length (m)
                    </span>
                    <input
                      type="number"
                      value={state.individualRollSpecs.lengthM}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          individualRollSpecs: {
                            ...prev.individualRollSpecs,
                            lengthM: Number(e.target.value),
                          },
                        }))
                      }
                      className="bg-transparent text-xs font-bold py-1 border-b fromental-border outline-none focus:border-[#967b4f] transition-colors"
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Spatial Guides */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-slate-400">
              3. Spatial Precision
            </h3>
            <div className="space-y-4">
              <button
                onClick={() =>
                  setMode(
                    mode === ToolMode.CALIBRATE
                      ? ToolMode.IDLE
                      : ToolMode.CALIBRATE
                  )
                }
                className={`w-full py-4 text-[10px] font-bold uppercase tracking-widest border transition-all ${
                  mode === ToolMode.CALIBRATE
                    ? "border-[#967b4f] bg-slate-50"
                    : "fromental-border hover:bg-slate-50"
                }`}
              >
                {mode === ToolMode.CALIBRATE
                  ? "Stop Calibration"
                  : "Set Calibration Line"}
              </button>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setCalibrationPreset(29.7)}
                  className="text-[8px] py-2 border fromental-border text-slate-500 uppercase tracking-widest hover:border-black transition-all"
                >
                  A4 Paper
                </button>
                <button
                  onClick={() => setCalibrationPreset(210)}
                  className="text-[8px] py-2 border fromental-border text-slate-500 uppercase tracking-widest hover:border-black transition-all"
                >
                  Door Height
                </button>
                <button
                  onClick={() => setCalibrationPreset(80)}
                  className="text-[8px] py-2 border fromental-border text-slate-500 uppercase tracking-widest hover:border-black transition-all"
                >
                  Door Width
                </button>
              </div>

              <div className="flex items-center gap-3 border-b fromental-border pb-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">
                  Scale (cm):
                </span>
                <input
                  type="number"
                  value={state.calibration.realWorldValueCm || ""}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      calibration: {
                        ...prev.calibration,
                        realWorldValueCm: Number(e.target.value),
                      },
                    }))
                  }
                  className="flex-1 bg-transparent text-xs font-bold outline-none"
                  placeholder="Value"
                />
              </div>

              <button
                onClick={() =>
                  setMode(
                    mode === ToolMode.SELECT_WALL
                      ? ToolMode.IDLE
                      : ToolMode.SELECT_WALL
                  )
                }
                className={`w-full py-4 text-[10px] font-bold uppercase tracking-widest border transition-all ${
                  mode === ToolMode.SELECT_WALL
                    ? "border-[#967b4f] bg-slate-50"
                    : "fromental-border hover:bg-slate-50"
                }`}
              >
                {mode === ToolMode.SELECT_WALL
                  ? "Finish Selection"
                  : "Draw Wall Guide"}
              </button>
            </div>
          </section>

          {/* Estimate Card */}
          {estimateProject && (
            <section className="bg-slate-50 p-6 border fromental-border">
              <h4 className="text-[10px] font-bold uppercase tracking-widest mb-4">
                Project Summary
              </h4>
              <div className="space-y-4">
                <div className="flex justify-between items-baseline border-b fromental-border pb-2">
                  <span className="text-[9px] uppercase font-bold text-slate-400">
                    Total Area
                  </span>
                  <span className="text-sm font-light italic">
                    {estimateProject.area} m²
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b fromental-border pb-2">
                  <span className="text-[9px] uppercase font-bold text-slate-400">
                    Required
                  </span>
                  <span className="text-sm font-bold fromental-brass-text uppercase">
                    {estimateProject.rolls} Rolls
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 italic leading-relaxed">
                  Estimations include a 10% tolerance for standard rolls and
                  wall guides.
                </p>
              </div>
            </section>
          )}

          {/* Action Button */}
          <div className="mt-auto pt-6 border-t fromental-border">
            {state.errorMessage && (
              <div className="p-3 border border-red-200 text-red-500 text-[10px] font-bold uppercase tracking-widest mb-4">
                {state.errorMessage}
              </div>
            )}
            <button
              onClick={handleRender}
              disabled={
                state.isRendering ||
                !state.roomImage ||
                !state.swatchImage ||
                !hasApiKey
              }
              className="w-full py-5 fromental-brass text-white text-[12px] font-bold uppercase tracking-[0.2em] shadow-xl hover:opacity-90 disabled:bg-slate-300 transition-all flex items-center justify-center gap-4"
            >
              {state.isRendering ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "Apply Visualization"
              )}
            </button>
          </div>
        </aside>

        {/* Workspace Main */}
        <main className="flex-1 p-8 lg:p-16 flex flex-col items-center">
          <div className="w-full max-w-5xl">
            <div className="mb-10 flex items-center justify-between border-b fromental-border pb-6">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-[0.3em] text-slate-400">
                  Spatial Visualizer
                </span>
                <h2 className="luxury-font text-2xl mt-1">Studio Preview</h2>
              </div>
              {state.renderedResult && (
                <div className="flex gap-4">
                  <a
                    href={state.renderedResult}
                    download="Fromental-Visual.png"
                    className="text-[10px] font-bold uppercase tracking-widest border fromental-border px-6 py-3 hover:bg-white transition-all"
                  >
                    Download High-Res
                  </a>
                </div>
              )}
            </div>

            <div className="relative group bg-white p-2 shadow-2xl">
              {state.renderedResult ? (
                <div className="relative animate-in fade-in duration-1000">
                  <img
                    src={state.renderedResult}
                    alt="Visualization"
                    className="w-full h-auto block"
                  />
                  <button
                    onClick={() =>
                      setState((prev) => ({ ...prev, renderedResult: null }))
                    }
                    className="absolute top-6 right-6 bg-white/90 backdrop-blur px-6 py-3 text-[10px] font-bold uppercase tracking-widest border border-black/5 hover:bg-white transition-all"
                  >
                    Adjust Settings
                  </button>
                </div>
              ) : (
                <Workspace
                  image={state.roomImage}
                  mode={mode}
                  calibration={state.calibration}
                  wallMask={state.wallMask}
                  onCalibrationUpdate={(data) =>
                    setState((prev) => ({ ...prev, calibration: data }))
                  }
                  onMaskUpdate={(pts) =>
                    setState((prev) => ({ ...prev, wallMask: pts }))
                  }
                />
              )}
            </div>

            {/* Aesthetic Footer */}
            <div className="mt-12 text-center">
              <p className="text-[9px] uppercase tracking-[0.4em] text-slate-300">
                Hand-painted wallpaper & luxury wallcoverings
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
