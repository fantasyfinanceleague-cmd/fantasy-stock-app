// src/utils/contentModeration.js

/**
 * Content moderation utility for usernames and other user-generated content.
 * Checks for profanity, slurs, and other inappropriate content.
 */

// Common inappropriate words/patterns (lowercase)
// This is a basic list - production apps should use a more comprehensive solution
const BLOCKED_WORDS = [
  // Profanity
  'fuck', 'shit', 'ass', 'damn', 'bitch', 'bastard', 'crap', 'piss', 'dick', 'cock',
  'pussy', 'cunt', 'whore', 'slut', 'fag', 'faggot',
  // Slurs and hate speech
  'nigger', 'nigga', 'chink', 'spic', 'wetback', 'kike', 'gook', 'jap', 'beaner',
  'cracker', 'honky', 'gringo', 'towelhead', 'raghead', 'camel jockey',
  'retard', 'retarded', 'tard',
  // Sexual content
  'penis', 'vagina', 'boob', 'tit', 'porn', 'xxx', 'nsfw', 'nude', 'naked',
  'sex', 'anal', 'oral', 'blowjob', 'handjob', 'dildo', 'vibrator',
  // Violence
  'kill', 'murder', 'rape', 'molest', 'terrorist', 'bomb', 'shoot',
  // Other inappropriate
  'nazi', 'hitler', 'kkk', 'holocaust',
];

// Patterns that try to evade filters (e.g., f*ck, sh1t, a$$)
const EVASION_PATTERNS = [
  // Common letter substitutions
  { pattern: /f+[u\*@0]+c+k+/gi, word: 'fuck' },
  { pattern: /s+h+[i1!]+t+/gi, word: 'shit' },
  { pattern: /a+[s$]+[s$]+/gi, word: 'ass' },
  { pattern: /b+[i1!]+t+c+h+/gi, word: 'bitch' },
  { pattern: /d+[i1!]+c+k+/gi, word: 'dick' },
  { pattern: /c+[o0]+c+k+/gi, word: 'cock' },
  { pattern: /p+[u\*]+s+s+y+/gi, word: 'pussy' },
  { pattern: /c+[u\*]+n+t+/gi, word: 'cunt' },
  { pattern: /n+[i1!]+g+[g]+[e3a]+r*/gi, word: 'slur' },
  { pattern: /f+[a@4]+g+/gi, word: 'slur' },
  { pattern: /r+[e3]+t+[a@4]+r+d+/gi, word: 'slur' },
];

// Words that are okay on their own but blocked in usernames
const USERNAME_BLOCKED = [
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support',
  'system', 'official', 'fantasystock', 'fantasy_stock',
];

/**
 * Check if text contains inappropriate content
 * @param {string} text - Text to check
 * @returns {{ isClean: boolean, reason?: string }}
 */
export function checkContent(text) {
  if (!text) return { isClean: true };

  const lower = text.toLowerCase().replace(/[\s_-]/g, '');

  // Check direct matches
  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word.replace(/\s/g, ''))) {
      return { isClean: false, reason: 'Contains inappropriate language' };
    }
  }

  // Check evasion patterns
  for (const { pattern } of EVASION_PATTERNS) {
    if (pattern.test(text)) {
      return { isClean: false, reason: 'Contains inappropriate language' };
    }
  }

  return { isClean: true };
}

/**
 * Check if a username is appropriate
 * @param {string} username - Username to check
 * @returns {{ isValid: boolean, reason?: string }}
 */
export function validateUsername(username) {
  if (!username) return { isValid: true };

  const lower = username.toLowerCase();

  // Check for reserved/impersonation names
  for (const reserved of USERNAME_BLOCKED) {
    if (lower === reserved || lower.includes(reserved)) {
      return { isValid: false, reason: 'This username is reserved' };
    }
  }

  // Check for inappropriate content
  const contentCheck = checkContent(username);
  if (!contentCheck.isClean) {
    return { isValid: false, reason: contentCheck.reason };
  }

  // Check for repeated characters (spam-like)
  if (/(.)\1{4,}/.test(username)) {
    return { isValid: false, reason: 'Username contains too many repeated characters' };
  }

  return { isValid: true };
}

/**
 * Check if a league name is appropriate
 * @param {string} name - League name to check
 * @returns {{ isValid: boolean, reason?: string }}
 */
export function validateLeagueName(name) {
  if (!name) return { isValid: true };

  const contentCheck = checkContent(name);
  if (!contentCheck.isClean) {
    return { isValid: false, reason: contentCheck.reason };
  }

  return { isValid: true };
}
