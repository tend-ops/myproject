# 代码审查数据集准备与标注说明

本目录用于存放多语言代码样本数据集，用于**规则适配与模型调优**、**功能验证**，对应毕业论文「代码解析引擎搭建与数据集准备」部分。

---

## 一、目录结构建议

```
datasets/
  python/           # Python 样本
    normal/          # 正常、规范代码
    syntax_error/    # 含语法错误
    style_violation/ # 不规范（命名、格式等）
    security/        # 含安全漏洞（eval、SQL 注入等）
  javascript/
    normal/
    syntax_error/
    style_violation/
    security/
  typescript/
    ...
  java/
    ...
  labels.json        # 可选：统一标注索引（见下方标注维度）
```

可按需增删子目录，保持「按语言 + 按类型」分类即可。

---

## 二、标注维度（为后续功能验证提供数据支撑）

建议在 `labels.json` 或各文件同目录下的 `labels.csv` 中明确以下维度：

| 维度           | 说明                     | 示例值                           |
|----------------|--------------------------|----------------------------------|
| 语法错误类型   | Tree-sitter / 解析报错   | `parse_error`, `indent_error`   |
| 规范违规类别   | 对应 Pylint/ESLint/Checkstyle 规则 | `naming`, `complexity`, `unused` |
| 漏洞等级       | 安全相关问题             | `high`, `medium`, `low`         |
| 是否用于模型调优 | 是否参与 prompt 示例     | `true` / `false`                |

标注文件示例（`labels.json`）：

```json
{
  "python/syntax_error/broken_indent.py": {
    "syntax_error_type": "indent_error",
    "norm_violation": [],
    "vulnerability_level": null,
    "for_model_tuning": true
  },
  "python/security/eval_usage.py": {
    "syntax_error_type": null,
    "norm_violation": ["eval-used"],
    "vulnerability_level": "high",
    "for_model_tuning": true
  }
}
```

---

## 三、样本类型说明

- **正常代码**：无语法错误、符合规范，用于验证无误报。
- **语法错误代码**：故意保留语法错误，用于验证 Tree-sitter 及插件「语法错误检测」。
- **不规范代码**：命名、复杂度、未使用变量等，用于验证 Pylint/ESLint/Checkstyle 规则引擎。
- **含安全漏洞代码**：如 `eval`、`exec`、潜在注入等，用于验证安全漏洞识别与高风险标记。
- **可重构代码**：长函数、重复代码等，用于验证「性能优化建议」与「重构方案生成」。

收集与标注完成后，可在插件中通过「全流程审查」对上述样本逐类测试，用于论文中的功能准确性测试与实验结果整理。
