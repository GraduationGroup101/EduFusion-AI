require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const chatbotRoutes = require('./routes/chatbot');
const chatbotFilesRoutes = require('./routes/chatbotFiles');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');
const questionGeneratorRoutes = require('./routes/questionGenerator');
const lectureScribeRoutes = require('./routes/lectureScribe');

const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/chatbot-files', chatbotFilesRoutes);
app.use('/api/question-generator', questionGeneratorRoutes);
app.use('/api/lecture-scribe', lectureScribeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});