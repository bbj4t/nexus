export interface MemoryItem {
  id: string;
  content: string; // Combined key/value or raw text
  created_at: string;
}

export interface AppConfig {
  apiKey: string; // Gemini API Key
  modelName: string;
  supabaseUrl: string;
  supabaseKey: string; // Anon key is fine if interfacing via Edge Function
  voiceName: string;
  systemInstruction: string;
  vadThreshold: number;
  vadSilenceTimeout: number;
}

export enum AgentStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  THINKING = 'THINKING',
  ERROR = 'ERROR'
}

export interface Attachment {
  type: 'image' | 'video';
  url: string; // Data URL for display
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  attachment?: Attachment;
}