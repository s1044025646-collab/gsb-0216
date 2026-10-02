# 本地词典拼写检查与纠错候选后端

基于 TypeScript + Node.js + SQLite 的本地英文单词拼写检查服务，提供 HTTP API 与 CLI。
只做后端，不依赖 Docker / WSL / 外部在线 API；运行时零第三方依赖（SQLite 使用
Node.js 内置 `node:sqlite`，HTTP 使用内置 `node:http`）。

## 功能范围

- 词典分组管理：多个分组互相隔离，查询不混查
- 词条管理：批量导入（CSV）、增、删、改词频、列出、导出
- 拼写检查：正确词明确识别（`correct: true`）；错误词返回纠错候选
- 纠错候选：自行实现的标准 Levenshtein 编辑距离（插入/删除/替换各一步，
  相邻字母交换不特殊处理，按两次普通操作计）
- 距离解释：查询任意两个词的编辑距离
- 查询历史：每次查询的输入原文与当时输出都落库保留，词典后续修改不影响历史
- 不包含：整段文本语法纠错、在线词典下载

## 关键规则

- 输入仅限英文字母（`^[A-Za-z]+$`，最长 64），其余字符报 `INVALID_WORD`
- 大小写统一按小写存储与比较；用户输入原文在结果与历史中保留
- 词频必须是 0 到 1e12 的整数，否则报 `INVALID_FREQ`
- 阈值 `threshold` 限定 0、1、2（默认 2）；数量 `limit` 1–100（默认 10）
- 候选排序：编辑距离升序 → 词频降序 → 词条字典序
- 重复词条：批量导入时跳过并在 `skippedDuplicates` 中报告；
  单个添加重复词条返回 409 `DUPLICATE_WORD`
- 批量导入先全量校验，任何非法行整体失败并回滚，不留下部分结果

## 环境与构建

要求 Node.js >= 22.5（使用内置 `node:sqlite`，会有 ExperimentalWarning，属正常）。

```powershell
npm install      # 安装 TypeScript 等开发依赖
npm run build    # 编译到 dist/
npm test         # 构建并运行全部自动化测试
npm run gen-data # 生成可重建的 4000 词批量演示词表 data/bulk-words.csv
npm run demo     # 运行演示（漏字/多字/替换/词频调整/批量计时）
```

## 启动服务

```powershell
npm start                 # 默认自动选择空闲端口，控制台打印实际端口
node dist/src/server.js --port 8080   # 指定端口（也可用环境变量 PORT）
```

数据文件默认保存在项目内 `data/spellcheck.db`，可用环境变量
`SPELLCHECK_DATA_DIR` 更换数据目录。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/groups` | 创建分组 `{ "name": "main" }` |
| GET | `/groups` | 列出分组与词条数 |
| POST | `/groups/:g/words` | 新增词条 `{ "word": "apple", "freq": 100 }` |
| PUT | `/groups/:g/words/:word` | 修改词频 `{ "freq": 200 }` |
| DELETE | `/groups/:g/words/:word` | 删除词条 |
| GET | `/groups/:g/words` | 列出词条 |
| POST | `/groups/:g/import` | 批量导入 `{ "words": [{word,freq}, ...] }` |
| GET | `/groups/:g/history?limit=50` | 查询历史 |
| GET | `/groups/:g/export` | 导出 CSV |
| GET/POST | `/check` | 拼写检查 |
| GET | `/explain?from=a&to=b&group=g` | 编辑距离解释 |

输入样例：

```
GET /check?word=frend&group=main&threshold=2&limit=3
```

输出样例：

```json
{
  "input": "frend",
  "normalized": "frend",
  "group": "main",
  "threshold": 2,
  "limit": 3,
  "correct": false,
  "candidates": [
    { "word": "friend", "freq": 2600, "distance": 1 },
    { "word": "fiend", "freq": 120, "distance": 1 },
    { "word": "friends", "freq": 2400, "distance": 2 }
  ]
}
```

错误统一返回 `{ "error": { "code", "message", "details?" } }`，错误码包括
`INVALID_WORD`、`INVALID_FREQ`、`INVALID_THRESHOLD`、`INVALID_LIMIT`、
`GROUP_NOT_FOUND`、`WORD_NOT_FOUND`、`DUPLICATE_WORD`、`DUPLICATE_GROUP`、
`IMPORT_FAILED`、`BAD_REQUEST`、`NOT_FOUND`。

## CLI 一览

```powershell
node dist/src/cli.js serve --port 8080
node dist/src/cli.js create-group main
node dist/src/cli.js import main data/demo-words.csv
node dist/src/cli.js add main apple 100
node dist/src/cli.js update main apple 200
node dist/src/cli.js remove main apple
node dist/src/cli.js words main
node dist/src/cli.js check main frend --threshold 2 --limit 5
node dist/src/cli.js explain main kitten sitting
node dist/src/cli.js history main 10
node dist/src/cli.js export main out.csv
```

词表文件格式：每行 `word,freq`，支持 `#` 注释与空行（见 `data/demo-words.csv`）。

## 测试与性能

`npm test` 覆盖：已知词对距离核对（kitten/sitting=3、recieve/receive=2 等）、
正确词识别、阈值边界、大小写归一、并列排序、词条删除后历史保留、
错误导入整体回滚、重复词条处理、参数校验、分组隔离、重启后数据持久。

`npm run demo` 使用 4000 词的可重建词表执行 200 次批量查询并报告耗时
（本机实测约 5 ms/次；仅作参考，不设硬性指标）。

## 已知限制

- 候选采用全表扫描 + 逐词计算距离，数千到数万词条规模表现良好，
  未做超大规模索引优化
- `node:sqlite` 在 Node.js 中仍标记为实验特性，启动时会打印警告
- 仅处理单词级别，不做分词与语法纠错
