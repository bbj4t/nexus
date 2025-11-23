export class VadDetector {
  threshold: number;
  silenceTimeout: number;
  private isSpeaking: boolean;
  private lastSpeechTime: number;

  constructor(threshold: number, silenceTimeout: number) {
    this.threshold = threshold;
    this.silenceTimeout = silenceTimeout;
    this.isSpeaking = false;
    this.lastSpeechTime = 0;
  }

  process(data: Float32Array): boolean {
    // Calculate Root Mean Square (RMS) amplitude
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
    }
    const rms = Math.sqrt(sumSquares / data.length);

    // Simple hysteresis
    if (rms > this.threshold) {
      this.isSpeaking = true;
      this.lastSpeechTime = Date.now();
    } else {
      if (this.isSpeaking && (Date.now() - this.lastSpeechTime > this.silenceTimeout)) {
        this.isSpeaking = false;
      }
    }
    
    return this.isSpeaking;
  }

  updateConfig(threshold: number, silenceTimeout: number) {
    this.threshold = threshold;
    this.silenceTimeout = silenceTimeout;
  }
}