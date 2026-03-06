# Python测试文件

def calculate_sum(a, b):
    return a + b


def process_data(data):
    total = 0
    for i in range(len(data)):
        total += data[i]
    return total


if __name__ == "__main__":
    x = 10
    y = 20
    result = calculate_sum(x, y)
    print(f"Sum: {result}")
    
    data = [1, 2, 3, 4, 5]
    result = process_data(data)
    print(f"Processed result: {result}")