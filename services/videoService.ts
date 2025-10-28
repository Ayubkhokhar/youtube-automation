declare const saveAs: any;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

interface VideoCreationOptions {
    imageBlobs: Blob[];
    audioBlobs: (Blob | null)[];
    secondsPerImage: number;
    orientation: '16:9' | '9:16';
    onProgress: (current: number, total: number, task: string) => void;
    fileName: string;
}

/**
 * Decodes raw PCM audio data (Int16) into an AudioBuffer for playback.
 * The Gemini TTS model returns audio at a 24000Hz sample rate.
 */
async function decodePcmData(
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
    secondsPerImage,
    orientation,
    onProgress,
    fileName
}: VideoCreationOptions): Promise<void> => {
    return new Promise(async (resolve, reject) => {
        const [width, height] = orientation === '16:9' ? [1280, 720] : [720, 1280];
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return reject(new Error("Could not get canvas context"));
        }

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        
        const videoTrack = canvas.captureStream(25).getVideoTracks()[0];
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

        const recorder = new MediaRecorder(combinedStream, { mimeType });
        const recordedChunks: Blob[] = [];

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        recorder.onstop = () => {
            onProgress(1, 1, 'Finalizing video file...');
            const videoBlob = new Blob(recordedChunks, { type: mimeType });
            saveAs(videoBlob, `${fileName}.webm`);
            audioContext?.close();
            resolve();
        };

        recorder.onerror = (event) => {
            audioContext?.close();
            reject((event as any).error || new Error("MediaRecorder error"));
        };
        
        recorder.start();

        const drawFrame = (img: ImageBitmap) => {
            const hRatio = canvas.width / img.width;
            const vRatio = canvas.height / img.height;
            const ratio = Math.min(hRatio, vRatio);
            const centerShift_x = (canvas.width - img.width * ratio) / 2;
            const centerShift_y = (canvas.height - img.height * ratio) / 2;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillRect(0, 0, width, height); // Black background
            ctx.drawImage(img, 0, 0, img.width, img.height, centerShift_x, centerShift_y, img.width * ratio, img.height * ratio);
        };

        for (let i = 0; i < imageBlobs.length; i++) {
            try {
                const imgBlob = imageBlobs[i];
                const audioBlob = audioBlobs[i];
                onProgress(i, imageBlobs.length, `Stitching scene ${i + 1}/${imageBlobs.length}...`);
                
                const img = await createImageBitmap(imgBlob);
                drawFrame(img);
                
                let durationMs = secondsPerImage * 1000;

                if (audioBlob && audioContext && audioDestination) {
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const audioBuffer = await decodePcmData(arrayBuffer, audioContext);
                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioDestination);
                    source.start();
                    durationMs = audioBuffer.duration * 1000;
                }
                
                await delay(durationMs);

            } catch (e) {
                recorder.stop();
                reject(e);
                return;
            }
        }

        recorder.stop();
    });
};