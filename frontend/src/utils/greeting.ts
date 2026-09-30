export function formatGreeting(name: string): string {
  if (!name) return 'Hello, Guest!';
  return `Hello, ${name}!`;
}
