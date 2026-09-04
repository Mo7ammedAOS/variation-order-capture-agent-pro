import { describe, expect, it } from 'vitest';
import { parseAnswerForField, parseWorkStatus } from '@/lib/reply-intent';

/**
 * Reading a reply in the light of the question that was asked.
 *
 * This is a regression suite for a live failure on 2026-09-04. The exchange
 * asked "Has the work started on site?", the engineer answered "No", and
 * nothing could read it: a bare "no" is not a statement about work. The reply
 * yielded no fact, was taken for a brand new report, and the conversation
 * started again from "which project?" — four times in a row, which is roughly
 * three more than anybody tolerates before they stop using a system.
 */

describe('has the work started?', () => {
  it('reads a bare no as not started', () => {
    for (const reply of ['No', 'no', 'nope', 'not yet', 'No.']) {
      expect(parseAnswerForField('work_status', reply)).toBe('not_started');
    }
  });

  it('reads a bare yes as started', () => {
    for (const reply of ['Yes', 'yep', 'yeah', 'started', 'Yes it has']) {
      expect(parseAnswerForField('work_status', reply)).toBe('in_progress');
    }
  });

  it('still prefers what he actually said over the yes or no', () => {
    expect(parseAnswerForField('work_status', 'no it is on hold')).toBe('on_hold');
    expect(parseAnswerForField('work_status', 'yes finished last week')).toBe('completed');
  });

  it('leaves a sentence alone, because a sentence is a report', () => {
    // "No, the client said..." is a report that happens to open with "no".
    // Swallowing it as a work status would throw the whole message away.
    expect(
      parseAnswerForField('work_status', 'No the client said the ceiling has to come down'),
    ).toBeNull();
  });

  it('does not read yes or no as anything when that was not the question', () => {
    // A bare yes only means something because of what was asked a moment ago.
    expect(parseAnswerForField('event_date', 'no')).toBeNull();
    expect(parseAnswerForField('document_reference', 'yes')).toBeNull();
    expect(parseWorkStatus('no')).toBeNull();
  });
});

describe('when did this happen?', () => {
  const today = new Date(Date.UTC(2026, 8, 4));

  it('reads the answers people actually send', () => {
    expect(parseAnswerForField('event_date', 'yesterday', today)).not.toBeNull();
    expect(parseAnswerForField('event_date', '03 September 2026', today)).not.toBeNull();
    expect(parseAnswerForField('event_date', '3 days ago', today)).not.toBeNull();
  });
});
