import { AppConfig } from '../types';

export const CustomLlmService = {
  /**
   * Sends a message to an OpenAI-compatible endpoint (OpenRouter, Ollama, Local, etc.)
   */
  sendMessage: async (text: string, config: AppConfig): Promise<string> => {
    if (!config.customBaseUrl) {
      throw new Error("Custom Base URL is required");
    }

    // Normalize URL: remove trailing slash and ensure it targets the completions endpoint if not specified
    let baseUrl = config.customBaseUrl.trim();
    while (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    // Most OpenAI compatible servers use /v1/chat/completions
    // If the user provided "http://localhost:11434", we assume they mean the base.
    // If they provided "http://localhost:11434/v1", we append /chat/completions.
    // If they explicitly included /chat/completions, we leave it.
    let endpoint = baseUrl;
    if (!endpoint.endsWith('/chat/completions')) {
      endpoint = `${endpoint}/chat/completions`;
    }

    console.log(`[Custom LLM] Sending to ${endpoint} with model ${config.customModelName}`);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.customApiKey || 'dummy-key'}` // Some local servers need a dummy key
        },
        body: JSON.stringify({
          model: config.customModelName || 'default',
          messages: [
            { role: 'system', content: config.systemInstruction },
            { role: 'user', content: text }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Provider responded with ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "No response received.";
    } catch (e: any) {
      console.error("Custom LLM Error:", e);
      throw e;
    }
  }
};