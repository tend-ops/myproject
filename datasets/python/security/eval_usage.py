def execute_code(code):
    """
    Execute arbitrary code - security risk!
    """
    result = eval(code)  # 安全漏洞：使用eval执行任意代码
    return result

if __name__ == "__main__":
    user_input = input("Enter code to execute: ")
    result = execute_code(user_input)
    print(f"Result: {result}")