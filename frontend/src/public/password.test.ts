import { describe, expect, it } from 'vitest';
import { checkPassword, isValidEmail, isValidPassword, passwordStrength } from './password';

describe('password rules', () => {
  it('accepts a password that meets all rules', () => {
    expect(isValidPassword('Abcdef12')).toBe(true);
  });
  it('rejects too short, single-case and no-digit passwords', () => {
    expect(checkPassword('Abc12').length).toBe(false);
    expect(isValidPassword('alllowercase1')).toBe(false);
    expect(isValidPassword('ALLUPPERCASE1')).toBe(false);
    expect(isValidPassword('NoDigitsHere')).toBe(false);
  });
  it('strength meter grows with length and variety, and stays low for short passwords', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(0);
    expect(passwordStrength('Abc1')).toBe(1);
    expect(passwordStrength('Abcdef12')).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('Abcdef12!xyz')).toBe(4);
  });
  it('validates email shape', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});
