/**
 * Logger Utility Tests
 *
 * Tests for the configurable logging utility.
 * Why this test matters: Ensures log levels work correctly and that
 * logging can be disabled/enabled programmatically for production vs dev.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  expectTypeOf,
} from 'vitest';

// Use vi.hoisted to define mocks that will be available when vi.mock is hoisted
const { mockAddBreadcrumb, mockCaptureException, mockCaptureMessage } =
  vi.hoisted(() => ({
    mockAddBreadcrumb: vi.fn(),
    mockCaptureException: vi.fn(),
    mockCaptureMessage: vi.fn(),
  }));

// Mock Sentry at module level (required for ESM)
vi.mock('@sentry/browser', () => ({
  addBreadcrumb: mockAddBreadcrumb,
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
}));

import {
  createLogger,
  LogLevel,
  setGlobalLogLevel,
  getGlobalLogLevel,
  getLogBuffer,
  clearLogBuffer,
  subscribeToLogs,
  type LogEntry,
} from './logger';

describe('Logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    // Reset to default log level
    setGlobalLogLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger with a tag prefix', () => {
      const logger = createLogger('TestModule');
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should prefix messages with the tag in brackets', () => {
      const logger = createLogger('GPS');
      logger.info('Watch started');
      expect(consoleSpy.log).toHaveBeenCalledWith('[GPS]', 'Watch started');
    });

    it('should support multiple arguments', () => {
      const logger = createLogger('Storage');
      logger.info('Found scenarios:', ['Scene1', 'Scene2']);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '[Storage]',
        'Found scenarios:',
        ['Scene1', 'Scene2']
      );
    });
  });

  describe('log levels', () => {
    it('should have correct log level hierarchy', () => {
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
      expect(LogLevel.ERROR).toBeLessThan(LogLevel.SILENT);
    });

    it('should log debug messages when level is DEBUG', () => {
      setGlobalLogLevel(LogLevel.DEBUG);
      const logger = createLogger('Test');
      logger.debug('debug message');
      expect(consoleSpy.log).toHaveBeenCalledWith('[Test]', 'debug message');
    });

    it('should NOT log debug messages when level is INFO', () => {
      setGlobalLogLevel(LogLevel.INFO);
      const logger = createLogger('Test');
      logger.debug('debug message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should log info messages when level is INFO', () => {
      setGlobalLogLevel(LogLevel.INFO);
      const logger = createLogger('Test');
      logger.info('info message');
      expect(consoleSpy.log).toHaveBeenCalledWith('[Test]', 'info message');
    });

    it('should NOT log info messages when level is WARN', () => {
      setGlobalLogLevel(LogLevel.WARN);
      const logger = createLogger('Test');
      logger.info('info message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should log warn messages when level is WARN', () => {
      setGlobalLogLevel(LogLevel.WARN);
      const logger = createLogger('Test');
      logger.warn('warning message');
      expect(consoleSpy.warn).toHaveBeenCalledWith('[Test]', 'warning message');
    });

    it('should NOT log warn messages when level is ERROR', () => {
      setGlobalLogLevel(LogLevel.ERROR);
      const logger = createLogger('Test');
      logger.warn('warning message');
      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });

    it('should log error messages when level is ERROR', () => {
      setGlobalLogLevel(LogLevel.ERROR);
      const logger = createLogger('Test');
      logger.error('error message');
      expect(consoleSpy.error).toHaveBeenCalledWith('[Test]', 'error message');
    });

    it('should NOT log any messages when level is SILENT', () => {
      setGlobalLogLevel(LogLevel.SILENT);
      const logger = createLogger('Test');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });
  });

  describe('getGlobalLogLevel / setGlobalLogLevel', () => {
    it('should get and set the global log level', () => {
      setGlobalLogLevel(LogLevel.WARN);
      expect(getGlobalLogLevel()).toBe(LogLevel.WARN);

      setGlobalLogLevel(LogLevel.DEBUG);
      expect(getGlobalLogLevel()).toBe(LogLevel.DEBUG);
    });

    it('should affect all loggers', () => {
      const logger1 = createLogger('Module1');
      const logger2 = createLogger('Module2');

      setGlobalLogLevel(LogLevel.ERROR);

      logger1.info('info1');
      logger2.warn('warn2');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();

      logger1.error('error1');
      expect(consoleSpy.error).toHaveBeenCalledWith('[Module1]', 'error1');
    });
  });

  describe('error logging with Error objects', () => {
    it('should handle Error objects properly', () => {
      const logger = createLogger('Test');
      const error = new Error('Something went wrong');
      logger.error('Operation failed:', error);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '[Test]',
        'Operation failed:',
        error
      );
    });
  });

  /**
   * Tests for the in-memory log buffer (ring buffer) feature.
   * Why this test matters: The log viewer UI needs access to recent log entries
   * to display them in an expandable panel. The buffer must have a size limit
   * to prevent memory issues.
   */
  describe('log buffer (ring buffer)', () => {
    beforeEach(() => {
      clearLogBuffer();
    });

    it('should store log entries in the buffer', () => {
      const logger = createLogger('GPS');
      logger.info('Watch started');

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(1);
      expect(buffer[0].tag).toBe('GPS');
      expect(buffer[0].message).toBe('Watch started');
      expect(buffer[0].level).toBe(LogLevel.INFO);
    });

    it('should include timestamp in each log entry', () => {
      const before = Date.now();
      const logger = createLogger('Test');
      logger.info('test message');
      const after = Date.now();

      const buffer = getLogBuffer();
      expect(buffer[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(buffer[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should store entries for all log levels', () => {
      const logger = createLogger('Multi');
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(4);
      expect(buffer[0].level).toBe(LogLevel.DEBUG);
      expect(buffer[1].level).toBe(LogLevel.INFO);
      expect(buffer[2].level).toBe(LogLevel.WARN);
      expect(buffer[3].level).toBe(LogLevel.ERROR);
    });

    it('should limit buffer size to 100 entries (ring buffer)', () => {
      const logger = createLogger('Bulk');

      // Add 150 entries
      for (let i = 0; i < 150; i++) {
        logger.info(`message ${i}`);
      }

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(100);
      // Oldest entries should be dropped, newest kept
      expect(buffer[0].message).toBe('message 50');
      expect(buffer[99].message).toBe('message 149');
    });

    it('should clear buffer with clearLogBuffer()', () => {
      const logger = createLogger('Test');
      logger.info('message 1');
      logger.info('message 2');

      expect(getLogBuffer().length).toBe(2);
      clearLogBuffer();
      expect(getLogBuffer().length).toBe(0);
    });

    it('should return a copy of the buffer to prevent mutation', () => {
      const logger = createLogger('Test');
      logger.info('original');

      const buffer1 = getLogBuffer();
      buffer1.push({
        timestamp: 0,
        level: LogLevel.INFO,
        tag: 'Fake',
        message: 'fake',
      });

      const buffer2 = getLogBuffer();
      expect(buffer2.length).toBe(1); // Still just the original
    });

    it('should still add to buffer even when log level filters console output', () => {
      setGlobalLogLevel(LogLevel.ERROR);
      const logger = createLogger('Test');
      logger.debug('filtered debug');
      logger.info('filtered info');

      // Console should NOT be called
      expect(consoleSpy.log).not.toHaveBeenCalled();

      // But buffer should still have the entries
      const buffer = getLogBuffer();
      expect(buffer.length).toBe(2);
    });
  });

  /**
   * Tests for log subscription feature.
   * Why this test matters: The log panel UI needs to receive updates
   * when new log entries are added, to update the display in real-time.
   */
  describe('log subscription', () => {
    beforeEach(() => {
      clearLogBuffer();
    });

    it('should notify subscribers when a log entry is added', () => {
      const callback = vi.fn();
      subscribeToLogs(callback);

      const logger = createLogger('Test');
      logger.info('test message');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          tag: 'Test',
          message: 'test message',
          level: LogLevel.INFO,
        })
      );
    });

    it('should return an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToLogs(callback);

      const logger = createLogger('Test');
      logger.info('first');
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      logger.info('second');
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should support multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      subscribeToLogs(callback1);
      subscribeToLogs(callback2);

      const logger = createLogger('Test');
      logger.warn('warning');

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should notify for all log levels', () => {
      const callback = vi.fn();
      subscribeToLogs(callback);

      const logger = createLogger('Test');
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      expect(callback).toHaveBeenCalledTimes(4);
    });

    it('should not break logging when a subscriber throws', () => {
      // Why this test matters: A faulty subscriber should not prevent other
      // subscribers from receiving log entries or break the logging system.
      const callback1 = vi.fn();
      const throwingCallback = vi.fn(() => {
        throw new Error('Subscriber error');
      });
      const callback2 = vi.fn();

      subscribeToLogs(callback1);
      subscribeToLogs(throwingCallback);
      subscribeToLogs(callback2);

      const logger = createLogger('Test');
      // This should not throw despite the faulty subscriber
      expect(() => logger.info('test message')).not.toThrow();

      // All subscribers should still be called
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(throwingCallback).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);

      // The error should be logged to console.error
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '[Logger] Subscriber threw an error:',
        expect.any(Error)
      );
    });
  });

  /**
   * Tests for safe argument serialization in log buffer.
   * Why this test matters: JSON.stringify can throw on circular structures
   * and loses Error details. Logging should never throw and should preserve
   * useful information from Error instances.
   */
  describe('safe argument serialization', () => {
    beforeEach(() => {
      clearLogBuffer();
    });

    it('should serialize Error instances with name, message, and stack', () => {
      const logger = createLogger('Test');
      const error = new Error('Something failed');
      error.name = 'CustomError';
      logger.error('Operation failed:', error);

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(1);
      const message = buffer[0].message;

      // Should contain error name, message, and stack
      expect(message).toContain('CustomError');
      expect(message).toContain('Something failed');
      expect(message).toContain('stack');
    });

    it('should serialize Error instances with enumerable properties', () => {
      const logger = createLogger('Test');
      const error = new Error('DB error');
      // Add enumerable properties
      (error as Error & { code: string }).code = 'ECONNREFUSED';
      (error as Error & { retryable: boolean }).retryable = true;
      logger.error(error);

      const buffer = getLogBuffer();
      const message = buffer[0].message;

      expect(message).toContain('ECONNREFUSED');
      expect(message).toContain('retryable');
    });

    it('should handle circular references without throwing', () => {
      const logger = createLogger('Test');
      const circular: Record<string, unknown> = { name: 'test' };
      circular.self = circular; // Create circular reference

      // This should NOT throw
      expect(() => logger.info('Circular:', circular)).not.toThrow();

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(1);
      // Should have some fallback representation
      expect(buffer[0].message).toContain('Circular:');
    });

    it('should handle deeply nested circular references', () => {
      const logger = createLogger('Test');
      const a: Record<string, unknown> = { id: 'a' };
      const b: Record<string, unknown> = { id: 'b', ref: a };
      a.ref = b; // a -> b -> a (cycle)

      expect(() => logger.info('Nested circular:', a)).not.toThrow();

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(1);
    });

    it('should still serialize normal objects correctly', () => {
      const logger = createLogger('Test');
      const data = { foo: 'bar', count: 42 };
      logger.info('Data:', data);

      const buffer = getLogBuffer();
      const message = buffer[0].message;

      expect(message).toContain('foo');
      expect(message).toContain('bar');
      expect(message).toContain('42');
    });

    it('should handle null and undefined gracefully', () => {
      const logger = createLogger('Test');
      logger.info('Values:', null, undefined);

      const buffer = getLogBuffer();
      expect(buffer[0].message).toBe('Values: null undefined');
    });

    it('should handle arrays correctly', () => {
      const logger = createLogger('Test');
      logger.info('Array:', [1, 2, 3]);

      const buffer = getLogBuffer();
      expect(buffer[0].message).toContain('[1,2,3]');
    });

    it('should handle functions gracefully', () => {
      const logger = createLogger('Test');
      const fn = function testFunc() {
        return 42;
      };

      expect(() => logger.info('Function:', fn)).not.toThrow();

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(1);
    });

    it('should handle Symbol gracefully', () => {
      const logger = createLogger('Test');
      const sym = Symbol('test');

      expect(() => logger.info('Symbol:', sym)).not.toThrow();

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(1);
    });

    it('should handle BigInt gracefully', () => {
      const logger = createLogger('Test');
      const big = BigInt(9007199254740991);

      expect(() => logger.info('BigInt:', big)).not.toThrow();

      const buffer = getLogBuffer();
      expect(buffer.length).toBe(1);
      expect(buffer[0].message).toContain('9007199254740991');
    });
  });

  describe('Sentry integration', () => {
    /**
     * Why these tests matter:
     * User feedback showed that errors logged via log.error() were visible
     * in the app's log panel but NOT reported to Sentry. This meant developers
     * had no visibility into production errors. These tests ensure:
     * 1. All log levels add Sentry breadcrumbs for debugging context
     * 2. log.error() with Error objects automatically reports to Sentry
     */

    beforeEach(() => {
      clearLogBuffer();
      mockAddBreadcrumb.mockClear();
      mockCaptureException.mockClear();
      mockCaptureMessage.mockClear();
    });

    it('should add breadcrumb for debug logs', () => {
      const logger = createLogger('Test');

      logger.debug('Debug message');

      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'log',
          level: 'debug',
          message: '[Test] Debug message',
        })
      );
    });

    it('should add breadcrumb for info logs', () => {
      const logger = createLogger('GPS');

      logger.info('Watch started');

      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'log',
          level: 'info',
          message: '[GPS] Watch started',
        })
      );
    });

    it('should add breadcrumb for warn logs', () => {
      const logger = createLogger('Storage');

      logger.warn('Low disk space');

      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'log',
          level: 'warning',
          message: '[Storage] Low disk space',
        })
      );
    });

    it('should add breadcrumb for error logs', () => {
      const logger = createLogger('Store');

      logger.error('Failed to persist action');

      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'log',
          level: 'error',
          message: expect.stringContaining('[Store] Failed to persist action'),
        })
      );
    });

    it('should call captureException when log.error receives an Error object', () => {
      const logger = createLogger('Store');

      const testError = new Error('NoModificationAllowedError');
      logger.error('Failed to persist action:', testError);

      expect(mockCaptureException).toHaveBeenCalledWith(testError);
    });

    it('should call captureException for each Error object in args', () => {
      const logger = createLogger('Test');

      const error1 = new Error('First error');
      const error2 = new Error('Second error');
      logger.error('Multiple errors:', error1, 'and', error2);

      expect(mockCaptureException).toHaveBeenCalledTimes(2);
      expect(mockCaptureException).toHaveBeenCalledWith(error1);
      expect(mockCaptureException).toHaveBeenCalledWith(error2);
    });

    it('should NOT call captureException for non-Error arguments', () => {
      const logger = createLogger('Test');

      logger.error('Plain error message without Error object');

      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('should NOT call captureException for info/warn/debug logs with Error objects', () => {
      const logger = createLogger('Test');
      const error = new Error('Some error');

      logger.debug('Debug with error:', error);
      logger.info('Info with error:', error);
      logger.warn('Warn with error:', error);

      // captureException should NOT be called - only log.error triggers it
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('should call captureMessage with warning level and a normalized-template fingerprint for log.warn()', () => {
      // Why: warnings must appear as standalone issues in Sentry so the team
      // can monitor unexpected conditions (e.g., malformed zip filenames)
      // without waiting for a subsequent error to surface them as breadcrumbs.
      // The fingerprint is derived from a NORMALIZED message template (dynamic
      // tokens replaced by placeholders) so dynamic values collapse into one
      // Issue while distinct messages stay distinct.
      const logger = createLogger('ZipReader');

      logger.warn('Unexpected filename: "actions/my-notes.json"');

      expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        '[ZipReader] Unexpected filename: "actions/my-notes.json"',
        {
          level: 'warning',
          fingerprint: [
            'log',
            'warning',
            'ZipReader',
            'Unexpected filename: "{str}"',
          ],
        }
      );
    });

    it('should group warnings with the same template despite dynamic message content', () => {
      // Why: two warnings of the same KIND but with different dynamic payloads
      // must share a fingerprint so they group into one Issue.
      const logger = createLogger('Capture');

      logger.warn('Suspicious image at frame 12: size 100 bytes');
      logger.warn('Suspicious image at frame 87: size 250 bytes');

      expect(mockCaptureMessage).toHaveBeenCalledTimes(2);
      const fingerprints = mockCaptureMessage.mock.calls.map(
        (call) => (call[1] as { fingerprint: string[] }).fingerprint
      );
      const expected = [
        'log',
        'warning',
        'Capture',
        'Suspicious image at frame {n}: size {n} bytes',
      ];
      expect(fingerprints[0]).toEqual(expected);
      expect(fingerprints[1]).toEqual(expected);
    });

    it('should NOT collapse genuinely different warnings that share a tag', () => {
      // Why: the tag identifies the source module, not the kind of message.
      // Two unrelated warnings from the same logger (e.g. quota vs. not-found)
      // must produce DIFFERENT fingerprints so they remain separate Issues —
      // otherwise the per-tag grouping would hide distinct problems.
      const logger = createLogger('Storage');

      logger.warn('Quota exceeded while writing frame');
      logger.warn('Requested file was not found');

      expect(mockCaptureMessage).toHaveBeenCalledTimes(2);
      const [first, second] = mockCaptureMessage.mock.calls.map(
        (call) => (call[1] as { fingerprint: string[] }).fingerprint
      );
      expect(first).not.toEqual(second);
      expect(first).toEqual([
        'log',
        'warning',
        'Storage',
        'Quota exceeded while writing frame',
      ]);
      expect(second).toEqual([
        'log',
        'warning',
        'Storage',
        'Requested file was not found',
      ]);
    });

    it('should call captureMessage with error level and a normalized-template fingerprint for string-only log.error()', () => {
      // Why (option B): a plain-string log.error must still surface as a Sentry
      // Issue, not only a breadcrumb/Log. The normalized-template fingerprint
      // collapses dynamic error messages of the same kind into one Issue.
      const logger = createLogger('Capture');

      logger.error('Suspicious image detected at frame 42: size 0 bytes');

      expect(mockCaptureException).not.toHaveBeenCalled();
      expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        '[Capture] Suspicious image detected at frame 42: size 0 bytes',
        {
          level: 'error',
          fingerprint: [
            'log',
            'error',
            'Capture',
            'Suspicious image detected at frame {n}: size {n} bytes',
          ],
        }
      );
    });

    it('should give a string-only error and a UUID-bearing error the same template when only the id differs', () => {
      // Why: UUIDs are dynamic; two errors that differ only by a UUID are the
      // same kind of problem and must group together.
      const logger = createLogger('Sync');

      logger.error('Session 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed');
      logger.error('Session 7c9e6679-7425-40de-944b-e07fc1f90ae7 failed');

      const fingerprints = mockCaptureMessage.mock.calls.map(
        (call) => (call[1] as { fingerprint: string[] }).fingerprint
      );
      expect(fingerprints[0]).toEqual([
        'log',
        'error',
        'Sync',
        'Session {uuid} failed',
      ]);
      expect(fingerprints[1]).toEqual(fingerprints[0]);
    });

    it('should NOT call captureMessage when log.error receives an Error object', () => {
      // Why: when an Error is present, captureException already produces an
      // Issue with a full stack trace; the string-only fallback must not also
      // fire and create a duplicate Issue.
      const logger = createLogger('Store');

      logger.error('Failed to persist action:', new Error('QuotaExceeded'));

      expect(mockCaptureException).toHaveBeenCalledTimes(1);
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });

    it('should NOT call captureMessage for debug/info logs', () => {
      // Why: only warn (captureMessage) and error (captureException or
      // string-only captureMessage) report standalone events; debug/info are
      // breadcrumbs only.
      const logger = createLogger('Test');

      logger.debug('debug msg');
      logger.info('info msg');

      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fingerprint template normalization (toFingerprintTemplate)
  //
  // These tests were added after a code-review of the real `log.warn`/
  // `log.error` call sites across both apps (RecorderApp + AppFramework). They
  // pin the dynamic-token categories that DO occur in practice (numbers, ISO
  // timestamps, quoted filenames/paths, signed/decimal/exponent values) and
  // explicitly document the deliberate NON-normalization of free-form error
  // text and bare identifiers — over-normalizing those would merge genuinely
  // distinct problems into one Issue, which is worse than mild fragmentation.
  // ──────────────────────────────────────────────────────────────────────────

  describe('fingerprint template normalization', () => {
    beforeEach(() => {
      clearLogBuffer();
      mockCaptureMessage.mockClear();
    });

    /** Extract the fingerprint array from the Nth captureMessage call. */
    const fingerprintOf = (callIndex: number): string[] =>
      (
        mockCaptureMessage.mock.calls[callIndex]?.[1] as {
          fingerprint: string[];
        }
      ).fingerprint;

    it('should normalize signed, decimal, and exponent numbers to the same template', () => {
      // Why: drift / coordinate / size values appear as negative, fractional,
      // and exponent forms; all are the same KIND of message and must group.
      const logger = createLogger('Pose');

      logger.warn('Drift detected: -3.5 m');
      logger.warn('Drift detected: 12.75 m');
      logger.warn('Drift detected: 1e3 m');

      const expected = ['log', 'warning', 'Pose', 'Drift detected: {n} m'];
      expect(fingerprintOf(0)).toEqual(expected);
      expect(fingerprintOf(1)).toEqual(expected);
      expect(fingerprintOf(2)).toEqual(expected);
    });

    it('should group ISO 8601 timestamps via the number rule', () => {
      // Why: timestamps are entirely numeric components, so the {n} rule
      // collapses them without a dedicated date rule. Note the `-?` in the
      // number pattern also consumes the date separators and the fractional
      // seconds fold into the preceding number — the exact template is a bit
      // lossy, but it is STABLE across timestamps, which is all grouping needs.
      // This is non-obvious and easy to regress, so pin it.
      const logger = createLogger('Session');

      logger.warn('Session started at 2026-05-29T09:43:48.123Z');
      logger.warn('Session started at 2026-05-30T11:02:05.000Z');

      expect(fingerprintOf(0)).toEqual(fingerprintOf(1));
      expect(fingerprintOf(0)).toEqual([
        'log',
        'warning',
        'Session',
        'Session started at {n}{n}{n}T{n}:{n}:{n}Z',
      ]);
    });

    it('should fully collapse a double-quoted path even when it embeds a number', () => {
      // Why: real call sites log `Skipping "actions/000001.json"`. The number
      // rule runs before the quoted-string rule, so the digits are replaced
      // first and the whole quoted token then collapses to "{str}". Two
      // different action files must therefore share one fingerprint.
      const logger = createLogger('ZipReader');

      logger.warn('Skipping "actions/000001.json": parse failed');
      logger.warn('Skipping "actions/000999.json": parse failed');

      expect(fingerprintOf(0)).toEqual(fingerprintOf(1));
      expect(fingerprintOf(0)).toEqual([
        'log',
        'warning',
        'ZipReader',
        'Skipping "{str}": parse failed',
      ]);
    });

    it('should normalize single-quoted strings the same way as double-quoted', () => {
      // Why: messages use both quote styles; both must collapse so e.g.
      // `Unexpected token 'foo'` and `Unexpected token 'bar'` group together.
      const logger = createLogger('Parser');

      logger.warn("Unexpected token 'foo'");
      logger.warn("Unexpected token 'bar'");

      expect(fingerprintOf(0)).toEqual(fingerprintOf(1));
      expect(fingerprintOf(0)).toEqual([
        'log',
        'warning',
        'Parser',
        "Unexpected token '{str}'",
      ]);
    });

    it('should group a message mixing several dynamic token kinds at once', () => {
      // Why: the worst real case (the "Suspicious image" log and friends) mixes
      // numbers and quoted filenames in one line; the combined template must be
      // stable across differing concrete values.
      const logger = createLogger('Capture');

      logger.error('Frame 12 ("tiles/000012.webp") failed after 3 retries');
      logger.error('Frame 87 ("tiles/000087.webp") failed after 9 retries');

      expect(fingerprintOf(0)).toEqual(fingerprintOf(1));
      expect(fingerprintOf(0)).toEqual([
        'log',
        'error',
        'Capture',
        'Frame {n} ("{str}") failed after {n} retries',
      ]);
    });

    it('should NOT normalize free-form error message text (kept distinct on purpose)', () => {
      // Why (deliberate boundary): appended `error.message` strings carry the
      // actual diagnosis (e.g. permission-checker logs `error.message`). Two
      // different underlying errors are different problems and MUST stay as
      // separate Issues, so their differing prose yields differing templates.
      const logger = createLogger('Geo');

      logger.warn('Geolocation error:', 'User denied Geolocation');
      logger.warn('Geolocation error:', 'Timeout expired');

      expect(fingerprintOf(0)).not.toEqual(fingerprintOf(1));
    });

    it('should NOT normalize bare (unquoted, non-numeric) identifiers', () => {
      // Why (deliberate boundary): bare ids/names like `${name}` or `${pointId}`
      // are not wrapped in quotes and are not UUID-shaped, so they are NOT
      // normalized. This keeps distinct named entities distinct rather than
      // risking an over-broad rule that swallows ordinary words. UUID-shaped
      // ids ARE normalized (covered by a separate test above).
      const logger = createLogger('RefPoints');

      logger.warn('Failed to process ref point alpha');
      logger.warn('Failed to process ref point bravo');

      expect(fingerprintOf(0)).not.toEqual(fingerprintOf(1));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * LogEntry is an immutable log record, constructed once and appended
     * to the ring buffer. Fields must never change after creation.
     */
    it('LogEntry ≡ Readonly<LogEntry>', () => {
      expectTypeOf<LogEntry>().toEqualTypeOf<Readonly<LogEntry>>();
    });
  });
});
