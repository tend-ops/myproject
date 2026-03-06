/**
 * Calculate the sum of an array of numbers.
 */
function calculateSum(numbers) {
    total = 0; // 未声明的变量
    for (var i = 0; i < numbers.length; i++) {
        total += numbers[i];
    }
    return total;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = calculateSum;
} else {
    window.calculateSum = calculateSum;
}

// Test
numbers = [1, 2, 3, 4, 5]; // 未声明的变量
result = calculateSum(numbers); // 未声明的变量
console.log(`Sum: ${result}`);