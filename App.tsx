
import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Scene } from './types';
import { generateStoryFromTopic, generatePromptsForScene, generateImageFromPrompt, generateAudioFromText } from './services/geminiService';
import { createVideo } from './services/videoService';
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

const ApiKeyScreen: React.FC<{ onSetKey: (key: string) => void }> = ({ onSetKey }) => {
  const [localKey, setLocalKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (localKey.trim()) {
      onSetKey(localKey.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-card-border rounded-lg p-8 w-full max-w-md text-center animate-fade-in">
        <h2 className="text-2xl font-bold mb-2 text-primary-light">Enter Your API Key</h2>
        <p className="text-text-secondary mb-6">
          A Google AI API key is required. Your key is only used for this session and is not stored.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={localKey}
            onChange={(e) => setLocalKey(e.target.value)}
            placeholder="Enter your Gemini API Key"
            className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all mb-4 text-center"
            aria-label="Gemini API Key"
          />
          <button
            type="submit"
            className="w-full bg-primary text-white font-bold py-3 px-6 rounded-md transition-colors hover:bg-primary-dark disabled:bg-gray-600 disabled:cursor-not-allowed"
            disabled={!localKey.trim()}
          >
            Start Generating
          </button>
        </form>
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
  const [apiKey, setApiKey] = useState<string>(process.env.API_KEY || '');
  const [mode, setMode] = useState<Mode>('select');
  const [topic, setTopic] = useState<string>('');
  const [numVariations, setNumVariations] = useState(3);
  const [storyLength, setStoryLength] = useState(3000);
  const [orientation, setOrientation] = useState<'16:9' | '9:16'>('16:9');
  const [secondsPerImage, setSecondsPerImage] = useState(3);
  
  const [isTtsEnabled, setIsTtsEnabled] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(TTS_VOICES[0].id);
  const [voiceStyle, setVoiceStyle] = useState('Narrate in a clear, documentary style');

  const [estimatedTime, setEstimatedTime] = useState<string>('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0, task: '' });
  const [error, setError] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [storyReadyForReview, setStoryReadyForReview] = useState(false);
  
  const isCancelledRef = useRef(false);
  const autoGenerateTriggerRef = useRef(false);

  const scenesRef = useRef(scenes);
  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  const updateScene = useCallback((sceneId: number, updates: Partial<Scene>) => {
    setScenes(prevScenes =>
      prevScenes.map(s => (s.id === sceneId ? { ...s, ...updates } : s))
    );
  }, []);
  
  const estimateTime = useCallback((length: number) => {
    const CHARS_PER_MINUTE = 1750; // Average for fast-paced narration
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

    // 1. Invalid API Key (most critical)
    if (lowerCaseErrorMsg.includes('api key not valid') || lowerCaseErrorMsg.includes('api_key_invalid')) {
      setError('Your API key is invalid or missing. Please enter a valid key to continue.');
      setApiKey(''); // This will trigger the API key screen
      return;
    }

    // 2. Rate Limiting / Quota
    if (lowerCaseErrorMsg.includes('resource_exhausted') || lowerCaseErrorMsg.includes('rate limit') || lowerCaseErrorMsg.includes('"code":429')) {
       setError('Rate limit exceeded. This is likely due to your API key\'s usage quota. Please check your plan, wait a few minutes, and try again.');
       return;
    }
    
    // 3. Safety/Content Filters (very common for image generation)
    if (lowerCaseErrorMsg.includes('safety filters') || lowerCaseErrorMsg.includes('prompt was blocked') || (lowerCaseErrorMsg.includes('did not return an image') && lowerCaseErrorMsg.includes('generation failed'))) {
        setError('An asset could not be generated due to AI safety filters, likely because the topic or a prompt was deemed too sensitive. The process was stopped.');
        return;
    }

    // 4. Billing not enabled
    if (lowerCaseErrorMsg.includes('billing is not enabled')) {
        setError('Billing is not enabled for your project. Please visit your Google Cloud project console to enable billing for your API key.');
        return;
    }
    
    // 5. Generic fallback - Use the original error message as it's often descriptive enough.
    setError(originalErrorMsg);

  }, []);

  const resetStateForNewRun = () => {
     setError(null);
     setScenes([]);
     setStoryReadyForReview(false);
     setProgress({ current: 0, total: 0, task: '' });
     isCancelledRef.current = false;
  };

  const handleGenerateStory = async () => {
    if (!topic.trim()) {
      setError("Please enter a historical topic.");
      return;
    }
    resetStateForNewRun();
    setIsLoading(true);
    setCurrentTask('story');
    setProgress({ current: 1, total: 1, task: 'Generating compelling story...' });
    
    try {
      const sceneDescriptions = await generateStoryFromTopic(apiKey, topic, storyLength);
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
    setError(null);
    const scene = scenesRef.current.find(s => s.id === sceneId);
    if (!scene) return;
    
    updateScene(sceneId, { isPromptLoading: true });
    try {
      const prompts = await generatePromptsForScene(apiKey, scene.description, numVariations);
      updateScene(sceneId, { prompts, imageUrls: [], imageBlobs: [] }); // Clear old images when regenerating prompts
    } catch (e) {
      handleApiError(e);
      throw e; 
    } finally {
      updateScene(sceneId, { isPromptLoading: false });
    }
  }, [updateScene, numVariations, apiKey, handleApiError]);

  const handleClearSceneImages = useCallback((sceneId: number) => {
    updateScene(sceneId, {
      imageUrls: Array(numVariations).fill(null),
      imageBlobs: Array(numVariations).fill(null),
    });
  }, [updateScene, numVariations]);

  const handleGenerateImagesForScene = useCallback(async (sceneId: number) => {
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

        const { dataUrl, blob } = await generateImageFromPrompt(apiKey, scene.prompts[i], orientation);
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
  }, [updateScene, isLoading, orientation, apiKey, handleApiError]);

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
                    const audioBlob = await generateAudioFromText(apiKey, scene.description, selectedVoice, voiceStyle);
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
        scenes.forEach(scene => {
            scene.imageBlobs.forEach((blob, index) => {
                if (blob) {
                    const extension = blob.type.split('/')[1] || 'png';
                    const fileName = `images/${String(scene.id).padStart(3, '0')}_${index + 1}.${extension}`;
                    zip.file(fileName, blob);
                }
            });
            if (scene.audioBlob) {
                const audioFileName = `audio/${String(scene.id).padStart(3, '0')}_narration.pcm`;
                zip.file(audioFileName, scene.audioBlob);
            }
        });
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

    setIsLoading(true);
    setCurrentTask('video');

    try {
        const fileName = `${topic.replace(/\s+/g, '_') || 'historical_story'}_video`;
        
        // We need one audio blob per image blob
        const correspondingAudioBlobs: (Blob | null)[] = scenes.flatMap(scene => {
            const validImageBlobs = scene.imageBlobs.filter(b => b !== null);
            // If there's audio for the scene, assign it to the first image, null to others
            return validImageBlobs.map((_, index) => (index === 0 ? scene.audioBlob : null));
        });

        await createVideo({
            imageBlobs: allImageBlobs,
            audioBlobs: correspondingAudioBlobs,
            secondsPerImage,
            orientation,
            fileName,
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
  
  const showSceneCards = scenes.length > 0 && scenes.some(s => s.prompts.length > 0);
  const isGenerating = isLoading && (currentTask === 'story' || currentTask === 'assets');
  const scenesWithPrompts = scenes.filter(s => s.prompts.length > 0);
  const allImagesGenerated = scenesWithPrompts.length > 0 && scenesWithPrompts.every(s => s.imageBlobs.filter(Boolean).length === s.prompts.length);


  const resetAndChangeMode = () => {
    resetStateForNewRun();
    setTopic('');
    setMode('select');
  }

  if (!apiKey) {
    return (
        <>
            {error && (
              <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-md relative m-4 max-w-md mx-auto" role="alert">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{error}</span>
              </div>
            )}
            <ApiKeyScreen onSetKey={key => { setApiKey(key); setError(null); }} />
        </>
    )
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

        {mode === 'select' && <ModeSelectionScreen onSelectMode={setMode} />}
        
        {mode !== 'select' && (
          <>
            {error && (
              <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-md relative mb-6" role="alert">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{error}</span>
                <span className="absolute top-0 bottom-0 right-0 px-4 py-3 cursor-pointer" onClick={() => setError(null)}>
                  <svg className="fill-current h-6 w-6 text-red-200" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                </span>
              </div>
            )}

            <div className="bg-card border border-card-border rounded-lg p-6 mb-8 shadow-lg">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-bold text-primary-light">Step 1: Configure Your Video</h2>
                  <p className="text-xs text-text-secondary mt-1">Current Mode: <span className="font-semibold capitalize">{mode}</span></p>
                </div>
                <div className="flex gap-2">
                    <button onClick={resetAndChangeMode} className="text-sm text-primary-light hover:underline">&larr; Change Mode</button>
                    <button onClick={() => setApiKey('')} className="text-sm text-red-400 hover:underline">Change API Key</button>
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
                        max="10000"
                        step="500"
                        value={storyLength}
                        onChange={(e) => setStoryLength(Number(e.target.value))}
                        className="w-full h-2 bg-background rounded-lg appearance-none cursor-pointer"
                        disabled={isLoading}
                    />
                    <div className="text-xs text-text-secondary text-center mt-1">Est. Video Time: <span className="font-bold text-primary-light">{estimatedTime}</span></div>
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
                    <label className="block text-sm font-medium text-text-secondary mb-1">Image Orientation</label>
                    <div className="flex bg-background border border-card-border rounded-md p-1 space-x-1">
                        <button onClick={() => setOrientation('16:9')} disabled={isLoading} className={`w-1/2 rounded py-2 text-sm font-semibold transition-colors ${orientation === '16:9' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'}`}>Horizontal</button>
                        <button onClick={() => setOrientation('9:16')} disabled={isLoading} className={`w-1/2 rounded py-2 text-sm font-semibold transition-colors ${orientation === '9:16' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'}`}>Vertical</button>
                    </div>
                </div>
              </div>

              {/* Audio Narration Settings */}
              <div className="mt-6 pt-6 border-t border-card-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-primary-light">Audio Narration</h3>
                   <div className="flex items-center">
                      <span className={`text-sm mr-3 ${isTtsEnabled ? 'text-text-primary' : 'text-text-secondary'}`}>{isTtsEnabled ? 'Enabled' : 'Disabled'}</span>
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
                {isTtsEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4 animate-fade-in">
                    <div>
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
                    <div className="md:col-span-2">
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
                    <div>
                      <label htmlFor="seconds-per-image" className="block text-sm font-medium text-text-secondary mb-1">Seconds per Image</label>
                      <input
                        id="seconds-per-image"
                        type="number"
                        value={secondsPerImage}
                        onChange={(e) => setSecondsPerImage(Math.max(1, Math.min(10, Number(e.target.value))))}
                        min="1"
                        max="10"
                        className="w-full bg-background border border-card-border rounded-md px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none transition-all disabled:opacity-50"
                        disabled={isLoading || isTtsEnabled}
                      />
                      {isTtsEnabled && <p className="text-xs text-primary-light mt-1">Image duration is automatically synced to audio length.</p>}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-6 border-t border-card-border">
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
                    <div className="grid grid-cols-2 gap-4">
                        <button 
                            onClick={handleDownloadAll} 
                            disabled={isLoading || scenes.every(s => (s.imageBlobs.length === 0 || s.imageBlobs.every(b => !b)) && !s.audioBlob)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center w-full text-base disabled:bg-gray-600 disabled:cursor-not-allowed"
                        >
                            {progress.task.includes('Zipping') ? <Spinner className="w-5 h-5"/> : '📦 Download Assets'}
                        </button>
                        <button
                            onClick={handleGenerateVideo}
                            disabled={!allImagesGenerated || isLoading}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center w-full text-base disabled:bg-gray-600 disabled:cursor-not-allowed"
                        >
                            {isLoading && currentTask === 'video' ? <Spinner className="w-5 h-5"/> : '🎬 Generate Video'}
                        </button>
                    </div>
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
            
            {showSceneCards && (
                <div>
                  <h2 className="text-xl font-bold mb-4 text-primary-light text-center">Your Generated Assets</h2>
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
          </>
        )}
      </div>
    </div>
  );
};

export default App;