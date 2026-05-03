'use strict';

const assert = require('assert');

// 需在扩展编译后运行： npm run compile
const { parseAgentReviewResponse } = require('../out/agentPayload.js');

function testPrefersMergedItemsOverIssues() {
  const merged = [{ id: 'm1', source: 'rule', category: 'security', message: 'sql', severity: 'error', line: 5, column: 0 }];
  const issuesLegacy = [{ category: 'style', message: 'legacy', severity: 'warning', line: 1 }];
  const items = parseAgentReviewResponse({
    mergedItems: merged,
    issues: issuesLegacy
  });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].message, 'sql');
  assert.strictEqual(items[0].line, 5);
}

function testFallsBackToIssuesWhenNoMergedItems() {
  const issues = [{ category: 'performance', message: 'cache', severity: 'info', line: 2 }];
  const items = parseAgentReviewResponse({ issues });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].category, 'performance');
  assert.strictEqual(items[0].severity, 'info');
}

function testMapsUnknownCategoryToStyle() {
  const items = parseAgentReviewResponse({
    mergedItems: [{ category: 'unknown_xyz', message: 'x', severity: 'warning', line: 0 }]
  });
  assert.strictEqual(items[0].category, 'style');
}

function testSourceRuleVsAi() {
  const rule = parseAgentReviewResponse({
    mergedItems: [{ source: 'rule', category: 'syntax', message: '', severity: 'error', line: 1 }]
  })[0];
  const ai = parseAgentReviewResponse({
    mergedItems: [{ category: 'refactor', message: '', severity: 'warning', line: 1 }]
  })[0];
  assert.strictEqual(rule.source, 'rule');
  assert.strictEqual(ai.source, 'ai');
}

function run() {
  testPrefersMergedItemsOverIssues();
  testFallsBackToIssuesWhenNoMergedItems();
  testMapsUnknownCategoryToStyle();
  testSourceRuleVsAi();
  console.log('agent.contract.test.cjs: all passed');
}

run();
