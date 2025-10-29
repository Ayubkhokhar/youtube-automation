import { GoogleGenAI, Type, Modality } from "@google/genai";

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Generates a story from a historical topic.
 * @param topic The historical topic.
 * @param storyLength The desired character length of the story.
 * @param numScenes The exact number of scenes to generate.
 * @param apiKey The user-provided API key.
 * @returns A promise that resolves to an array of scene descriptions.
 */
export const generateStoryFromTopic = async (topic: string, storyLength: number, numScenes: number, apiKey: string): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Create a detailed story about the historical topic: "${topic}".
The story should be approximately ${storyLength} characters long.
Divide the story into exactly ${numScenes} distinct scenes, each representing a key visual moment.
Each scene description should be a single paragraph.`;

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                description: `An array of strings, where each string is a scene description. There should be exactly ${numScenes} scenes.`,
                items: { type: Type.STRING }
              }
            }
          },
        },
      });
      
      const jsonText = response.text.trim();
      const result = JSON.parse(jsonText);
      
      if (!result.scenes || !Array.isArray(result.scenes) || result.scenes.length < (numScenes * 0.8)) { // Allow for slight deviation
        throw new Error("Failed to parse a sufficient number of scenes. The model response might be in an unexpected format or the topic too narrow.");
      }

      return result.scenes;
    } catch (error) {
      attempt++;
      console.error(`Error generating story (Attempt ${attempt}/${maxRetries}):`, error);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRateLimitError = errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('"code":429') || errorMessage.toLowerCase().includes('quota exceeded');

      if (isRateLimitError) {
        if (attempt >= maxRetries) {
          throw new Error("Rate limit or quota repeatedly exceeded while generating story. Please check your plan and billing details, wait a few minutes, and try again.");
        }
        const backoffTime = 65000; // Over a minute for text models' per-minute quota
        console.log(`Rate limit/quota hit. Waiting ${backoffTime / 1000} seconds before retrying...`);
        await delay(backoffTime);
      } else {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Failed to generate story. Please check the console for details.");
      }
    }
  }
  throw new Error("An unknown error occurred after multiple retries while generating the story.");
};


/**
 * Generates multiple AI image prompts for a scene description.
 * @param description The description of the scene.
 * @param numVariations The number of prompts to generate.
 * @param apiKey The user-provided API key.
 * @returns A promise that resolves to an array of cinematic image prompts.
 */
export const generatePromptsForScene = async (description: string, numVariations: number, apiKey: string): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Your task is to act as a prompt engineer for a historical illustration AI. This AI has strict safety filters and will reject prompts that are too graphic, violent, or sensitive.

Based on the scene description below, create ${numVariations} distinct, safe-for-work, and highly detailed cinematic image prompts.

**CRITICAL INSTRUCTIONS:**
1.  **Focus on Visuals, Not Violence:** Instead of describing acts of violence, focus on the *atmosphere*, *emotion*, and *visual storytelling*. Describe lighting (e.g., "dramatic chiaroscuro lighting," "golden hour sunlight"), camera angles (e.g., "low-angle shot," "cinematic wide shot"), and character expressions (e.g., "a look of grim determination," "faces etched with worry").
2.  **Avoid Trigger Words:** Do not use words like "blood," "kill," "attack," "wound," or overly graphic terms. Instead, imply action and conflict through composition and mood. For example, instead of "a bloody battle," use "a chaotic scene of a medieval field engagement, focusing on the mud-splattered boots and determined faces of soldiers under a stormy sky."
3.  **Be Descriptive and Artistic:** Use rich, artistic language. Mention textures, colors, and composition.

Scene Description: "${description}"

Generate the prompts.`;

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              prompts: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            }
          },
        },
      });
      
      const jsonText = response.text.trim();
      const result = JSON.parse(jsonText);
      
      if (!result.prompts || !Array.isArray(result.prompts) || result.prompts.length === 0) {
        throw new Error("Model did not return valid prompts in the expected format.");
      }

      return result.prompts;
    } catch (error) {
      attempt++;
      console.error(`Error generating prompts (Attempt ${attempt}/${maxRetries}):`, error);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRateLimitError = errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('"code":429') || errorMessage.toLowerCase().includes('quota exceeded');

      if (isRateLimitError) {
        if (attempt >= maxRetries) {
          throw new Error("Rate limit or quota repeatedly exceeded while generating prompts. Please check your plan and billing details, wait a few minutes, and try again.");
        }
        const backoffTime = 65000;
        console.log(`Rate limit/quota hit. Waiting ${backoffTime / 1000} seconds before retrying...`);
        await delay(backoffTime);
      } else {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Failed to generate image prompts. The model response may be invalid.");
      }
    }
  }
  throw new Error("An unknown error occurred after multiple retries while generating prompts.");
};


/**
 * Generates an image from a prompt with a retry mechanism for rate limiting.
 * @param prompt The image generation prompt.
 * @param aspectRatio The desired aspect ratio for the image ('16:9' or '9:16').
 * @param apiKey The user-provided API key.
 * @returns A promise that resolves to an object containing the base64 data URL and the image blob.
 */
export const generateImageFromPrompt = async (prompt: string, aspectRatio: '16:9' | '9:16', apiKey: string): Promise<{ dataUrl: string; blob: Blob }> => {
  const ai = new GoogleGenAI({ apiKey });
  const maxRetries = 3;
  let attempt = 0;
  
  // Add aspect ratio to the prompt as this model doesn't have a specific config for it.
  const fullPrompt = `${prompt}, cinematic, aspect ratio ${aspectRatio}`;

  while (attempt < maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: fullPrompt }],
        },
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

      if (!imagePart || !imagePart.inlineData) {
        throw new Error("Image generation failed: The model did not return an image. This may be due to safety filters or an issue with the prompt.");
      }
      
      const base64ImageBytes = imagePart.inlineData.data;
      const mimeType = imagePart.inlineData.mimeType;
      const dataUrl = `data:${mimeType};base64,${base64ImageBytes}`;
      const blob = await (await fetch(dataUrl)).blob();

      return { dataUrl, blob };

    } catch (error) {
      attempt++;
      console.error(`Error generating image (Attempt ${attempt}/${maxRetries}):`, error);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRateLimitError = errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('"code":429') || errorMessage.toLowerCase().includes('quota exceeded');

      if (isRateLimitError) {
        if (attempt >= maxRetries) {
            throw new Error("Rate limit or quota repeatedly exceeded. This may be due to your API key's quota. Please check your plan and billing details, wait a few minutes, and try again.");
        }
        // Wait for over a minute and a half to ensure the quota resets.
        const backoffTime = 91000; 
        console.log(`Rate limit/quota hit. Waiting ${backoffTime / 1000} seconds before retrying...`);
        await delay(backoffTime);
      } else {
        // For non-rate-limit errors, fail immediately.
        throw error;
      }
    }
  }

  throw new Error("An unknown error occurred after multiple retries while generating an image.");
};

const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates audio from text using a TTS model.
 * @param text The text to convert to speech.
 * @param voiceName The name of the prebuilt voice to use.
 * @param stylePrompt An optional prompt to guide the voice style.
 * @param apiKey The user-provided API key.
 * @returns A promise that resolves to an audio Blob.
 */
export const generateAudioFromText = async (text: string, voiceName: string, stylePrompt: string, apiKey: string): Promise<Blob> => {
  const ai = new GoogleGenAI({ apiKey });
  
  const fullPrompt = stylePrompt ? `${stylePrompt}: ${text}` : text;

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: fullPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        throw new Error("Audio generation failed: The model did not return audio data.");
      }
      
      const audioBytes = decode(base64Audio);
      return new Blob([audioBytes], { type: 'audio/pcm' });

    } catch (error) {
      attempt++;
      console.error(`Error generating audio (Attempt ${attempt}/${maxRetries}):`, error);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRateLimitError = errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('"code":429') || errorMessage.toLowerCase().includes('quota exceeded');

      if (isRateLimitError) {
        if (attempt >= maxRetries) {
          throw new Error("Rate limit or quota repeatedly exceeded while generating audio. Please check your plan and billing details, wait a few minutes, and try again.");
        }
        const backoffTime = 65000;
        console.log(`Rate limit/quota hit. Waiting ${backoffTime / 1000} seconds before retrying...`);
        await delay(backoffTime);
      } else {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Failed to generate audio. Please check the console for details.");
      }
    }
  }
  throw new Error("An unknown error occurred after multiple retries while generating audio.");
};


/**
 * Generates a suggestion for background music based on a topic.
 * @param topic The historical topic.
 * @param apiKey The user-provided API key.
 * @returns A promise that resolves to a string with the music suggestion.
 */
export const generateBackgroundMusicSuggestion = async (topic: string, apiKey: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Based on the historical topic "${topic}", describe the ideal background music for a short documentary video. Be concise and evocative. Focus on mood, tempo, and key instrumentation.

  Examples:
  - Topic: The Black Death in Europe -> "A somber, slow-tempo orchestral piece with haunting cellos and violins, evoking a sense of tragedy and loss."
  - Topic: The Golden Age of Piracy -> "An upbeat, adventurous orchestral score with swelling brass, rhythmic drums, and a hint of a sea shanty melody, creating a feeling of exploration and high-stakes action."
  - Topic: The construction of the Great Wall of China -> "A sweeping, majestic instrumental featuring traditional Chinese instruments like the guzheng and erhu, combined with a powerful orchestral backbone to convey a sense of immense scale and enduring legacy."`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestion: {
              type: Type.STRING,
              description: "A concise description of the suggested background music."
            }
          }
        },
      },
    });
    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText);
    if (!result.suggestion) {
      throw new Error("Model did not return a valid music suggestion.");
    }
    return result.suggestion;
  } catch (error) {
    console.error('Error generating music suggestion:', error);
    // Don't retry for this non-critical feature to avoid blocking the user.
    throw new Error("Failed to generate music suggestion.");
  }
};