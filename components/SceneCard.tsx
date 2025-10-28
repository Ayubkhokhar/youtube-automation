import React from 'react';
import { Scene } from '../types';
import Spinner from './Spinner';

interface SceneCardProps {
  scene: Scene;
  numVariations: number;
  onGeneratePrompts: (sceneId: number) => void;
  onGenerateImages: (sceneId: number) => void;
  onImageClick: (imageUrl: string) => void;
  onClearImages: (sceneId: number) => void;
}

const SceneCard: React.FC<SceneCardProps> = ({ scene, numVariations, onGeneratePrompts, onGenerateImages, onImageClick, onClearImages }) => {
  const hasPrompts = scene.prompts.length > 0;
  const generatedImageCount = scene.imageUrls.filter(Boolean).length;
  const hasSomeImages = generatedImageCount > 0;
  const hasAllImages = hasPrompts && generatedImageCount === scene.prompts.length;

  let imageButtonText = 'Generate Images';
  if (hasSomeImages && !hasAllImages) {
    imageButtonText = 'Complete Images';
  } else if (hasAllImages) {
    imageButtonText = 'Generated';
  }


  return (
    <div className="bg-card border border-card-border rounded-lg p-4 flex flex-col gap-4 transition-all duration-300 hover:border-primary-dark">
      <h3 className="text-lg font-bold text-primary">Scene {scene.id}</h3>
      <p className="text-text-secondary text-sm flex-grow min-h-[60px]">{scene.description}</p>
      
      {scene.prompts.length > 0 && (
        <div className="mt-2">
          <label className="text-xs font-semibold text-text-secondary block mb-1">Image Prompts</label>
          <div className="w-full bg-background border border-card-border rounded-md p-2 text-xs h-28 resize-none overflow-y-auto space-y-2">
            {scene.prompts.map((prompt, index) => (
              <p key={index} className="border-b border-card-border pb-1 mb-1 last:border-b-0 last:pb-0 last:mb-0">
                <span className="font-bold text-primary/80">{index + 1}:</span> {prompt}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2`}>
        {Array.from({ length: numVariations }).map((_, index) => (
          <div key={index} className="aspect-video bg-background rounded-md flex items-center justify-center overflow-hidden border border-card-border">
            {scene.isImageLoading && !scene.imageUrls[index] ? (
               <div className="flex flex-col items-center gap-1 text-text-secondary text-center p-1">
                 <Spinner className="w-6 h-6" />
                 <span className="text-xs">Generating...</span>
               </div>
            ) : scene.imageUrls[index] ? (
              <button onClick={() => onImageClick(scene.imageUrls[index])} className="w-full h-full focus:outline-none focus:ring-2 focus:ring-primary-light rounded-md transition-all">
                <img src={scene.imageUrls[index]} alt={`Generated image ${index + 1} for scene ${scene.id}`} className="w-full h-full object-cover" />
              </button>
            ) : (
              <span className="text-xs text-text-secondary/70 text-center p-1">Image {index + 1}</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-auto">
        <button
          onClick={() => onGeneratePrompts(scene.id)}
          disabled={scene.isPromptLoading}
          className="w-full flex-1 bg-primary/20 text-primary hover:bg-primary/30 disabled:bg-gray-600/50 disabled:text-gray-400 disabled:cursor-not-allowed font-semibold py-2 px-4 rounded-md transition-colors text-sm flex items-center justify-center gap-2"
        >
          {scene.isPromptLoading ? <Spinner className="w-4 h-4" /> : (hasPrompts ? 'Regenerate Prompts' : 'Generate Prompts')}
        </button>
        <div className="flex-1 flex gap-2">
          <button
            onClick={() => onGenerateImages(scene.id)}
            disabled={scene.prompts.length === 0 || scene.isImageLoading || hasAllImages}
            className="w-full flex-1 bg-primary text-white hover:bg-primary-dark disabled:bg-gray-600 disabled:cursor-not-allowed font-semibold py-2 px-4 rounded-md transition-colors text-sm flex items-center justify-center gap-2"
          >
            {scene.isImageLoading && !hasAllImages ? <Spinner className="w-4 h-4" /> : imageButtonText}
          </button>
          {hasSomeImages && (
             <button
              onClick={() => onClearImages(scene.id)}
              disabled={scene.isImageLoading}
              className="bg-red-900/70 text-red-200 hover:bg-red-900 px-3 rounded-md transition-colors text-xs font-semibold disabled:opacity-50"
              title="Clear all images for this scene"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SceneCard;