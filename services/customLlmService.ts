import { AppConfig } from '../types';
import { getFunctionUrl } from '../utils/supabaseUtils';

export const CustomLlmService = {
  /**
   * Sends a message to the custom-chat Edge Function, which proxies to the provider.
   */
  sendMessage: async (text: string, config: AppConfig): Promise<string> => {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error("Supabase URL and Key are required for Custom LLM Service");
    }

    const endpoint = getFunctionUrl(config.supabaseUrl, 'custom-chat');
    console.log(`[Custom LLM] Sending to Edge Function: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.customModelName || 'default',
          messages: [
            { role: 'system', content: config.systemInstruction },
            { role: 'user', content: text }
          ],
          config: {
            // Pass any extra config if needed, e.g. temperature
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge Function responded with ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "No response received.";
    } catch (e: any) {
      console.error("Custom LLM Error:", e);
      throw e;
    }
  }
};