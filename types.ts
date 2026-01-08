
export interface Point {
  x: number;
  y: number;
}

export interface CalibrationData {
  p1: Point | null;
  p2: Point | null;
  realWorldValueCm: number;
}

export enum SwatchType {
  INDIVIDUAL = 'INDIVIDUAL',
  PANORAMA = 'PANORAMA'
}

export interface AppState {
  roomImage: string | null;
  swatchImage: string | null;
  swatchType: SwatchType;
  panoramaSpecs: {
    rollWidthCm: number;
    totalRolls: number;
    designHeightCm: number;
  };
  individualRollSpecs: {
    widthCm: number;
    lengthM: number;
  };
  calibration: CalibrationData;
  wallMask: Point[];
  isRendering: boolean;
  renderedResult: string | null;
  errorMessage: string | null;
}

export enum ToolMode {
  IDLE = 'IDLE',
  CALIBRATE = 'CALIBRATE',
  SELECT_WALL = 'SELECT_WALL'
}
