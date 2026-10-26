import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlanEdits, buildReviewPlan, summary } from '../background/review-plan.js';
import { sampleSnapshot } from './helpers.js';

function acceptedFor(snapshot) {
  return {
    accepted: snapshot.eligibleTabs.map((tab, index) => ({
      ref: tab.ref,
      category: ['Development', 'Study', 'Shopping'][index],
      explanation: `reason ${tab.ref}`,
      confidence: 60 + index,
    })),
    missingRefs: [],
    rejected: [],
  };
}

test('the plan maps classifications back to real tab IDs and counts categories locally', async () => {
  const snapshot = await sampleSnapshot();
  const plan = buildReviewPlan(snapshot, acceptedFor(snapshot));
  assert.deepEqual(plan.items.map((item) => item.tabId), [1, 2, 3]);
  assert.deepEqual(plan.counts, {
    Development: 1,
    Study: 1,
    Research: 0,
    Shopping: 1,
    Entertainment: 0,
    Other: 0,
    'Junk / Review': 0,
  });
  assert.equal(plan.items[0].closeSelected, false);
  assert.equal(plan.windowId, 10);
  assert.equal(plan.sessionId, snapshot.sessionId);
});

test('model-supplied totals cannot override validated counts', async () => {
  const snapshot = await sampleSnapshot();
  const accepted = acceptedFor(snapshot);
  accepted.accepted[0].category = 'Development';
  const plan = buildReviewPlan(snapshot, accepted);
  applyPlanEdits(plan, { moves: [{ tabId: 3, category: 'Development' }] });
  assert.equal(plan.counts.Development, 2);
  assert.equal(plan.counts.Shopping, 0);
});

test('a total supplied inside the model payload is ignored', async () => {
  const snapshot = await sampleSnapshot();
  const accepted = acceptedFor(snapshot);
  accepted.total = 999;
  const plan = buildReviewPlan(snapshot, accepted);
  assert.equal(summary(plan).total, 3);
});

test('user edits move tabs and keep the AI original intact', async () => {
  const snapshot = await sampleSnapshot();
  const plan = buildReviewPlan(snapshot, acceptedFor(snapshot));
  const { plan: updated, rejectedMoves } = applyPlanEdits(plan, { moves: [{ tabId: 1, category: 'Other' }] });
  const item = updated.items.find((entry) => entry.tabId === 1);
  assert.equal(item.category, 'Other');
  assert.equal(item.originalCategory, 'Development');
  assert.equal(item.userEdited, true);
  assert.deepEqual(rejectedMoves, []);
});

test('closure selection is explicit and per tab', async () => {
  const snapshot = await sampleSnapshot();
  const plan = buildReviewPlan(snapshot, acceptedFor(snapshot));
  applyPlanEdits(plan, { closures: [{ tabId: 2, closeSelected: true }] });
  assert.equal(plan.items.find((item) => item.tabId === 2).closeSelected, true);
  assert.equal(plan.items.find((item) => item.tabId === 1).closeSelected, false);
  assert.equal(summary(plan).closureCount, 1);
});

test('edits referencing unknown tabs are rejected rather than applied', async () => {
  const snapshot = await sampleSnapshot();
  const plan = buildReviewPlan(snapshot, acceptedFor(snapshot));
  const { rejectedMoves, rejectedClosures } = applyPlanEdits(plan, {
    moves: [{ tabId: 777, category: 'Study' }],
    closures: [{ tabId: 888, closeSelected: true }],
  });
  assert.deepEqual(rejectedMoves, [{ tabId: 777, code: 'STALE_TABS', reason: 'tabId is not in the current plan' }]);
  assert.deepEqual(rejectedClosures, [{ tabId: 888, code: 'STALE_TABS', reason: 'tabId is not in the current plan' }]);
  assert.equal(plan.items.every((item) => item.closeSelected === false), true);
});

test('an edit targeting a skipped browser page is reported as an unsupported tab', async () => {
  const snapshot = await sampleSnapshot();
  const plan = buildReviewPlan(snapshot, acceptedFor(snapshot));
  const { rejectedMoves } = applyPlanEdits(plan, { moves: [{ tabId: 4, category: 'Study' }] });
  assert.equal(rejectedMoves[0].code, 'UNSUPPORTED_TABS');
});

test('invalid categories and non-boolean closure flags are refused', async () => {
  const snapshot = await sampleSnapshot();
  const plan = buildReviewPlan(snapshot, acceptedFor(snapshot));
  assert.throws(
    () => applyPlanEdits(plan, { moves: [{ tabId: 1, category: 'Gambling' }] }),
    (error) => {
      assert.equal(error.code, 'INVALID_REQUEST');
      return true;
    },
  );
  assert.throws(
    () => applyPlanEdits(plan, { closures: [{ tabId: 1, closeSelected: 'yes' }] }),
    (error) => {
      assert.equal(error.code, 'INVALID_REQUEST');
      return true;
    },
  );
});

test('unclassified tabs stay visible instead of being invented', async () => {
  const snapshot = await sampleSnapshot();
  const accepted = acceptedFor(snapshot);
  accepted.accepted = accepted.accepted.slice(0, 1);
  accepted.missingRefs = [2, 3];
  const plan = buildReviewPlan(snapshot, accepted);
  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.unclassified.map((tab) => tab.tabId), [2, 3]);
});
