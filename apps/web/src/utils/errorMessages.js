// src/utils/errorMessages.js
// Maps technical error codes/messages to user-friendly messages

const ERROR_MAP = {
  // Auth errors
  'Invalid login credentials': 'Incorrect email or password. Please try again.',
  'Email not confirmed': 'Please check your email and click the verification link.',
  'User already registered': 'An account with this email already exists. Try logging in instead.',
  'Password should be at least 6 characters': 'Password must be at least 6 characters long.',
  'JWT expired': 'Your session has expired. Please log in again.',
  'invalid_grant': 'Your session has expired. Please log in again.',
  'refresh_token_not_found': 'Your session has expired. Please log in again.',

  // Network errors
  'Failed to fetch': 'Unable to connect to the server. Please check your internet connection.',
  'NetworkError': 'Network error. Please check your internet connection.',
  'net::ERR_INTERNET_DISCONNECTED': 'No internet connection. Please check your network.',
  'net::ERR_CONNECTION_REFUSED': 'Server unavailable. Please try again later.',
  'ECONNREFUSED': 'Server unavailable. Please try again later.',
  'timeout': 'Request timed out. Please try again.',
  'AbortError': 'Request was cancelled. Please try again.',

  // Supabase/Database errors
  '23505': 'This value already exists. Please use a different one.',
  '23503': 'This operation references data that doesn\'t exist.',
  '42501': 'You don\'t have permission to perform this action.',
  'PGRST116': 'The requested item was not found.',
  'not_authenticated': 'Please log in to continue.',

  // Stock API errors
  'credentials_invalid': 'Your Alpaca credentials are invalid. Please update them in Profile settings.',
  'no_credentials': 'Please set up your Alpaca credentials in Profile settings to trade.',
  'insufficient_funds': 'Insufficient buying power for this trade.',
  'no_price': 'Unable to get current stock price. Please try again.',
  'market_closed': 'The market is currently closed. Orders will execute when it opens.',
  'invalid_symbol': 'Invalid stock symbol. Please check and try again.',

  // Rate limiting
  '429': 'Too many requests. Please wait a moment and try again.',
  'rate_limit': 'You\'re doing that too fast. Please slow down.',

  // Generic
  'server_error': 'Something went wrong on our end. Please try again.',
  'unhandled': 'An unexpected error occurred. Please try again.',
};

/**
 * Convert a technical error to a user-friendly message
 * @param {Error|string|object} error - The error to convert
 * @returns {string} User-friendly error message
 */
export function getUserFriendlyError(error) {
  if (!error) {
    return 'An unexpected error occurred. Please try again.';
  }

  // Handle string errors
  if (typeof error === 'string') {
    // Check for exact match
    if (ERROR_MAP[error]) {
      return ERROR_MAP[error];
    }
    // Check for partial match
    for (const [key, value] of Object.entries(ERROR_MAP)) {
      if (error.toLowerCase().includes(key.toLowerCase())) {
        return value;
      }
    }
    // Return the string if it seems user-friendly already
    if (error.length < 100 && !error.includes('Error:') && !error.includes('Exception')) {
      return error;
    }
    return 'An unexpected error occurred. Please try again.';
  }

  // Handle Error objects
  if (error instanceof Error) {
    const message = error.message;
    if (ERROR_MAP[message]) {
      return ERROR_MAP[message];
    }
    for (const [key, value] of Object.entries(ERROR_MAP)) {
      if (message.toLowerCase().includes(key.toLowerCase())) {
        return value;
      }
    }
    // Check error name
    if (ERROR_MAP[error.name]) {
      return ERROR_MAP[error.name];
    }
  }

  // Handle Supabase error objects
  if (error.code && ERROR_MAP[error.code]) {
    return ERROR_MAP[error.code];
  }
  if (error.error && ERROR_MAP[error.error]) {
    return ERROR_MAP[error.error];
  }
  if (error.message) {
    return getUserFriendlyError(error.message);
  }

  // Handle HTTP status codes
  if (error.status) {
    if (error.status === 401) return 'Please log in to continue.';
    if (error.status === 403) return 'You don\'t have permission to do that.';
    if (error.status === 404) return 'The requested item was not found.';
    if (error.status === 429) return ERROR_MAP['429'];
    if (error.status >= 500) return ERROR_MAP['server_error'];
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Log error for debugging while returning user-friendly message
 * @param {Error|string|object} error - The error
 * @param {string} context - Where the error occurred
 * @returns {string} User-friendly error message
 */
export function handleError(error, context = '') {
  // Log the full error for debugging
  console.error(`Error${context ? ` in ${context}` : ''}:`, error);

  // Return user-friendly message
  return getUserFriendlyError(error);
}
