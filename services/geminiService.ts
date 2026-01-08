
import { GoogleGenAI } from "@google/genai";
import { SwatchType } from "../types";

export async function renderWallpaper(
  roomBase64: string,
  swatchBase64: string,
  calibrationInfo: string,
  maskPrompt: string,
  swatchType: SwatchType,
  panoramaSpecs?: { rollWidthCm: number; totalRolls: number; designHeightCm: number }
): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });

  let instructions = "";
  if (swatchType === SwatchType.INDIVIDUAL) {
    instructions = `
      1. SEAMLESS TILING: The swatch represents exactly 1m x 1m. You MUST tile it repeatedly across the wall. Do NOT stretch the image.
    `;
  } else {
    instructions = `
      1. PANORAMA MURAL MAPPING: The provided swatch is a complete mural consisting of ${panoramaSpecs?.totalRolls} rolls.
      2. DIMENSIONS: Each roll is ${panoramaSpecs?.rollWidthCm}cm wide. The design height is ${panoramaSpecs?.designHeightCm}cm.
      3. PLACEMENT: Do NOT tile this image like a small sample. Instead, map the mural across the wall, scaling it so the height of the mural matches the height of the wall (accounting for the ${panoramaSpecs?.designHeightCm}cm reference).
    `;
  }

  const prompt = `
    You are a professional architectural visualizer specializing in high-end bespoke wallpaper. 
    TASK: Apply the provided wallpaper image onto the designated walls in the room photo.
    
    CONSTRAINTS:
    ${instructions}
    4. PERSPECTIVE: Align the pattern to the perspective and depth of the walls. Ensure linear perspective foreshortening is physically accurate.
    5. SCALE: ${calibrationInfo}. Use this to ensure the pattern/mural is rendered at the correct physical scale.
    6. OCCLUSION: Preserve all foreground objects (furniture, plants, lamps, persons). The wallpaper should only appear on the surfaces of the wall "behind" these objects.
    7. LIGHTING: Blend the wallpaper with the existing room lighting, including shadows and highlights.
    
    TARGET AREA: ${maskPrompt}
    
    Return the final high-fidelity composite image.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: roomBase64.split(',')[1],
              mimeType: 'image/png'
            }
          },
          {
            inlineData: {
              data: swatchBase64.split(',')[1],
              mimeType: 'image/png'
            }
          }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image data returned from AI.");
  } catch (error: any) {
    if (error?.message?.includes("Requested entity was not found")) {
      throw new Error("KEY_RESET_REQUIRED");
    }
    throw error;
  }
}
