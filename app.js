require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT = 3011;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Configure CORS
const corsOptions = {
   origin: ['http://handy-man.com.pl', 'https://handy-man.com.pl'],
   methods: ['GET', 'POST'],
   allowedHeaders: ['Content-Type', 'Authorization'],
   credentials: true,
   optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

// In-memory session storage
const chatSessions = new Map();

const tools = [{
    "type": "function",
    "function": {
        "name": "searchGoogle",
        "description": "Search Google for a given query and return the top 5 results.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to look up on Google."
                }
            },
            "required": ["query"],
            "additionalProperties": false
        },
        "strict": true
    }
}];

// Google Search Function
async function searchGoogle(query) {
   try {
      const { data } = await axios.get(
         `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(
            query
         )}&key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_CX}`
      );

      return (
         data.items?.slice(0, 5).map((item) => ({
            name: item.title || 'Brak nazwy',
            phone:
               item.snippet?.match(/\+?\d[\d\s-]{8,14}\d/)?.[0] ||
               'Brak numeru',
            link: item.link || 'Brak linku',
         })) || [{ name: 'Brak wyników', phone: 'N/A', link: 'N/A' }]
      );
   } catch (error) {
      console.error('Google search error:', error);
      return [{ name: 'Błąd wyszukiwania', phone: 'N/A', link: 'N/A' }];
   }
}

// Session Management
function createSession(sessionId) {
   chatSessions.set(sessionId, {
      history: [
         {
            role: 'assistant',
            content:
               'Cześć! Jestem twoim asystentem do wyszukiwania złotych rączek. Powiedz mi, jakiego specjalistę szukasz i w jakiej lokalizacji?',
         },
      ],
      createdAt: Date.now(),
      threadId: null,
   });
   return chatSessions.get(sessionId);
}

// Handle OpenAI Function Calls
async function handleToolCalls(threadId, runId, toolCalls) {
   const toolOutputs = [];

   for (const toolCall of toolCalls) {
      if (toolCall.function.name === 'searchGoogle') {
         const { query } = JSON.parse(toolCall.function.arguments);
         const results = await searchGoogle(query);
         toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(results),
         });
      }
   }

   await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: toolOutputs,
   });
}

// Process Messages with OpenAI
async function processMessage(sessionId, message) {
   const session = chatSessions.get(sessionId);

   try {
      // Create thread if not exists
      if (!session.threadId) {
         const thread = await openai.beta.threads.create();
         session.threadId = thread.id;
      }

      // Add user message to thread
      await openai.beta.threads.messages.create(session.threadId, {
         role: 'user',
         content: message,
      });

      // Create and monitor run
      let run = await openai.beta.threads.runs.create(session.threadId, {
         assistant_id: ASSISTANT_ID,
         tools: tools, // Add the tools array here
      });

      while (true) {
         await new Promise((resolve) => setTimeout(resolve, 1000));
         run = await openai.beta.threads.runs.retrieve(
            session.threadId,
            run.id
         );

         if (run.status === 'completed') {
            const messages = await openai.beta.threads.messages.list(
               session.threadId,
               {
                  order: 'desc',
                  limit: 1,
               }
            );

            const assistantMessage = messages.data[0].content[0].text.value;

            session.history.push(
               { role: 'user', content: message },
               { role: 'assistant', content: assistantMessage }
            );

            return assistantMessage;
         }

         if (run.status === 'requires_action') {
            await handleToolCalls(
               session.threadId,
               run.id,
               run.required_action.submit_tool_outputs.tool_calls
            );
         }
      }
   } catch (error) {
      console.error('OpenAI processing error:', error);
      return 'Wystąpił błąd podczas przetwarzania żądania.';
   }
}
// Routes
app.post('/api/chat/session', (req, res) => {
   const sessionId = Math.random().toString(36).substring(2, 18);
   createSession(sessionId);
   res.json({
      sessionId,
      message: chatSessions.get(sessionId).history[0].content,
   });
});

app.post('/api/chat/message', async (req, res) => {
   const { sessionId, message } = req.body;

   if (!chatSessions.has(sessionId)) {
      return res.status(404).json({ error: 'Sesja nie istnieje' });
   }

   const session = chatSessions.get(sessionId);
   console.log('Processing message for session:', sessionId);
   console.log('Current thread ID:', session.threadId);

   try {
      const response = await processMessage(sessionId, message);
      res.json({ message: response });
   } catch (error) {
      res.status(500).json({ error: 'Błąd przetwarzania wiadomości' });
   }
});

app.get('/api/chat/history/:sessionId', (req, res) => {
   const session = chatSessions.get(req.params.sessionId);
   res.json(
      session ? { history: session.history } : { error: 'Sesja nie istnieje' }
   );
});

// Cleanup old sessions
setInterval(() => {
   const now = Date.now();
   for (const [id, session] of chatSessions.entries()) {
      if (now - session.createdAt > 86400000) chatSessions.delete(id);
   }
}, 3600000);

app.listen(PORT, () =>
   console.log(`🚀 Server działa na http://localhost:${PORT}`)
);
