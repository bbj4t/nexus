import React, { useState, useEffect, useRef } from 'react';
import { useLiveAgent } from './hooks/useLiveAgent';
import { MemoryService } from './services/memoryService';
import { GeminiService } from './services/geminiService';
import { CustomLlmService } from './services/customLlmService';
import { AgentStatus, AppConfig, MemoryItem } from './types';
import { ConfigModal } from './components/ConfigModal';

const DEFAULT_CONFIG: AppConfig = {
  apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
  modelName: 'gemini-2.5-flash-native-audio-preview-09-2025',
  voiceName: 'Zephyr',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  systemInstruction: 'You are Nexus, a helpful AI assistant with persistent memory. You are concise, friendly, and efficient. When saving to memory, categorize the key accurately.',
  vadThreshold: 0.015,
  vadSilenceTimeout: 800,
  chatProvider: 'gemini',
  customBaseUrl: import.meta.env.VITE_CUSTOM_BASE_URL || '',
  customApiKey: import.meta.env.VITE_CUSTOM_API_KEY || '',
  customModelName: import.meta.env.VITE_CUSTOM_MODEL_NAME || ''
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(() => {
    const saved = localStorage.getItem('nexus_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge with default to ensure new fields exist, but prefer env vars if saved values are empty
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        apiKey: parsed.apiKey || DEFAULT_CONFIG.apiKey,
        supabaseUrl: parsed.supabaseUrl || DEFAULT_CONFIG.supabaseUrl,
        supabaseKey: parsed.supabaseKey || DEFAULT_CONFIG.supabaseKey,
        customBaseUrl: parsed.customBaseUrl || DEFAULT_CONFIG.customBaseUrl,
        customApiKey: parsed.customApiKey || DEFAULT_CONFIG.customApiKey,
        customModelName: parsed.customModelName || DEFAULT_CONFIG.customModelName
      };
    }
    return DEFAULT_CONFIG;
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshMemory = async () => {
    const recent = await MemoryService.getRecent(config);
    setMemories(recent);
  };

  useEffect(() => {
    if (config.supabaseUrl && config.supabaseKey) {
      refreshMemory();
    }
  }, [config.supabaseUrl, config.supabaseKey]);

  const handleConfigSave = (newConfig: AppConfig) => {
    setConfig(newConfig);
    localStorage.setItem('nexus_config', JSON.stringify(newConfig));
  };

  const {
    connect,
    disconnect,
    status,
    volume,
    isUserSpeaking,
    error,
    messages,
    setMessages,
    sendTextMessage
  } = useLiveAgent({
    config,
    onMemoryUpdate: refreshMemory
  });

  const isActive = status === AgentStatus.LISTENING || status === AgentStatus.SPEAKING || status === AgentStatus.THINKING;

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle Text Submission
  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText;
    setInputText('');

    if (isActive) {
      // Send to Live Session
      sendTextMessage(text);
    } else {
      // Send to Standard Chat (Gemini Flash Lite or Custom LLM)
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text, timestamp: Date.now() }]);

      try {
        let responseText = '';

        if (config.chatProvider === 'custom' && config.customBaseUrl) {
          // Use Custom LLM (OpenRouter / Local)
          responseText = await CustomLlmService.sendMessage(text, config);
        } else {
          // Fallback to Gemini Flash Lite
          if (!config.supabaseUrl || !config.supabaseKey) throw new Error("Supabase URL and Key required for Gemini fallback");
          responseText = await GeminiService.askFast(config, text);
        }

        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: responseText || "No response.",
          timestamp: Date.now()
        }]);

      } catch (err: any) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'system',
          text: `Error: ${err.message}`,
          timestamp: Date.now()
        }]);
      }
    }
  };

  // Handle File Upload (Image/Video)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Analysis ALWAYS uses Gemini 3 Pro (requires Google API Key)
    // Analysis uses Gemini 3 Pro via Edge Function
    if (!config.supabaseUrl || !config.supabaseKey) {
      alert("Supabase URL and Key are required for media analysis.");
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      alert("Only images and videos are supported.");
      return;
    }

    setIsAnalyzing(true);

    // Read file as base64
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Url = reader.result as string;
        const base64Data = base64Url.split(',')[1];

        // Add User Message with Attachment placeholder
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'user',
          text: `Analyzing ${isImage ? 'image' : 'video'}...`,
          timestamp: Date.now(),
          attachment: {
            type: isImage ? 'image' : 'video',
            url: base64Url,
            mimeType: file.type
          }
        }]);

        // Call Gemini 3 Pro
        const prompt = isImage ? "Analyze this image in detail." : "Analyze this video and describe what happens.";
        const analysis = await GeminiService.analyzeMedia(config, base64Data, file.type, prompt);

        // Add Model Response
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: analysis || "I couldn't analyze the media.",
          timestamp: Date.now()
        }]);

      } catch (err: any) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'system',
          text: `Analysis failed: ${err.message}`,
          timestamp: Date.now()
        }]);
      } finally {
        setIsAnalyzing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  // Visualizer calculations
  const visualizerSize = 100 + volume * 300;
  const visualizerColor = isUserSpeaking
    ? 'rgba(59, 130, 246, 0.6)'
    : status === AgentStatus.SPEAKING
      ? 'rgba(16, 185, 129, 0.6)'
      : 'rgba(255, 255, 255, 0.1)';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col items-center relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 to-slate-900 pointer-events-none" />

      {/* Header */}
      <header className="w-full max-w-5xl p-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
            <i className="fa-solid fa-bolt text-white text-sm"></i>
          </div>
          <h1 className="font-bold text-xl tracking-tight text-white">NEXUS <span className="text-slate-500 font-light">| Live VAD Agent</span></h1>
        </div>
        <button
          onClick={() => setIsConfigOpen(true)}
          className="p-2 rounded-full hover:bg-slate-800 transition-colors"
        >
          <i className="fa-solid fa-gear text-slate-400 hover:text-white"></i>
        </button>
      </header>

      {/* Main Area */}
      <main className="flex-1 flex flex-col items-center w-full max-w-3xl z-10 relative px-4 min-h-0">

        {/* Status Indicator */}
        <div className="font-mono text-xs uppercase tracking-widest text-slate-500 mb-4">
          {status}
        </div>

        {/* The Orb */}
        <div className="relative flex items-center justify-center w-48 h-48 mb-6 shrink-0">
          {/* Ripple Effect */}
          {isActive && (
            <div
              className="absolute rounded-full transition-all duration-75 ease-out border border-white/10"
              style={{
                width: `${Math.min(250, visualizerSize * 1.5)}px`,
                height: `${Math.min(250, visualizerSize * 1.5)}px`,
                opacity: volume * 2
              }}
            />
          )}

          {/* Core */}
          <button
            onClick={isActive ? disconnect : connect}
            className={`
              relative z-20 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500
              ${isActive ? 'bg-slate-800 shadow-[0_0_50px_rgba(59,130,246,0.3)]' : 'bg-slate-800 hover:bg-slate-700 shadow-xl'}
            `}
            style={{
              transform: isActive ? 'scale(1.1)' : 'scale(1)',
              boxShadow: isActive ? `0 0 ${30 + volume * 100}px ${visualizerColor}` : ''
            }}
          >
            {isActive ? (
              <i className={`fa-solid ${status === AgentStatus.SPEAKING ? 'fa-waveform' : 'fa-microphone'} text-2xl text-white transition-all`}></i>
            ) : (
              <i className="fa-solid fa-power-off text-2xl text-slate-400"></i>
            )}
          </button>
        </div>

        {/* VAD Status Feedback */}
        <div className="h-6 flex items-center gap-2 mb-2">
          {isUserSpeaking && (
            <span className="flex items-center gap-2 text-blue-400 text-xs font-medium animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              Voice Detected
            </span>
          )}
        </div>

        {/* Chat History */}
        <div
          ref={chatContainerRef}
          className="w-full flex-1 overflow-y-auto mb-4 space-y-4 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent pb-4"
        >
          {messages.length === 0 && isActive && (
            <div className="text-center text-slate-600 text-sm mt-10">
              Start speaking or type below...
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {msg.attachment && (
                <div className="mb-2 max-w-[200px] rounded-lg overflow-hidden border border-slate-700">
                  {msg.attachment.type === 'image' ? (
                    <img src={msg.attachment.url} alt="User upload" className="w-full h-auto" />
                  ) : (
                    <video src={msg.attachment.url} controls className="w-full h-auto" />
                  )}
                </div>
              )}
              <div
                className={`
                  max-w-[80%] px-4 py-2 rounded-2xl text-sm leading-relaxed
                  ${msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : msg.role === 'system'
                      ? 'bg-red-900/50 text-red-200 border border-red-500/30'
                      : 'bg-slate-800 text-slate-200 rounded-bl-sm border border-slate-700'}
                `}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isAnalyzing && (
            <div className="flex items-start">
              <div className="bg-slate-800 text-slate-400 px-4 py-2 rounded-2xl rounded-bl-sm border border-slate-700 text-sm animate-pulse">
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="w-full relative group">
          <form onSubmit={handleSendText} className="relative flex items-center gap-2 bg-slate-800/80 backdrop-blur border border-slate-700 rounded-full p-2 pl-4 shadow-xl transition-all focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20">

            {/* File Upload Trigger */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-slate-400 hover:text-blue-400 transition-colors p-2"
              title="Upload Image or Video (Uses Gemini 3 Pro)"
            >
              <i className="fa-solid fa-paperclip"></i>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*,video/*"
              onChange={handleFileUpload}
            />

            {/* Text Input */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isActive ? "Send text to live agent..." : (config.chatProvider === 'custom' ? `Message ${config.customModelName || 'custom LLM'}...` : "Message Gemini...")}
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-white placeholder-slate-500"
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="w-8 h-8 rounded-full bg-blue-600 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center hover:bg-blue-500 transition-all"
            >
              <i className="fa-solid fa-arrow-up text-xs"></i>
            </button>
          </form>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-3 bg-red-900/50 border border-red-500/30 rounded text-red-200 text-sm max-w-md text-center">
            {error}
          </div>
        )}

      </main>

      {/* Memory Panel */}
      <div className="w-full max-w-5xl p-6 z-10 border-t border-slate-800 bg-slate-900/50 backdrop-blur mt-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          <i className="fa-solid fa-database"></i> Persistent Memory (Recent)
        </h3>
        {!config.supabaseUrl ? (
          <p className="text-slate-600 text-xs italic">Configure Supabase to enable memory.</p>
        ) : memories.length === 0 ? (
          <p className="text-slate-600 text-xs italic">No memories found. Ask the agent to remember something.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {memories.map(m => (
              <div key={m.id} className="glass-panel p-3 rounded hover:bg-slate-800/50 transition-colors">
                <div className="text-xs text-blue-400 font-mono mb-1 truncate">
                  {new Date(m.created_at).toLocaleDateString()}
                </div>
                <div className="text-xs text-slate-300 line-clamp-2">{m.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Config Modal */}
      <ConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        config={config}
        onSave={handleConfigSave}
      />
    </div>
  );
}