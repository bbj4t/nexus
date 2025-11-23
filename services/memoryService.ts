import { MemoryItem, AppConfig } from '../types';

// Helper to sanitize and format the Edge Function URL
const getFunctionUrl = (baseUrl: string) => {
  if (!baseUrl) return '';
  let url = baseUrl.trim();
  
  // Remove trailing slashes
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  
  // Ensure protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  // If the user mistakenly pasted the full function path (detected by presence of /functions/v1)
  // we trust their input but ensure we point to the memory-tool.
  if (url.includes('/functions/v1')) {
     if (url.endsWith('/memory-tool')) return url;
     // If they just pasted .../functions/v1, append the tool name
     if (url.endsWith('/functions/v1')) return `${url}/memory-tool`;
     // Otherwise, they might have pasted a different function URL, try to replace or just return
     return url;
  }

  // Standard project URL case: https://project-ref.supabase.co
  return `${url}/functions/v1/memory-tool`;
};

export const MemoryService = {
  /**
   * Fetches the most recent memories via the Edge Function.
   */
  getRecent: async (config: AppConfig): Promise<MemoryItem[]> => {
    if (!config.supabaseUrl || !config.supabaseKey) return [];
    
    const endpoint = getFunctionUrl(config.supabaseUrl);
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'get_recent'
        })
      });
      
      if (!response.ok) {
        const errText = await response.text();
        console.warn(`Memory Fetch Warning (${response.status}):`, errText);
        throw new Error(`Server responded with ${response.status}`);
      }
      
      const data = await response.json();
      return data.memories || [];
    } catch (e) {
      console.debug("Memory Fetch skipped or failed:", e);
      return [];
    }
  },

  /**
   * Calls the Edge Function to vectorize and save the memory.
   */
  save: async (key: string, value: string, config: AppConfig): Promise<string> => {
    if (!config.supabaseUrl || !config.supabaseKey) return "Configuration missing. Please set Supabase URL and Key.";

    const endpoint = getFunctionUrl(config.supabaseUrl);
    console.log(`[Memory] Saving to: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'save',
          content: `[${key}]: ${value}` // Combine for context
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Memory] Save failed (${response.status}): ${errText}`);
        throw new Error(`Edge function failed: ${response.status}`);
      }
      return `Saved memory about ${key}.`;
    } catch (e: any) {
      console.error("Memory Save Error:", e);
      return `Failed to save memory: ${e.message || "Network error"}`;
    }
  },

  /**
   * Calls the Edge Function to vectorize the query and perform hybrid search.
   */
  query: async (queryTerm: string, config: AppConfig): Promise<string> => {
    if (!config.supabaseUrl || !config.supabaseKey) return "Configuration missing.";

    const endpoint = getFunctionUrl(config.supabaseUrl);
    console.log(`[Memory] Querying: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'query',
          query: queryTerm
        })
      });

      if (!response.ok) {
        throw new Error(`Query failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.documents || data.documents.length === 0) {
        return "No relevant memories found.";
      }
      
      return JSON.stringify(data.documents);
    } catch (e) {
      console.error("Memory Query Error", e);
      return "Failed to retrieve memories due to network error.";
    }
  }
};