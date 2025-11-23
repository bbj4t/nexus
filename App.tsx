import React, { useState, useEffect, useRef } from 'react';
import { useLiveAgent } from './hooks/useLiveAgent';
import { MemoryService } from './services/memoryService';
import { AgentStatus, AppConfig, MemoryItem } from './types';
import { ConfigModal } from './components/ConfigModal';

const DEFAULT_CONFIG: AppConfig = {
  apiKey: '', 
  modelName: 'gemini-2.5-flash-native-audio-preview-09-2025',
  voiceName: 'Zephyr',
  supabaseUrl: '',
  supabaseKey: '',
  systemInstruction: 'You are Nexus, a helpful AI assistant with persistent memory. You are concise, friendly, and efficient. When saving to memory, categorize the key accurately.',
  vadThreshold: 0.015,
  vadSilenceTimeout: 800
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(() => {
    const saved = localStorage.getItem('nexus_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });
  
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  // Wrap in useCallback or just call safely inside useEffect
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

  const { connect, disconnect, status, volume, isUserSpeaking, error, messages } = useLiveAgent({
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
      <main className="flex-1 flex flex-col items-center w-full max-w-3xl z-10 relative px-4">
        
        {/* Status Indicator */}
        <div className="font-mono text-xs uppercase tracking-widest text-slate-500 mb-4">
          {status}
        </div>

        {/* The Orb */}
        <div className="relative flex items-center justify-center w-64 h-64 mb-6">
          {/* Ripple Effect */}
          {isActive && (
            <div 
              className="absolute rounded-full transition-all duration-75 ease-out border border-white/10"
              style={{
                width: `${Math.min(300, visualizerSize * 1.5)}px`,
                height: `${Math.min(300, visualizerSize * 1.5)}px`,
                opacity: volume * 2
              }}
            />
          )}
          
          {/* Core */}
          <button
            onClick={isActive ? disconnect : connect}
            className={`
              relative z-20 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500
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
        <div className="h-6 flex items-center gap-2 mb-4">
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
          className="w-full flex-1 min-h-0 overflow-y-auto mb-4 space-y-4 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
        >
          {messages.length === 0 && isActive && (
            <div className="text-center text-slate-600 text-sm mt-10">
              Start speaking to interact with Nexus...
            </div>
          )}
          
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div 
                className={`
                  max-w-[80%] px-4 py-2 rounded-2xl text-sm leading-relaxed
                  ${msg.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-br-sm' 
                    : 'bg-slate-800 text-slate-200 rounded-bl-sm border border-slate-700'}
                `}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-500/30 rounded text-red-200 text-sm max-w-md text-center">
            {error}
          </div>
        )}

      </main>

      {/* Memory Panel */}
      <div className="w-full max-w-5xl p-6 z-10 border-t border-slate-800 bg-slate-900/50 backdrop-blur">
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