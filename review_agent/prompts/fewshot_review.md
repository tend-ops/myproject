# Few-shot（范式约束）：模型只输出 JSON，严禁解释、前缀、后缀或 Markdown 列表。
# 仅输出一个合法 JSON 数组；数组元素对象为：category（小写）、line（整数，未知为 0）、message（单行字符串）。

[示例1 — python]
语言: python
代码:
def run(cmd):
    user = input("cmd:")
    eval(user)
输出:
[{"category":"security","line":3,"message":"避免使用 eval 执行用户输入，建议白名单命令映射或安全 API"},{"category":"style","line":1,"message":"缺少类型注解与错误处理，建议补充并记录异常"}]

[示例2 — javascript]
语言: javascript
代码:
for (let i = 0; i < arr.length; i++) { console.log(arr[i]); }
输出:
[{"category":"performance","line":1,"message":"循环中重复访问 arr.length，建议缓存为局部常量"},{"category":"style","line":1,"message":"生产代码避免 console.log，改用日志库或移除"}]

[示例3 — java]
语言: java
代码:
Statement st = conn.createStatement();
ResultSet rs = st.executeQuery("SELECT * FROM t WHERE id=" + id);
输出:
[{"category":"security","line":2,"message":"字符串拼接 SQL 存在注入风险，应使用 PreparedStatement 绑定参数"},{"category":"refactor","line":1,"message":"应使用 try-with-resources 管理 Connection/Statement/ResultSet 关闭"}]

[示例4 — typescript]
语言: typescript
代码:
function f(data:any){ return data.name.toUpperCase() }
输出:
[{"category":"style","line":1,"message":"避免 any，使用明确接口或泛型约束"},{"category":"security","line":1,"message":"访问 data.name 前应做空值与类型校验"}]
