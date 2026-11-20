-- supabase/migrations/025_seed_skills_catalog.sql
BEGIN;

-- Track exact row IDs created by migration 025 so rollback removes ONLY rows
-- inserted by 025 and never deletes pre-existing catalog rows or aliases.
CREATE TABLE IF NOT EXISTS private.seed_025_skills_ownership (
  entity_type text NOT NULL CHECK (entity_type IN ('skill', 'skill_alias')),
  entity_id uuid NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

WITH inserted_skills AS (
  INSERT INTO public.skills (slug, canonical_name, category_id, description, status)
  SELECT v.slug, v.canonical_name, sc.id, v.description, 'approved'::public.content_status
  FROM (
    VALUES
      -- Frontend
      ('html',                           'HTML',                         'web-development',                   'HyperText Markup Language for structuring web documents'),
      ('css',                            'CSS',                          'web-development',                   'Cascading Style Sheets for web layout and visual presentation'),
      ('javascript',                     'JavaScript',                   'programming-languages',             'Core programming language for web and server-side development'),
      ('typescript',                     'TypeScript',                   'programming-languages',             'Statically typed superset of JavaScript'),
      ('react',                          'React',                        'web-development',                   'Component-based JavaScript library for building user interfaces'),
      ('nextjs',                         'Next.js',                      'web-development',                   'Full-stack React framework with server rendering and routing'),
      ('tailwind-css',                   'Tailwind CSS',                 'web-development',                   'Utility-first CSS framework for rapid UI development'),
      ('vuejs',                          'Vue.js',                       'web-development',                   'Progressive JavaScript framework for building user interfaces'),
      ('angular',                        'Angular',                      'web-development',                   'TypeScript-based web application framework'),

      -- Backend & APIs
      ('nodejs',                         'Node.js',                      'web-development',                   'JavaScript runtime for building server-side applications'),
      ('expressjs',                      'Express.js',                   'web-development',                   'Minimalist Node.js web application and API framework'),
      ('nestjs',                         'NestJS',                       'web-development',                   'Progressive TypeScript framework for scalable server-side applications'),
      ('python',                         'Python',                       'programming-languages',             'General-purpose programming language for backend, data, and AI'),
      ('fastapi',                        'FastAPI',                      'web-development',                   'High-performance Python web framework for building APIs'),
      ('django',                         'Django',                       'web-development',                   'Full-featured Python web framework'),
      ('java',                           'Java',                         'programming-languages',             'Object-oriented programming language for enterprise and backend systems'),
      ('spring-boot',                    'Spring Boot',                  'web-development',                   'Java framework for building production-grade backend services'),
      ('go',                             'Go',                           'programming-languages',             'Statically typed compiled language for concurrent backend and cloud systems'),
      ('csharp',                         'C#',                           'programming-languages',             'Object-oriented programming language for .NET applications'),
      ('rest-api',                       'REST API',                     'web-development',                   'Architectural style and design patterns for HTTP-based web APIs'),
      ('graphql',                        'GraphQL',                      'web-development',                   'Query language and runtime for strongly typed APIs'),

      -- Databases & Caching
      ('sql',                            'SQL',                          'databases',                         'Structured Query Language for querying and managing relational databases'),
      ('postgresql',                     'PostgreSQL',                   'databases',                         'Open-source object-relational database management system'),
      ('mysql',                          'MySQL',                        'databases',                         'Open-source relational database management system'),
      ('mongodb',                        'MongoDB',                      'databases',                         'Document-oriented NoSQL database'),
      ('redis',                          'Redis',                        'databases',                         'In-memory data structure store for caching, queues, and state'),

      -- DevOps, Cloud & Tooling
      ('git',                            'Git',                          'software-engineering-fundamentals', 'Distributed version control system for source code management'),
      ('linux',                          'Linux',                        'devops-tooling',                    'Unix-like operating system administration, shell, and server tooling'),
      ('docker',                         'Docker',                       'devops-tooling',                    'Containerization platform for packaging and running applications'),
      ('kubernetes',                     'Kubernetes',                   'cloud-infrastructure',              'Container orchestration platform for automated deployment and scaling'),
      ('aws',                            'AWS',                          'cloud-infrastructure',              'Amazon Web Services cloud computing platform and infrastructure'),
      ('ci-cd',                          'CI/CD',                        'devops-tooling',                    'Continuous Integration and Continuous Delivery automation pipelines'),
      ('terraform',                      'Terraform',                    'cloud-infrastructure',              'Infrastructure as Code tool for provisioning cloud resources'),

      -- Data, AI & ML
      ('data-structures-and-algorithms', 'Data Structures & Algorithms', 'software-engineering-fundamentals', 'Core computational data structures, complexity analysis, and algorithms'),
      ('system-design',                  'System Design',                'software-engineering-fundamentals', 'Architecture and scalability design for distributed software systems'),
      ('pandas',                         'Pandas',                       'data-engineering',                  'Python library for tabular data manipulation and analysis'),
      ('machine-learning',               'Machine Learning',             'ai-machine-learning',               'Statistical and algorithmic modeling for predictive systems'),
      ('pytorch',                        'PyTorch',                      'ai-machine-learning',               'Deep learning framework for research and production AI models'),
      ('tensorflow',                     'TensorFlow',                   'ai-machine-learning',               'End-to-end machine learning and deep learning platform'),
      ('llm-engineering',                'LLM Engineering',              'ai-machine-learning',               'Design, evaluation, retrieval, and deployment of large language model applications'),

      -- Mobile, QA & Security
      ('react-native',                   'React Native',                 'mobile-development',                'Cross-platform mobile application framework built on React'),
      ('flutter',                        'Flutter',                      'mobile-development',                'Cross-platform UI toolkit for mobile, web, and desktop applications'),
      ('software-testing',               'Software Testing',             'testing-quality',                   'Verification, test design, and quality assurance practices for software'),
      ('playwright',                     'Playwright',                   'testing-quality',                   'End-to-end browser testing and web automation framework'),
      ('cybersecurity',                  'Cybersecurity',                'security',                          'Application, network, and cloud security principles and defense')
  ) AS v(slug, canonical_name, category_slug, description)
  LEFT JOIN public.skill_categories sc ON sc.slug = v.category_slug
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO private.seed_025_skills_ownership (entity_type, entity_id)
SELECT 'skill', id FROM inserted_skills
ON CONFLICT DO NOTHING;

WITH inserted_aliases AS (
  INSERT INTO public.skill_aliases (skill_id, alias, alias_normalized, status, source, validated_at)
  SELECT s.id, v.alias, lower(btrim(v.alias)), 'validated'::public.alias_status, 'seed', now()
  FROM (
    VALUES
      ('html',                           'HTML5'),
      ('css',                            'CSS3'),
      ('javascript',                     'JS'),
      ('typescript',                     'TS'),
      ('react',                          'ReactJS'),
      ('react',                          'React.js'),
      ('nextjs',                         'NextJS'),
      ('tailwind-css',                   'Tailwind'),
      ('vuejs',                          'Vue'),
      ('vuejs',                          'VueJS'),
      ('nodejs',                         'Node'),
      ('nodejs',                         'NodeJS'),
      ('expressjs',                      'Express'),
      ('expressjs',                      'ExpressJS'),
      ('nestjs',                         'Nest'),
      ('nestjs',                         'Nest.js'),
      ('spring-boot',                    'Spring'),
      ('go',                             'Golang'),
      ('csharp',                         'C Sharp'),
      ('rest-api',                       'REST'),
      ('rest-api',                       'RESTful API'),
      ('postgresql',                     'Postgres'),
      ('postgresql',                     'PSQL'),
      ('mongodb',                        'Mongo'),
      ('kubernetes',                     'K8s'),
      ('aws',                            'Amazon Web Services'),
      ('ci-cd',                          'CICD'),
      ('data-structures-and-algorithms', 'DSA'),
      ('machine-learning',               'ML'),
      ('software-testing',               'QA')
  ) AS v(skill_slug, alias)
  JOIN public.skills s ON s.slug = v.skill_slug AND s.deleted_at IS NULL
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO private.seed_025_skills_ownership (entity_type, entity_id)
SELECT 'skill_alias', id FROM inserted_aliases
ON CONFLICT DO NOTHING;

COMMIT;
