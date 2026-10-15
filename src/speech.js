/**
 * LexNote Speech Recognition & Lecture Audio Recording Engine
 * Free client-side speech recognition with Bangla, English, and Banglish support.
 * Live audio visualizer, uncertainty word detection, and audio playback.
 */

export class SpeechRecorder {
  constructor(options = {}) {
    this.onTranscriptUpdate = options.onTranscriptUpdate || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onAudioReady = options.onAudioReady || (() => {});

    this.recognition = null;
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.animFrameId = null;

    this.isRecording = false;
    this.audioChunks = [];
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.currentLanguage = options.language || 'bn-BD'; // 'bn-BD', 'en-US', 'mixed'
    this.recordedBlob = null;
    this.recordingStartTime = null;
    this.timerInterval = null;
    this.elapsedSeconds = 0;

    this.initRecognition();
  }

  // Check Web Speech API Support
  static isSpeechSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  // Check MediaRecorder Support
  static isAudioRecordingSupported() {
    return navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && 'MediaRecorder' in window;
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API not natively supported in this browser.');
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 2;
      this.recognition.lang = this.currentLanguage === 'mixed' ? 'en-US' : this.currentLanguage;

      this.recognition.onstart = () => {
        this.isRecording = true;
        this.onStateChange({ status: 'recording', lang: this.currentLanguage });
      };

      this.recognition.onresult = (event) => {
        let currentInterim = '';
        const uncertainWords = [];

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcriptText = res[0].transcript;
          const confidence = res[0].confidence;

          if (res.isFinal) {
            // Check confidence score
            if (confidence > 0 && confidence < 0.70) {
              this.finalTranscript += ` ${this.wrapUncertain(transcriptText)} `;
            } else {
              this.finalTranscript += ` ${transcriptText} `;
            }
          } else {
            currentInterim += transcriptText;
          }
        }

        this.interimTranscript = currentInterim;
        this.onTranscriptUpdate({
          finalText: this.finalTranscript.trim(),
          interimText: this.interimTranscript.trim(),
          raw: (this.finalTranscript + ' ' + this.interimTranscript).trim()
        });
      };

      this.recognition.onerror = (event) => {
        console.warn('Speech recognition event error:', event.error);
        const errorInfo = this.formatSpeechError(event.error);
        this.onError(errorInfo);
      };

      this.recognition.onend = () => {
        // If recording was not explicitly stopped by user, attempt auto-restart for long lectures
        if (this.isRecording) {
          try {
            this.recognition.start();
          } catch {
            // Already started or terminated
          }
        } else {
          this.onStateChange({ status: 'idle' });
        }
      };
    } catch (err) {
      console.error('Error initializing SpeechRecognition:', err);
    }
  }

  wrapUncertain(text) {
    const words = text.split(/\s+/);
    return words.map(w => `<span class="uncertain-word" data-word="${w}" title="Click to edit speech recognized text">${w}</span>`).join(' ');
  }

  formatSpeechError(errorCode) {
    switch (errorCode) {
      case 'not-allowed':
        return {
          code: 'not-allowed',
          title: 'Microphone Permission Blocked',
          message: 'Browser denied microphone access. Click the lock/tune icon beside your address bar, enable "Microphone", and refresh.',
          actionable: 'Please allow microphone access in browser settings.'
        };
      case 'no-speech':
        return {
          code: 'no-speech',
          title: 'No Speech Detected',
          message: 'No clear audio was detected by the microphone. Speak a little louder or verify your mic input levels.',
          actionable: 'Microphone is active. Waiting for student voice...'
        };
      case 'network':
        return {
          code: 'network',
          title: 'Speech Recognition Network Delay',
          message: 'The browser speech engine experienced a momentary network interruption. Your voice recording is still safely capturing on disk.',
          actionable: 'Recording continues safely. You can also import audio files or dictate.'
        };
      case 'audio-capture':
        return {
          code: 'audio-capture',
          title: 'Microphone Hardware Not Found',
          message: 'No microphone was detected on your device. Connect a microphone or headset and try again.',
          actionable: 'Connect an audio input device.'
        };
      case 'language-not-supported':
        return {
          code: 'language-not-supported',
          title: 'Selected Language Not Available',
          message: `Your browser does not have speech recognition files for "${this.currentLanguage}". Try switching to English or Bangla.`,
          actionable: 'Switch to another language in the dictation bar.'
        };
      default:
        return {
          code: errorCode,
          title: 'Speech Recognition Warning',
          message: `Status: ${errorCode}. Audio recording remains active.`,
          actionable: 'You can continue speaking or edit the transcript directly.'
        };
    }
  }

  setLanguage(lang) {
    this.currentLanguage = lang;
    if (this.recognition) {
      this.recognition.lang = lang === 'mixed' ? 'bn-BD' : lang;
    }
  }

  async startRecording(canvasElement = null) {
    if (this.isRecording) return;

    if (!SpeechRecorder.isAudioRecordingSupported()) {
      throw new Error('Your browser does not support audio recording (getUserMedia). Please use Chrome, Edge, or Firefox.');
    }

    try {
      // 1. Request microphone permission
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // 2. Setup MediaRecorder for audio playback
      this.audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.recordedBlob = new Blob(this.audioChunks, { type: mimeType });
        const audioUrl = URL.createObjectURL(this.recordedBlob);
        this.onAudioReady({
          blob: this.recordedBlob,
          url: audioUrl,
          durationSeconds: this.elapsedSeconds
        });
      };

      this.mediaRecorder.start(1000); // 1-second chunks

      // 3. Setup Web Audio API Analyser for Live Soundwave Visualizer
      if (canvasElement) {
        this.setupVisualizer(canvasElement);
      }

      // 4. Start Speech Recognition
      if (this.recognition) {
        try {
          this.recognition.start();
        } catch (err) {
          console.warn('SpeechRecognition start error:', err);
        }
      }

      this.isRecording = true;
      this.recordingStartTime = Date.now();
      this.elapsedSeconds = 0;
      this.timerInterval = setInterval(() => {
        this.elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        this.onStateChange({
          status: 'recording',
          elapsedSeconds: this.elapsedSeconds
        });
      }, 1000);

      return { success: true };
    } catch (err) {
      console.warn('Microphone permission or hardware access notice:', err?.name, err?.message);
      let errorInfo;
      const isPermissionDenied = 
        err?.name === 'NotAllowedError' || 
        err?.name === 'PermissionDeniedError' || 
        (err?.message && (err.message.includes('Permission denied') || err.message.toLowerCase().includes('not allowed')));

      if (isPermissionDenied) {
        errorInfo = this.formatSpeechError('not-allowed');
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        errorInfo = this.formatSpeechError('audio-capture');
      } else {
        errorInfo = {
          code: err?.name || 'Error',
          title: 'Audio Recording Notice',
          message: err?.message || 'Could not access audio device.',
          actionable: 'Please check your browser permissions.'
        };
      }
      this.onError(errorInfo);
      return { success: false, error: errorInfo };
    }
  }

  setupVisualizer(canvas) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.audioStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const ctx = canvas.getContext('2d');

      const draw = () => {
        if (!this.isRecording) {
          // Draw quiet line
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#E9E5DC';
          ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
          return;
        }

        this.animFrameId = requestAnimationFrame(draw);
        this.analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * canvas.height * 0.85;

          // LexNote Forest Green Theme Accent
          ctx.fillStyle = '#23483F';
          const y = (canvas.height - barHeight) / 2;
          ctx.beginPath();
          ctx.roundRect(x, y, Math.max(barWidth - 2, 2), Math.max(barHeight, 2), 2);
          ctx.fill();

          x += barWidth + 1;
        }
      };

      draw();
    } catch (e) {
      console.warn('Audio visualizer setup skipped:', e);
    }
  }

  stopRecording() {
    this.isRecording = false;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Safe catch
      }
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Safe catch
      }
    }

    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {
        // Safe catch
      }
    }

    this.onStateChange({ status: 'stopped', elapsedSeconds: this.elapsedSeconds });
  }

  clearTranscript() {
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.onTranscriptUpdate({ finalText: '', interimText: '', raw: '' });
  }
}
