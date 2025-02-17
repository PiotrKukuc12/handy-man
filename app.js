require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
const cors = require('cors');
const PORT = 3011;

const corsOptions = {
   origin: ['http://handy-man.com.pl', 'https://handy-man.com.pl'],
   methods: ['GET', 'POST'],
   allowedHeaders: ['Content-Type', 'Authorization'],
   credentials: true,
   optionsSuccessStatus: 200,
};

// Apply CORS middleware before other middleware and routes
app.use(cors(corsOptions));

// In-memory store for chat sessions
// In a production environment, you would want to use a database
const chatSessions = new Map();

// Middleware
app.use(express.json());

// Existing Google search function
async function searchGoogle(query) {
   const API_KEY = process.env.GOOGLE_API_KEY;
   const CSE_ID = process.env.GOOGLE_CX;
   const url = `https://www.googleapis.com/customsearch/v1?q=${query}&key=${API_KEY}&cx=${CSE_ID}`;

   try {
      const response = await axios.get(url);
      const data = response.data;

      if (!data.items) {
         return [{ name: 'Brak wyników', phone: 'N/A', link: 'N/A' }];
      }

      return data.items.slice(0, 5).map((item) => {
         const title = item.title || 'Brak nazwy';
         const snippet = item.snippet || 'Brak opisu';
         const link = item.link || 'Brak linku';

         // Wyciąganie numeru telefonu z opisu (snippet)
         const phoneMatch = snippet.match(/\+?\d[\d\s-]{8,14}\d/);
         const phone = phoneMatch ? phoneMatch[0] : 'Brak numeru';

         return { name: title, phone, link };
      });
   } catch (error) {
      console.error('Błąd podczas wyszukiwania:', error);
      return [{ name: 'Błąd', phone: 'N/A', link: 'N/A' }];
   }
}

// Generate a unique session ID
function generateSessionId() {
   return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
   );
}

// Process user message and generate bot response
async function processChatMessage(message, sessionId) {
   // Get or create session
   if (!chatSessions.has(sessionId)) {
      chatSessions.set(sessionId, {
         history: [
            {
               role: 'bot',
               content:
                  'Cześć! Jestem twoim asystentem do wyszukiwania złotych rączek. Powiedz mi, jakiego specjalistę szukasz i w jakiej lokalizacji?',
            },
         ],
         createdAt: Date.now(),
      });
   }

   const session = chatSessions.get(sessionId);

   // Add user message to history
   session.history.push({
      role: 'user',
      content: message,
   });

   // Determine if we need to search (most messages will trigger a search)
   if (message.length > 2) {
      try {
         // Add keywords to improve search relevance
         const searchQuery = `${message} złota rączka fachowiec`;
         const results = await searchGoogle(searchQuery);

         let botResponse;

         if (
            results.length === 0 ||
            (results.length === 1 && results[0].name === 'Brak wyników')
         ) {
            botResponse =
               'Nie znalazłem żadnych specjalistów pasujących do twojego zapytania. Możesz spróbować inaczej sformułować pytanie?';
         } else {
            botResponse = 'Oto wyniki wyszukiwania, które mogą Ci pomóc:';
         }

         // Add bot message to history
         session.history.push({
            role: 'bot',
            content: botResponse,
            results: results,
         });

         return {
            message: botResponse,
            results: results,
         };
      } catch (error) {
         console.error('Error during search:', error);
         const errorResponse =
            'Przepraszam, wystąpił błąd podczas wyszukiwania. Spróbuj ponownie później.';

         // Add error message to history
         session.history.push({
            role: 'bot',
            content: errorResponse,
         });

         return {
            message: errorResponse,
            results: [],
         };
      }
   } else {
      const shortInputResponse =
         'Potrzebuję więcej informacji. Jakiego specjalistę szukasz i w jakim mieście/dzielnicy?';

      // Add response to history
      session.history.push({
         role: 'bot',
         content: shortInputResponse,
      });

      return {
         message: shortInputResponse,
         results: [],
      };
   }
}

// Clean up old sessions (runs every hour)
setInterval(() => {
   const now = Date.now();
   const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // 24 hours

   for (const [sessionId, session] of chatSessions.entries()) {
      if (now - session.createdAt > MAX_SESSION_AGE) {
         chatSessions.delete(sessionId);
      }
   }
}, 60 * 60 * 1000);

// Routes

// Create a new chat session
app.post('/api/chat/session', (req, res) => {
   const sessionId = generateSessionId();
   chatSessions.set(sessionId, {
      history: [
         {
            role: 'bot',
            content:
               'Cześć! Jestem twoim asystentem do wyszukiwania złotych rączek. Powiedz mi, jakiego specjalistę szukasz i w jakiej lokalizacji?',
         },
      ],
      createdAt: Date.now(),
   });

   res.json({
      sessionId,
      message:
         'Cześć! Jestem twoim asystentem do wyszukiwania złotych rączek. Powiedz mi, jakiego specjalistę szukasz i w jakiej lokalizacji?',
   });
});

// Send a message in an existing chat session
app.post('/api/chat/message', async (req, res) => {
   const { sessionId, message } = req.body;

   if (!sessionId) {
      return res.status(400).json({ error: 'Brak identyfikatora sesji' });
   }

   if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Brak wiadomości' });
   }

   if (!chatSessions.has(sessionId)) {
      return res.status(404).json({ error: 'Sesja nie istnieje' });
   }

   const response = await processChatMessage(message, sessionId);
   res.json(response);
});

// Get chat history for a session
app.get('/api/chat/history/:sessionId', (req, res) => {
   const { sessionId } = req.params;

   if (!chatSessions.has(sessionId)) {
      return res.status(404).json({ error: 'Sesja nie istnieje' });
   }

   const session = chatSessions.get(sessionId);
   res.json({ history: session.history });
});

// Start server
app.listen(PORT, () => {
   console.log(`🚀 Server działa na http://localhost:${PORT}`);
});
