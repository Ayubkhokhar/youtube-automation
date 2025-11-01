declare const saveAs: any;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export interface VideoCreationOptions {
    imageBlobs: Blob[];
    audioBlobs: (Blob | null)[];
    durations: number[];
    orientation: '16:9' | '9:16';
    quality: '720p' | '1080p';
    onProgress: (current: number, total: number, task: string) => void;
    fileName: string;
    isAnimationEnabled?: boolean;
}

/**
 * Decodes raw PCM audio data (Int16) into an AudioBuffer for playback.
 * The Gemini TTS model returns audio at a 24000Hz sample rate.
 */
export async function decodePcmData(
  data: ArrayBuffer,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


export const createVideo = async ({
    imageBlobs,
    audioBlobs,
    durations,
    orientation,
    quality,
    onProgress,
    fileName,
    isAnimationEnabled = false,
}: VideoCreationOptions): Promise<void> => {
    return new Promise(async (resolve, reject) => {
        const resolutions = {
            '720p': orientation === '16:9' ? [1280, 720] : [720, 1280],
            '1080p': orientation === '16:9' ? [1920, 1080] : [1080, 1920],
        };
        const [width, height] = resolutions[quality];
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return reject(new Error("Could not get canvas context"));
        }

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        
        const videoTrack = canvas.captureStream(30).getVideoTracks()[0];
        const hasAudio = audioBlobs && audioBlobs.some(b => b !== null);
        
        let combinedStream: MediaStream;

        const audioContext = hasAudio ? new AudioContext({ sampleRate: 24000 }) : null;
        const audioDestination = audioContext ? audioContext.createMediaStreamDestination() : null;
        
        if (hasAudio && audioDestination) {
            const audioTrack = audioDestination.stream.getAudioTracks()[0];
            combinedStream = new MediaStream([videoTrack, audioTrack]);
        } else {
            combinedStream = new MediaStream([videoTrack]);
        }
        
        const mimeType = 'video/webm; codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            // Fallback for browsers that don't support vp9 with opus
            const fallbackMimeType = 'video/webm; codecs=vp9';
            if (!MediaRecorder.isTypeSupported(fallbackMimeType)) {
               return reject(new Error(`Video format ${fallbackMimeType} is not supported by your browser.`));
            }
        }
        
        const bitsPerSecond = {
            '720p': 5_000_000,  // Increased from 2.5M for higher quality (YouTube's recommendation)
            '1080p': 8_000_000, // Increased from 5M for higher quality (YouTube's recommendation)
        };

        const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: bitsPerSecond[quality] });
        const recordedChunks: Blob[] = [];
        const activeAudioSources = new Set<AudioBufferSourceNode>();

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        recorder.onstop = () => {
            onProgress(1, 1, 'Finalizing video file...');
            activeAudioSources.forEach(s => s.stop());
            const videoBlob = new Blob(recordedChunks, { type: mimeType });
            saveAs(videoBlob, `${fileName}.webm`);
            audioContext?.close();
            resolve();
        };

        recorder.onerror = (event) => {
            activeAudioSources.forEach(s => s.stop());
            audioContext?.close();
            reject((event as any).error || new Error("MediaRecorder error"));
        };
        
        recorder.start();

        const drawStaticFrame = (img: ImageBitmap) => {
             // This function is kept for the non-animated case.
            const imgAspectRatio = img.width / img.height;
            const canvasAspectRatio = canvas.width / canvas.height;
            let sx, sy, sWidth, sHeight;

            if (imgAspectRatio > canvasAspectRatio) {
                sHeight = img.height;
                sWidth = sHeight * canvasAspectRatio;
                sx = (img.width - sWidth) / 2;
                sy = 0;
            } else {
                sWidth = img.width;
                sHeight = sWidth / canvasAspectRatio;
                sx = 0;
                sy = (img.height - sHeight) / 2;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
        };

        const drawAnimatedFrame = (img: ImageBitmap, scale: number, panX: number, panY: number) => {
            const sourceWidth = img.width / scale;
            const sourceHeight = img.height / scale;
            const sx = (img.width - sourceWidth) / 2 * (1 + panX);
            const sy = (img.height - sourceHeight) / 2 * (1 + panY);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, sx, sy, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        };

        const animateImage = (img: ImageBitmap, durationMs: number): Promise<void> => {
            return new Promise(resolve => {
                const startTime = performance.now();
                
                const zoomDirection = Math.random() > 0.5 ? 1 : -1;
                const startScale = zoomDirection === 1 ? 1.0 : 1.15;
                const endScale = zoomDirection === 1 ? 1.15 : 1.0;

                const panXStart = Math.random() * 2 - 1;
                const panYStart = Math.random() * 2 - 1;
                const panXEnd = Math.random() * 2 - 1;
                const panYEnd = Math.random() * 2 - 1;
                
                const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

                const frame = (currentTime: number) => {
                    const elapsedTime = currentTime - startTime;
                    let progress = Math.min(elapsedTime / durationMs, 1.0);
                    progress = easeInOutCubic(progress);

                    const currentScale = startScale + (endScale - startScale) * progress;
                    const currentPanX = panXStart + (panXEnd - panXStart) * progress;
                    const currentPanY = panYStart + (panYEnd - panYStart) * progress;
                    
                    drawAnimatedFrame(img, currentScale, currentPanX, currentPanY);

                    if (elapsedTime < durationMs) {
                        requestAnimationFrame(frame);
                    } else {
                        drawAnimatedFrame(img, endScale, panXEnd, panYEnd);
                        resolve();
                    }
                };
                requestAnimationFrame(frame);
            });
        };


        for (let i = 0; i < imageBlobs.length; i++) {
            try {
                activeAudioSources.forEach(s => s.stop());
                activeAudioSources.clear();

                const imgBlob = imageBlobs[i];
                const audioBlob = audioBlobs[i];
                onProgress(i, imageBlobs.length, `Stitching scene ${i + 1}/${imageBlobs.length}...`);
                
                const img = await createImageBitmap(imgBlob);
                const durationMs = durations[i] * 1000;

                if (audioBlob && audioContext && audioDestination) {
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const audioBuffer = await decodePcmData(arrayBuffer, audioContext);
                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioDestination);
                    source.start();
                    activeAudioSources.add(source);
                }

                if (isAnimationEnabled) {
                    await animateImage(img, durationMs);
                } else {
                    drawStaticFrame(img);
                    await delay(durationMs);
                }
            } catch (e) {
                recorder.stop();
                reject(e);
                return;
            }
        }

        recorder.stop();
    });
};