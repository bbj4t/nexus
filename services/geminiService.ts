import { GoogleGenAI, Modality } from "@google/genai";

// Helper to get client with current key
const getClient = (apiKey: string) => new GoogleGenAI({ apiKey });

export const GeminiService = {
  // Fast text response using Flash-Lite
  askFast: async (apiKey: string, prompt: string) => {
    const ai = getClient(apiKey);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite-latest',
        contents: prompt,
      });
      return response.text;
    } catch (error) {
      console.error("Fast AI Error:", error);
      throw error;
    }
  },

  // Grounded search using Flash + Google Search Tool
  askWithSearch: async (apiKey: string, prompt: string) => {
    const ai = getClient(apiKey);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-latest',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      
      const text = response.text || "No response generated.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      
      return { text, chunks };
    } catch (error) {
      console.error("Search AI Error:", error);
      throw error;
    }
  },

  // Transcribe audio using Flash
  transcribeAudio: async (apiKey: string, audioBase64: string, mimeType: string) => {
    const ai = getClient(apiKey);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-latest',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: audioBase64
              }
            },
            {
              text: "Transcribe this audio exactly as spoken. Return only the text."
            }
          ]
        }
      });
      return response.text;
    } catch (error) {
      console.error("Transcription Error:", error);
      throw error;
    }
  },

  // Text to Speech using Gemini
  generateSpeech: async (apiKey: string, text: string, voiceName: string = 'Zephyr') => {
    const ai = getClient(apiKey);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName as any },
            },
          },
        },
      });
      
      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) throw new Error("No audio data returned");
      return audioData;
    } catch (error) {
      console.error("TTS Error:", error);
      throw error;
    }
  },

  // Analyze Image or Video using Gemini 3 Pro
  analyzeMedia: async (apiKey: string, base64Data: string, mimeType: string, prompt: string) => {
    const ai = getClient(apiKey);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: prompt || "Analyze this media in detail."
            }
          ]
        }
      });
      return response.text;
    } catch (error) {
      console.error("Media Analysis Error:", error);
      throw error;
    }
  }
};