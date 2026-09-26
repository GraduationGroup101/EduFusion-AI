# Lecture study validation — 2026-09-26

Scope: `feature/lecture-study-integration`, based on the existing reference-design branch. The university chatbot repository, deployment and data were not modified. The main chatbot and question-generator page and gateway files have no diff against the feature base.

## Automated verification

- `npm run check`: lint, 45 backend tests, 17 frontend tests and the production build passed.
- `python -m unittest discover -s services/lecture-study -p test_engine.py`: 11 tests passed.
- Real SQL integration coverage includes ownership enforcement, private histories and answer keys, shared prepared content across 50 accounts, idempotency, persistent quotas after history removal, lease fencing, preparation checkpoints, account removal, read-only academic recommendations and encrypted recovery.
- Model regressions found during local testing now reject unsupported language drift, use exact option text to derive MCQ answer indices, and check evidence relevance before producing a chat answer.

## Local environment

An independent loopback PostgreSQL instance stores both a synthetic academic demo and a separate learning database. The original `backend/.env` remains unchanged. Local credentials, model traces, snapshots, database files and the preview profile are ignored by Git.

The worker uses the existing local Ollama installation. The small Qwen 1.5B model was useful for initial integration checks but produced unsuitable language and answer-key output; it is not the selected final local worker model. Llama 3.1 8B uses partial GPU offload, a small inference batch and memory mapping on the available 4 GiB GPU.

The local retrieval mode is explicitly lexical. Semantic E5 embeddings are implemented but their optional Python dependency installation timed out, so semantic retrieval was not validated on this machine. No external AI account or paid service was created.

## Recovery and operational limits

An authenticated encrypted snapshot was restored into a new native PostgreSQL database. It recovered lecture text, memberships, chunks, jobs, private messages, a quiz, a graded attempt and usage counters. UTC usage dates were compared with the source database. Restore neither overwrites an existing database nor accesses academic tables.

The preview uses synthetic students and a short networking transcript. This verifies application wiring; it is not an Arabic/English model-quality benchmark or a production capacity test. More varied lecture material and manually reviewed answer keys remain necessary before broad access.

The production academic database was unavailable and the existing transcription provider was offline during verification. No production migration, deployment, merge, chatbot change or academic prediction regeneration was performed. The feature remains off by default until a separate production learning database and worker are configured.
