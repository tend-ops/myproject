// JavaScript测试文件

function calculateSum(a, b) {
    return a + b;
}

function processData(data) {
    let total = 0;
    for (let i = 0; i < data.length; i++) {
        total += data[i];
    }
    return total;
}

// 测试
const x = 10;
const y = 20;
const result = calculateSum(x, y);
console.log(`Sum: ${result}`);

const data = [1, 2, 3, 4, 5];
const processedResult = processData(data);
console.log(`Processed result: ${processedResult}`);