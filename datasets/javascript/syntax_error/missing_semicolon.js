/**
 * Calculate the sum of an array of numbers.
 */
function calculateSum(numbers) {
    let total = 0
    for (const number of numbers) {
        total += number
    }
    return total
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = calculateSum
} else {
    window.calculateSum = calculateSum
}

// Test
const numbers = [1, 2, 3, 4, 5]
const result = calculateSum(numbers)
console.log(`Sum: ${result}`)