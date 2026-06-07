# EduPredict AI — Full Stack Platform

A production-ready AI academic platform with authentication, dashboard, and chatbot integration.

## Tech Stack

**Frontend:** React 18 + Vite + Tailwind CSS + Framer Motion  
**Backend:** Node.js + Express + PostgreSQL + JWT + bcryptjs  
**Database:** PostgreSQL (Render)  
**Chatbot API:** https://iug-chatbot.onrender.com

**LectureScribe API:** https://lecturescribe.app

## Project Structure

```
edupredict/
├── backend/
│   ├── src/
│   │   ├── index.js          # Express server entry
│   │   ├── db/
│   │   │   ├── index.js      # PostgreSQL connection pool
│   │   │   └── queries.js    # All database queries
│   │   ├── middleware/
│   │   │   └── auth.js       # JWT middleware
│   │   └── routes/
│   │       ├── auth.js       # Login / logout / me
│   │       ├── dashboard.js  # Stats, predictions, charts
│   │       └── chatbot.js    # Proxy to IUG chatbot API
│   ├── .env
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx            # Router
    │   ├── main.jsx
    │   ├── index.css          # Global styles + Tailwind
    │   ├── context/
    │   │   └── AuthContext.jsx
    │   ├── services/
    │   │   └── api.js         # Axios instance + services
    │   ├── components/
    │   │   ├── auth/
    │   │   │   └── ProtectedRoute.jsx
    │   │   └── layout/
    │   │       ├── Sidebar.jsx
    │   │       └── DashboardLayout.jsx
    │   └── pages/
    │       ├── Login.jsx
    │       ├── DashboardHome.jsx
    │       ├── ChatbotPage.jsx
    │       ├── Placeholders.jsx
    │       └── LectureScribePage.jsx # YouTube lecture transcription
    ├── tailwind.config.js
    ├── vite.config.js
    └── package.json
```

## Setup & Run

### 1. Backend

```bash
cd backend
npm install
# .env is already configured with your database
npm run dev        # development
npm start          # production
```

Server runs on: **http://localhost:5000**

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # development (http://localhost:3000)
npm run build      # production build
```

## API Endpoints

### Auth
- `POST /api/auth/login` — `{ username, password }` → `{ token, user }`
- `GET  /api/auth/me` — Returns current user (requires Bearer token)
- `POST /api/auth/logout` — Clears session

### Dashboard
- `GET /api/dashboard/stats` — Total students, enrollments, predictions, at-risk count
- `GET /api/dashboard/predictions/recent?limit=10` — Recent predictions with student info
- `GET /api/dashboard/risk-distribution` — Risk level breakdown for charts
- `GET /api/dashboard/course-stats` — Enrollment counts per course module

### Chatbot (Proxies to IUG API)
- `POST /api/chatbot/chat` — `{ question, session_id }` → `{ answer, session_id, top_chunks }`
- `GET  /api/chatbot/history/:session_id`
- `DELETE /api/chatbot/history/:session_id`

### LectureScribe
- `GET  /api/lecture-scribe/health` — Check the transcription service
- `POST /api/lecture-scribe/jobs` — Submit a YouTube lecture
- `GET  /api/lecture-scribe/jobs` — List persisted transcription jobs
- `GET  /api/lecture-scribe/jobs/:jobId` — Poll job progress
- `GET  /api/lecture-scribe/jobs/:jobId/transcript?kind=cleaned` — Read the result

All LectureScribe endpoints require the EduFusion bearer token. The Express backend
proxies requests to `LECTURESCRIBE_API_URL`, keeping the external service URL and
cross-origin behavior out of the browser.

## Color Palette
| Variable | Hex |
|---|---|
| Primary | `#091413` |
| Secondary | `#285A48` |
| Accent | `#408A71` |
| Light Accent | `#B0E4CC` |

## Adding Future APIs

The following pages are scaffolded and ready for API integration:

1. **AI Tool** (`/dashboard/ai-tool`) → Edit `src/pages/Placeholders.jsx`
2. **Question Generator** (`/dashboard/question-gen`) → Edit `src/pages/Placeholders.jsx`
3. **LectureScribe** (`/dashboard/youtube`) → Connected to the external FastAPI service

For each, add the API endpoint to `src/services/api.js` and build the UI component.

## Database Tables Used

| Table | Purpose |
|---|---|
| `app_users` | Authentication (`username`, `password_hash`, `role`, `is_active`) |
| `students` | Student profiles |
| `enrollments` | Course enrollments |
| `predictions` | Risk predictions |
| `course_presentations` | Course modules |

## Security Features
- JWT tokens (24h expiry)
- bcryptjs password hashing
- Rate limiting on login (10 attempts / 15 min)
- Protected routes (client + server side)
- SQL injection prevention (parameterized queries)
- CORS configured for localhost origins
