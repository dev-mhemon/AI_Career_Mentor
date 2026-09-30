# System Architecture Document (SAD) v1.1

## Product

AI Career Intelligence Mentor

## Status

Architecture Frozen

## Architecture Scope

YES - Frozen

## Ready for Development

YES

------------------------------------------------------------------------

# 1. System Overview

AI Career Intelligence Mentor is a personal AI-powered career guidance
platform designed for personal use and limited sharing with
approximately 50-100 users.

The system uses a modular monolith architecture.

Core goals:

-   Personalized career guidance
-   AI-generated career roadmaps
-   Learning task generation
-   Progress tracking
-   AI mentor conversations

High-level architecture:

User\
↓\
Next.js Frontend\
↓\
NestJS Backend API\
↓\
PostgreSQL Database\
↓\
OpenAI AI Service Layer

------------------------------------------------------------------------

# 2. Architecture Components

## Frontend

Technology: - Next.js - TypeScript

Responsibilities: - User interface - Profile management - Roadmap
display - Task tracking - Progress dashboard - AI mentor chat

## Backend

Technology: - NestJS - TypeScript

Responsibilities: - Authentication - Authorization - Business logic - AI
orchestration - Progress evaluation - Admin functions

## AI Module

Responsibilities: - Context building - Prompt management - OpenAI API
integration - Response validation - Memory extraction

## Progress Evaluation Service

Responsibilities:

-   Analyze completed tasks
-   Evaluate projects
-   Process assessments
-   Calculate readiness score
-   Identify skill gaps
-   Generate explanations

------------------------------------------------------------------------

# 3. Technology Stack Decisions

## Frontend

Next.js + TypeScript

Reason: - Industry standard - Maintainable - Good ecosystem - Future
expansion support

## Backend

NestJS + TypeScript

Reason: - Structured backend architecture - Same language ecosystem -
Good modular design

## Database

PostgreSQL

Reason: - Reliable relational database - Suitable for user, skill,
roadmap, and progress relationships

## Authentication

Supabase Auth

Supports: - Email/password - Phone/password - Google login - Facebook
login

## AI Provider

OpenAI API

Strategy: - Use latest cost-effective OpenAI model - Use lower-cost
models where appropriate - Keep AI layer replaceable

------------------------------------------------------------------------

# 4. Frontend Architecture

Structure:

    src/
     app/
     components/
     features/
     services/
     hooks/
     types/
     utils/

State management:

-   React Query for server state
-   Lightweight client state only when needed

API communication:

Frontend → REST API → Backend

PWA:

Optional only.

Push notifications are not included in MVP.

------------------------------------------------------------------------

# 5. Backend Architecture

Architecture style:

Modular Monolith

Modules:

-   auth
-   users
-   career
-   ai
-   progress
-   admin
-   feature-toggle

Module structure:

    module/
     controller
     service
     schema/model

Repositories are added only when required.

------------------------------------------------------------------------

# 6. Database Design

Main entities:

## User

Stores: - Identity - Authentication data - Role - Status

## User Profile

Stores: - Current role - Experience - Skills - Career goal - Learning
availability - Learning preference

## Career Knowledge Base

AI-generated data:

-   Career paths
-   Skills
-   Skill sequence
-   Difficulty
-   Projects
-   Assessment criteria

Initial paths:

-   Frontend Developer
-   Backend Developer
-   QA Automation / SDET
-   DevOps Engineer

## Roadmap

Stores:

-   User
-   Career path
-   Version
-   Status
-   AI model version

## Learning Task

Stores:

-   Tasks
-   Completion status

## Progress Record

Stores:

-   Skill levels
-   Evidence
-   Assessment results
-   Readiness score

## AI Conversation

Stores:

-   Conversations
-   Messages

## Feedback

Stores recommendation ratings.

------------------------------------------------------------------------

# 7. AI Architecture

Workflow:

User Context ↓ Context Builder ↓ Prompt Manager ↓ OpenAI Model ↓
Response Validator ↓ Memory Extractor ↓ Database

AI responsibilities:

-   Generate roadmaps
-   Generate learning tasks
-   Answer mentor questions
-   Evaluate progress

------------------------------------------------------------------------

# 8. AI Memory System

Memory categories:

## Profile Memory

-   Experience
-   Goals
-   Skills

## Learning Memory

-   Completed tasks
-   Learning history

## Progress Memory

-   Skill progress
-   Assessments
-   Projects

## Preference Memory

-   Learning preferences
-   Feedback patterns

## Conversation Summary

Full chat history is not sent with every request.

------------------------------------------------------------------------

# 9. Authentication and Authorization

Authentication:

Supabase Auth

MVP methods:

-   Email/password
-   Phone/password
-   Google login
-   Facebook login

Phone verification:

Primary: - WhatsApp OTP

Fallback: - Low-cost SMS OTP provider

Invitation flow:

Register ↓ Login ↓ Invitation code verification ↓ Account activation

Invitation code stores:

-   Code
-   Creator
-   Usage limit
-   Expiration
-   Status

Roles:

User: - Uses career features

Admin: - Manages users - Manages invitation codes - Controls feature
toggles

------------------------------------------------------------------------

# 10. Feature Toggle System

Features:

-   AI Mentor Chat
-   Roadmap Generator
-   Daily Task Generator
-   Progress Tracking

Stored in:

FeatureToggle table

Fields:

-   feature_name
-   enabled
-   updated_at

------------------------------------------------------------------------

# 11. Security Architecture

Security measures:

-   Secure password hashing
-   OAuth validation
-   HTTPS
-   Input validation
-   Authorization checks
-   Rate limiting

AI privacy:

-   Do not send unnecessary personal data
-   Do not send phone/email to AI provider
-   Store AI logs securely

Retention:

User data: - Account lifetime

AI conversations: - Full messages 90 days - Summary afterwards

AI logs: - 30 days

Audit logs:

Track: - Admin actions - Feature changes - User management actions

------------------------------------------------------------------------

# 12. Deployment Architecture

Deployment:

Frontend: - Vercel

Backend: - Single deployment

Database: - Managed PostgreSQL

CI/CD:

Simple pipeline:

Git repository ↓ Build validation ↓ Deployment

Monitoring:

-   Application errors
-   API failures
-   AI failures
-   Database health

------------------------------------------------------------------------

# 13. Development Phases

## Phase 1: Foundation

-   Project setup
-   Database
-   Authentication
-   Invitation system
-   Roles

## Phase 2: Core Features

-   User profile
-   Career knowledge base
-   Roadmap
-   Tasks
-   Progress tracking

## Phase 3: AI Integration

-   OpenAI integration
-   Prompt management
-   AI memory
-   Mentor chat

## Phase 4: Progress Intelligence

-   Assessments
-   Project evidence
-   Job readiness evaluation

## Phase 5: Testing and Deployment

-   Security testing
-   AI quality testing
-   Production deployment

------------------------------------------------------------------------

# Architecture Decision Summary

Major decisions:

-   Modular monolith architecture
-   Next.js frontend
-   NestJS backend
-   PostgreSQL database
-   Supabase authentication
-   OpenAI AI service
-   AI-generated career knowledge base
-   Weighted job readiness evaluation
-   WhatsApp OTP for phone verification

Trade-offs:

-   Simplicity over enterprise scalability
-   Managed services over custom infrastructure
-   AI-generated content over manual content creation

Not implemented:

-   Microservices
-   Vector database
-   AI agent framework
-   CMS
-   Push notifications
-   Advanced analytics

------------------------------------------------------------------------

# SAD Freeze Status

Architecture Scope Frozen: YES

Ready for Development: YES

Remaining decisions:

Only execution-level tasks remain: - Select exact OpenAI model based on
current pricing - Configure WhatsApp OTP provider - Generate initial AI
career knowledge dataset - Create UI designs
