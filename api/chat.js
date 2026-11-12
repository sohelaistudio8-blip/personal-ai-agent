export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Health check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Personal AI Agent",
      provider: "Google Gemini"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing."
      });
    }

    const body = req.body || {};

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (message.length > 12000) {
      return res.status(400).json({
        error: "Message is too long."
      });
    }

    const model =
      process.env.GEMINI_MODEL || "gemini-2.5-flash";

    // Prepare conversation history
    const history = Array.isArray(body.history)
      ? body.history.slice(-10)
      : [];

    const contents = [];

    for (const item of history) {
      if (!item || typeof item.content !== "string") {
        continue;
      }

      if (
        item.role !== "user" &&
        item.role !== "assistant"
      ) {
        continue;
      }

      const content = item.content.trim();

      if (!content || content.length > 12000) {
        continue;
      }

      contents.push({
        role:
          item.role === "assistant"
            ? "model"
            : "user",
        parts: [{ text: content }]
      });
    }

    // Add latest message if not already included
    const lastItem = contents[contents.length - 1];

    if (
      !lastItem ||
      lastItem.role !== "user" ||
      lastItem.parts[0].text !== message
    ) {
      contents.push({
        role: "user",
        parts: [{ text: message }]
      });
    }

    // AI instructions
    const systemInstruction = `
You are a personal AI assistant.

Your responsibilities:
- Help the user think, plan and solve problems.
- Give accurate and practical answers.
- Understand Bengali, Banglish and English.
- Reply in the language used by the user.
- Be honest about your abilities and limitations.
- Never claim that you completed an action you did not perform.
- Ask for permission before sensitive or important actions.
- Never invent research, sources or facts.
- Keep answers clear and useful.
- Remember the conversation context provided to you.
`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1200
      }
    };

    // Call Gemini API
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 55000);

    let response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json();

    // Handle API errors
    if (!response.ok) {
      console.error("Gemini API error:", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Gemini could not process your request."
      });
    }

    // Extract AI response
    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim() || "";

    if (!reply) {
      return res.status(502).json({
        error: "The AI returned an empty response."
      });
    }

    // Keep frontend response format unchanged
    return res.status(200).json({
      reply,
      provider: "Google Gemini",
      model
    });

  } catch (error) {
    console.error("Personal AI error:", error);

    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "The AI took too long to respond."
      });
    }

    return res.status(500).json({
      error: "Server error. Please check your deployment."
    });
  }
    }
