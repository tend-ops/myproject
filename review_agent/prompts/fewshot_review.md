[示例1]
语言: python
代码:
def run(cmd):
    user = input("cmd:")
    eval(user)
输出:
- [security] 避免使用 eval 执行用户输入，建议改为白名单命令映射
- [style] 函数缺少异常处理，建议捕获并记录错误

[示例2]
语言: javascript
代码:
for (let i = 0; i < arr.length; i++) { console.log(arr[i]); }
输出:
- [performance] 高频循环内直接读取 arr.length，建议缓存长度
- [style] 避免在生产代码使用 console.log 调试输出

[示例3]
语言: typescript
代码:
function f(data:any){ return data.name.toUpperCase() }
输出:
- [style] 避免 any，建议使用明确接口类型
- [security] 访问 data.name 前应校验可用性，避免运行时异常

[示例4]
语言: java
代码:
Statement st = conn.createStatement();
ResultSet rs = st.executeQuery("SELECT * FROM t WHERE id=" + id);
输出:
- [security] 存在 SQL 注入风险，建议使用 PreparedStatement 参数化查询
- [refactor] 建议使用 try-with-resources 自动关闭数据库资源
