import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array, arrayBufferToBase64, float32ToWav, mergeFloat32Arrays } from '../utils/audioUtils';
import { MemoryService } from '../services/memoryService';
import { GeminiService } from '../services/geminiService';
import { CustomLlmService } from '../services/customLlmService';
import { AgentStatus, AppConfig, ChatMessage } from '../types';
import { VadDetector } from '../utils/vad';

interface UseLiveAgentProps {
  config: AppConfig;
  onMemoryUpdate: () => void;
}

export function useLiveAgent({ config, onMemoryUpdate }: UseLiveAgentProps) {
  const [status, setStatus] = useState<AgentStatus>(AgentStatus.DISCONNECTED);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [volume, setVolume] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Keep a ref to the config so the active session callbacks always see the latest version
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Audio Context Refs
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  
  // Logic Refs
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const vadRef = useRef<VadDetector>(new VadDetector(config.vadThreshold, config.vadSilenceTimeout));
  
  // Custom Pipeline Refs
  const audioChunksRef = useRef<Float32Array[]>([]);
  const totalAudioLengthRef = useRef(0);
  const isProcessingTurnRef = useRef(false);

  // Transcription Accumulators (Live API)
  const currentInputRef = useRef('');
  const currentOutputRef = useRef('');

  // Update VAD on config change
  useEffect(() => {
    vadRef.current.updateConfig(config.vadThreshold, config.vadSilenceTimeout);
  }, [config.vadThreshold, config.vadSilenceTimeout]);

  const memoryTools: FunctionDeclaration[] = [
    {
      name: 'saveToMemory',
      description: 'Saves a key-value pair or general information to the user\'s persistent memory database.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING, description: 'The topic or subject key' },
          value: { type: Type.STRING, description: 'The detailed content to remember' }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'queryMemory',
      description: 'Searches the user\'s persistent memory database for relevant information.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: 'The search query' }
        },
        required: ['query']
      }
    }
  ];

  const disconnect = useCallback(async () => {
    console.log("Disconnecting Live Agent...");
    setStatus(AgentStatus.DISCONNECTED);
    setIsUserSpeaking(false);
    setVolume(0);

    // Stop streams
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Close AudioContexts
    if (inputContextRef.current) {
      await inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      await outputContextRef.current.close();
      outputContextRef.current = null;
    }

    // Clear session
    sessionPromiseRef.current = null;
    nextStartTimeRef.current = 0;
    scheduledSourcesRef.current.forEach(s => s.stop());
    scheduledSourcesRef.current.clear();
    
    // Clear accumulators
    currentInputRef.current = '';
    currentOutputRef.current = '';
    audioChunksRef.current = [];
    totalAudioLengthRef.current = 0;
    isProcessingTurnRef.current = false;
  }, []);

  /**
   * Play generic audio data (used for Custom Pipeline TTS)
   */
  const playAudioData = async (base64Data: string) => {
    if (!outputContextRef.current || !outputNodeRef.current) return;
    
    try {
      const audioBuffer = await decodeAudioData(
        base64ToUint8Array(base64Data),
        outputContextRef.current
      );
      
      const source = outputContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputNodeRef.current);
      
      // In Custom Mode, we just play immediately since it's turn based
      setStatus(AgentStatus.SPEAKING);
      source.start();
      
      source.onended = () => {
        setStatus(AgentStatus.LISTENING);
      };
    } catch (e) {
      console.error("Audio Playback Error", e);
      setStatus(AgentStatus.LISTENING);
    }
  };

  /**
   * Custom Pipeline: STT -> Custom LLM -> TTS
   */
  const processCustomPipelineTurn = async () => {
    if (isProcessingTurnRef.current || audioChunksRef.current.length === 0) return;
    
    const apiKey = configRef.current.apiKey || process.env.API_KEY;
    if (!apiKey) {
      setError("API Key required for Speech Recognition");
      return;
    }

    isProcessingTurnRef.current = true;
    setStatus(AgentStatus.THINKING);

    try {
      // 1. Prepare Audio
      const merged = mergeFloat32Arrays(audioChunksRef.current, totalAudioLengthRef.current);
      const wavBuffer = float32ToWav(merged, 16000);
      const base64Audio = arrayBufferToBase64(wavBuffer);

      // Clear buffer immediately
      audioChunksRef.current = [];
      totalAudioLengthRef.current = 0;

      // 2. STT (Transcribe)
      const transcription = await GeminiService.transcribeAudio(apiKey, base64Audio, 'audio/wav');
      
      if (!transcription || !transcription.trim()) {
         setStatus(AgentStatus.LISTENING);
         isProcessingTurnRef.current = false;
         return;
      }

      // Add User Message
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'user',
        text: transcription,
        timestamp: Date.now()
      }]);

      // 3. LLM (Custom)
      let responseText = "";
      try {
        responseText = await CustomLlmService.sendMessage(transcription, configRef.current);
      } catch (llmErr: any) {
        responseText = `Error: ${llmErr.message}`;
      }

      // Add Model Message
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      }]);

      // 4. TTS (Gemini)
      if (responseText) {
        const ttsAudio = await GeminiService.generateSpeech(apiKey, responseText, configRef.current.voiceName);
        await playAudioData(ttsAudio);
      } else {
        setStatus(AgentStatus.LISTENING);
      }

    } catch (e: any) {
      console.error("Custom Pipeline Error:", e);
      setError(e.message);
      setStatus(AgentStatus.ERROR);
    } finally {
      isProcessingTurnRef.current = false;
    }
  };

  const connect = useCallback(async () => {
    try {
      if (status === AgentStatus.CONNECTING || status === AgentStatus.LISTENING) return;
      setStatus(AgentStatus.CONNECTING);
      setError(null);

      // Common Audio Setup
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      outputNodeRef.current = outputNode;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Determine Mode
      const useLiveApi = configRef.current.chatProvider === 'gemini';
      const apiKey = configRef.current.apiKey || process.env.API_KEY;
      if (!apiKey) throw new Error("API Key required");

      // Setup Input Processing
      const source = inputCtx.createMediaStreamSource(stream);
      const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);

      let vadState = false; // Local tracker for VAD state change

      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Run VAD
        const isSpeaking = vadRef.current.process(inputData);
        
        // State Sync
        if (isSpeaking !== vadState) {
           vadState = isSpeaking;
           setIsUserSpeaking(isSpeaking);
           
           // If using Custom Pipeline, trigger turn end on silence
           if (!useLiveApi && !isSpeaking) {
              // Add a small delay to ensure we don't cut off end of sentence too aggressively
              // But for simplicity in this loop, we just trigger.
              setTimeout(() => {
                 // Only process if still silent and not already processing
                 if (!vadRef.current.process(new Float32Array(1)) && !isProcessingTurnRef.current) {
                    processCustomPipelineTurn();
                 }
              }, 500);
           }
        }
        
        // Simple volume meter
        let sum = 0;
        for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
        setVolume(Math.sqrt(sum / inputData.length));

        // --- PROVIDER SPECIFIC LOGIC ---
        if (useLiveApi) {
          // GEMINI LIVE API MODE
          if (isSpeaking && sessionPromiseRef.current) {
            const pcmBlob = createPcmBlob(inputData);
            sessionPromiseRef.current.then(session => session.sendRealtimeInput({ media: pcmBlob }));
          }
        } else {
          // CUSTOM LLM MODE
          if (isSpeaking) {
             // Buffer audio for STT
             const chunk = new Float32Array(inputData);
             audioChunksRef.current.push(chunk);
             totalAudioLengthRef.current += chunk.length;
          }
        }
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(inputCtx.destination);

      if (useLiveApi) {
        // --- GEMINI WEBSOCKET CONNECTION ---
        const ai = new GoogleGenAI({ apiKey });
        const sessionPromise = ai.live.connect({
          model: configRef.current.modelName,
          callbacks: {
            onopen: () => {
              console.log("Live Session Opened");
              setStatus(AgentStatus.LISTENING);
            },
            onmessage: async (msg: LiveServerMessage) => {
              const content = msg.serverContent;
              
              // Handle Transcriptions
              if (content?.inputTranscription?.text) {
                currentInputRef.current += content.inputTranscription.text;
              }
              if (content?.outputTranscription?.text) {
                currentOutputRef.current += content.outputTranscription.text;
              }

              // Handle Turn Complete
              if (content?.turnComplete) {
                const newMessages: ChatMessage[] = [];
                const userInput = currentInputRef.current.trim();
                const modelOutput = currentOutputRef.current.trim();

                if (userInput) {
                  newMessages.push({ id: crypto.randomUUID(), role: 'user', text: userInput, timestamp: Date.now() });
                }
                if (modelOutput) {
                  newMessages.push({ id: crypto.randomUUID(), role: 'model', text: modelOutput, timestamp: Date.now() });
                }
                if (newMessages.length > 0) setMessages(prev => [...prev, ...newMessages]);
                currentInputRef.current = '';
                currentOutputRef.current = '';
              }

              // Handle Interruption
              if (content?.interrupted) {
                 currentOutputRef.current = '';
                 nextStartTimeRef.current = 0;
                 for (const source of scheduledSourcesRef.current) {
                   source.stop();
                 }
                 scheduledSourcesRef.current.clear();
              }

              // Handle Tool Calls
              if (msg.toolCall) {
                setStatus(AgentStatus.THINKING);
                for (const fc of msg.toolCall.functionCalls) {
                  let result = "Error executing tool";
                  try {
                    if (fc.name === 'saveToMemory') {
                      const args = fc.args as any;
                      result = await MemoryService.save(args.key, args.value, configRef.current);
                      onMemoryUpdate();
                    } else if (fc.name === 'queryMemory') {
                      const args = fc.args as any;
                      result = await MemoryService.query(args.query, configRef.current);
                    }
                  } catch (e) {
                    console.error(e);
                    result = "Failed to execute memory operation.";
                  }
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result } }
                  }));
                }
                setStatus(AgentStatus.SPEAKING);
              }

              // Handle Audio
              const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audioData) {
                setStatus(AgentStatus.SPEAKING);
                const audioBuffer = await decodeAudioData(
                  base64ToUint8Array(audioData),
                  outputCtx
                );
                
                const source = outputCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputNode);
                
                const startTime = Math.max(outputCtx.currentTime, nextStartTimeRef.current);
                source.start(startTime);
                nextStartTimeRef.current = startTime + audioBuffer.duration;
                
                scheduledSourcesRef.current.add(source);
                source.onended = () => {
                  scheduledSourcesRef.current.delete(source);
                  if (scheduledSourcesRef.current.size === 0) setStatus(AgentStatus.LISTENING);
                };
              }
            },
            onclose: () => {
               console.log("Session Closed");
               setStatus(AgentStatus.DISCONNECTED);
            },
            onerror: (err) => {
              console.error(err);
              setError(err.message || "Session Error");
              setStatus(AgentStatus.ERROR);
            }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: configRef.current.voiceName } }
            },
            systemInstruction: configRef.current.systemInstruction,
            tools: [{ functionDeclarations: memoryTools }],
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          }
        });
        sessionPromiseRef.current = sessionPromise;
      } else {
        // --- CUSTOM MODE INITIALIZATION ---
        // No WebSocket to connect. Just set status to LISTENING.
        // The scriptProcessor loop handles the logic.
        setStatus(AgentStatus.LISTENING);
      }

    } catch (e: any) {
      console.error(e);
      setError(e.message);
      setStatus(AgentStatus.ERROR);
    }
  }, [status, config, onMemoryUpdate]);

  const sendTextMessage = useCallback(async (text: string) => {
    // Optimistically add to UI
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: 'user',
      text: text,
      timestamp: Date.now()
    }]);

    if (configRef.current.chatProvider === 'gemini') {
       if (sessionPromiseRef.current) {
         const session = await sessionPromiseRef.current;
         session.send({
           clientContent: {
             turns: [{ role: 'user', parts: [{ text }] }],
             turnComplete: true
           }
         });
       }
    } else {
      // Custom Mode Text Message Injection
      setStatus(AgentStatus.THINKING);
      try {
         const response = await CustomLlmService.sendMessage(text, configRef.current);
         setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: response,
          timestamp: Date.now()
        }]);
        
        // Speak the response
        const apiKey = configRef.current.apiKey || process.env.API_KEY;
        if (apiKey) {
          const ttsAudio = await GeminiService.generateSpeech(apiKey, response, configRef.current.voiceName);
          await playAudioData(ttsAudio);
        }
      } catch (e: any) {
         setError(e.message);
         setStatus(AgentStatus.ERROR);
      }
    }
  }, []);

  return { 
    connect, 
    disconnect, 
    status, 
    volume, 
    isUserSpeaking, 
    error, 
    messages, 
    setMessages, 
    sendTextMessage 
  };
}