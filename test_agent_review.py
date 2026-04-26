#!/usr/bin/env python3
"""
智能代码审查AI Agent测试用例
测试AI Agent对不同类型问题的检测能力
"""

import json
import asyncio
import requests

def create_test_code():
    """创建包含各种问题的测试代码"""
    test_code = '''
# 测试代码 - 包含各种问题
def example_function():
    # 语法错误：缺少冒号
    for i in range(10)
        print(i)
    
    # 安全漏洞：使用eval
    user_input = input("请输入命令: ")
    eval(user_input)
    
    # 性能问题：循环中使用len()
    items = [1, 2, 3, 4, 5]
    for i in range(len(items)):
        print(items[i])
    
    # 重构建议：代码行过长
    result = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 13 + 14 + 15 + 16 + 17 + 18 + 19 + 20
    
    # 调试打印语句
    print("debug: 函数执行完成")
    
    return result

# 未使用的变量
unused_variable = "这是一个未使用的变量"

if __name__ == "__main__":
    example_function()
'''
    return test_code

async def test_agent_review():
    """测试AI Agent代码审查"""
    print("=== 智能代码审查AI Agent测试 ===")
    
    # 准备测试数据
    test_code = create_test_code()
    test_data = {
        "file_path": "test.py",
        "language": "python",
        "code": test_code,
        "syntax_errors": [],  # 让AI Agent自己检测
        "lint_issues": []     # 让AI Agent自己检测
    }
    
    print("测试代码:")
    print(test_code)
    print("\n" + "="*50 + "\n")
    
    try:
        # 发送请求到AI Agent服务器
        response = requests.post(
            "http://localhost:8000/api/review",
            json=test_data,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("审查结果:")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            
            # 分析结果
            print("\n" + "="*50 + "\n")
            print("结果分析:")
            print(f"总问题数: {result['summary']['total_issues']}")
            print("按类别统计:")
            for category, count in result['summary']['by_category'].items():
                print(f"  {category}: {count}")
            
            print(f"\n执行时间: {result['execution_time']['total']:.2f}ms")
            
        else:
            print(f"请求失败: {response.status_code}")
            print(response.text)
            
    except Exception as e:
        print(f"测试失败: {str(e)}")
        print("请确保AI Agent服务器正在运行 (python python/main.py)")

if __name__ == "__main__":
    asyncio.run(test_agent_review())