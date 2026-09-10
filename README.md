# EduFusion AI — Full Stack Platform

A suite of AI tools for digital education: academic risk prediction (EduPredict), lecture
transcription (LectureScribe), an academic chatbot, and question generation (QuizForge) —
behind one account and one dashboard.

## Tech Stack

**Frontend:** React 18 + Vite + Tailwind CSS + Framer Motion  
**Backend:** Node.js + Express + PostgreSQL + JWT + bcryptjs  
**Database:** PostgreSQL (Render)  
**Chatbot API:** https://final-iug-chat-botv2.onrender.com

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
    │       ├── Landing.jsx        # Public home page explaining the platform
    │       ├── Auth.jsx           # Sign in + 2-step student registration
    │       ├── DashboardHome.jsx
    │       ├── ChatbotPage.jsx
    │       ├── Placeholders.jsx
    │       └── LectureScribePage.jsx # YouTube lecture transcription
    ├── public/
    │   ├── edufusion-preview.mp4        # Concept film shown on the landing page
    │   └── edufusion-preview-poster.jpg # Its poster frame
    ├── vercel.json            # SPA rewrite — required, see Deployment
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
- `GET  /api/auth/registration-courses` — Course presentations open for registration
- `POST /api/auth/register-student` — Creates a student + enrollment → `{ token, user, warnings }`
  (`email` is optional; every other field in `REQUIRED_REGISTRATION_FIELDS` is not)
- `GET  /api/auth/me` — Returns current user (requires Bearer token)
- `POST /api/auth/logout` — Clears session

### Dashboard
- `GET /api/dashboard/stats` — Total students, enrollments, predictions, at-risk count
- `GET /api/dashboard/predictions/recent?limit=10` — Recent predictions with student info
- `GET /api/dashboard/risk-distribution` — Risk level breakdown for charts
- `GET /api/dashboard/course-stats` — Enrollment counts per course module

### Chatbot (Proxies to the current IUG API)
- `GET  /api/chatbot/health` — Lightweight liveness check against the current chatbot
- `POST /api/chatbot/chat` — `{ question, session_id }` → `{ answer, session_id, source }`
- `GET  /api/chatbot/history/:session_id`
- `DELETE /api/chatbot/history/:session_id`

EduFusion keeps its own authentication boundary and calls the chatbot's stateless
`/api/chat/guest` endpoint from the backend. The last five completed turns are
forwarded for follow-up context. The legacy chatbot file proxy was removed; use
the current chatbot admin portal at
`https://final-iug-chat-botv2.onrender.com/app/admin.html`.

### LectureScribe
- `GET  /api/lecture-scribe/health` — Check the transcription service
- `POST /api/lecture-scribe/jobs` — Submit a YouTube lecture
- `GET  /api/lecture-scribe/jobs` — List persisted transcription jobs
- `GET  /api/lecture-scribe/jobs/:jobId` — Poll job progress
- `GET  /api/lecture-scribe/jobs/:jobId/transcript?kind=cleaned` — Read the result

All LectureScribe endpoints require the EduFusion bearer token. The Express backend
proxies requests to `LECTURESCRIBE_API_URL`, keeping the external service URL and
cross-origin behavior out of the browser.

## Deployment

The frontend is a client-routed SPA, so the host **must** serve `index.html` for every
path — otherwise refreshing (or opening a direct link to) `/dashboard/...` returns a 404
from the host before React ever loads. `frontend/vercel.json` does this on Vercel:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

It only takes effect when Vercel's **Root Directory** is set to `frontend`. If the project
is ever built from the repository root instead, move `vercel.json` there too.

Set `VITE_API_URL` in the Vercel project to the deployed backend's `/api` base, and
`FRONTEND_URL` on the backend so CORS allows the deployed origin.

## Optional Render Keep-Alive Checks

The scheduled workflow in `.github/workflows/render-keep-alive.yml` performs three
small checks every ten minutes:

- `GET https://final-iug-chat-botv2.onrender.com/live`
- `GET https://edupredict-api-6ob5.onrender.com/health`
- `SELECT 1` against PostgreSQL

It is intentionally disabled until the repository variable
`ENABLE_RENDER_KEEP_ALIVE=true` is added. Also add the PostgreSQL connection string
as a GitHub Actions secret named `DATABASE_URL`. Optional repository variables
`CHATBOT_API_URL` and `EDUPREDICT_API_URL` override the default public URLs.

Keeping two Render Free web services continuously active can exceed the 750 Free
instance hours available to one workspace each month. In addition, a ping cannot
prevent a Free Render PostgreSQL database from expiring after its plan's lifetime.
Use paid instances for guaranteed uptime and durable PostgreSQL availability; use
this workflow only when its Free-hour tradeoff is acceptable.

### PostgreSQL connection resilience

The backend pool enables TCP keep-alive and retries transient connection errors up
to `DB_QUERY_RETRIES` times (default: `2`). In a Render deployment, configure
`DATABASE_URL` with the database's **Internal Database URL** when the web service
and PostgreSQL are in the same Render region. Keep the External Database URL for
local development only.

These settings recover from idle sockets, maintenance restarts, and brief network
interruptions. They cannot revive an expired database or prevent a Free database
from reaching its expiration date.

## Color Palette
| Variable | Hex |
|---|---|
| Primary (page background) | `#F5F5F5` |
| Secondary (brand teal) | `#76ABAE` |
| Accent (highlight orange) | `#FF5722` |
| Light Accent (text) | `#222831` |

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
