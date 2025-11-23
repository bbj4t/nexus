import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from '../utils/audioUtils';
import { MemoryService } from '../services/memoryService';
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
  // This fixes the issue where updating the URL in settings didn't apply to the active session.
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
  
  // Transcription Accumulators
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
    scheduledSourcesRef.current.clear();
    
    // Clear accumulators
    currentInputRef.current = '';
    currentOutputRef.current = '';
  }, []);

  const connect = useCallback(async () => {
    try {
      if (status === AgentStatus.CONNECTING || status === AgentStatus.LISTENING) return;
      setStatus(AgentStatus.CONNECTING);
      setError(null);

      // Use config API key if provided, else fallback to env
      const activeKey = config.apiKey || process.env.API_KEY;
      if (!activeKey) throw new Error("API Key not found in config or env");

      const ai = new GoogleGenAI({ apiKey: activeKey });
      
      // Setup Audio
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      outputNodeRef.current = outputNode;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: config.modelName,
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setStatus(AgentStatus.LISTENING);
            
            // Audio Pipeline with VAD
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Run VAD
              const isSpeaking = vadRef.current.process(inputData);
              setIsUserSpeaking(isSpeaking);
              
              // Simple volume meter
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              setVolume(Math.sqrt(sum / inputData.length));

              if (isSpeaking) {
                const pcmBlob = createPcmBlob(inputData);
                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              }
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
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

            // Handle Turn Complete (Commit Messages)
            if (content?.turnComplete) {
              const newMessages: ChatMessage[] = [];
              const userInput = currentInputRef.current.trim();
              const modelOutput = currentOutputRef.current.trim();

              if (userInput) {
                newMessages.push({
                  id: crypto.randomUUID(),
                  role: 'user',
                  text: userInput,
                  timestamp: Date.now()
                });
              }
              if (modelOutput) {
                newMessages.push({
                  id: crypto.randomUUID(),
                  role: 'model',
                  text: modelOutput,
                  timestamp: Date.now()
                });
              }

              if (newMessages.length > 0) {
                setMessages(prev => [...prev, ...newMessages]);
              }

              // Reset accumulators
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
                    // CRITICAL FIX: Use configRef.current to access the LATEST config
                    result = await MemoryService.save(args.key, args.value, configRef.current);
                    onMemoryUpdate(); // Refresh UI
                  } else if (fc.name === 'queryMemory') {
                    const args = fc.args as any;
                    // CRITICAL FIX: Use configRef.current
                    result = await MemoryService.query(args.query, configRef.current);
                  }
                } catch (e) {
                  console.error(e);
                  result = "Failed to execute memory operation.";
                }
                
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: {
                    id: fc.id,
                    name: fc.name,
                    response: { result }
                  }
                }));
              }
              setStatus(AgentStatus.SPEAKING); // approximate state back
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
                if (scheduledSourcesRef.current.size === 0) {
                  setStatus(AgentStatus.LISTENING);
                }
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
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } }
          },
          systemInstruction: config.systemInstruction,
          tools: [{ functionDeclarations: memoryTools }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      setError(e.message);
      setStatus(AgentStatus.ERROR);
    }
  }, [status, config, onMemoryUpdate]);

  return { connect, disconnect, status, volume, isUserSpeaking, error, messages };
}