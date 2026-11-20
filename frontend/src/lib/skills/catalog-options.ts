import type { MultiSelectOption } from '@/components/ui/multi-select-combobox';

/**
 * Approved canonical skills seeded in `supabase/migrations/025_seed_skills_catalog.sql`,
 * with their validated seed aliases as searchable keywords for zero-latency autocomplete.
 */
export const APPROVED_SKILL_CATALOG_OPTIONS: readonly MultiSelectOption[] = [
  // Frontend
  { id: 'html', label: 'HTML', keywords: ['HTML5'] },
  { id: 'css', label: 'CSS', keywords: ['CSS3'] },
  { id: 'javascript', label: 'JavaScript', keywords: ['JS'] },
  { id: 'typescript', label: 'TypeScript', keywords: ['TS'] },
  { id: 'react', label: 'React', keywords: ['ReactJS', 'React.js'] },
  { id: 'nextjs', label: 'Next.js', keywords: ['NextJS'] },
  { id: 'tailwind-css', label: 'Tailwind CSS', keywords: ['Tailwind'] },
  { id: 'vuejs', label: 'Vue.js', keywords: ['Vue', 'VueJS'] },
  { id: 'angular', label: 'Angular' },

  // Backend & APIs
  { id: 'nodejs', label: 'Node.js', keywords: ['Node', 'NodeJS'] },
  { id: 'expressjs', label: 'Express.js', keywords: ['Express', 'ExpressJS'] },
  { id: 'nestjs', label: 'NestJS', keywords: ['Nest', 'Nest.js'] },
  { id: 'python', label: 'Python' },
  { id: 'fastapi', label: 'FastAPI' },
  { id: 'django', label: 'Django' },
  { id: 'java', label: 'Java' },
  { id: 'spring-boot', label: 'Spring Boot', keywords: ['Spring'] },
  { id: 'go', label: 'Go', keywords: ['Golang'] },
  { id: 'csharp', label: 'C#', keywords: ['C Sharp'] },
  { id: 'rest-api', label: 'REST API', keywords: ['REST', 'RESTful API'] },
  { id: 'graphql', label: 'GraphQL' },

  // Databases & Caching
  { id: 'sql', label: 'SQL' },
  { id: 'postgresql', label: 'PostgreSQL', keywords: ['Postgres', 'PSQL'] },
  { id: 'mysql', label: 'MySQL' },
  { id: 'mongodb', label: 'MongoDB', keywords: ['Mongo'] },
  { id: 'redis', label: 'Redis' },

  // DevOps, Cloud & Tooling
  { id: 'git', label: 'Git' },
  { id: 'linux', label: 'Linux' },
  { id: 'docker', label: 'Docker' },
  { id: 'kubernetes', label: 'Kubernetes', keywords: ['K8s'] },
  { id: 'aws', label: 'AWS', keywords: ['Amazon Web Services'] },
  { id: 'ci-cd', label: 'CI/CD', keywords: ['CICD'] },
  { id: 'terraform', label: 'Terraform' },

  // Data, AI & ML
  {
    id: 'data-structures-and-algorithms',
    label: 'Data Structures & Algorithms',
    keywords: ['DSA'],
  },
  { id: 'system-design', label: 'System Design' },
  { id: 'pandas', label: 'Pandas' },
  { id: 'machine-learning', label: 'Machine Learning', keywords: ['ML'] },
  { id: 'pytorch', label: 'PyTorch' },
  { id: 'tensorflow', label: 'TensorFlow' },
  { id: 'llm-engineering', label: 'LLM Engineering' },

  // Mobile, QA & Security
  { id: 'react-native', label: 'React Native' },
  { id: 'flutter', label: 'Flutter' },
  { id: 'software-testing', label: 'Software Testing', keywords: ['QA'] },
  { id: 'playwright', label: 'Playwright' },
  { id: 'cybersecurity', label: 'Cybersecurity' },
] as const;

/**
 * Finds an exact case-insensitive catalog match by canonical label or validated keyword alias.
 */
export function findCatalogSkillOption(
  rawInput: string,
  options: readonly MultiSelectOption[] = APPROVED_SKILL_CATALOG_OPTIONS,
): MultiSelectOption | undefined {
  const normalized = rawInput.trim().toLowerCase();
  if (!normalized) return undefined;
  return options.find(
    (option) =>
      option.label.trim().toLowerCase() === normalized ||
      (option.keywords?.some((kw) => kw.trim().toLowerCase() === normalized) ??
        false),
  );
}
