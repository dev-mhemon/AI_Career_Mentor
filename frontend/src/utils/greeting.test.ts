import { formatGreeting } from './greeting';

describe('formatGreeting', () => {
  it('should format greeting with name', () => {
    expect(formatGreeting('Alice')).toBe('Hello, Alice!');
  });

  it('should handle empty name', () => {
    expect(formatGreeting('')).toBe('Hello, Guest!');
  });
});
