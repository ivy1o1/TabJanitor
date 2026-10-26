import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CATEGORY_COLORS } from '../shared/constants.js';
import { applyOrganization } from '../background/organizer.js';
import { buildReviewPlan } from '../background/review-plan.js';
import { fakeChrome, sampleTabs } from './helpers.js';
import { captureWindowSnapshot } from '../background/tab-scanner.js';

async function planFixture(tabs = sampleTabs()) {
  const { chromeRef, calls } = fakeChrome(tabs);
  const snapshot = await captureWindowSnapshot({ chromeRef });
  const plan = buildReviewPlan(snapshot, {
    accepted: snapshot.eligibleTabs.map((tab, index) => ({
      ref: tab.ref,
      category: ['Development', 'Study', 'Junk / Review'][index],
      explanation: `reason ${tab.ref}`,
      confidence: 70 + index,
    })),
    missingRefs: [],
    rejected: [],
  });
  return { snapshot, plan, chromeRef, calls };
}

test('approved categories become native tab groups with a documented color', async () => {
  const { plan, chromeRef, calls } = await planFixture();
  plan.items.find((item) => item.tabId === 1).closeSelected = false;
  const result = await applyOrganization({ plan, chromeRef });
  assert.equal(result.partial, false);
  assert.deepEqual(result.groups.map((group) => group.title).sort(), ['Development', 'Junk / Review', 'Study']);
  assert.equal(result.groups.find((group) => group.category === 'Development').color, 'cyan');
  assert.equal(result.groups.find((group) => group.category === 'Junk / Review').color, 'red');
  assert.equal(calls.grouped.length, 3);
  assert.equal(result.closures.length, 0);
});

test('every group call uses the option names Chrome actually accepts', async () => {
  const { snapshot, plan, chromeRef, calls } = await planFixture();
  await applyOrganization({ plan, chromeRef });
  assert.equal(calls.groupOptions.length, 3);
  for (const options of calls.groupOptions) {
    assert.deepEqual(Object.keys(options).sort(), ['createProperties', 'tabIds']);
    assert.deepEqual(options.createProperties, { windowId: snapshot.windowId });
  }
});

test('every category colour is a value chrome.tabGroups actually accepts', async () => {
  const tabs = CATEGORIES.map((category, index) => ({
    id: index + 1,
    windowId: 10,
    title: `${category} page`,
    url: `https://tab-${index}.example.com/`,
    active: false,
  }));
  const { chromeRef, calls } = fakeChrome(tabs);
  const snapshot = await captureWindowSnapshot({ chromeRef });
  const plan = buildReviewPlan(snapshot, {
    accepted: snapshot.eligibleTabs.map((tab, index) => ({
      ref: tab.ref,
      category: CATEGORIES[index],
      explanation: `reason ${tab.ref}`,
      confidence: 70,
    })),
    missingRefs: [],
    rejected: [],
  });
  const result = await applyOrganization({ plan, chromeRef });
  assert.equal(result.partial, false, JSON.stringify(result.failures));
  assert.equal(calls.groupUpdates.length, CATEGORIES.length);
  assert.deepEqual(
    calls.groupUpdates.map((entry) => entry.update.color).sort(),
    CATEGORIES.map((category) => CATEGORY_COLORS[category]).sort(),
  );
});

test('only explicitly selected tabs are closed', async () => {
  const { plan, chromeRef, calls } = await planFixture();
  plan.items.find((item) => item.tabId === 3).closeSelected = true;
  const result = await applyOrganization({ plan, chromeRef });
  assert.deepEqual(calls.removed, [3]);
  assert.deepEqual(result.closures, [{ tabId: 3, status: 'closed' }]);
  assert.equal(result.closureRequested, 1);
});

test('selecting no closures closes nothing', async () => {
  const { plan, chromeRef, calls } = await planFixture();
  const result = await applyOrganization({ plan, chromeRef });
  assert.deepEqual(calls.removed, []);
  assert.equal(result.closureRequested, 0);
  assert.equal(result.closureCompleted, 0);
});

test('tabs that disappeared before apply are reported, not faked', async () => {
  const { plan, chromeRef } = await planFixture();
  const surviving = sampleTabs().filter((tab) => tab.id !== 2);
  chromeRef.tabs.query = async () => surviving;
  const result = await applyOrganization({ plan, chromeRef });
  assert.deepEqual(result.stale, [{ tabId: 2, reason: 'tab no longer exists in the scanned window' }]);
  assert.equal(result.groups.some((group) => group.tabIds.includes(2)), false);
});

test('tabs moved to another window are treated as stale', async () => {
  const { plan, chromeRef } = await planFixture();
  const moved = sampleTabs().map((tab) => (tab.id === 1 ? { ...tab, windowId: 99 } : tab));
  chromeRef.tabs.query = async () => moved;
  const result = await applyOrganization({ plan, chromeRef });
  assert.deepEqual(result.stale, [{ tabId: 1, reason: 'tab no longer exists in the scanned window' }]);
});

test('a failing group operation is reported as partial without claiming success', async () => {
  const { plan, chromeRef } = await planFixture();
  chromeRef.tabs.group = async () => { throw new Error('grouping denied'); };
  const result = await applyOrganization({ plan, chromeRef });
  assert.equal(result.partial, true);
  assert.equal(result.groups.length, 0);
  assert.equal(result.failures.length, 3);
  assert.equal(result.failures[0].operation, 'group');
});

test('a failing close is reported per tab', async () => {
  const { plan, chromeRef } = await planFixture();
  plan.items.find((item) => item.tabId === 3).closeSelected = true;
  const originalRemove = chromeRef.tabs.remove;
  chromeRef.tabs.remove = async (tabId) => {
    if (tabId === 3) throw new Error('close denied');
    return originalRemove(tabId);
  };
  const result = await applyOrganization({ plan, chromeRef });
  assert.equal(result.partial, true);
  assert.equal(result.closureFailed, 1);
  assert.equal(result.closureCompleted, 0);
  assert.equal(result.failures.some((failure) => failure.operation === 'close' && failure.tabId === 3), true);
});

test('an invalid category in the approved plan blocks the whole apply', async () => {
  const { plan, chromeRef } = await planFixture();
  plan.items[0].category = 'Gambling';
  await assert.rejects(
    () => applyOrganization({ plan, chromeRef }),
    (error) => {
      assert.equal(error.code, 'INVALID_REQUEST');
      return true;
    },
  );
});

test('a missing review plan cannot be applied', async () => {
  const { chromeRef } = fakeChrome(sampleTabs());
  await assert.rejects(
    () => applyOrganization({ plan: null, chromeRef }),
    (error) => {
      assert.equal(error.code, 'INVALID_REQUEST');
      return true;
    },
  );
});
