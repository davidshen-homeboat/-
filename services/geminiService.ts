
import { GoogleGenAI } from "@google/genai";
import { Reservation, DataType } from "../types";

const SYSTEM_INSTRUCTION = "You are a BakeryOS restaurant manager assistant. Respond in Traditional Chinese (zh-TW). Analyze upcoming reservations. Focus on peak hours, seating conflicts, and special customer notes. Keep it concise.";

export const analyzeBakeryData = async (
  type: DataType,
  data: Reservation[]
): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Simple filter to get recent/relevant data to avoid token limits
    const dataContext = JSON.stringify(data.slice(0, 40)); 

    // Use gemini-3-flash-preview for analysis task as it is the recommended model for basic text tasks.
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `請分析以下訂位資料並給出營運建議:\n\n${dataContext}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.3, 
      }
    });

    return response.text || "無法生成分析報告。";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "AI 分析服務目前暫時無法使用，請檢查 API Key 設定。";
  }
};
