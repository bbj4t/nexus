import { AppConfig } from '../types';
import { getFunctionUrl } from '../utils/supabaseUtils';
import { Modality } from '@google/genai'; // Keep Modality for enum if needed, or hardcode strings

// Helper to call the Edge Function
const callGeminiFunction = async (config: AppConfig, payload: any) => {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error("Supabase URL and Key are required for Gemini Service");
  }

  const endpoint = getFunctionUrl(config.supabaseUrl, 'gemini');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Edge Function failed (${response.status}): ${errText}`);
  }

  return await response.json();
};

export const GeminiService = {
  // Fast text response using Flash-Lite
  askFast: async (config: AppConfig, prompt: string) => {
    const data = await callGeminiFunction(config, {
      model: 'gemini-2.5-flash-lite-latest',
      prompt: prompt // Simple prompt support
    });
    return data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  },

  // Grounded search using Flash + Google Search Tool
  askWithSearch: async (config: AppConfig, prompt: string) => {
    const data = await callGeminiFunction(config, {
      model: 'gemini-2.5-flash-latest',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    return { text, chunks };
  },

  // Transcribe audio using Flash
  transcribeAudio: async (config: AppConfig, audioBase64: string, mimeType: string) => {
    const data = await callGeminiFunction(config, {
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
    return data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  },

  // Text to Speech using Gemini
  generateSpeech: async (config: AppConfig, text: string, voiceName: string = 'Zephyr') => {
    const data = await callGeminiFunction(config, {
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'], // Hardcoded string to avoid import
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
      },
    });

    const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) throw new Error("No audio data returned from Edge Function");
    return audioData;
  },

  // Analyze Image or Video using Gemini 3 Pro
  analyzeMedia: async (config: AppConfig, base64Data: string, mimeType: string, prompt: string) => {
    const data = await callGeminiFunction(config, {
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
    return data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
};