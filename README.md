# SB Materials

A web application for SB Materials — a company providing inspection and auditing services for waste materials prior to resale and recycling. The app replaces paper-based and Google Forms workflows with a streamlined multi-user system for logging inspections, managing customers, and generating PDF reports.

## Features

- **Inspection Reports** — Create, edit, and manage inspection reports with support for multiple report types:
  - Fibre inspections (moisture readings, bale counts, storage modes)
  - Plastics/metals inspections (container tracking, loading references)
  - PERN audits (comprehensive compliance audits)
- **PDF Generation** — Download completed reports as formatted PDFs
- **Photo Attachments** — Upload and associate photos with reports and containers
- **Signature Capture** — Capture inspector signatures directly in the browser
- **Customer & Site Management** — Maintain customers and their inspection sites
- **Configurable Lookups** — Manage product descriptions, grades, storage modes, contaminants, and unwanted materials
- **User Management** — Multi-user support with superuser roles for administration
- **Search, Filter & Sort** — Quickly find reports by customer, date, status, and more

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Backend | Express, TypeScript |
| Database | SQLite (via better-sqlite3) |
| Auth | Express sessions (better-sqlite3-session-store) |
| PDF | pdfmake |
| Photos | multer, sharp |
| Signatures | react-signature-canvas |

## Prerequisites

- Node.js (v18 or later recommended)
- npm

## Getting Started

1. **Clone the repository**

   ```bash
   git clone <repo-url>
   cd sb-materials
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   Copy the default `.env` file and adjust as needed:

   ```bash
   cp .env.default .env
   ```

   | Variable | Description | Default |
   |----------|-------------|---------|
   | `PORT` | Server port | `3000` |
   | `DATA_DIR` | Directory for SQLite database and uploaded photos | `./data` |
   | `SESSION_SECRET` | Secret for signing session cookies (change in production) | — |
   | `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `http://localhost:5173` |

4. **Run in development mode**

   ```bash
   npm run dev
   ```

   This starts both the Express API server (port 3000) and the Vite dev server (port 5173) with hot reload.

5. **Build for production**

   ```bash
   npm run build
   npm start
   ```

   The production server serves the built React client and the API from a single Express process on the configured port.

## Deploying Behind Nginx

An example Nginx configuration is provided in `nginx.conf.example`. It proxies all traffic to the Express server and handles SSL termination. Adjust `server_name`, certificate paths, and upstream port to match your environment.

## Project Structure

```
sb-materials/
  client/              # React frontend (Vite)
    src/
      api/             # API client
      pages/           # Page components (Reports, ReportEdit, etc.)
      types/           # TypeScript types
  server/              # Express backend
    src/
      db/              # Schema and seed data
      routes/          # API routes (auth, users, customers, lookups, reports, photos, pdf)
  nginx.conf.example   # Example Nginx reverse proxy config
  package.json         # Workspace root
```

## Default Accounts

On first run the database is seeded with default users:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin` | Superuser |

Change this password immediately in any non-development environment.

## License

Released under the [PostgreSQL License](LICENSE.md). Copyright (c) 2026, Dave Page.
