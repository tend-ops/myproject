#!/usr/bin/env python3
"""
测试Agent反思机制
"""

from review_agent.agent_logic import produce_review
from review_agent.types import AgentReviewInput

def test_reflection():
    """测试反思机制"""
    print("=== 测试Agent反思机制 ===")
    
    # 准备测试代码
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
    
    # 创建输入
    input_data = AgentReviewInput(
        languageId="python",
        filePath="test.py",
        code=test_code
    )
    
    print("测试代码:")
    print(test_code)
    print("\n" + "="*50 + "\n")
    
    try:
        # 调用produce_review函数
        result = produce_review(input_data)
        
        print("审查结果:")
        print(f"总问题数: {len(result.mergedItems)}")
        print("问题列表:")
        for item in result.mergedItems:
            print(f"- [{item.category.upper()}] {item.message}")
        
        # 检查是否包含反思结果
        if result.ai_result and "包含反思改进" in result.ai_result.summary:
            print("\n反思机制已成功运行！")
        else:
            print("\n反思机制未运行（可能是AI调用失败）")
            
    except Exception as e:
        print(f"测试失败: {str(e)}")

if __name__ == "__main__":
    test_reflection()
