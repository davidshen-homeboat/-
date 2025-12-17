import { GoogleGenAI } from "@google/genai";
import { Reservation } from "../types";

const SYSTEM_INSTRUCTION = `
You are a restaurant reservation manager assistant.
Your goal is to analyze upcoming reservations and provide operational insights.
Focus on:
1. Identifying peak hours and potential seating conflicts.
2. Summarizing total guest counts for the upcoming days.
3. Suggesting table arrangements or staffing needs based on "Type" (內用 vs 包場) and "Pax".
4. Highlighting any special notes (e.g. birthdays, allergies) found in the notes field.

Keep the response concise, helpful, and in Traditional Chinese (zh-TW).
`;

export const analyzeBakeryData = async (
  reservations: Reservation[]
): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Sort and take upcoming reservations only
    const today = new Date().toISOString().split('T')[0];
    const upcoming = reservations
        .filter(r => r.date >= today)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 30); // Analyze next 30 reservations max

    const dataContext = JSON.stringify({
      upcomingReservations: upcoming
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `請分析以下未來的訂位資料並給出外場準備建議:\n\n${dataContext}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.3, 
      }
    });

    return response.text || "無法生成分析報告，請稍後再試。";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "AI 分析服務目前暫時無法使用，請檢查 API Key 設定。";
  }
};
