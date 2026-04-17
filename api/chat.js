export default async function handler(req, res) {
    const { message, context } = req.body;

    try {
        const response = await fetch(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a gut health coach AI.

Current User Data:
${context}`
                        },
                        {
                            role: 'user',
                            content: message
                        }
                    ],
                    max_tokens: 500,
                    temperature: 0.7
                })
            }
        );

        const data = await response.json();

        res.status(200).json({
            reply: data.choices[0].message.content
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}