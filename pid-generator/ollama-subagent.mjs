// ollama-subagent.mjs — Call Ollama model as a sub-agent via HTTP API
// Usage: node ollama-subagent.mjs <model> <prompt>
// Example: node ollama-subagent.mjs qwen3.6:35b-a3b "What is 2+2?"

const model = process.argv[2] || 'qwen3.6:35b-a3b';
const prompt = process.argv[3];

if (!prompt) {
  console.error('Usage: node ollama-subagent.mjs <model> <prompt>');
  process.exit(1);
}

const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  }),
});

const data = await response.json();
if (data.message) {
  console.log(data.message.content);
} else {
  console.error('Error:', JSON.stringify(data));
  process.exit(1);
}
