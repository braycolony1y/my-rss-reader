# Project Overview

Custom self-hosted RSS reader with AI summarization capabilities, offline caching, and support for complex platforms (e.g., Voz, Reddit) through custom extractors and third-party fallback (OpenCLI, Jina Reader).

# Architecture Summary

- **Frontend**: Single Page Application (SPA) built with Alpine.js and Tailwind CSS (`index.html`, `script.js`).
- **Backend**: Node.js/Express (`server.js`) serving API routes and handling scheduled jobs.
- **AI/LLM**: Integrates Gemini/Qwen APIs via `summary-engine.js` for article summarization and deep analysis.
- **Storage**: In-memory database with write-through persistence to local JSON files (`database.json`, `smart-data.json`).
- **Data Gathering**: Custom source parsers for local news/forums (e.g., Voz, Tuoi Tre) inside `src/sources/`, falling back to `opencli` and `Jina Reader`.

# Runtime Architecture

- App boots via `server.js`.
- Express initializes middleware and HTTP endpoints.
- In-memory database `_dbCache` loads from JSON files, handling file locks (`database.writer.lock`).
- Background intervals start for cache cleanup and feed prefetching.
- Summary engine queue starts processing requested summaries asynchronously.
- Server listens on configured port (default 3000).

# Request Flow

1. User accesses the frontend application in the browser.
2. `script.js` performs HTTP `fetch` requests to backend API endpoints.
3. Express router in `server.js` receives the request.
4. If article data is requested, the backend uses `src/sources/` handlers or external fetchers, caching the sanitized result in `article_cache/`.
5. Data is returned as JSON to the frontend, where Alpine.js reactivity updates the DOM.

# Data Flow

1. **Feeds**: Stored in `database.json`. Polled periodically or on-demand via user actions.
2. **Parsing**: Custom source files (e.g., `VozSource.js`) parse HTML using regex or DOM APIs.
3. **Storage**: Extracted text, images, and metadata are sanitized and stored in `article_cache/` as versioned JSON.
4. **Presentation**: Client fetches article by URL; backend serves from cache or fetches dynamically, returning formatted HTML.

# Frontend Architecture

- `index.html`: Contains layout, component templates, and modal definitions. Uses Tailwind utility classes.
- `script.js`: Contains the Alpine.js component `rssApp()`, which manages all reactive state (feeds, articles, UI modals, tabs).
- Local storage is used for preferences and themes.

# Backend Architecture

- `server.js`: Main entry point, sets up Express, manages in-memory DB locking, provides core API routes.
- `summary-engine.js`: Manages AI processing queues, API key rotation (Gemini/Qwen), and caching of summaries.
- `smart-news.js`: Logic for clustering news topics and generating AI-based insights.
- `src/sources/`: Modular parser handlers overriding generic fetching behaviors to extract specialized fields.

# Database Structure

- **database.json**: Main store for user feeds and article metadata lists. Includes automatic `.backup` rolling snapshots.
- **smart-data.json**: Stores heavy AI clustered data (`smartClusters`, `smartRawArticles`) to keep the primary DB file small and performant.
- **article_cache/**: Directory containing SHA-256 hashed JSON files for individual article contents.

# Cache Layers

- **Article Cache**: Disk-based cache for fetched articles with a 7-day TTL (`article_cache/`).
- **JSON Parsing Cache**: In-memory cache (`_jsonParsedCache`) in `server.js` to avoid repeatedly `JSON.parse`-ing large strings from the database.
- **Summary Cache**: Disk cache for AI-generated summaries.

# External Services

- **Jina Reader** (`r.jina.ai`): Used as a generic fallback for converting URLs to Markdown.
- **Google News URL Decoder**: Decodes obfuscated Google News links.
- **Gemini / Qwen API**: Used for AI-based summaries and contextual content analysis.
- **Vietserver Proxy**: Configurable proxy for bypassing blocked regional sites.
- **OpenCLI**: Used for scraping heavy, JS-rendered pages when lightweight scraping fails.

# Scheduled Jobs

- **Cache Cleanup**: `setInterval` runs every 1 hour to prune expired items from `article_cache/`.
- **Feed Prefetching**: `setInterval` runs every 30 minutes to pre-fetch universal tab feeds.
- **Summary Queue**: Polling occurs every 3 seconds in `summary-engine.js`.

# RSS Pipeline

Feed Fetching
↓
Parsing (Custom source in `src/sources/` or generic fallback)
↓
Normalization (Sanitizing HTML, stripping junk nodes)
↓
Storage (Disk cache in `article_cache/`)
↓
API (Served via Express)
↓
Frontend (Rendered via Alpine.js)

# Configuration

- `.env`: General configurations (Port, Proxy URLs, application passwords).
- `gemini.env`: Specific LLM configurations/keys to isolate API secrets.
- `gemini-keys.txt`: Fallback list of API keys for round-robin rotation.

# Deployment Architecture

- Deployed on a Linux VPS.
- Managed via `systemd` as `rss-reader.service`.
- Runs directly on Node.js without Docker abstraction.

# Open Questions

- None.

# Assumptions

- Systemd ensures the Node.js process restarts on failure.
- User data model assumes a single-tenant or simplified multi-tenant environment (authenticated via a shared password or lightweight session).

# Architecture Confidence

- Project Understanding: 95%
- Architecture Confidence: 95%
- Remaining Unknown Areas: None critical.

# Structure Completion Assessment

Can Structure Building Stop?

YES

Reason:

- Startup flow is understood.
- Runtime architecture is understood.
- Request flow is understood.
- Data flow is understood.
- Database/storage layer is understood.
- Cache layer is understood.
- Background jobs are understood.
- Frontend/backend interaction is understood.
- Deployment architecture is understood.
- No critical unknown areas remain.
