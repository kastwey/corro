// sound.ts — audio management module with Web Audio API

interface SoundInstance {
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  pannerNode: StereoPannerNode;
  buffer: AudioBuffer | null;
  isPlaying: boolean;
  isPaused: boolean;
  startTime: number;
  pauseTime: number;
  currentPitch: number; // Store current pitch for pause/resume
}

class SoundManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sounds: Map<string, SoundInstance> = new Map();
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  /** iOS only unlocks audio output after a real buffer plays in a gesture; primed once. */
  private outputPrimed = false;
  /** Optional subscriber notified whenever the AudioContext changes state. */
  private onStateChange: ((state: string) => void) | null = null;

  constructor() {
	// We don't initialize AudioContext in the constructor to avoid autoplay errors
	// It will be created lazily when actually needed
  }

  /**
   * Ensures the audio context is active (required for some browsers)
   * Only creates the AudioContext when it's actually needed
   */
  private async ensureAudioContext(): Promise<boolean> {
	// Don't create AudioContext until it's actually needed
	if (!this.audioContext) {
	  try {
		// This is the first time audio is being used, create context
		this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		this.masterGain = this.audioContext.createGain();
		this.masterGain.connect(this.audioContext.destination);
		this.audioContext.onstatechange = () => this.notifyStateChange();
	  } catch (error) {
		console.warn('Web Audio API not available:', error);
		return false;
	  }
	}

	if (this.audioContext.state === 'suspended') {
	  try {
		await this.audioContext.resume();
	  } catch (error) {
		console.warn('Could not resume audio context:', error);
		return false;
	  }
	}

	return this.audioContext !== null && this.masterGain !== null;
  }

  /**
   * Loads an audio file and stores it in cache
   */
  async loadSound(id: string, url: string): Promise<boolean> {
	if (!await this.ensureAudioContext()) return false;

	try {
	  const response = await fetch(url);
	  const arrayBuffer = await response.arrayBuffer();
	  const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);

	  this.audioBuffers.set(id, audioBuffer);
	  return true;
	} catch (error) {
	  console.warn(`Error loading sound ${id} from ${url}:`, error);
	  return false;
	}
  }

  /**
   * Plays a sound with volume, pan and pitch options
   */
  async playSound(
	id: string,
	options: {
	  volume?: number;  // 0.0 - 1.0
	  pan?: number;     // -1.0 (left) to 1.0 (right)
	  pitch?: number;   // 0.25 - 4.0 (0.5 = half speed, 2.0 = double speed)
	  loop?: boolean;
	  url?: string;     // auto-load if not exists
	  overlap?: boolean; // fire-and-forget: allow concurrent plays of the same id
	} = {}
  ): Promise<boolean> {
	if (!await this.ensureAudioContext()) return false;

	// If we don't have the buffer loaded, try to load it
	if (!this.audioBuffers.has(id) && options.url) {
	  await this.loadSound(id, options.url);
	}

	const buffer = this.audioBuffers.get(id);
	if (!buffer) {
	  console.warn(`Sound ${id} not found`);
	  return false;
	}

	// Overlapping one-shot earcons (e.g. rapid token hops fired ~350 ms apart) must NOT
	// cut off the previous identical sound, otherwise consecutive plays truncate each
	// other and blur into fewer audible taps. Such plays are fire-and-forget: they are not
	// tracked in `this.sounds` (so they can't be stopped/paused), and self-clean on end.
	const overlap = options.overlap === true;

	// Stop previous instance if exists (skipped for overlapping fire-and-forget plays).
	if (!overlap) this.stopSound(id);

	try {
	  // Create new instance
	  const source = this.audioContext!.createBufferSource();
	  const gainNode = this.audioContext!.createGain();
	  const pannerNode = this.audioContext!.createStereoPanner();

	  // Configure parameters
	  source.buffer = buffer;
	  source.loop = options.loop || false;
	  source.playbackRate.value = Math.max(0.25, Math.min(4.0, options.pitch || 1.0)); // Pitch control
	  gainNode.gain.value = Math.max(0, Math.min(1, options.volume || 1.0));
	  pannerNode.pan.value = Math.max(-1, Math.min(1, options.pan || 0));

	  // Connect nodes
	  source.connect(gainNode);
	  gainNode.connect(pannerNode);
	  pannerNode.connect(this.masterGain!);

	  if (!overlap) {
		// Save instance so it can be paused/resumed/stopped later, and reset its playing
		// state when it finishes. Overlapping plays skip this (fire-and-forget).
		const soundInstance: SoundInstance = {
		  source,
		  gainNode,
		  pannerNode,
		  buffer,
		  isPlaying: true,
		  isPaused: false,
		  startTime: this.audioContext!.currentTime,
		  pauseTime: 0,
		  currentPitch: options.pitch || 1.0
		};

		this.sounds.set(id, soundInstance);

		// Set up completion event
		source.onended = () => {
		  const instance = this.sounds.get(id);
		  if (instance) {
			instance.isPlaying = false;
			instance.isPaused = false;
		  }
		};
	  }

	  // Start playback
	  // Diagnostic: a sound scheduled while the context is not 'running' (e.g. the tab is
	  // backgrounded and the browser auto-suspended it) is silently inaudible. Log the
	  // state at play time so an unexpectedly muted earcon is easy to spot in the console.
	  if (this.audioContext!.state !== 'running') {
		console.debug(`[sound] playSound "${id}": AudioContext is "${this.audioContext!.state}" at play time — earcon may be silent`);
	  }
	  source.start(0);
	  return true;
	} catch (error) {
	  console.warn(`Error playing sound ${id}:`, error);
	  return false;
	}
  }

  /**
   * Pauses a playing sound
   */
  pauseSound(id: string): boolean {
	const sound = this.sounds.get(id);
	if (!sound || !sound.isPlaying || sound.isPaused) return false;

	if (!this.audioContext) return false;

	try {
	  sound.pauseTime = this.audioContext.currentTime;
	  sound.source?.stop();
	  sound.isPlaying = false;
	  sound.isPaused = true;
	  return true;
	} catch (error) {
	  console.warn(`Error pausing sound ${id}:`, error);
	  return false;
	}
  }

  /**
   * Resumes a paused sound
   */
  resumeSound(id: string): boolean {
	const sound = this.sounds.get(id);
	if (!sound || !sound.isPaused || !sound.buffer) return false;

	if (!this.audioContext) return false;

	try {
	  // Create new source (required after stop())
	  const source = this.audioContext.createBufferSource();
	  source.buffer = sound.buffer;
	  source.loop = sound.source?.loop || false;
	  source.playbackRate.value = sound.currentPitch; // Keep the original pitch

	  // Reconnect
	  source.connect(sound.gainNode);

	  // Calculate offset to resume from
	  const offset = sound.pauseTime - sound.startTime;

	  // Update reference and state
	  sound.source = source;
	  sound.isPlaying = true;
	  sound.isPaused = false;
	  sound.startTime = this.audioContext.currentTime - offset;

	  source.onended = () => {
		sound.isPlaying = false;
		sound.isPaused = false;
	  };

	  source.start(0, offset);
	  return true;
	} catch (error) {
	  console.warn(`Error resuming sound ${id}:`, error);
	  return false;
	}
  }

  /**
   * Stops a sound completely
   */
  stopSound(id: string): boolean {
	const sound = this.sounds.get(id);
	if (!sound) return false;

	try {
	  if (sound.source && sound.isPlaying) {
		sound.source.stop();
	  }
	  sound.isPlaying = false;
	  sound.isPaused = false;
	  return true;
	} catch (error) {
	  console.warn(`Error stopping sound ${id}:`, error);
	  return false;
	}
  }

  /**
   * Adjusts the volume of a specific sound
   */
  setSoundVolume(id: string, volume: number): boolean {
	const sound = this.sounds.get(id);
	if (!sound) return false;

	sound.gainNode.gain.value = Math.max(0, Math.min(1, volume));
	return true;
  }

  /**
   * Adjusts the pan of a specific sound
   */
  setSoundPan(id: string, pan: number): boolean {
	const sound = this.sounds.get(id);
	if (!sound) return false;

	sound.pannerNode.pan.value = Math.max(-1, Math.min(1, pan));
	return true;
  }

  /**
   * Adjusts the pitch of a specific sound
   */
  setSoundPitch(id: string, pitch: number): boolean {
	const sound = this.sounds.get(id);
	if (!sound || !sound.source || !sound.isPlaying) return false;

	const newPitch = Math.max(0.25, Math.min(4.0, pitch));
	sound.source.playbackRate.value = newPitch;
	sound.currentPitch = newPitch; // Preserve the pitch across pause/resume.
	return true;
  }

  /**
   * Adjusts the master volume
   */
  setMasterVolume(volume: number): boolean {
	if (!this.masterGain) return false;

	this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
	return true;
  }

  /**
   * Gets the state of a sound
   */
  getSoundState(id: string): { isPlaying: boolean; isPaused: boolean } | null {
	const sound = this.sounds.get(id);
	if (!sound) return null;

	return {
	  isPlaying: sound.isPlaying,
	  isPaused: sound.isPaused
	};
  }

  /**
   * Stops all sounds
   */
  stopAllSounds(): void {
	for (const [id] of this.sounds) {
	  this.stopSound(id);
	}
  }

  /**
   * Checks if Web Audio API is available
   */
  isSupported(): boolean {
	return !!(window.AudioContext || (window as any).webkitAudioContext);
  }

  /** Current AudioContext state ('none' when not yet created). For diagnostics. */
  getAudioContextState(): string {
	return this.audioContext?.state ?? 'none';
  }

  /**
   * True once the AudioContext is actually running, i.e. audio can be heard. Before the
   * first user gesture (and while a browser like iOS/Safari is still blocking autoplay)
   * this is false, which the sound toggle surfaces as a "tap to enable" hint.
   */
  isUnlocked(): boolean {
	return this.audioContext?.state === 'running';
  }

  /**
   * Subscribe to AudioContext state changes (e.g. suspended -> running once the user
   * unlocks audio, or running -> suspended when the tab is backgrounded). Lets the UI
   * keep the sound toggle's blocked hint accurate. Only one subscriber is needed.
   */
  setOnStateChange(cb: (state: string) => void): void {
	this.onStateChange = cb;
  }

  private notifyStateChange(): void {
	try {
	  this.onStateChange?.(this.getAudioContextState());
	} catch (error) {
	  console.debug('[sound] onStateChange handler threw', error);
	}
  }

  /**
   * Unlocks audio SYNCHRONOUSLY from within a user-gesture handler. Browsers only
   * honour `resume()` when it is called directly in the gesture's call stack — if it
   * runs after an `await` (as it does inside `loadSound`/`playSound`) the context can
   * stay suspended until a later interaction, which is why earcons would only start
   * playing partway through the game. Call this from the first-interaction listener.
   */
  unlock(): void {
	if (!this.audioContext) {
	  try {
		this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		this.masterGain = this.audioContext.createGain();
		this.masterGain.connect(this.audioContext.destination);
		this.audioContext.onstatechange = () => this.notifyStateChange();
	  } catch (error) {
		console.debug('[sound] unlock: could not create AudioContext', error);
		return;
	  }
	}
	console.debug('[sound] unlock: AudioContext state before resume =', this.audioContext.state);
	// 'interrupted' is a non-standard Safari/iOS state (not in the TS AudioContextState
	// union) that also needs resuming, so compare as a plain string.
	const state: string = this.audioContext.state;
	if (state === 'suspended' || state === 'interrupted') {
	  // Fire-and-forget, but the call itself happens synchronously in the gesture.
	  this.audioContext.resume()
		.then(() => console.debug('[sound] unlock: resume() resolved, state =', this.audioContext?.state))
		.catch(error => console.debug('[sound] unlock: resume() failed', error));
	}
	// iOS/iPadOS Safari is the reason this exists: resume() alone leaves the audio OUTPUT
	// muted until an AudioBufferSourceNode actually plays inside a user gesture. So, still
	// synchronously within the gesture, start a one-sample silent buffer to fully unlock
	// the output route; otherwise the first real earcons are scheduled but inaudible.
	this.primeOutput();
	// Repaint any UI bound to the audio state (e.g. the sound toggle's "blocked" hint):
	// resuming may have flipped us to 'running', or the context might have been created
	// already running on desktop — neither necessarily emits a change event here.
	this.notifyStateChange();
  }

  /**
   * Play a single silent sample synchronously to unlock audio output on iOS/iPadOS, where
   * resuming the context is not enough — the output stays muted until a buffer has actually
   * started from within a user gesture. Idempotent: the route only needs priming once.
   */
  private primeOutput(): void {
	if (this.outputPrimed) return;
	if (!this.audioContext || !this.masterGain) return;
	try {
	  const buffer = this.audioContext.createBuffer(1, 1, 22050);
	  const source = this.audioContext.createBufferSource();
	  source.buffer = buffer;
	  source.connect(this.masterGain);
	  source.start(0);
	  this.outputPrimed = true;
	  console.debug('[sound] primeOutput: started silent buffer to unlock iOS audio output');
	} catch (error) {
	  console.debug('[sound] primeOutput: failed', error);
	}
  }
}

// Shared singleton instance.
export const soundManager = new SoundManager();

// Convenience functions.
export const playSound = (id: string, options?: Parameters<typeof soundManager.playSound>[1]) =>
  soundManager.playSound(id, options);
export const stopSound = (id: string) => soundManager.stopSound(id);
export const pauseSound = (id: string) => soundManager.pauseSound(id);
export const resumeSound = (id: string) => soundManager.resumeSound(id);
export const setSoundVolume = (id: string, volume: number) => soundManager.setSoundVolume(id, volume);
export const setSoundPan = (id: string, pan: number) => soundManager.setSoundPan(id, pan);
export const setSoundPitch = (id: string, pitch: number) => soundManager.setSoundPitch(id, pitch);
export const setMasterVolume = (volume: number) => soundManager.setMasterVolume(volume);
