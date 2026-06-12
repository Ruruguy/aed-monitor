/* app.js */

// Global State Variables
const STATES = {
  OFF: 'OFF',
  BOOTING: 'BOOTING',
  PLACING_PADS: 'PLACING_PADS',
  CONNECTING: 'CONNECTING',
  ANALYZING: 'ANALYZING',
  CHARGING: 'CHARGING',
  PROMPTING_SHOCK: 'PROMPTING_SHOCK',
  CPR: 'CPR'
};

let currentState = STATES.OFF;
let isPaused = false;
let currentCycleIndex = 0;
let cycleSettings = [true, false, true, false]; // true = shock, false = no shock
let timerInterval = null;
let cprTimeRemaining = 120; // 2 minutes (120 seconds)
let metronomeSound = 'beep'; // beep, woodblock, voice, none

// HTML Elements
const body = document.body;
const audioGate = document.getElementById('audioGate');
const btnStartApp = document.getElementById('btnStartApp');
const settingsTrigger = document.getElementById('settingsTrigger');
const settingsPanel = document.getElementById('settingsPanel');
const settingsClose = document.getElementById('settingsClose');
const btnPower = document.getElementById('btnPower');
const btnShock = document.getElementById('btnShock');
const shockLabel = document.getElementById('shockLabel');
const cableSocket = document.getElementById('cableSocket');
const cablePlug = document.getElementById('cablePlug');
const instructionMain = document.getElementById('instructionMain');
const instructionSub = document.getElementById('instructionSub');
const screenTimer = document.getElementById('screenTimer');
const statusLed = document.getElementById('statusLed');
const padsStatusText = document.getElementById('padsStatusText');
const compressionVisualizer = document.getElementById('compressionVisualizer');
const compressionRing = document.getElementById('compressionRing');
const compressionHands = document.getElementById('compressionHands');
const compressionCount = document.getElementById('compressionCount');

// Pad items
const targetClavicle = document.getElementById('targetClavicle');
const targetRibs = document.getElementById('targetRibs');
const placedPadClavicle = document.getElementById('placedPadClavicle');
const placedPadRibs = document.getElementById('placedPadRibs');
const deckPadClavicle = document.getElementById('deckPadClavicle');
const deckPadRibs = document.getElementById('deckPadRibs');

// Settings items
const themeButtons = document.querySelectorAll('.theme-btn');
const selectMetronomeSound = document.getElementById('selectMetronomeSound');
const cycleSequenceList = document.getElementById('cycleSequenceList');
const btnAddCycle = document.getElementById('btnAddCycle');
const btnForceShock = document.getElementById('btnForceShock');
const btnForceNoShock = document.getElementById('btnForceNoShock');
const btnFastForward = document.getElementById('btnFastForward');
const btnPauseResume = document.getElementById('btnPauseResume');
const btnResetSimulation = document.getElementById('btnResetSimulation');
const toastContainer = document.getElementById('toastContainer');

// Canvas ECG Config
const ecgCanvas = document.getElementById('ecgCanvas');
const ctx = ecgCanvas.getContext('2d');
let animationFrameId = null;
let ecgX = 0;
let ecgPoints = [];

// Simulation Variables
let padsPlaced = { clavicle: false, ribs: false };
let cableConnected = false;
let forceAnalysisResult = null; // null = use sequencer, true = force shock, false = force no-shock
let shockSpeechInterval = null;

// Speech Engine Wrapper (TTS)
const Speech = {
  synth: window.speechSynthesis,
  utterance: null,
  isSpeaking: false,
  
  speak(text, onEnd) {
    this.cancel();
    if (!this.synth) {
      if (onEnd) onEnd();
      return;
    }
    
    // Create utterance
    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.lang = 'zh-TW';
    
    // Choose Chinese voice
    const voices = this.synth.getVoices();
    const zhVoice = voices.find(v => v.lang.includes('zh-TW')) || 
                    voices.find(v => v.lang.includes('zh-HK')) ||
                    voices.find(v => v.lang.includes('zh-CN')) || 
                    voices.find(v => v.lang.includes('zh'));
    if (zhVoice) {
      this.utterance.voice = zhVoice;
    }
    
    this.utterance.rate = 1.05; // Slightly faster standard pace
    this.utterance.pitch = 1.0;
    
    this.utterance.onstart = () => {
      this.isSpeaking = true;
    };
    
    this.utterance.onend = () => {
      this.isSpeaking = false;
      this.utterance = null;
      if (onEnd) onEnd();
    };
    
    this.utterance.onerror = () => {
      this.isSpeaking = false;
      this.utterance = null;
      if (onEnd) onEnd();
    };
    
    this.synth.speak(this.utterance);
  },
  
  cancel() {
    if (this.synth) {
      this.synth.cancel();
      this.isSpeaking = false;
      this.utterance = null;
    }
  }
};

// Web Audio API Sound Generator
class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.chargeOsc = null;
    this.chargeGain = null;
    this.chargeTimeout = null;
  }
  
  init() {
    if (this.audioCtx) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  playBootChime() {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    
    const osc1 = this.audioCtx.createOscillator();
    const osc2 = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();
    
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.setValueAtTime(659.25, now + 0.15); // E5
    osc1.frequency.setValueAtTime(783.99, now + 0.3); // G5
    osc1.frequency.setValueAtTime(1046.50, now + 0.45); // C6
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(261.63, now); // C4
    
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gainNode.gain.setValueAtTime(0.2, now + 0.5);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);
    
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.1);
    osc2.stop(now + 1.1);
  }
  
  startCharging(duration, onDone) {
    if (!this.audioCtx) return;
    this.stopCharging();
    
    const now = this.audioCtx.currentTime;
    this.chargeOsc = this.audioCtx.createOscillator();
    this.chargeGain = this.audioCtx.createGain();
    
    this.chargeOsc.type = 'sine';
    this.chargeOsc.frequency.setValueAtTime(260, now);
    this.chargeOsc.frequency.linearRampToValueAtTime(1400, now + duration);
    
    this.chargeGain.gain.setValueAtTime(0, now);
    this.chargeGain.gain.linearRampToValueAtTime(0.12, now + 0.3);
    this.chargeGain.gain.setValueAtTime(0.12, now + duration - 0.2);
    this.chargeGain.gain.linearRampToValueAtTime(0, now + duration);
    
    this.chargeOsc.connect(this.chargeGain);
    this.chargeGain.connect(this.audioCtx.destination);
    
    this.chargeOsc.start(now);
    this.chargeOsc.stop(now + duration);
    
    this.chargeTimeout = setTimeout(() => {
      this.chargeOsc = null;
      if (onDone) onDone();
    }, duration * 1000);
  }
  
  stopCharging() {
    if (this.chargeOsc) {
      try { this.chargeOsc.stop(); } catch(e) {}
      this.chargeOsc = null;
    }
    if (this.chargeTimeout) {
      clearTimeout(this.chargeTimeout);
      this.chargeTimeout = null;
    }
  }
  
  playDischarge() {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    
    // Shock sound (simulated loud pop + low frequency wave)
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const filter = this.audioCtx.createBiquadFilter();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 0.3);
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, now);
    
    gain.gain.setValueAtTime(0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start(now);
    osc.stop(now + 0.5);
    
    // Play confirmation beep after shock discharge
    setTimeout(() => {
      this.playBeep(2200, 0.12, 0.15);
    }, 450);
  }
  
  playBeep(frequency, duration, volume = 0.1) {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }
  
  playWoodblock(time, volume = 0.15) {
    if (!this.audioCtx) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1100, time);
    osc.frequency.exponentialRampToValueAtTime(750, time + 0.04);
    
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start(time);
    osc.stop(time + 0.08);
  }
}

const Audio = new SoundEngine();

// Metronome Engine (precise scheduling)
class Metronome {
  constructor(soundEngine) {
    this.soundEngine = soundEngine;
    this.bpm = 110;
    this.isPlaying = false;
    this.nextBeatTime = 0.0;
    this.beatCount = 0;
    this.timerId = null;
    this.onBeat = null; // Animation callback
  }
  
  start(onBeatCallback) {
    if (this.isPlaying) return;
    this.soundEngine.init();
    this.isPlaying = true;
    this.beatCount = 0;
    this.onBeat = onBeatCallback;
    this.nextBeatTime = this.soundEngine.audioCtx.currentTime + 0.05;
    this.scheduler();
  }
  
  stop() {
    this.isPlaying = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
  
  scheduler() {
    if (!this.isPlaying) return;
    
    const scheduleAheadTime = 0.1; // schedule 100ms in advance
    const lookahead = 25.0; // run scheduler every 25ms
    
    while (this.nextBeatTime < this.soundEngine.audioCtx.currentTime + scheduleAheadTime) {
      this.scheduleBeat(this.beatCount, this.nextBeatTime);
      this.advanceBeat();
    }
    
    this.timerId = setTimeout(() => this.scheduler(), lookahead);
  }
  
  advanceBeat() {
    const secondsPerBeat = 60.0 / this.bpm;
    this.nextBeatTime += secondsPerBeat;
    this.beatCount++;
  }
  
  scheduleBeat(beatNumber, time) {
    const count30 = (beatNumber % 30) + 1;
    
    // UI Animation Sync
    const diffMs = Math.max(0, (time - this.soundEngine.audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (this.isPlaying && this.onBeat) {
        this.onBeat(count30);
      }
    }, diffMs);
    
    // Sound Generation
    if (metronomeSound === 'none') return;
    
    if (metronomeSound === 'beep') {
      this.playTone(900, 0.05, time);
    } else if (metronomeSound === 'woodblock') {
      this.soundEngine.playWoodblock(time);
    } else if (metronomeSound === 'voice') {
      // Woodblock beat as base
      this.soundEngine.playWoodblock(time, 0.08);
      
      // Every 5 beats, trigger a quick speech count (if speech synthesizer is idle)
      if (count30 % 5 === 0 && !Speech.isSpeaking) {
        // Run speech asynchronously to avoid blocking the scheduler
        setTimeout(() => {
          if (this.isPlaying && currentState === STATES.CPR) {
            Speech.speak(count30.toString());
          }
        }, diffMs);
      }
    }
  }
  
  playTone(frequency, duration, time) {
    const osc = this.soundEngine.audioCtx.createOscillator();
    const gain = this.soundEngine.audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, time);
    
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc.connect(gain);
    gain.connect(this.soundEngine.audioCtx.destination);
    
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }
}

const Metro = new Metronome(Audio);

// Canvas ECG Waveform Animation Loop
function startEcgAnimation() {
  const canvasWidth = ecgCanvas.clientWidth;
  const canvasHeight = ecgCanvas.clientHeight;
  ecgCanvas.width = canvasWidth;
  ecgCanvas.height = canvasHeight;
  
  ecgPoints = new Array(canvasWidth).fill(canvasHeight / 2);
  ecgX = 0;
  
  function draw() {
    if (currentState === STATES.OFF) {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      animationFrameId = requestAnimationFrame(draw);
      return;
    }
    
    ctx.fillStyle = 'rgba(9, 26, 21, 0.2)'; // Persistent trace background
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw grid lines
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvasWidth; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvasHeight);
      ctx.stroke();
    }
    for (let i = 0; i < canvasHeight; i += 20) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvasWidth, i);
      ctx.stroke();
    }
    
    // Generate next point based on state
    const mid = canvasHeight / 2;
    let nextY = mid;
    const t = Date.now() / 1000;
    
    switch (currentState) {
      case STATES.BOOTING:
        nextY = mid + (Math.random() - 0.5) * 2;
        break;
      case STATES.PLACING_PADS:
      case STATES.CONNECTING:
        // Flatline noise
        nextY = mid + Math.sin(t * 8) * 1.5 + (Math.random() - 0.5) * 3;
        break;
      case STATES.ANALYZING:
      case STATES.CHARGING:
      case STATES.PROMPTING_SHOCK:
        // Decide rhythm
        const isShock = forceAnalysisResult !== null ? forceAnalysisResult : cycleSettings[currentCycleIndex % cycleSettings.length];
        if (isShock) {
          // Ventricular Fibrillation (chaotic fast wave)
          nextY = mid + Math.sin(t * 35) * 16 + Math.sin(t * 60) * 8 + (Math.random() - 0.5) * 8;
        } else {
          // Normal Sinus Rhythm (NSR) - piecewise formula
          const cycleTime = (Date.now() % 800) / 800; // 75 BPM
          if (cycleTime < 0.1) { // P wave
            nextY = mid - Math.sin(cycleTime * Math.PI / 0.1) * 3;
          } else if (cycleTime >= 0.15 && cycleTime < 0.18) { // Q
            nextY = mid + (cycleTime - 0.15) * 150;
          } else if (cycleTime >= 0.18 && cycleTime < 0.22) { // R
            nextY = mid - 25 + Math.abs(cycleTime - 0.2) * 500;
          } else if (cycleTime >= 0.22 && cycleTime < 0.25) { // S
            nextY = mid + (0.25 - cycleTime) * 120;
          } else if (cycleTime >= 0.4 && cycleTime < 0.55) { // T wave
            nextY = mid - Math.sin((cycleTime - 0.4) * Math.PI / 0.15) * 5;
          } else {
            nextY = mid + (Math.random() - 0.5) * 0.8;
          }
        }
        break;
      case STATES.CPR:
        // Huge periodic compression waves (110 BPM)
        const cprPeriod = 60 / 110;
        const cprTime = t % cprPeriod;
        if (cprTime < cprPeriod * 0.3) {
          nextY = mid + Math.sin((cprTime / (cprPeriod * 0.3)) * Math.PI) * 20; // compression stroke
        } else if (cprTime >= cprPeriod * 0.3 && cprTime < cprPeriod * 0.7) {
          nextY = mid - Math.sin(((cprTime - cprPeriod * 0.3) / (cprPeriod * 0.4)) * Math.PI) * 8; // recoil
        } else {
          // Rest of NSR rhythm underneath chest compressions
          nextY = mid + (Math.random() - 0.5) * 1;
        }
        break;
      default:
        nextY = mid;
    }
    
    // Scroll buffer
    ecgPoints.push(nextY);
    if (ecgPoints.length > canvasWidth) {
      ecgPoints.shift();
    }
    
    // Draw trace
    ctx.strokeStyle = varColor('--screen-glow', '#00ffcc');
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 6;
    ctx.shadowColor = varColor('--screen-glow', '#00ffcc');
    ctx.beginPath();
    ctx.moveTo(0, ecgPoints[0]);
    
    for (let i = 1; i < ecgPoints.length; i++) {
      ctx.lineTo(i, ecgPoints[i]);
    }
    ctx.stroke();
    ctx.shadowBlur = 0; // reset
    
    animationFrameId = requestAnimationFrame(draw);
  }
  
  draw();
}

function stopEcgAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// Helper: Fetch CSS variable value or fallback
function varColor(varName, fallback) {
  return getComputedStyle(body).getPropertyValue(varName).trim() || fallback;
}

// Toast notification helper
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toast-in 0.3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ----------------------------------------------------
// STATE MACHINE CONTROLLER & STATE HANDLERS
// ----------------------------------------------------

function setAEDState(newState) {
  if (currentState === newState) return;
  currentState = newState;
  
  // LED blinking classes reset
  statusLed.className = 'status-led-dot';
  btnPower.classList.remove('on');
  btnShock.classList.remove('active');
  cableSocket.classList.remove('blink-led');
  compressionVisualizer.classList.remove('active');
  
  // Stop sounds/speech
  Metro.stop();
  Audio.stopCharging();
  if (newState !== STATES.ANALYZING && newState !== STATES.CHARGING && newState !== STATES.PROMPTING_SHOCK) {
    Speech.cancel();
    clearInterval(shockSpeechInterval);
  }
  
  switch (currentState) {
    case STATES.OFF:
      statusLed.classList.add('blink-red');
      instructionMain.innerText = '系統關機中';
      instructionSub.innerText = '請按下電源鈕啟動';
      screenTimer.innerText = '00:00';
      resetPhysicalInterface();
      stopEcgAnimation();
      break;
      
    case STATES.BOOTING:
      statusLed.classList.add('blink-green');
      btnPower.classList.add('on');
      instructionMain.innerText = '正在開機...';
      instructionSub.innerText = '初始化自我檢測中';
      Audio.playBootChime();
      
      setTimeout(() => {
        if (currentState === STATES.BOOTING) {
          setAEDState(STATES.PLACING_PADS);
        }
      }, 1500);
      break;
      
    case STATES.PLACING_PADS:
      statusLed.classList.add('blink-green');
      btnPower.classList.add('on');
      instructionMain.innerText = '請貼上電擊貼片';
      instructionSub.innerText = '撕下貼片，黏貼於病人右胸與左肋';
      
      // Voice Instruction
      Speech.speak("已開機。請撕下貼片，貼在病人裸露的胸部。", () => {
        // Loop prompt if still in this state
        setTimeout(() => {
          if (currentState === STATES.PLACING_PADS) {
            Speech.speak("請撕下貼片，黏貼於病人右胸與左肋。");
          }
        }, 6000);
      });
      break;
      
    case STATES.CONNECTING:
      statusLed.classList.add('blink-green');
      btnPower.classList.add('on');
      cableSocket.classList.add('blink-led');
      instructionMain.innerText = '請插入連接插頭';
      instructionSub.innerText = '將電擊貼片插頭插入閃爍的插座中';
      
      Speech.speak("請將插頭插入閃爍的插座中。", () => {
        setTimeout(() => {
          if (currentState === STATES.CONNECTING) {
            Speech.speak("請插入插頭。");
          }
        }, 5000);
      });
      break;
      
    case STATES.ANALYZING:
      statusLed.classList.add('blink-green');
      btnPower.classList.add('on');
      instructionMain.innerText = '分析病人心率中';
      instructionSub.innerText = '請勿碰觸病患！正在進行心電圖分析';
      
      // Play voice analysis prompt
      Speech.speak("正在分析病人心率，不要碰觸病患。");
      
      setTimeout(() => {
        if (currentState === STATES.ANALYZING) {
          Speech.speak("正在進行分析，不要碰觸病患。");
        }
      }, 3500);
      
      // Analysis duration: 7 seconds
      setTimeout(() => {
        if (currentState === STATES.ANALYZING) {
          evaluateAnalysisResult();
        }
      }, 7000);
      break;
      
    case STATES.CHARGING:
      statusLed.classList.add('blink-green');
      btnPower.classList.add('on');
      instructionMain.innerText = '建議電擊，正在充電';
      instructionSub.innerText = '電擊器充電中... 請遠離病患';
      
      Speech.speak("建議電擊，正在充電。請勿碰觸病患。");
      
      // Start rising pitch charge chime (5 seconds duration)
      Audio.startCharging(5, () => {
        if (currentState === STATES.CHARGING) {
          setAEDState(STATES.PROMPTING_SHOCK);
        }
      });
      break;
      
    case STATES.PROMPTING_SHOCK:
      statusLed.classList.add('blink-green');
      btnPower.classList.add('on');
      btnShock.classList.add('active');
      instructionMain.innerText = '建議電擊，請按下電擊鈕';
      instructionSub.innerText = '⚡ 請立即按下閃爍的橘紅色按鈕！';
      
      // Continuous prompt speaker
      const promptShockVoice = () => {
        Speech.speak("請按下橘紅色電擊鈕！");
        Audio.playBeep(2500, 0.25, 0.2); // Loud alarm beep
      };
      
      promptShockVoice();
      shockSpeechInterval = setInterval(promptShockVoice, 3500);
      break;
      
    case STATES.CPR:
      statusLed.classList.add('blink-green');
      btnPower.classList.add('on');
      instructionMain.innerText = '請持續進行 CPR';
      instructionSub.innerText = '跟隨節拍器進行按壓，按壓速率 110BPM';
      
      cprTimeRemaining = 120; // reset 2 min timer
      updateTimerDisplay();
      
      // Start metronome and chest compression overlay
      compressionVisualizer.classList.add('active');
      
      // Start the metronome
      Metro.start((count30) => {
        // Beat callback: triggers flash & increments number
        compressionCount.innerText = count30;
        
        // Flashing animation ring
        compressionRing.classList.remove('compressing');
        void compressionRing.offsetWidth; // trigger reflow
        compressionRing.classList.add('compressing');
        
        compressionHands.classList.remove('compressing');
        void compressionHands.offsetWidth; // trigger reflow
        compressionHands.classList.add('compressing');
        
        // Highlight screen bezel background briefly
        const screenEl = document.getElementById('aedScreen');
        screenEl.classList.add('flash-metronome');
        setTimeout(() => screenEl.classList.remove('flash-metronome'), 80);
      });
      
      // Start 2 minutes timer countdown
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        if (isPaused) return;
        cprTimeRemaining--;
        updateTimerDisplay();
        
        if (cprTimeRemaining <= 0) {
          clearInterval(timerInterval);
          Metro.stop();
          currentCycleIndex++; // increment cycle
          showToast(`第 ${currentCycleIndex} 週期結束，重新評估`);
          setAEDState(STATES.ANALYZING);
        }
      }, 1000);
      break;
  }
}

// Reset physical state variables when powered off
function resetPhysicalInterface() {
  padsPlaced = { clavicle: false, ribs: false };
  cableConnected = false;
  
  // Reset placement elements
  placedPadClavicle.style.display = 'none';
  placedPadRibs.style.display = 'none';
  deckPadClavicle.classList.remove('used');
  deckPadRibs.classList.remove('used');
  padsStatusText.innerText = '貼片未貼上';
  padsStatusText.style.color = '#ef4444';
  
  // Reset target borders
  targetClavicle.classList.remove('correct-placed');
  targetRibs.classList.remove('correct-placed');
  
  // Cable Reset
  cablePlug.classList.remove('connected');
  cableSocket.classList.remove('connected');
  
  clearInterval(timerInterval);
  clearInterval(shockSpeechInterval);
}

// Evaluate whether shock is advised in current cycle
function evaluateAnalysisResult() {
  const isShock = forceAnalysisResult !== null ? forceAnalysisResult : cycleSettings[currentCycleIndex % cycleSettings.length];
  forceAnalysisResult = null; // Clear override once consumed
  
  if (isShock) {
    setAEDState(STATES.CHARGING);
  } else {
    Speech.speak("不建議電擊，如有需要請持續ＣＰＲ。", () => {
      setAEDState(STATES.CPR);
    });
  }
}

// Update CPR Timer String MM:SS
function updateTimerDisplay() {
  const mins = Math.floor(cprTimeRemaining / 60);
  const secs = cprTimeRemaining % 60;
  screenTimer.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Check if placement requirements met to proceed from placing/plugging
function checkPlacementRequirements() {
  if (currentState !== STATES.PLACING_PADS && currentState !== STATES.CONNECTING) return;
  
  const allPadsPlaced = padsPlaced.clavicle && padsPlaced.ribs;
  
  if (allPadsPlaced) {
    padsStatusText.innerText = '貼片已貼妥';
    padsStatusText.style.color = 'var(--led-green)';
    
    if (cableConnected) {
      setAEDState(STATES.ANALYZING);
    } else {
      setAEDState(STATES.CONNECTING);
    }
  } else {
    padsStatusText.innerText = '貼片放置中';
    padsStatusText.style.color = '#fbbf24';
  }
}

// Place Pad function
function placePad(type) {
  if (currentState !== STATES.PLACING_PADS && currentState !== STATES.CONNECTING) {
    showToast('請先開機再黏貼貼片');
    return;
  }
  
  if (type === 'clavicle') {
    padsPlaced.clavicle = true;
    placedPadClavicle.style.display = 'flex';
    deckPadClavicle.classList.add('used');
    targetClavicle.classList.add('correct-placed');
    Speech.speak("右胸貼片已貼上");
    showToast('右胸上方貼片已定位');
  } else if (type === 'ribs') {
    padsPlaced.ribs = true;
    placedPadRibs.style.display = 'flex';
    deckPadRibs.classList.add('used');
    targetRibs.classList.add('correct-placed');
    Speech.speak("左肋貼片已貼上");
    showToast('左肋下方貼片已定位');
  }
  
  checkPlacementRequirements();
}

// Remove Pad function
function removePad(type) {
  if (type === 'clavicle') {
    padsPlaced.clavicle = false;
    placedPadClavicle.style.display = 'none';
    deckPadClavicle.classList.remove('used');
    targetClavicle.classList.remove('correct-placed');
    showToast('右胸貼片已移除');
  } else if (type === 'ribs') {
    padsPlaced.ribs = false;
    placedPadRibs.style.display = 'none';
    deckPadRibs.classList.remove('used');
    targetRibs.classList.remove('correct-placed');
    showToast('左肋貼片已移除');
  }
  
  checkPlacementRequirements();
}

// ----------------------------------------------------
// UI INTERACTION & HARDWARE CLICK HANDLERS
// ----------------------------------------------------

// Power On/Off
btnPower.addEventListener('click', () => {
  Audio.init();
  if (currentState === STATES.OFF) {
    setAEDState(STATES.BOOTING);
    startEcgAnimation();
  } else {
    setAEDState(STATES.OFF);
  }
});

// Shock button pressed
btnShock.addEventListener('click', () => {
  if (currentState !== STATES.PROMPTING_SHOCK) return;
  
  // Disable button to prevent double shock
  btnShock.classList.remove('active');
  clearInterval(shockSpeechInterval);
  
  // Play boom sound & flash screen
  Audio.playDischarge();
  instructionMain.innerText = '⚡ 電擊放電中！';
  instructionSub.innerText = '請勿觸碰病患，電擊完成';
  
  // Flash Screen Animation Effect
  const screenEl = document.getElementById('aedScreen');
  screenEl.style.backgroundColor = '#ffffff';
  setTimeout(() => {
    screenEl.style.backgroundColor = '';
  }, 250);
  
  Speech.speak("電擊完成，如有需要請持續ＣＰＲ。", () => {
    setAEDState(STATES.CPR);
  });
});

// Click connector to plug in cable
function connectCable() {
  if (currentState === STATES.OFF) return;
  if (cableConnected) return;
  
  cableConnected = true;
  cablePlug.classList.add('connected');
  cableSocket.classList.add('connected');
  Audio.playBeep(800, 0.08, 0.2);
  showToast('貼片插頭已牢固插入');
  
  checkPlacementRequirements();
}

cablePlug.addEventListener('click', connectCable);
cableSocket.addEventListener('click', connectCable);

// Pad Deck Taps (easy mobile click-to-place)
deckPadClavicle.addEventListener('click', () => placePad('clavicle'));
deckPadRibs.addEventListener('click', () => placePad('ribs'));

// Placed Pads click-to-remove
placedPadClavicle.addEventListener('click', () => removePad('clavicle'));
placedPadRibs.addEventListener('click', () => removePad('ribs'));

// ----------------------------------------------------
// SETTINGS DRAWER & ADMIN PANEL LOGIC
// ----------------------------------------------------

// Load Settings from LocalStorage
function loadLocalStorageSettings() {
  const savedTheme = localStorage.getItem('aed_theme') || 'red';
  setTheme(savedTheme);
  
  const savedMetronome = localStorage.getItem('aed_metro_sound') || 'beep';
  metronomeSound = savedMetronome;
  selectMetronomeSound.value = savedMetronome;
  
  const savedSequence = localStorage.getItem('aed_shock_sequence');
  if (savedSequence) {
    try {
      cycleSettings = JSON.parse(savedSequence);
    } catch (e) {
      cycleSettings = [true, false, true, false];
    }
  }
  renderCycleSequenceSettings();
}

// Set Theme
function setTheme(themeName) {
  body.classList.remove('theme-red', 'theme-green', 'theme-blue');
  body.classList.add(`theme-${themeName}`);
  
  themeButtons.forEach(btn => {
    if (btn.getAttribute('data-theme') === themeName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  localStorage.setItem('aed_theme', themeName);
}

// Render the checkbox sequence of shock decisions
function renderCycleSequenceSettings() {
  cycleSequenceList.innerHTML = '';
  cycleSettings.forEach((val, idx) => {
    const cycleMins = idx * 2;
    const item = document.createElement('div');
    item.className = 'cycle-item';
    item.innerHTML = `
      <span class="cycle-label">
        ${cycleMins === 0 ? '初始分析 (0 分鐘)' : `第 ${idx} 週期 (${cycleMins} 分鐘)`}
      </span>
      <label class="switch">
        <input type="checkbox" class="cycle-toggle-cb" data-index="${idx}" ${val ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    `;
    
    // Add event listener
    item.querySelector('.cycle-toggle-cb').addEventListener('change', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'));
      cycleSettings[index] = e.target.checked;
      localStorage.setItem('aed_shock_sequence', JSON.stringify(cycleSettings));
      showToast(`已更新第 ${index} 週期為: ${e.target.checked ? '建議電擊' : '不建議電擊'}`);
    });
    
    cycleSequenceList.appendChild(item);
  });
}

// Settings Panel Toggle
settingsTrigger.addEventListener('click', () => {
  settingsPanel.classList.add('active');
});

settingsClose.addEventListener('click', () => {
  settingsPanel.classList.remove('active');
});

// Theme Button Taps
themeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedTheme = btn.getAttribute('data-theme');
    setTheme(selectedTheme);
    showToast(`更換配色為: ${btn.innerText}`);
  });
});

// Metronome Sound change
selectMetronomeSound.addEventListener('change', (e) => {
  metronomeSound = e.target.value;
  localStorage.setItem('aed_metro_sound', metronomeSound);
  showToast(`節拍器音效更換為: ${e.target.options[e.target.selectedIndex].text}`);
});

// Add Cycle setting
btnAddCycle.addEventListener('click', () => {
  cycleSettings.push(false); // Default to no-shock for new cycles
  localStorage.setItem('aed_shock_sequence', JSON.stringify(cycleSettings));
  renderCycleSequenceSettings();
  showToast('已新增一個 2 分鐘循環段落');
});

// ----------------------------------------------------
// INSTRUCTOR OVERRIDES (手動強制功能)
// ----------------------------------------------------

// Force Shock Advised (立即分析並建議電擊)
btnForceShock.addEventListener('click', () => {
  if (currentState === STATES.OFF) {
    showToast('請先開機');
    return;
  }
  forceAnalysisResult = true;
  settingsPanel.classList.remove('active');
  showToast('強制設定：建議電擊');
  setAEDState(STATES.ANALYZING);
});

// Force No Shock Advised (立即分析並不建議電擊)
btnForceNoShock.addEventListener('click', () => {
  if (currentState === STATES.OFF) {
    showToast('請先開機');
    return;
  }
  forceAnalysisResult = false;
  settingsPanel.classList.remove('active');
  showToast('強制設定：不建議電擊');
  setAEDState(STATES.ANALYZING);
});

// Skip CPR Countdown (Fast Forward)
btnFastForward.addEventListener('click', () => {
  if (currentState !== STATES.CPR) {
    showToast('僅能在 CPR 階段進行快轉');
    return;
  }
  cprTimeRemaining = 2; // trigger immediate analysis in 2 seconds
  settingsPanel.classList.remove('active');
  showToast('已快轉跳過 CPR，即將分析');
});

// Pause / Resume Simulation
btnPauseResume.addEventListener('click', () => {
  if (currentState === STATES.OFF) return;
  
  isPaused = !isPaused;
  if (isPaused) {
    // Pause Metro and Speech
    Metro.stop();
    Speech.cancel();
    Audio.stopCharging();
    btnPauseResume.innerText = '繼續模擬';
    btnPauseResume.style.backgroundColor = '#10b981';
    showToast('模擬暫停');
    instructionMain.innerText = '[已暫停]';
  } else {
    // Resume
    btnPauseResume.innerText = '暫停 / 繼續';
    btnPauseResume.style.backgroundColor = '#4b5563';
    showToast('模擬繼續');
    
    // Restore state action
    if (currentState === STATES.CPR) {
      setAEDState(STATES.CPR);
    } else {
      // Re-trigger current state speech/actions
      const stateBackup = currentState;
      currentState = STATES.OFF; // force refresh
      setAEDState(stateBackup);
    }
  }
});

// Reset Simulation
btnResetSimulation.addEventListener('click', () => {
  isPaused = false;
  btnPauseResume.innerText = '暫停 / 繼續';
  btnPauseResume.style.backgroundColor = '#4b5563';
  currentCycleIndex = 0;
  setAEDState(STATES.OFF);
  settingsPanel.classList.remove('active');
  showToast('模擬器已重置');
});

// Audio Policy Gate Button click (Entry point)
btnStartApp.addEventListener('click', () => {
  audioGate.classList.add('hidden');
  
  // Trigger user click activation of Web Audio and Web Speech
  Audio.init();
  Metro.start(() => {}); // Dry run to unlock context
  Metro.stop();
  
  // Trigger speech initialization
  Speech.speak("語音系統已啟動");
  
  // Load settings
  loadLocalStorageSettings();
  
  // Initially, AED is OFF
  setAEDState(STATES.OFF);
});

// Handle browser speechSynthesis voices loaded
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    // Load voices in background
  };
}

// Drag & Drop Placement Logic (Optional Desktop Support)
let activeDrag = null;

function setupDragAndDrop() {
  const chestCanvasArea = document.getElementById('chestCanvasArea');
  
  // Touch/Mouse support for dragging deck buttons
  // Note: For extreme accessibility, deckPad clicks are standard.
  // We already bind clicks which is 100% stable on all mobile devices.
  // We can add simple event handlers to prevent defaults if dragged.
}

setupDragAndDrop();
