import { Router } from "express";
import { generateContent, editContent } from "../services/aiServe.js";

const router = Router();

// POST /api/generate
router.post("/generate", async (req, res) => {
  try {
    const { contentType, platform, targetAudience, userPrompt } = req.body;
    console.log(contentType, platform, targetAudience, userPrompt);

    const content = await generateContent(
      contentType,
      platform,
      targetAudience,
      userPrompt
    );
    res.json({ content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate content" });
  }
});

// POST /api/chat
router.post("/chat", async (req, res) => {
  try {
    const { platform, contentType, originalContent, editRequest } = req.body;
    console.log(platform, contentType, originalContent, editRequest);

    const content = await editContent(
      platform,
      contentType,
      originalContent,
      editRequest
    );
    res.json({ content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process edit request" });
  }
});

export default router;
