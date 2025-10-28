export interface Scene {
  id: number;
  description: string;
  prompts: string[];
  imageUrls: string[];
  imageBlobs: (Blob | null)[];
  audioBlob: Blob | null;
  isPromptLoading: boolean;
  isImageLoading: boolean;
  isAudioLoading: boolean;
}