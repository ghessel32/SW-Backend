import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

// Load and parse the prompt templates
let promptTemplates = null;

// Platform to API key mapping
const PLATFORM_API_MAPPING = {
  // YouTube
  youtube: "YT_API_KEY",
  yt: "YT_API_KEY",

  // LinkedIn, Reddit, X (Twitter)
  linkedin: "LRX_API_KEY",
  reddit: "LRX_API_KEY",
  x: "LRX_API_KEY",
  twitter: "LRX_API_KEY",

  // Instagram, TikTok, Facebook, Email
  instagram: "ITFE_API_KEY",
  insta: "ITFE_API_KEY",
  tiktok: "ITFE_API_KEY",
  facebook: "ITFE_API_KEY",
  fb: "ITFE_API_KEY",
  email: "ITFE_API_KEY",
};

// Model fallback configuration
const MODEL_FALLBACK_CHAIN = [
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
  "meta-llama/llama-4-maverick:free",
];

// Function to get the appropriate API key for a platform
function getApiKeyForPlatform(platform) {
  const platformLower = platform.toLowerCase();
  const apiKeyName = PLATFORM_API_MAPPING[platformLower];

  if (!apiKeyName) {
    throw new Error(
      `Unsupported platform: ${platform}. Available platforms: ${Object.keys(
        PLATFORM_API_MAPPING
      ).join(", ")}`
    );
  }

  const apiKey = process.env[apiKeyName];
  if (!apiKey) {
    throw new Error(
      `API key ${apiKeyName} not found in environment variables for platform ${platform}`
    );
  }

  return apiKey;
}

async function loadPromptTemplates() {
  if (!promptTemplates) {
    try {
      const promptData = await fs.readFile(
        path.join(process.cwd(), "src", "prompt.json"),
        "utf8"
      );

      promptTemplates = JSON.parse(promptData);
    } catch (error) {
      console.error("Error loading prompt templates:", error);
      throw new Error("Failed to load prompt configuration");
    }
  }
  return promptTemplates;
}

function buildPrompt(contentType, platform, targetAudience, userPrompt) {
  const templates = promptTemplates?.content_creation_prompts;

  if (!templates) {
    throw new Error("Prompt templates not loaded");
  }

  const platformTemplates = templates[platform.toLowerCase()];
  if (!platformTemplates) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const contentTemplate = platformTemplates[contentType.toLowerCase()];
  if (!contentTemplate) {
    throw new Error(
      `Unsupported content type '${contentType}' for platform '${platform}'`
    );
  }

  // Gather data
  const humanRules = templates.global_guidelines?.["Human Rules"] || "";
  const length = contentTemplate.length || "";
  const defaultTone = contentTemplate.default_tone || "";
  const rules = contentTemplate.rules?.map((r) => `- ${r}`).join("\n") || "";
  const constraints =
    contentTemplate.constraints?.map((c) => `- ${c}`).join("\n") || "";
  const outputFormat =
    contentTemplate.output_format?.map((f) => `- ${f}`).join("\n") || "";

  // Assemble prompt
  const fullPrompt = `
${contentTemplate.prompt} ${userPrompt}

Human like writing rules:
${humanRules}

Additional rules:
- Platform-specific rules override global guidelines when they conflict.
- Target Audience: ${targetAudience}
- Length: ${length} [*Adjust length according to target audience or idea]
- Default Tone: ${defaultTone} [*Adjust tone according to target audience or idea]
${rules}

Constraints:
${constraints}

**Just give final output.**
  `.trim();

  return fullPrompt;
}

function sanitizeContent(content) {
  // First, apply the original regex replacement
  let sanitized = content.replace(
    /^<\|start\|>assistant<\|channel\|>final<\|message\|>\s*/,
    ""
  );

  // Check if content contains "assistantfinal"
  if (sanitized.includes("assistantfinal")) {
    // Split by "assistantfinal" and take the last part
    const parts = sanitized.split("assistantfinal");
    sanitized = parts[parts.length - 1].trim();
  } else {
    // Just trim the content
    sanitized = sanitized.trim();
  }

  return sanitized;
}

function isRateLimitError(error, responseData) {
  if (error.message && error.message.includes("429")) return true;
  if (responseData?.error?.code === 429) return true;
  if (responseData?.error?.message?.toLowerCase().includes("rate-limited"))
    return true;
  return false;
}

// Make API call with model fallback
async function makeApiCallWithFallback(apiKey, prompt, modelIndex = 0) {
  if (modelIndex >= MODEL_FALLBACK_CHAIN.length) {
    throw new Error("All models are rate-limited. Please try again later.");
  }

  const currentModel = MODEL_FALLBACK_CHAIN[modelIndex];
  console.log(
    `Attempting with model: ${currentModel} (attempt ${modelIndex + 1})`
  );

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [{ role: "user", content: prompt }],
        }),
      }
    );

    const data = await response.json();

    // Check if this is a rate limit error
    if (
      !response.ok &&
      isRateLimitError(new Error(response.statusText), data)
    ) {
      console.log(
        `Model ${currentModel} is rate-limited, trying next model...`
      );
      return await makeApiCallWithFallback(apiKey, prompt, modelIndex + 1);
    }

    // Enhanced error handling for other errors
    if (!response.ok) {
      console.error("API Error:", data);
      throw new Error(
        `API request failed: ${data.error?.message || response.statusText}`
      );
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Invalid API Response:", data);
      throw new Error("Invalid response structure from API");
    }

    console.log(`Successfully used model: ${currentModel}`);
    return data.choices[0].message.content;
  } catch (error) {
    // If it's a rate limit error, try the next model
    if (isRateLimitError(error, null)) {
      console.log(
        `Model ${currentModel} is rate-limited, trying next model...`
      );
      return await makeApiCallWithFallback(apiKey, prompt, modelIndex + 1);
    }

    // For other errors, throw immediately
    throw error;
  }
}

export async function generateContent(
  contentType,
  platform,
  targetAudience,
  userPrompt
) {
  try {
    // Load prompt templates if not already loaded
    await loadPromptTemplates();

    // Get the appropriate API key for the platform
    const apiKey = getApiKeyForPlatform(platform);

    // Build the comprehensive prompt
    const prompt = buildPrompt(
      contentType,
      platform,
      targetAudience,
      userPrompt
    );

    console.log("Generated Prompt:", prompt); // For debugging
    console.log(
      `Using API key for platform ${platform}:`,
      apiKey.substring(0, 10) + "..."
    ); // Log first 10 chars for debugging

    // Use the new fallback function
    const content = await makeApiCallWithFallback(apiKey, prompt);
    return sanitizeContent(content);
  } catch (error) {
    console.error("Error in generateContent:", error);
    throw error;
  }
}

export async function editContent(
  platform,
  contentType,
  originalContent,
  editRequest
) {
  console.log(platform, contentType, originalContent, editRequest);

  const prompt = `Here is the original content:
${originalContent}

Edit Request: ${editRequest}

Please rewrite the content according to the edit request while maintaining the original style and format. Keep the same content type and platform requirements.
**just give final output do not share what u change or anything else**
`;

  try {
    // Get the appropriate API key for the platform
    const apiKey = process.env.EDIT_API_KEY;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-maverick:free",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
          temperature: 0.7,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("API Error:", data);
      throw new Error(
        `API request failed: ${data.error?.message || response.statusText}`
      );
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Invalid API Response:", data);
      throw new Error("Invalid response structure from API");
    }

    return sanitizeContent(data.choices[0].message.content);
  } catch (error) {
    console.error("Error in editContent:", error);
    throw error;
  }
}

// Helper function to get available platforms and content types
export function getAvailableOptions() {
  if (!promptTemplates) {
    throw new Error("Prompt templates not loaded. Call generateContent first.");
  }

  const platforms = Object.keys(
    promptTemplates.content_creation_prompts
  ).filter((key) => key !== "global_guidelines");

  const contentTypes = {};
  platforms.forEach((platform) => {
    contentTypes[platform] = Object.keys(
      promptTemplates.content_creation_prompts[platform]
    );
  });

  return { platforms, contentTypes };
}

// Helper function to validate inputs
export function validateInputs(contentType, platform) {
  if (!promptTemplates) {
    throw new Error("Prompt templates not loaded");
  }

  const templates = promptTemplates.content_creation_prompts;

  if (!templates[platform.toLowerCase()]) {
    const availablePlatforms = Object.keys(templates).filter(
      (key) => key !== "global_guidelines"
    );
    throw new Error(
      `Invalid platform: ${platform}. Available platforms: ${availablePlatforms.join(
        ", "
      )}`
    );
  }

  if (!templates[platform.toLowerCase()][contentType.toLowerCase()]) {
    const availableTypes = Object.keys(templates[platform.toLowerCase()]);
    throw new Error(
      `Invalid content type: ${contentType} for platform ${platform}. Available types: ${availableTypes.join(
        ", "
      )}`
    );
  }

  return true;
}

// Helper function to get platform API mapping info
export function getPlatformApiInfo() {
  return PLATFORM_API_MAPPING;
}

// Helper function to get current model fallback chain
export function getModelFallbackChain() {
  return MODEL_FALLBACK_CHAIN;
}
