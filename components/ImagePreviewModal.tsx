import React, { useEffect } from 'react';

interface ImagePreviewModalProps {
  imageUrl: string;
  onClose: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
      style={{ animationDuration: '150ms' }}
    >
      <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={imageUrl} alt="Full-size preview" className="w-auto h-auto max-w-full max-h-[90vh] object-contain rounded-lg" />
        <button 
          onClick={onClose}
          className="absolute -top-3 -right-3 bg-white text-black rounded-full w-8 h-8 flex items-center justify-center text-xl font-bold hover:bg-gray-200 transition-colors"
          aria-label="Close image preview"
        >
          &times;
        </button>
      </div>
    </div>
  );
};

export default ImagePreviewModal;
