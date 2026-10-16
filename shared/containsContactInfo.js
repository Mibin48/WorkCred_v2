const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const MALAYALAM_DIGITS = ['൦', '൧', '൨', '൩', '൪', '൫', '൬', '൭', '൮', '൯'];

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * Normalizes text for contact information scanning.
 * - Converts to lowercase and Unicode NFKC.
 * - Converts Devanagari and Malayalam numerals to 0-9.
 * @param {string} text 
 * @returns {string}
 */
export function normalizeContactText(text) {
  if (typeof text !== 'string') return '';
  let normalized = text.normalize('NFKC').toLowerCase();

  for (let i = 0; i <= 9; i++) {
    normalized = normalized.replaceAll(DEVANAGARI_DIGITS[i], String(i));
    normalized = normalized.replaceAll(MALAYALAM_DIGITS[i], String(i));
  }

  return normalized;
}

/**
 * Checks if input text contains contact information (Decision E2, BOOK-4).
 * Must block:
 * 1. A run of 7 or more digits after stripping inter-digit delimiters.
 * 2. 6 or more spelled-out digit words in a row ("nine eight four five...").
 * 3. An email pattern or "at" and "dot" spelled out around words.
 * 4. URLs (http, https, www, wa.me, t.me, bit.ly, or word.tld for common TLDs: com, in, net, org, co, io, me).
 * 5. Words whatsapp, telegram, or insta followed within 20 characters by a digit run of 4+ or an @handle.
 *
 * Must NOT block:
 * "2 workers for 4 hours", "Rs 1,200", "3 PM to 6 PM", "12/10/2026", "room 204".
 *
 * @param {string} text 
 * @returns {boolean} True if contact information detected, false otherwise.
 */
export function containsContactInfo(text) {
  if (!text || typeof text !== 'string') return false;

  const normalized = normalizeContactText(text);

  // 1. URLs
  const urlRegex = /(?:https?:\/\/|www\.|wa\.me\/|t\.me\/|bit\.ly\/|[a-z0-9-]+\.(?:com|in|net|org|co|io|me)(?:\/[^\s]*)?)/i;
  if (urlRegex.test(normalized)) {
    return true;
  }

  // 2. Email pattern (literal or "at ... dot ...")
  const emailLiteral = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  if (emailLiteral.test(normalized)) {
    return true;
  }
  const emailSpelled = /\b[a-z0-9._%+-]+\s*(?:\[at\]|\(at\)|\bat\b)\s*[a-z0-9.-]+\s*(?:\[dot\]|\(dot\)|\bdot\b)\s*(?:com|in|net|org|co|io|me)\b/i;
  if (emailSpelled.test(normalized)) {
    return true;
  }

  // 3. Social media keywords followed within 20 chars by 4+ digits or @handle
  const socialRegex = /(?:whatsapp|telegram|insta(?:gram)?)\b.{0,20}?(?:@\w+|\d{4,})/i;
  if (socialRegex.test(normalized)) {
    return true;
  }

  // 4. Run of 6 or more spelled-out digit words in sequence
  const digitWordsPattern = DIGIT_WORDS.join('|');
  const sequenceRegex = new RegExp(`\\b(?:${digitWordsPattern})(?:[\\s,.-]+(?:${digitWordsPattern})){5,}\\b`, 'i');
  if (sequenceRegex.test(normalized)) {
    return true;
  }

  // 5. 7 or more digits after stripping inter-digit spaces and delimiters
  // We extract digit groups connected by optional separators [. - ( ) _ / ,]
  // Note: dates like 12/10/2026 has 2+2+4 = 8 digits if fully stripped!
  // To avoid false positives on standard dates (DD/MM/YYYY or YYYY-MM-DD):
  const textWithoutDates = normalized.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
                                     .replace(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g, ' ');

  // Look for 7 or more digits separated only by spaces, dots, dashes, parentheses, underscores
  const phoneDelimitedRegex = /(?:\d[\s.\-()_]*){7,}\d/;
  if (phoneDelimitedRegex.test(textWithoutDates)) {
    return true;
  }

  // Also catch simple continuous 7+ digit runs
  if (/\d{7,}/.test(textWithoutDates)) {
    return true;
  }

  return false;
}
