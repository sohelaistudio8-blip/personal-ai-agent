export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Health check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Personal AI Agent API",
      message: "API route is running."
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing in Vercel Environment Variables."
      });
    }

    const body = req.body || {};
    const message =
      typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (message.length > 12000) {
      return res.status(400).json({
        error: "Message is too long. Please shorten it."
      });
    }

    // Choose the model
    const fastModel =
      process.env.OPENAI_FAST_MODEL || "gpt-6-luna";

    const reasoningModel =
      process.env.OPENAI_REASONING_MODEL || "gpt-6-astra";

    const requestedModel =
      typeof body.model === "string" ? body.model : "fast";

    const mode =
      typeof body.mode === "string" ? body.mode : "auto";

    const complexTask =
      message.length > 1200 ||
      /\b(analy[sz]e|reason|architecture|debug|complex|strategy|compare|research|plan|code|program|explain in depth)\b/i.test(message);

    let model = fastModel;

    if (requestedModel === "reasoning") {
      model = reasoningModel;
    } else if (mode === "auto" && complexTask) {
      model = reasoningModel;
    }

    // Safely prepare conversation history
    const history = Array.isArray(body.history)
      ? body.history.slice(-12)
      : [];

    const input = [];

    for (const item of history) {
      if (!item || typeof item.content !== "string") continue;

      if (item.role !== "user" && item.role !== "assistant") {
        continue;
      }

      const content = item.content.trim();

      if (!content || content.length > 12000) continue;

      input.push({
        role: item.role,
        content: content
      });
    }

    // Avoid sending the latest message twice
    const lastItem = input[input.length - 1];

    if (
      !lastItem ||
      lastItem.role !== "user" ||
      lastItem.content !== message
    ) {
      input.push({
        role: "user",
        content: message
      });
    }

    const payload = {
      model: model,
      instructions:
        "You are a helpful personal AI assistant. " +
        "Be accurate, thoughtful, practical, and honest. " +
        "Follow the user's language. If the user writes Bengali or Banglish, " +
        "reply naturally in Bengali or Banglish. " +
        "Never pretend to have completed an action you have not performed. " +
        "If you do not know something, say so clearly.",
      input: input,
      max_output_tokens: 1500,
      store: false
    };

    if (model === reasoningModel) {
      payload.reasoning = {
        effort: "medium"
      };
    }

    // Send the message to OpenAI
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    let response;

    try {
      response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "OpenAI could not process your request."
      });
    }

    // Extract the AI's answer
    let reply =
      typeof data.output_text === "string"
        ? data.output_text.trim()
        : "";

    if (!reply && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (
              part.type === "output_text" &&
              typeof part.text === "string"
            ) {
              reply += part.text;
            }
          }
        }
      }

      reply = reply.trim();
    }

    if (!reply) {
      return res.status(502).json({
        error: "The AI returned an empty response. Please try again."
      });
    }

    // Send the answer back to the website
    return res.status(200).json({
      reply: reply,
      provider: "OpenAI",
      model: model
    });

  } catch (error) {
    console.error("Chat API error:", error);

    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "The AI took too long to respond. Please try again."
      });
    }

    return res.status(500).json({
      error: "Server error. Please check your Vercel deployment and API settings."
    });
  }
        }
