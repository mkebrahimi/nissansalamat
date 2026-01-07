
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResponse } from "./types";

const SYSTEM_INSTRUCTION = `
تو یک دستیار هوشمند تغذیه و سلامت هستی. وظیفه تو مدیریت دیتابیس کالری و محاسبه نیاز روزانه کاربر است.

قوانین تشخیص:
1. اگر کاربر مشخصات فیزیکی داد (سن، قد، وزن، جنسیت، فعالیت) **و یا** هدف وزنی (وزن هدف، مقدار کاهش وزن در ماه):
   - action_type را برابر "PROFILE_SETUP" قرار بده.
   - مشخصات را استخراج کن.
   - محاسبه TDEE (نیاز روزانه برای ثابت ماندن):
     * فرمول Mifflin-St Jeor:
     * مردان: (10 × وزن) + (6.25 × قد) - (5 × سن) + 5
     * زنان: (10 × وزن) + (6.25 × قد) - (5 × سن) - 161
     * ضریب فعالیت: بدون تحرک (1.2)، کم (1.375)، متوسط (1.55)، زیاد (1.725).
   - محاسبه کسری کالری برای کاهش وزن:
     * هر 1 کیلوگرم چربی بدن ≈ 7700 کالری.
     * اگر کاربر گفت "میخواهم ماهی X کیلو کم کنم": (X * 7700) / 30 = کسری روزانه.
     * هدف نهایی (calculated_goal) = TDEE - کسری روزانه.
     * نکته: اگر هدف نهایی کمتر از 1200 شد، همان 1200 را برگردان (جهت ایمنی).

2. اگر کاربر نام غذا داد:
   - action_type را برابر "FOOD_ENTRY" قرار بده.
   - اگر کاربر مقدار غذا را نگفت (مثلا فقط گفت "برنج و کباب")، یک مقدار متوسط استاندارد (مثلا ۱۰ قاشق یا ۳۰۰ گرم) را **تخمین بزن** و در فیلدها پر کن.
   - **بسیار مهم**: کالری و درشت‌مغذی‌ها باید بر اساس مقدار تخمینی محاسبه شوند.

3. در فیلد advice:
   - اگر مقدار غذا توسط کاربر گفته نشده بود، بنویس: "من مقدار [نام غذا] را [مقدار تخمینی] در نظر گرفتم. لطفاً قبل از تایید، وزن دقیق را چک کن."
   - یک توصیه کوتاه سلامتی هم اضافه کن.
`;

export const analyzeInput = async (userInput: string): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: userInput,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action_type: { type: Type.STRING },
            user_stats: {
              type: Type.OBJECT,
              properties: {
                age: { type: Type.NUMBER },
                gender: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                height: { type: Type.NUMBER },
                activity_level: { type: Type.STRING },
                target_weight: { type: Type.NUMBER, description: "وزن هدف کاربر" },
                weight_loss_per_month: { type: Type.NUMBER, description: "مقدار کاهش وزن مد نظر در ماه" }
              }
            },
            calculated_goal: { type: Type.NUMBER },
            food_items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  food_name: { type: Type.STRING },
                  amount_grams: { type: Type.NUMBER },
                  calories: { type: Type.NUMBER },
                  protein: { type: Type.NUMBER },
                  carbs: { type: Type.NUMBER },
                  fat: { type: Type.NUMBER }
                },
                required: ["food_name", "amount_grams", "calories"]
              }
            },
            advice: { type: Type.STRING }
          },
          required: ["action_type", "advice"]
        }
      }
    });

    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("Analysis Error:", error);
    throw error;
  }
};
