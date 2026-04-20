export default async function handler(req, res) {
    const { history = [] } = req.body;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: `
Generate a gut health multiple choice question.

Rules:
- 4 answer choices
- Only ONE correct answer
- Return JSON ONLY:
{
  "question": "...",
  "options": ["A", "B", "C", "D"],
  "correct": 0,
  "explanation": "..."
}`
                },
                {
                    role: "user",
                    content: `Previous questions: ${JSON.stringify(history)}`
                }
            ],
            temperature: 0.8
        })
    });

    const data = await response.json();
    const content = data.choices[0].message.content;

    res.status(200).json(JSON.parse(content));
}