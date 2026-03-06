def execute_code(code):
    """
    Execute arbitrary code - security risk!
    """
    result = eval(code)  # 安全漏洞：使用eval执行任意代码
    return result


def process_data(data):
    # 长函数示例
    total = 0
    for i in range(len(data)):
        total += data[i]
    for i in range(len(data)):
        total += data[i] * 2
    for i in range(len(data)):
        total += data[i] * 3
    for i in range(len(data)):
        total += data[i] * 4
    for i in range(len(data)):
        total += data[i] * 5
    for i in range(len(data)):
        total += data[i] * 6
    for i in range(len(data)):
        total += data[i] * 7
    for i in range(len(data)):
        total += data[i] * 8
    for i in range(len(data)):
        total += data[i] * 9
    for i in range(len(data)):
        total += data[i] * 10
    return total


if __name__ == "__main__":
    user_input = input("Enter code to execute: ")
    result = execute_code(user_input)
    print(f"Result: {result}")
    
    data = [1, 2, 3, 4, 5]
    result = process_data(data)
    print(f"Processed result: {result}")