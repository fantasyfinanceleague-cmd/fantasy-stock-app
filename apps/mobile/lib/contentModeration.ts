// Content moderation utility for usernames and other user-generated content.

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

const EVASION_PATTERNS = [
  { pattern: /f+[u\*@0]+c+k+/gi },
  { pattern: /s+h+[i1!]+t+/gi },
  { pattern: /a+[s$]+[s$]+/gi },
  { pattern: /b+[i1!]+t+c+h+/gi },
  { pattern: /d+[i1!]+c+k+/gi },
  { pattern: /c+[o0]+c+k+/gi },
  { pattern: /p+[u\*]+s+s+y+/gi },
  { pattern: /c+[u\*]+n+t+/gi },
  { pattern: /n+[i1!]+g+[g]+[e3a]+r*/gi },
  { pattern: /f+[a@4]+g+/gi },
  { pattern: /r+[e3]+t+[a@4]+r+d+/gi },
];

function checkContent(text: string): { isClean: boolean; reason?: string } {
  if (!text) return { isClean: true };

  const lower = text.toLowerCase().replace(/[\s_-]/g, '');

  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word.replace(/\s/g, ''))) {
      return { isClean: false, reason: 'Contains inappropriate language' };
    }
  }

  for (const { pattern } of EVASION_PATTERNS) {
    if (pattern.test(text)) {
      return { isClean: false, reason: 'Contains inappropriate language' };
    }
  }

  return { isClean: true };
}

export function validateLeagueName(name: string): { isValid: boolean; reason?: string } {
  if (!name) return { isValid: true };

  const contentCheck = checkContent(name);
  if (!contentCheck.isClean) {
    return { isValid: false, reason: contentCheck.reason };
  }

  return { isValid: true };
}

export function validateUsername(username: string): { isValid: boolean; reason?: string } {
  if (!username) return { isValid: true };

  const contentCheck = checkContent(username);
  if (!contentCheck.isClean) {
    return { isValid: false, reason: 'Username contains inappropriate language' };
  }

  return { isValid: true };
}
