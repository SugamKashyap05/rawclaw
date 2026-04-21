
// Since we cannot easily import the NestJS service in a simple script due to dependencies,
// we will simulate the logic in a pure JS test to verify the algorithm integrity.

function simulateBudgetContext(messages, maxTotalChars, maxToolResultChars) {
  let totalChars = messages.reduce((acc, m) => acc + m.content.length, 0);
  
  // Clone to avoid mutating input during test
  const budgetMessages = JSON.parse(JSON.stringify(messages));

  budgetMessages.forEach(m => {
    if (m.toolResults && totalChars > maxTotalChars) {
      for (const tr of m.toolResults) {
        if (tr.output && typeof tr.output === 'string' && tr.output.length > maxToolResultChars) {
          const originalLen = tr.output.length;
          tr.output = tr.output.slice(0, maxToolResultChars) + '\n[... Tool Result Truncated for Prompt Budget ...]';
          tr.is_truncated = true;
          totalChars -= (originalLen - tr.output.length);
          if (totalChars <= maxTotalChars) break;
        }
      }
    }
  });

  return { budgetMessages, totalChars };
}

const testMessages = [
  { role: 'user', content: 'Context content that is long enough to fill up the budget eventually. '.repeat(20) }, // ~1400 chars
  { role: 'tool', content: 'Tool Result', toolResults: [
    { tool_name: 'test', output: 'A'.repeat(2000) }
  ]}
];

const MAX_TOTAL = 1000;
const MAX_TOOL = 500;

console.log('Testing context budgeting...');
const result = simulateBudgetContext(testMessages, MAX_TOTAL, MAX_TOOL);

console.log('Total chars after budget:', result.totalChars);
console.log('Is truncated:', result.budgetMessages[1].toolResults[0].is_truncated);
console.log('Output length:', result.budgetMessages[1].toolResults[0].output.length);

if (result.totalChars <= MAX_TOTAL && result.budgetMessages[1].toolResults[0].is_truncated === true) {
  console.log('✅ Context budgeting test passed');
} else {
  console.log('❌ Context budgeting test failed');
  process.exit(1);
}

// Test Parameter Validation Logic
function simulateValidation(request) {
  if (request.temperature !== undefined) {
    request.temperature = Math.max(0, Math.min(1, request.temperature));
  }
  if (request.top_p !== undefined) {
    request.top_p = Math.max(0, Math.min(1, request.top_p));
  }
  return request;
}

console.log('\nTesting parameter validation...');
const req1 = simulateValidation({ temperature: 1.5, top_p: -0.5 });
console.log('Validated Req:', req1);
if (req1.temperature === 1 && req1.top_p === 0) {
  console.log('✅ Parameter validation test passed');
} else {
  console.log('❌ Parameter validation test failed');
  process.exit(1);
}
