
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Scene } from './types';
import { generateStoryFromTopic, generatePromptsForScene, generateImageFromPrompt, generateAudioFromText, generateBackgroundMusicSuggestion } from './services/geminiService';
import { createVideo, decodePcmData } from './services/videoService';
import SceneCard from './components/SceneCard';
import Spinner from './components/Spinner';
import ImagePreviewModal from './components/ImagePreviewModal';

declare const JSZip: any;
declare const saveAs: any;

type Mode = 'select' | 'auto' | 'manual';

const TTS_VOICES = [
  { id: 'Kore', name: 'Kore (Female, Calm)' },
  { id: 'Puck', name: 'Puck (Male, Energetic)' },
  { id: 'Charon', name: 'Charon (Male, Deep)' },
  { id: 'Fenrir', name: 'Fenrir (Male, Raspy)' },
  { id: 'Zephyr', name: 'Zephyr (Female, Gentle)' },
];

const ApiKeyScreen: React.FC<{ onApiKeySubmit: (key: string) => void }> = ({ onApiKeySubmit }) => {
  const [key, setKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      onApiKeySubmit(key.trim());
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card border border-card-border rounded-lg p-8 shadow-2xl">
        <h2 className="text-2xl font-bold text-center text-primary-light mb-2">Enter Your Gemini API Key</h2>
        <p className="text-center text-text-secondary mb-6 text-sm">
          To use this application, you need a Google AI API key.
        </p>
        <form onSubmit={handleSubmit} className="mb-6">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your Gemini API key here"
            className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all mb-4"
          />
          <button
            type="submit"
            disabled={!key.trim()}
            className="w-full font-bold py-3 px-6 rounded-md transition-colors text-lg bg-primary hover:bg-primary-dark disabled:bg-gray-600 disabled:cursor-not-allowed text-white"
          >
            Save & Continue
          </button>
        </form>
        
        <div className="text-sm text-text-secondary/80 border-t border-card-border pt-6">
            <h3 className="font-semibold text-text-primary mb-2">How to get your API Key:</h3>
            <ol className="list-decimal list-inside space-y-2 text-xs">
                <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary-light underline hover:text-primary">Google AI Studio</a>.</li>
                <li>Click on <strong className="text-text-primary">"Get API key"</strong>, then <strong className="text-text-primary">"Create API key"</strong>.</li>
                <li>Copy the generated key and paste it into the field above.</li>
            </ol>
             <p className="text-xs text-text-secondary/60 mt-4 text-center">
              Your API key is saved securely in your browser's local storage and is never sent to our servers.
            </p>
        </div>
      </div>
    </div>
  );
};


const ModeSelectionScreen: React.FC<{ onSelectMode: (mode: Mode) => void }> = ({ onSelectMode }) => (
  <div className="bg-card border border-card-border rounded-lg p-8 my-8 text-center animate-fade-in">
    <h2 className="text-2xl font-bold mb-2 text-primary-light">Choose Your Workflow</h2>
    <p className="text-text-secondary mb-8">Select a mode that best fits your creative process.</p>
    <div className="flex flex-col sm:flex-row gap-6 justify-center">
      <button onClick={() => onSelectMode('auto')} className="flex-1 bg-primary text-white p-6 rounded-lg hover:bg-primary-dark transition-all text-left">
        <h3 className="text-xl font-bold">🚀 Automatic Mode</h3>
        <p className="mt-2 text-sm text-blue-200">The one-click solution. Enter a topic, and the AI will generate the story, prompts, and all images automatically.</p>
      </button>
      <button onClick={() => onSelectMode('manual')} className="flex-1 bg-primary/30 text-primary-light p-6 rounded-lg hover:bg-primary/40 transition-all text-left">
        <h3 className="text-xl font-bold">✍️ Manual Mode</h3>
        <p className="mt-2 text-sm text-blue-200">For creative control. Generate the story first, then review and edit it before generating the final visual assets.</p>
      </button>
    </div>
  </div>
);


const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [topic, setTopic] = useState<string>('');
  const [numVariations, setNumVariations] = useState(3);
  const [storyLength, setStoryLength] = useState(3000);
  const [numScenes, setNumScenes] = useState(12);
  const [orientation, setOrientation] = useState<'16:9' | '9:16'>('16:9');
  const [videoQuality, setVideoQuality] = useState<'720p' | '1080p'>('1080p');
  const [secondsPerImage, setSecondsPerImage] = useState(3);
  
  const [isTtsEnabled, setIsTtsEnabled] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(TTS_VOICES[0].id);
  const [voiceStyle, setVoiceStyle] = useState('Narrate in a clear, documentary style');
  const [musicSuggestion, setMusicSuggestion] = useState<string>('');
  const [isMusicLoading, setIsMusicLoading] = useState(false);
  const [isAnimationEnabled, setIsAnimationEnabled] = useState(true);

  const [estimatedTime, setEstimatedTime] = useState<string>('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0, task: '' });
  const [error, setError] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [storyReadyForReview, setStoryReadyForReview] = useState(false);
  
  const [imageDurations, setImageDurations] = useState<number[]>([]);
  const [sceneAudioDurations, setSceneAudioDurations] = useState<Record<number, number>>({});

  const isCancelledRef = useRef(false);
  const autoGenerateTriggerRef = useRef(false);

  const scenesRef = useRef(scenes);
  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);
  
  useEffect(() => {
    const savedApiKey = localStorage.getItem('geminiApiKey');
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
  }, []);
  
  const updateScene = useCallback((sceneId: number, updates: Partial<Scene>) => {
    setScenes(prevScenes =>
      prevScenes.map(s => (s.id === sceneId ? { ...s, ...updates } : s))
    );
  }, []);
  
  const estimateTime = useCallback((length: number) => {
    const CHARS_PER_MINUTE = 1800; // Adjusted for a slightly slower, clearer pace
    const totalSeconds = (length / CHARS_PER_MINUTE) * 60;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    setEstimatedTime(`${minutes} min ${seconds} sec`);
  }, []);
  
  useEffect(() => {
    estimateTime(storyLength);
  }, [storyLength, estimateTime]);
  
  const handleApiError = useCallback((e: unknown) => {
    const originalErrorMsg = e instanceof Error ? e.message : String(e);
    const lowerCaseErrorMsg = originalErrorMsg.toLowerCase();

    if (lowerCaseErrorMsg.includes('api key not valid') || lowerCaseErrorMsg.includes('api_key_invalid')) {
      setError('Your API key is invalid. Please refresh and enter a valid key.');
      setApiKey(null); // Reset API key to force re-entry
      localStorage.removeItem('geminiApiKey');
      return;
    }

    if (lowerCaseErrorMsg.includes('resource_exhausted') || lowerCaseErrorMsg.includes('rate limit') || lowerCaseErrorMsg.includes('"code":429')) {
       setError('Rate limit exceeded. This is likely due to your API key\'s usage quota. Please check your plan, wait a few minutes, and try again.');
       return;
    }
    
    if (lowerCaseErrorMsg.includes('safety filters') || lowerCaseErrorMsg.includes('prompt was blocked') || (lowerCaseErrorMsg.includes('did not return an image') && lowerCaseErrorMsg.includes('generation failed'))) {
        setError('An asset could not be generated due to AI safety filters, likely because the topic or a prompt was deemed too sensitive. The process was stopped.');
        return;
    }

    if (lowerCaseErrorMsg.includes('billing is not enabled')) {
        setError('Billing is not enabled for your project. Please visit your Google Cloud project console to enable billing for your API key.');
        return;
    }
    
    setError(originalErrorMsg);

  }, []);

  const resetStateForNewRun = () => {
     setError(null);
     setScenes([]);
     setStoryReadyForReview(false);
     setProgress({ current: 0, total: 0, task: '' });
     setMusicSuggestion('');
     isCancelledRef.current = false;
  };

  const handleGenerateStory = async () => {
    if (!topic.trim()) {
      setError("Please enter a historical topic.");
      return;
    }
    if (!apiKey) {
      setError("API Key is not set. Please refresh the page.");
      return;
    }
    resetStateForNewRun();
    setIsLoading(true);
    setCurrentTask('story');
    setProgress({ current: 1, total: 1, task: 'Generating compelling story...' });
    
    try {
      const sceneDescriptions = await generateStoryFromTopic(topic, storyLength, numScenes, apiKey);
      const newScenes: Scene[] = sceneDescriptions.map((desc, index) => ({
        id: index + 1,
        description: desc,
        prompts: [],
        imageUrls: [],
        imageBlobs: [],
        audioBlob: null,
        isPromptLoading: false,
        isImageLoading: false,
        isAudioLoading: false,
      }));
      setScenes(newScenes);

      // Fetch music suggestion in parallel without blocking UI
      setIsMusicLoading(true);
      generateBackgroundMusicSuggestion(topic, apiKey)
        .then(setMusicSuggestion)
        .catch(musicError => {
          console.error("Failed to get music suggestion:", musicError);
          setMusicSuggestion("Could not generate a music suggestion.");
        })
        .finally(() => setIsMusicLoading(false));

      return newScenes; // Return for chaining in auto mode
    } catch (e) {
       handleApiError(e);
       throw e; // re-throw to be caught by callers
    } finally {
        // In manual mode, loading stops here. In auto, it continues.
        if (mode === 'manual') {
            setIsLoading(false);
            setCurrentTask('');
            setProgress({ current: 0, total: 0, task: '' });
            setStoryReadyForReview(true);
        }
    }
  };
  
  const handleSceneDescriptionChange = (sceneId: number, newDescription: string) => {
    updateScene(sceneId, { description: newDescription, audioBlob: null }); // Clear audio blob on text change
  };
  
  const handleGeneratePromptsForScene = useCallback(async (sceneId: number) => {
    if (!apiKey) {
      setError("API Key is missing. Cannot generate prompts.");
      return;
    }
    setError(null);
    const scene = scenesRef.current.find(s => s.id === sceneId);
    if (!scene) return;
    
    updateScene(sceneId, { isPromptLoading: true });
    try {
      const prompts = await generatePromptsForScene(scene.description, numVariations, apiKey);
      updateScene(sceneId, { prompts, imageUrls: [], imageBlobs: [] }); // Clear old images when regenerating prompts
    } catch (e) {
      handleApiError(e);
      throw e; 
    } finally {
      updateScene(sceneId, { isPromptLoading: false });
    }
  }, [updateScene, numVariations, handleApiError, apiKey]);

  const handleClearSceneImages = useCallback((sceneId: number) => {
    updateScene(sceneId, {
      imageUrls: Array(numVariations).fill(null),
      imageBlobs: Array(numVariations).fill(null),
    });
  }, [updateScene, numVariations]);

  const handleGenerateImagesForScene = useCallback(async (sceneId: number) => {
    if (!apiKey) {
      setError("API Key is missing. Cannot generate images.");
      return;
    }
    setError(null);
    const scene = scenesRef.current.find(s => s.id === sceneId);
    if (!scene || scene.prompts.length === 0) return;

    updateScene(sceneId, { isImageLoading: true });

    const newImageUrls = [...scene.imageUrls];
    const newImageBlobs = [...scene.imageBlobs];

    try {
      for (let i = 0; i < scene.prompts.length; i++) {
        if (isCancelledRef.current) throw new Error("Operation cancelled.");
        
        if (newImageUrls[i]) continue;

        if (isLoading) {
             const totalImages = scenesRef.current.reduce((acc, s) => acc + s.prompts.length, 0);
             const completedImages = scenesRef.current.reduce((acc, s) => acc + s.imageUrls.filter(Boolean).length, 0) + 1;
             setProgress({
                total: totalImages,
                current: completedImages,
                task: `Generating image ${i + 1}/${scene.prompts.length} for scene ${scene.id}...`
            });
        }

        const { dataUrl, blob } = await generateImageFromPrompt(scene.prompts[i], orientation, apiKey);
        newImageUrls[i] = dataUrl;
        newImageBlobs[i] = blob;
        updateScene(sceneId, { imageUrls: [...newImageUrls], imageBlobs: [...newImageBlobs] });
        await delay(4000);
      }
    } catch (e) {
      handleApiError(e);
      throw e;
    } finally {
      updateScene(sceneId, { isImageLoading: false });
    }
  }, [updateScene, isLoading, orientation, handleApiError, apiKey]);

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  const handleGenerateAssets = async () => {
    if (isLoading && currentTask === 'assets') {
        isCancelledRef.current = true;
        setIsLoading(false);
        setCurrentTask('');
        setError("Process cancelled by user.");
        setProgress({ current: 0, total: 0, task: '' });
        scenesRef.current.forEach(s => updateScene(s.id, {isImageLoading: false, isPromptLoading: false, isAudioLoading: false}));
        return;
    }
    if (!apiKey) {
      setError("API Key is not set. Please refresh and try again.");
      return;
    }

    setIsLoading(true);
    setCurrentTask('assets');
    isCancelledRef.current = false;
    setError(null);

    try {
        setStoryReadyForReview(false);

        const scenesToProcess = scenesRef.current;
        if (scenesToProcess.length === 0) throw new Error("No story scenes available to generate assets.");

        // Step 1: Generate Audio if enabled
        if (isTtsEnabled) {
            setProgress({ current: 0, total: scenesToProcess.length, task: 'Generating audio narration...' });
            for (const scene of scenesToProcess) {
                if (isCancelledRef.current) throw new Error("Operation cancelled.");
                updateScene(scene.id, { isAudioLoading: true });
                try {
                    const audioBlob = await generateAudioFromText(scene.description, selectedVoice, voiceStyle, apiKey);
                    updateScene(scene.id, { audioBlob });
                } catch(e) {
                    console.error(`Failed to generate audio for scene ${scene.id}:`, e);
                    // Continue even if one fails
                } finally {
                    updateScene(scene.id, { isAudioLoading: false });
                    setProgress(prev => ({ ...prev, current: prev.current + 1, task: `Generated audio for scene ${scene.id}` }));
                }
                await delay(2000); // Proactively delay to avoid hitting rate limits
            }
        }
        
        // Step 2: Generate Prompts
        setProgress({ current: 0, total: scenesToProcess.length, task: 'Generating cinematic prompts...' });
        for (const scene of scenesToProcess) {
            if (isCancelledRef.current) throw new Error("Operation cancelled.");
            await handleGeneratePromptsForScene(scene.id);
            setProgress(prev => ({ ...prev, current: prev.current + 1, task: `Generated prompts for scene ${scene.id}` }));
            await delay(2000); // Proactively delay to avoid hitting rate limits
        }

        await delay(100);

        // Step 3: Generate Images
        const totalImages = scenesRef.current.reduce((acc, s) => acc + (s.prompts?.length || 0), 0);
        setProgress({ current: 0, total: totalImages, task: 'Preparing to generate stunning images...' });
        
        for (const scene of scenesRef.current) {
            if (isCancelledRef.current) throw new Error("Operation cancelled.");
            await handleGenerateImagesForScene(scene.id);
        }

        setProgress({ current: totalImages, total: totalImages, task: 'All assets are ready!' });
    } catch (e) {
        console.error("Asset generation process failed:", e);
        const errorMsg = e instanceof Error ? e.message : "An unknown error occurred during the generation process.";
        if (!errorMsg.includes("cancelled")) {
           if (!errorMsg.includes('API key not valid')) {
             setError(errorMsg);
           }
        }
    } finally {
        setIsLoading(false);
        setCurrentTask('');
        if (!isCancelledRef.current) {
            setTimeout(() => setProgress({ current: 0, total: 0, task: '' }), 5000);
        }
    }
  };

  const handleAutomaticGeneration = async () => {
    if (isLoading) {
        isCancelledRef.current = true;
        setIsLoading(false);
        setCurrentTask('');
        setError("Process cancelled by user.");
        setProgress({ current: 0, total: 0, task: '' });
        scenesRef.current.forEach(s => updateScene(s.id, {isImageLoading: false, isPromptLoading: false, isAudioLoading: false}));
        return;
    }

    autoGenerateTriggerRef.current = true;
    await handleGenerateStory();
  }

  useEffect(() => {
    if (autoGenerateTriggerRef.current && scenes.length > 0) {
      autoGenerateTriggerRef.current = false; 
      handleGenerateAssets();
    }
  }, [scenes, handleGenerateAssets]);
  
  const convertPcmToWavBlob = (pcmBlob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const pcmData = reader.result as ArrayBuffer;
            const sampleRate = 24000;
            const numChannels = 1;
            const bitsPerSample = 16;
            
            const wavHeader = new ArrayBuffer(44);
            const view = new DataView(wavHeader);

            const writeString = (offset: number, str: string) => {
                for (let i = 0; i < str.length; i++) {
                    view.setUint8(offset + i, str.charCodeAt(i));
                }
            };

            const blockAlign = (numChannels * bitsPerSample) / 8;
            const byteRate = sampleRate * blockAlign;

            writeString(0, 'RIFF');
            view.setUint32(4, 36 + pcmData.byteLength, true);
            writeString(8, 'WAVE');
            writeString(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitsPerSample, true);
            writeString(36, 'data');
            view.setUint32(40, pcmData.byteLength, true);

            const wavBlob = new Blob([wavHeader, pcmData], { type: 'audio/wav' });
            resolve(wavBlob);
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(pcmBlob);
    });
  };

  const handleDownloadAll = async () => {
    if (scenes.every(s => (s.imageBlobs.length === 0 || s.imageBlobs.every(b => !b)) && !s.audioBlob)) {
        setError("No assets have been generated to download.");
        return;
    }
    setError(null);
    setProgress({ current: 1, total:1, task: 'Zipping files...'});

    try {
        const zip = new JSZip();
        const storyText = scenes.map(s => `Scene ${s.id}:\n${s.description}`).join('\n\n');
        zip.file('story.txt', storyText);
        const promptsText = scenes.map(s => 
            `Scene ${s.id}:\n` +
            s.prompts.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
        ).join('\n\n');
        zip.file('prompts.txt', promptsText);
        
        for (const scene of scenes) {
            scene.imageBlobs.forEach((blob, index) => {
                if (blob) {
                    const extension = blob.type.split('/')[1] || 'png';
                    const fileName = `images/${String(scene.id).padStart(3, '0')}_${index + 1}.${extension}`;
                    zip.file(fileName, blob);
                }
            });
            if (scene.audioBlob) {
                const audioFileName = `audio/${String(scene.id).padStart(3, '0')}_narration.wav`;
                const wavBlob = await convertPcmToWavBlob(scene.audioBlob);
                zip.file(audioFileName, wavBlob);
            }
        }
        
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFileName = `${topic.replace(/\s+/g, '_') || 'historical_story'}_assets.zip`;
        saveAs(zipBlob, zipFileName);
    } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create ZIP file.");
    } finally {
        setProgress({ current: 0, total: 0, task: '' });
    }
  };

  const handleGenerateVideo = async () => {
    setError(null);
    const allImageBlobs = scenes.flatMap(s => s.imageBlobs.filter((b): b is Blob => b !== null));
    if (allImageBlobs.length === 0) {
        setError("No images available to generate video.");
        return;
    }
     if (allImageBlobs.length !== imageDurations.length) {
        setError("Mismatch between number of images and duration settings. Please regenerate assets.");
        return;
    }

    setIsLoading(true);
    setCurrentTask('video');

    try {
        const fileName = `${topic.replace(/\s+/g, '_') || 'historical_story'}_video`;
        
        const correspondingAudioBlobs: (Blob | null)[] = scenes.flatMap(scene => {
            const validImageBlobs = scene.imageBlobs.filter(b => b !== null);
            return validImageBlobs.map((_, index) => (index === 0 ? scene.audioBlob : null));
        });

        await createVideo({
            imageBlobs: allImageBlobs,
            audioBlobs: correspondingAudioBlobs,
            durations: imageDurations,
            orientation,
            quality: videoQuality,
            fileName,
            isAnimationEnabled,
            onProgress: (current, total, task) => {
                setProgress({ current, total, task });
            }
        });
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Failed to generate video.";
        setError(errorMsg);
        console.error("Video generation failed:", e);
    } finally {
        setIsLoading(false);
        setCurrentTask('');
        setProgress({ current: 0, total: 0, task: '' });
    }
  };
  
  const scenesWithPrompts = scenes.filter(s => s.prompts.length > 0);
  const allImagesGenerated = scenesWithPrompts.length > 0 && scenesWithPrompts.every(s => s.imageBlobs.filter(Boolean).length === s.prompts.length);
  const assetsReady = scenes.length > 0 && !isLoading;
  const isGenerating = isLoading && (currentTask === 'story' || currentTask === 'assets');

  useEffect(() => {
    if (!isTtsEnabled) {
        setSceneAudioDurations({});
        return;
    }

    const calculateDurations = async () => {
        const audioCtx = new AudioContext({ sampleRate: 24000 });
        const newDurations: Record<number, number> = {};
        for (const scene of scenes) {
            if (scene.audioBlob && !sceneAudioDurations[scene.id]) { // Only process new blobs
                try {
                    const arrayBuffer = await scene.audioBlob.arrayBuffer();
                    const audioBuffer = await decodePcmData(arrayBuffer, audioCtx);
                    newDurations[scene.id] = audioBuffer.duration;
                } catch (e) {
                    console.error(`Could not decode audio for scene ${scene.id}`, e);
                }
            }
        }
        await audioCtx.close();
        if (Object.keys(newDurations).length > 0) {
          setSceneAudioDurations(prev => ({...prev, ...newDurations}));
        }
    };

    const scenesWithAudio = scenes.filter(s => s.audioBlob);
    if (isTtsEnabled && scenesWithAudio.length > 0) {
       calculateDurations();
    }
  }, [scenes, isTtsEnabled]);


  useEffect(() => {
    if (allImagesGenerated) {
        const flatDurations: number[] = [];
        scenes.forEach(scene => {
            const sceneImages = scene.imageBlobs.filter(Boolean);
            if (sceneImages.length > 0) {
                const audioDuration = sceneAudioDurations[scene.id];
                if (isTtsEnabled && audioDuration) {
                    flatDurations.push(parseFloat(audioDuration.toFixed(2)));
                    for (let i = 1; i < sceneImages.length; i++) {
                        flatDurations.push(secondsPerImage);
                    }
                } else {
                    for (let i = 0; i < sceneImages.length; i++) {
                        flatDurations.push(secondsPerImage);
                    }
                }
            }
        });
        setImageDurations(flatDurations);
    } else {
        setImageDurations([]);
    }
  }, [allImagesGenerated, scenes, sceneAudioDurations, isTtsEnabled, secondsPerImage]);

  const handleImageDurationChange = (index: number, value: string) => {
    const newDurations = [...imageDurations];
    const numericValue = parseFloat(value);
    if (!isNaN(numericValue) && numericValue > 0) {
        newDurations[index] = numericValue;
        setImageDurations(newDurations);
    }
  };

  const flatImages = useMemo(() => scenes.flatMap(s =>
      s.imageBlobs.map((blob, index) => blob ? ({
          blobUrl: URL.createObjectURL(blob),
          sceneId: s.id,
          imageIndex: index,
          isAudioAttached: isTtsEnabled && sceneAudioDurations[s.id] && index === 0
      }) : null).filter((item): item is NonNullable<typeof item> => item !== null)
  ), [scenes, isTtsEnabled, sceneAudioDurations]);

  useEffect(() => {
      // Clean up Object URLs
      return () => {
          flatImages.forEach(img => URL.revokeObjectURL(img.blobUrl));
      };
  }, [flatImages]);


  const resetAndChangeMode = () => {
    resetStateForNewRun();
    setTopic('');
    setMode('select');
  }

  const handleApiKeySubmit = (key: string) => {
    localStorage.setItem('geminiApiKey', key);
    setApiKey(key);
  };
  
  const handleChangeApiKey = () => {
    if (window.confirm("Are you sure you want to change your API key? This will clear your current session and reset your work.")) {
        localStorage.removeItem('geminiApiKey');
        setApiKey(null);
        resetAndChangeMode();
    }
  };

  if (!apiKey) {
    return <ApiKeyScreen onApiKeySubmit={handleApiKeySubmit} />;
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      {selectedImageUrl && <ImagePreviewModal imageUrl={selectedImageUrl} onClose={() => setSelectedImageUrl(null)} />}
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
              Ayub YouTube Automation
            </h1>
            <p className="mt-2 text-lg text-text-secondary">
              Generate a full set of video assets from a single topic.
            </p>
        </header>
        
        <>
            {mode === 'select' && <ModeSelectionScreen onSelectMode={setMode} />}
            
            {mode !== 'select' && (
              <>
                {error && (
                  <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-md relative mb-6" role="alert">
                    <strong className="font-bold">Error: </strong>
                    <span className="block sm:inline">{error}</span>
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3 cursor-pointer" onClick={() => setError(null)}>
                      <svg className="fill-current h-6 w-6 text-red-200" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="http://www.w3.org/2000/svg" width="20" height="20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                    </span>
                  </div>
                )}

                <div className="bg-card border border-card-border rounded-lg p-6 mb-8 shadow-lg">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-primary-light">Step 1: Configure Your Video</h2>
                      <p className="text-xs text-text-secondary mt-1">Current Mode: <span className="font-semibold capitalize">{mode}</span></p>
                    </div>
                     <div className="flex items-center gap-4">
                      <button onClick={handleChangeApiKey} className="text-sm text-red-400 hover:underline">Change API Key</button>
                      <button onClick={resetAndChangeMode} className="text-sm text-primary-light hover:underline">&larr; Change Mode</button>
                    </div>
                  </div>

                  {/* Main Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-3">
                        <label htmlFor="topic-input" className="block text-sm font-medium text-text-secondary mb-1">Historical Topic</label>
                        <textarea
                          id="topic-input"
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                          placeholder="e.g., The Silk Road and Ancient Trade"
                          className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all min-h-[80px] resize-y"
                          disabled={isLoading}
                          rows={3}
                        />
                    </div>
                    <div>
                        <label htmlFor="story-length-slider" className="block text-sm font-medium text-text-secondary mb-1">Story Length ({storyLength} chars)</label>
                        <input
                            id="story-length-slider"
                            type="range"
                            min="500"
                            max="30000"
                            step="500"
                            value={storyLength}
                            onChange={(e) => setStoryLength(Number(e.target.value))}
                            className="w-full h-2 bg-background rounded-lg appearance-none cursor-pointer"
                            disabled={isLoading}
                        />
                        <div className="text-xs text-text-secondary text-center mt-1">Est. Video Time: <span className="font-bold text-primary-light">{estimatedTime}</span></div>
                    </div>
                    <div>
                        <label htmlFor="scene-count-slider" className="block text-sm font-medium text-text-secondary mb-1">Number of Scenes ({numScenes})</label>
                        <input
                            id="scene-count-slider"
                            type="range"
                            min="5"
                            max="25"
                            step="1"
                            value={numScenes}
                            onChange={(e) => setNumScenes(Number(e.target.value))}
                            className="w-full h-2 bg-background rounded-lg appearance-none cursor-pointer"
                            disabled={isLoading}
                        />
                    </div>
                    <div>
                        <label htmlFor="variations-input" className="block text-sm font-medium text-text-secondary mb-1">Images per Scene</label>
                        <input
                          id="variations-input"
                          type="number"
                          value={numVariations}
                          onChange={(e) => setNumVariations(Math.max(1, Math.min(5, Number(e.target.value))))}
                          min="1"
                          max="5"
                          className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                          disabled={isLoading}
                        />
                    </div>
                    <div>
                        <label htmlFor="orientation-select" className="block text-sm font-medium text-text-secondary mb-1">Image Aspect Ratio</label>
                        <select
                            id="orientation-select"
                            value={orientation}
                            onChange={(e) => setOrientation(e.target.value as '16:9' | '9:16')}
                            disabled={isLoading}
                            className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                        >
                            <option value="16:9">▭ Horizontal (16:9)</option>
                            <option value="9:16">▯ Vertical (9:16)</option>
                        </select>
                    </div>
                  </div>

                  {/* Audio & Video Settings */}
                  <div className="mt-6 pt-6 border-t border-card-border">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-primary-light">Audio & Video Settings</h3>
                       <div className="flex items-center">
                          <span className={`text-sm mr-3 ${isTtsEnabled ? 'text-text-primary' : 'text-text-secondary'}`}>{isTtsEnabled ? 'Narration On' : 'Narration Off'}</span>
                          <button
                            onClick={() => setIsTtsEnabled(!isTtsEnabled)}
                            disabled={isLoading}
                            className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${isTtsEnabled ? 'bg-primary' : 'bg-background'}`}
                            aria-label="Toggle audio narration"
                          >
                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${isTtsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                      {isTtsEnabled && (
                        <>
                          <div className="animate-fade-in">
                            <label htmlFor="voice-select" className="block text-sm font-medium text-text-secondary mb-1">Voice</label>
                            <select
                              id="voice-select"
                              value={selectedVoice}
                              onChange={(e) => setSelectedVoice(e.target.value)}
                              disabled={isLoading}
                              className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                            >
                              {TTS_VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                            </select>
                          </div>
                          <div className="md:col-span-2 animate-fade-in">
                             <label htmlFor="voice-style" className="block text-sm font-medium text-text-secondary mb-1">Voice Style Prompt</label>
                              <input
                                id="voice-style"
                                type="text"
                                value={voiceStyle}
                                onChange={(e) => setVoiceStyle(e.target.value)}
                                placeholder="e.g., Speak in a calm, documentary style"
                                className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                                disabled={isLoading}
                              />
                               <p className="text-xs text-text-secondary mt-1">The language is often detected from the story text.</p>
                          </div>
                        </>
                      )}
                      {(isMusicLoading || musicSuggestion) && (
                        <div className="lg:col-span-3 animate-fade-in">
                            <label className="block text-sm font-medium text-text-secondary mb-1">AI Background Music Suggestion</label>
                            <div className="w-full bg-background border border-card-border rounded-md px-4 py-3 min-h-[60px] flex items-center">
                                {isMusicLoading ? (
                                    <div className="flex items-center gap-2 text-text-secondary">
                                        <Spinner className="w-4 h-4" />
                                        <span>Deducing ambiance...</span>
                                    </div>
                                ) : (
                                    <p className="text-sm text-text-primary">{musicSuggestion}</p>
                                )}
                            </div>
                        </div>
                      )}
                      <div>
                        <label htmlFor="seconds-per-image" className="block text-sm font-medium text-text-secondary mb-1">Default Seconds per Image</label>
                        <input
                          id="seconds-per-image"
                          type="number"
                          value={secondsPerImage}
                          onChange={(e) => setSecondsPerImage(Math.max(1, Math.min(10, Number(e.target.value))))}
                          min="1"
                          max="10"
                          className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all disabled:opacity-50"
                          disabled={isLoading}
                        />
                        {isTtsEnabled && <p className="text-xs text-primary-light mt-1">Used for images in a scene without narration.</p>}
                      </div>
                       <div>
                          <label htmlFor="video-quality" className="block text-sm font-medium text-text-secondary mb-1">Video Quality</label>
                          <select
                            id="video-quality"
                            value={videoQuality}
                            onChange={(e) => setVideoQuality(e.target.value as '720p' | '1080p')}
                            disabled={isLoading}
                            className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                          >
                            <option value="720p">HD (720p)</option>
                            <option value="1080p">Full HD (1080p)</option>
                          </select>
                      </div>
                       <div>
                          <label className="block text-sm font-medium text-text-secondary mb-1">Video Effects</label>
                           <div className="flex items-center justify-between bg-background border border-card-border rounded-md px-4 py-3">
                              <span className={`text-sm ${isAnimationEnabled ? 'text-text-primary' : 'text-text-secondary'}`}>
                                  Animate Static Images (Ken Burns)
                              </span>
                              <button
                                onClick={() => setIsAnimationEnabled(!isAnimationEnabled)}
                                disabled={isLoading}
                                className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${isAnimationEnabled ? 'bg-primary' : 'bg-gray-600'}`}
                                aria-label="Toggle image animation"
                              >
                                <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${isAnimationEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                              </button>
                          </div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-6 pt-6 border-t border-card-border">
                    {mode === 'manual' && (
                        <button
                            onClick={handleGenerateStory}
                            disabled={!topic.trim() || isLoading}
                            className="font-bold py-3 px-6 rounded-md transition-colors flex items-center justify-center w-full text-lg bg-primary hover:bg-primary-dark disabled:bg-gray-600 disabled:cursor-not-allowed text-white"
                        >
                            {isLoading && currentTask === 'story' ? <><Spinner className="mr-2" /><span>Generating Story...</span></> : (scenes.length > 0 && !storyReadyForReview ? '📝 Regenerate Story' : '📝 Generate Story')}
                        </button>
                    )}
                    {mode === 'auto' && (
                         <button
                            onClick={handleAutomaticGeneration}
                            disabled={!topic.trim() || isLoading}
                            className={`font-bold py-3 px-6 rounded-md transition-colors flex items-center justify-center w-full text-lg ${isGenerating ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-dark'} text-white disabled:bg-gray-600 disabled:cursor-not-allowed`}
                         >
                            {isGenerating ? <><Spinner className="mr-2" /><span>Cancel Generation</span></> : '🚀 Start Automatic Generation'}
                        </button>
                    )}
                  </div>
                </div>

                {mode === 'manual' && storyReadyForReview && !isLoading && (
                  <div className="bg-card border border-card-border rounded-lg p-6 my-8 shadow-lg">
                    <h2 className="text-xl font-bold mb-2 text-primary-light">Step 2: Review & Edit Story</h2>
                    <p className="text-text-secondary mb-6 text-sm">Review the generated scenes below. You can edit the text in any scene before generating the final assets.</p>
                    <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                      {scenes.map((scene) => (
                        <div key={scene.id}>
                          <label className="block text-sm font-medium text-text-secondary mb-1">Scene {scene.id}</label>
                          <textarea
                            value={scene.description}
                            onChange={(e) => handleSceneDescriptionChange(scene.id, e.target.value)}
                            className="w-full bg-background border border-card-border rounded-md px-3 py-2 focus:ring-2 focus:ring-primary focus:outline-none transition-all text-sm"
                            rows={4}
                          />
                        </div>
                      ))}
                    </div>
                    <button
                        onClick={handleGenerateAssets}
                        disabled={isLoading}
                        className={`font-bold py-3 px-6 rounded-md transition-colors flex items-center justify-center w-full text-lg mt-6 ${isLoading && currentTask === 'assets' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-dark'} text-white`}
                      >
                      {isLoading && currentTask === 'assets' ? <><Spinner className="mr-2" /><span>Cancel Generation</span></> : '✨ Generate All Assets'}
                    </button>
                  </div>
                )}
                
                {isLoading && progress.total > 0 && (
                    <div className="mb-8 p-4 bg-card rounded-lg">
                        <p className="text-center text-text-secondary mb-2">{progress.task}</p>
                        <div className="w-full bg-card-border rounded-full h-4 relative overflow-hidden">
                            <div className="bg-primary h-4 rounded-full absolute top-0 left-0" style={{ width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.5s ease-in-out' }}></div>
                            <span className="absolute inset-0 text-center text-xs font-bold flex items-center justify-center text-white">{progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%</span>
                        </div>
                    </div>
                )}
                
                {assetsReady && (
                    <div className="bg-card border border-card-border rounded-lg p-6 my-8 shadow-lg">
                      <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-primary-light">Step 2: Generated Assets</h2>
                         <button 
                            onClick={handleDownloadAll} 
                            disabled={isLoading || scenes.every(s => (s.imageBlobs.length === 0 || s.imageBlobs.every(b => !b)) && !s.audioBlob)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center text-base disabled:bg-gray-600 disabled:cursor-not-allowed"
                        >
                            {progress.task.includes('Zipping') ? <Spinner className="w-5 h-5"/> : '📦 Download All Assets'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
                        {scenes.map(scene => (
                          <SceneCard
                            key={scene.id}
                            scene={scene}
                            numVariations={numVariations}
                            onGeneratePrompts={handleGeneratePromptsForScene}
                            onGenerateImages={handleGenerateImagesForScene}
                            onImageClick={setSelectedImageUrl}
                            onClearImages={handleClearSceneImages}
                          />
                        ))}
                      </div>
                    </div>
                )}

                {allImagesGenerated && !isLoading && (
                  <div className="bg-card border border-card-border rounded-lg p-6 my-8 shadow-lg animate-fade-in">
                      <h2 className="text-xl font-bold mb-2 text-primary-light">Step 3: Assemble & Generate Video</h2>
                      <p className="text-text-secondary mb-6 text-sm">Fine-tune the duration for each image before creating the final video. Audio duration is used automatically when narration is enabled.</p>
                      
                      <div className="space-y-2 max-h-[60vh] overflow-y-auto p-2 bg-background/50 rounded-lg">
                          {flatImages.map((imgInfo, globalIndex) => (
                              <div key={`${imgInfo.sceneId}-${imgInfo.imageIndex}`} className="flex items-center gap-4 bg-card p-2 rounded-md border border-card-border">
                                  <img src={imgInfo.blobUrl} alt={`Scene ${imgInfo.sceneId} - Image ${imgInfo.imageIndex + 1}`} className="w-28 h-[78px] object-cover rounded" />
                                  <div className="flex-1">
                                      <p className="text-sm font-semibold">Scene {imgInfo.sceneId}, Image {imgInfo.imageIndex + 1}</p>
                                      {imgInfo.isAudioAttached && <p className="text-xs text-primary-light">Audio narration attached</p>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <input
                                          type="number"
                                          value={imageDurations[globalIndex] ?? ''}
                                          onChange={e => handleImageDurationChange(globalIndex, e.target.value)}
                                          disabled={isLoading || imgInfo.isAudioAttached}
                                          className="w-20 bg-background border border-card-border rounded-md px-2 py-1 text-center disabled:opacity-50"
                                          step="0.1"
                                          min="0.1"
                                      />
                                      <span className="text-sm text-text-secondary">sec</span>
                                  </div>
                              </div>
                          ))}
                      </div>

                      <button
                          onClick={handleGenerateVideo}
                          disabled={!allImagesGenerated || isLoading}
                          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-md transition-colors flex items-center justify-center w-full text-lg mt-6 disabled:bg-gray-600 disabled:cursor-not-allowed"
                      >
                          {isLoading && currentTask === 'video' ? <Spinner className="w-5 h-5 mr-2"/> : '🎬 Generate Video'}
                      </button>
                  </div>
                )}

              </>
            )}
          </>
      </div>
    </div>
  );
};

export default App;