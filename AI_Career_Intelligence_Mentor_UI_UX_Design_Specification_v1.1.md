# AI Career Intelligence Mentor

# UI/UX Design Specification Document v1.1

## Document Status

Product: AI Career Intelligence Mentor\
Type: Personal AI-powered career guidance PWA\
Scope: Frozen MVP

This version applies UX review improvements without changing product
scope.

------------------------------------------------------------------------

# 1. UX Principles

## Design Philosophy

The product should feel like a personal AI career mentor, not a course
platform.

Core principles: - Personalized guidance over generic information -
Clear next actions over information overload - AI explanations over
black-box recommendations - User control over AI decisions

## Experience Goals

Users should understand: - Current career position - Recommended next
step - Reason behind recommendations - Progress toward goals

------------------------------------------------------------------------

# 2. User Personas

## Primary User: Junior Technology Professional

Profile: - 0-3 years experience - Junior developer, QA engineer, early
technology professional

Goals: - Choose career direction - Understand skill gaps - Follow
structured growth plans - Improve readiness

Needs: - Roadmap - Daily tasks - Progress tracking - AI guidance

## Admin User

Responsible for: - User management - Access control - Feature toggles

Not responsible for: - Courses - Career content - Learning path
maintenance

------------------------------------------------------------------------

# 3. User Journey

## New User

Landing → Registration/Login → Invitation Code Verification → Profile
Setup → AI Analysis → Dashboard

## Onboarding

Five steps: 1. Basic information 2. Current skills 3. Career goal 4.
Learning availability and preference 5. AI preparation

Requirements: - Progress indicator - Save draft - Required field
indicators - Explain why information is collected

## AI Analysis

Loading: - Reviewing experience - Comparing career paths - Identifying
gaps - Creating roadmap

## Returning User

Login → Dashboard → Today's recommended task → Current milestone →
Progress update → AI Mentor

Dashboard priority: 1. Today's task 2. Current milestone 3. Progress 4.
AI insight

------------------------------------------------------------------------

# 4. Information Architecture

## User Navigation

-   Dashboard
-   Roadmap
-   Tasks
-   Progress
-   AI Mentor

Profile is accessed through avatar/menu.

## Admin Navigation

Admin: - Dashboard - Users - Invitations - Feature Toggles

------------------------------------------------------------------------

# 5. Screen Specifications

All screens require: - Purpose - User goal - Components - Actions -
Loading state - Empty state - Error state

## Landing

Purpose: Explain product value.

Components: - Introduction - Benefits - Register/Login

## Authentication

Components: - Email/password - Phone/password - Google login - Facebook
login

States: Loading: Authentication progress. Error: Invalid credentials or
verification failure.

## Onboarding

Components: - Profile form - Skills - Goal - Availability - Preferences

Actions: - Save - Continue - Resume

## AI Analysis

Components: AI recommendation card:

Current situation: User context

Recommendation: Suggested skills

Reason: Why this is recommended

Expected impact: Career benefit

Actions: - Accept roadmap - Edit profile - Rate recommendation

Feedback: - Rating 1-5 - Optional comment - Confirmation state

## Dashboard

Components: - Today's task - Goal - Milestone - Progress - AI insight

## Roadmap

Components: - Career path - Skills - Milestones - Priority - Reason -
Progress percentage

## Daily Task

Lifecycle: Generated → Started → Completed → Reviewed

States: - New - In Progress - Completed

Actions: - Start - Complete - Review

## Progress

Components: - Skill levels - Tasks - Projects - Assessments - Job
readiness score

Job readiness explanation: Shows evidence behind score and next
improvement area.

## AI Mentor Chat

Components: - Chat - Suggested questions - Conversation summary

AI responses include: - Answer - Reasoning - Next action

## Profile

Components: - Experience - Skills - Goal - Preferences

## Admin

Dashboard: User and feature overview.

Users: Manage access.

Feature Toggles: Enable/disable MVP features.

------------------------------------------------------------------------

# 6. AI UX Requirements

AI recommendations must explain: 1. Current situation 2. Recommended
skills 3. Reason 4. Expected impact

AI must not: - Guarantee jobs - Promise success - Replace user decisions

Show limitation message: "AI guidance is based on your profile and
progress. Review decisions based on your own situation."

------------------------------------------------------------------------

# 7. Mobile/PWA Experience

Mobile-first requirements: - Single column layouts - Touch-friendly
controls - Bottom navigation - Responsive cards

PWA MVP: Included: - Installable experience - Responsive layout - Cached
static assets - Network fallback

Not included: - Offline AI - Push notifications

------------------------------------------------------------------------

# 8. Accessibility

Requirements: - WCAG 2.1 AA target - Keyboard navigation - Screen reader
labels - Clear focus states - Accessible validation messages - Do not
rely only on color - Readable contrast

------------------------------------------------------------------------

# 9. Developer Handoff Requirements

Components must define: - States - Variants - Actions - Required data

Examples:

Task Card: States: - New - In Progress - Completed - Failed

Roadmap data: - title - career_path - skills - priority - reason -
progress_percentage

Progress data: - skill levels - evidence - assessments - readiness score

AI message: - message - reasoning - suggested actions

------------------------------------------------------------------------

# UI/UX Decision Summary

## Major Improvements Applied

-   Added feedback loop UI
-   Added job readiness explanation
-   Added detailed onboarding states
-   Added loading/error/empty requirements
-   Added AI transparency patterns
-   Added mobile/PWA rules
-   Added developer handoff requirements

## Decisions Maintained

-   Existing MVP scope
-   Existing screens
-   AI mentor positioning
-   Admin limitations
-   Mobile-first approach

## Not Implemented

-   Courses
-   Marketplace
-   Resume review
-   Interview simulation
-   Job applications
-   Advanced analytics
-   Offline AI features

------------------------------------------------------------------------

# UI/UX Freeze Status

Scope frozen: YES

Ready for development: YES

Remaining design decisions: - Final branding - Typography tokens - Color
palette - Visual component styling
