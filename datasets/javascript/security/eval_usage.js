/**
 * Execute arbitrary code - security risk!
 */
function executeCode(code) {
    const result = eval(code); // 安全漏洞：使用eval执行任意代码
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = executeCode;
} else {
    window.executeCode = executeCode;
}

// Test
const userInput = prompt("Enter code to execute: ");
const result = executeCode(userInput);
console.log(`Result: ${result}`);