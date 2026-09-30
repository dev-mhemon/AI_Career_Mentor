# AI Career Intelligence Mentor - MVP

## Project Overview
The AI Career Intelligence Mentor is an AI-powered platform designed to provide personalized career guidance, skills gap analysis, and tailored learning paths. This repository contains the Phase 0 foundational setup for the Minimum Viable Product (MVP).

## Architecture Reference
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Backend**: NestJS, TypeScript
- **Database**: PostgreSQL
- **Environment**: Docker (Database)
- **CI/CD**: GitHub Actions

See `docs/architecture` and the foundational design documents (`PRD`, `SAD`, `UI/UX`, `Development Plan`) for more details.

## Setup Instructions

### Prerequisites
- Node.js (v24 or higher)
- npm (v10 or higher)
- Docker Desktop
- Git

### 1. Environment Configuration
Copy the placeholder environment file to set up your local variables:
```bash
cp .env.example .env
```
*(Update `.env` with actual secrets as needed; never commit `.env` to source control)*

### 2. Database Setup
Start the local PostgreSQL development environment via Docker:
```bash
docker-compose up -d
```

### 3. Frontend Setup
Navigate to the frontend directory and install dependencies:
```bash
cd frontend
npm install
```

### 4. Backend Setup
Navigate to the backend directory and install dependencies:
```bash
cd backend
npm install
```

## Development Commands

### Frontend
- Start development server: `npm run dev`
- Build for production: `npm run build`
- Start production server: `npm run start`
- Run linter: `npm run lint`

### Backend
- Start development server: `npm run start:dev`
- Build for production: `npm run build`
- Start production server: `npm run start:prod`
- Run linter: `npm run lint`
- Run tests: `npm run test`

## Git Workflow
- **`main`**: Production-ready code.
- **`develop`**: Integration branch for new features.
- **Feature Branches**: Branch off `develop` (e.g., `feature/user-auth`) and submit PRs to `develop`.

## AI Agents
Please refer to `AGENTS.md` for strict development rules and constraints when contributing to this repository using AI assistants.
