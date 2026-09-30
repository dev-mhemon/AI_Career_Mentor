# AI Career Intelligence Mentor

# Product Requirement Document v1.1 (Final Freeze)

**Product Type:** Personal AI-powered career guidance platform\
**Status:** Frozen\
**Development Readiness:** Ready for Architecture Design

------------------------------------------------------------------------

# 1. Product Overview

## Product Vision

Create a personal AI career mentor that understands a user's current
skills, career goals, and learning progress, then provides personalized
guidance similar to an experienced industry mentor.

## Mission Statement

Help individuals:

-   Understand suitable career directions
-   Build structured learning plans
-   Develop relevant professional skills
-   Measure learning progress
-   Receive personalized career guidance

## Product Scope

This product is designed for personal use and limited sharing with
approximately 50--100 known users.

It is not a commercial SaaS platform.

------------------------------------------------------------------------

# 2. Problem Statement

Many learners struggle to make effective career decisions because they
do not know:

-   Which skills they should learn next
-   Which technologies are valuable for their target career
-   How industry professionals approach growth
-   How to create a structured learning path
-   Whether their current learning direction is effective

The product solves this by providing AI-guided career planning and
personalized learning recommendations.

------------------------------------------------------------------------

# 3. Target Users

## Primary MVP User Segment

Junior Technology Professionals (0--3 years experience)

Examples:

-   Junior developers
-   Junior QA engineers
-   Early-career technology professionals

## Secondary Users

Future expansion may include:

-   University students
-   Fresh graduates
-   Career switchers
-   Experienced professionals learning new technologies

------------------------------------------------------------------------

# 4. Product Goals

## Primary Goals

## Personalized Career Guidance

Help users understand:

-   Current position
-   Desired career direction
-   Recommended next steps

## Structured Learning Journeys

Generate:

-   Skill priorities
-   Learning sequence
-   Milestones
-   Practice recommendations

## Better Career Decisions

Help users make informed decisions about:

-   Skills
-   Technologies
-   Career paths

------------------------------------------------------------------------

# 5. MVP Features

# Feature 1: User Profile

## Purpose

Create user context required for personalized AI recommendations.

## User Value

Users receive guidance based on:

-   Experience
-   Skills
-   Goals
-   Learning availability

## User Inputs

Users provide:

-   Current role
-   Experience level
-   Existing skills
-   Career goal
-   Available learning time
-   Learning preference

## Acceptance Criteria

The system should:

-   Allow profile creation
-   Allow profile updates
-   Store user career goals
-   Store skill information
-   Store learning availability

------------------------------------------------------------------------

# Feature 2: AI Career Roadmap Generator

## Purpose

Generate a personalized career development roadmap.

## User Value

Users understand:

-   What skills to learn
-   Learning order
-   Why skills matter
-   Expected progression

## AI Recommendation Quality Requirement

AI recommendations must be based on:

-   Current experience
-   Existing skills
-   Career goal
-   Learning progress
-   Skill gaps

AI should not provide generic recommendations.

## Recommendation Format

Each recommendation should explain:

1.  Current user situation
2.  Recommended next skills
3.  Reason for prioritization
4.  Expected career impact

## Example

User:

-   1 year frontend experience
-   Goal: Become backend developer

AI Recommendation:

"Based on your frontend experience and backend goal, prioritize Node.js,
SQL, and API design because these skills create a smoother transition
into backend engineering."

## Acceptance Criteria

The roadmap should:

-   Use user profile information
-   Match selected career goal
-   Provide prioritized skills
-   Explain recommendations

AI should avoid:

-   Guaranteeing job outcomes
-   Providing unrealistic timelines

------------------------------------------------------------------------

# Feature 3: Daily Learning Task Generator

## Purpose

Convert roadmap goals into practical learning activities.

## User Value

Users receive clear actions instead of only long-term plans.

## Generated Tasks

Examples:

-   Learning activities
-   Practice exercises
-   Mini challenges
-   Review activities

## Acceptance Criteria

The system should:

-   Generate tasks aligned with roadmap
-   Match user skill level
-   Allow task completion tracking

------------------------------------------------------------------------

# Feature 4: Progress Tracking

## Purpose

Measure user improvement over time.

## Skill Progress Levels

The system uses:

1.  Beginner
2.  Familiar
3.  Practicing
4.  Job Ready
5.  Advanced

## Job Ready Evaluation

The AI determines whether a user is Job Ready.

Evaluation inputs:

### Task Completion

Includes:

-   Completed roadmap activities
-   Completed practice tasks
-   Learning milestones

### Project Evidence

Includes:

-   Personal projects
-   Portfolio work
-   Practical implementation

### Assessments

Includes:

-   Technical assessments
-   Knowledge checks
-   AI evaluation

## Acceptance Criteria

The system should:

-   Track completed tasks
-   Display progress status
-   Identify improvement areas
-   Use progress for recommendations

------------------------------------------------------------------------

# Feature 5: AI Career Mentor Chat

## Purpose

Provide continuous career guidance.

## Supported Topics

Users can ask about:

-   Career decisions
-   Technology choices
-   Learning strategies
-   Skill development

## Acceptance Criteria

AI responses should:

-   Consider user profile
-   Use learning history
-   Provide actionable suggestions
-   Explain reasoning

------------------------------------------------------------------------

# 6. Initial Supported Career Paths

The MVP supports only:

## 1. Frontend Developer

## 2. Backend Developer

## 3. QA Automation / SDET

## 4. DevOps Engineer

Additional career paths will be added later.

------------------------------------------------------------------------

# 7. Admin Requirements

## Purpose

Control access and product availability.

Admin responsibilities:

-   User management
-   Access control
-   Feature toggle management

Admin will NOT:

-   Create courses
-   Maintain learning paths manually
-   Manage career content

## Feature Toggles

Admin can enable/disable:

-   AI Mentor Chat
-   Roadmap Generator
-   Daily Task Generator
-   Progress Tracking

------------------------------------------------------------------------

# 8. Authentication Requirement

## Registration Methods

Users can register using:

-   Email and password
-   Phone number and password
-   Google login
-   Facebook login

## Invite Code Access

Because this is a private platform:

Flow:

Registration

↓

Login

↓

Enter invitation code

↓

Account activated

↓

Access granted

------------------------------------------------------------------------

# 9. AI Memory Requirement

## Purpose

Maintain user learning context over time.

## AI Should Remember

### Completed Tasks

Examples:

-   Finished learning activities
-   Completed roadmap items

### Learning History

Examples:

-   Previous recommendations
-   Progress updates
-   Learning activities

## AI Uses Memory To

-   Adjust recommendations
-   Avoid repeating completed topics
-   Suggest appropriate next steps
-   Provide personalized guidance

------------------------------------------------------------------------

# 10. User Feedback Loop

## Recommendation Rating

Users can rate AI recommendations.

Rating scale:

1 - Not useful

2 - Slightly useful

3 - Moderately useful

4 - Very useful

5 - Extremely useful

## Feedback Purpose

Used to:

-   Measure recommendation quality
-   Identify poor recommendations
-   Improve AI guidance

------------------------------------------------------------------------

# 11. AI Responsibilities and Limitations

## AI Should

-   Analyze user information
-   Suggest career options
-   Recommend learning paths
-   Explain tradeoffs
-   Ask clarifying questions

## AI Should Not

-   Guarantee job outcomes
-   Promise career success
-   Replace human career advisors
-   Make final career decisions for users

------------------------------------------------------------------------

# 12. Non-Goals

The product will NOT:

-   Guarantee employment
-   Replace professional career counseling
-   Automatically apply for jobs
-   Provide complete courses
-   Act as a learning marketplace
-   Replace human mentors
-   Require admins to manage content manually

------------------------------------------------------------------------

# 13. Future Features

Future scope:

-   Industry trend analysis
-   Job market intelligence
-   AI skill gap analysis
-   Resume review
-   Interview simulation
-   Personalized project recommendations

------------------------------------------------------------------------

# 14. Product Risks

## AI Hallucination

Risk:

AI may provide incorrect recommendations.

Mitigation:

-   Structured AI behavior rules
-   User feedback
-   Recommendation monitoring

------------------------------------------------------------------------

## Incorrect Career Guidance

Risk:

Career decisions have personal impact.

Mitigation:

AI provides guidance and options, not absolute answers.

------------------------------------------------------------------------

## User Dependency

Risk:

Users may rely completely on AI decisions.

Mitigation:

AI encourages independent thinking.

------------------------------------------------------------------------

## Data Privacy

Risk:

Career information is personal.

Mitigation:

-   Limit collected data
-   Control access
-   Protect user information

------------------------------------------------------------------------

## Recommendation Quality Maintenance

Risk:

Technology careers change quickly.

Mitigation:

-   Review recommendation quality
-   Collect user feedback

------------------------------------------------------------------------

# 15. Final MVP Scope

## Must Have

-   User Profile
-   AI Career Roadmap Generator
-   Daily Learning Task Generator
-   Progress Tracking
-   AI Career Mentor Chat
-   Authentication
-   Invite code access
-   Admin user management
-   Feature toggles

## Not Included in MVP

-   Industry intelligence
-   Resume review
-   Interview simulator
-   Job market analysis
-   Advanced analytics

------------------------------------------------------------------------

# PRD Freeze Status

## Scope Frozen: YES

The MVP scope is frozen. No additional features should be added before
initial development.

## Ready for Architecture Design: YES

The PRD defines:

-   MVP boundaries
-   User requirements
-   AI behavior
-   Authentication flow
-   Progress evaluation
-   Admin responsibilities

## Remaining Decisions Before Development

Implementation-level decisions only:

1.  Final AI evaluation scoring approach
2.  Invitation code management rules
3.  Data retention policy
4.  Initial roadmap structure for four career paths
5.  Final UI/UX flows

------------------------------------------------------------------------

# Document Status

Version: 1.1\
Status: Frozen\
Next Stage: Architecture Design
