import { MemoryItem, AppConfig } from '../types';

export const MemoryService = {
  /**
   * Fetches the most recent memories added to the DB for display in the UI.
   */
  getRecent: async (config: AppConfig): Promise<MemoryItem[]> => {
    if (!config.supabaseUrl || !config.supabaseKey) return [];
    
    try {
      // Direct DB query for the UI panel (read-only access via anon key)
      const response = await fetch(`${config.supabaseUrl}/rest/v1/memories?select=*&order=created_at.desc&limit=5`, {
        headers: {
          'apikey': config.supabaseKey,
          'Authorization': `Bearer ${config.supabaseKey}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch recent memories');
      return await response.json();
    } catch (e) {
      console.error("Memory Fetch Error", e);
      return [];
    }
  },

  /**
   * Calls the Edge Function to vectorize and save the memory.
   */
  save: async (key: string, value: string, config: AppConfig): Promise<string> => {
    if (!config.supabaseUrl || !config.supabaseKey) return "Configuration missing.";

    try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/memory-tool`, {
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

      if (!response.ok) throw new Error('Edge function failed');
      return `Saved memory about ${key}.`;
    } catch (e) {
      console.error("Memory Save Error", e);
      return "Failed to save memory due to network error.";
    }
  },

  /**
   * Calls the Edge Function to vectorize the query and perform hybrid search.
   */
  query: async (queryTerm: string, config: AppConfig): Promise<string> => {
    if (!config.supabaseUrl || !config.supabaseKey) return "Configuration missing.";

    try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/memory-tool`, {
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