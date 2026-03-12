export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Clé API manquante." });

  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);

    const { messages, max_tokens = 1000 } = body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages manquants ou invalides" });
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Erreur Groq" });
    }

    // Adapter le format Groq → format Anthropic attendu par App.js
    return res.status(200).json({
      content: [{ type: "text", text: data.choices?.[0]?.message?.content || "Pas de réponse." }]
    });

  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
}

export const config = {
  api: { bodyParser: true },
};