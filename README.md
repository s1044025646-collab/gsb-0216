# 本地词典拼写检查与纠错候选后端

基于 TypeScript + Node.js + SQLite（`node:sqlite`，零原生依赖）的本地英文单词拼写检查服务，仅提供 HTTP API 与 CLI，不依赖 Docker / WSL / 在线服务。

## 支持范围

- 仅处理**单个英文单词**（A–Z/a–z），不做整段文本或语法纠错。
- 大小写统一按小写处理；查询日志中保留用户输入原文。
- 自行实现经典 Levenshtein 编辑距离：插入、删除、替换各计 1 步；**相邻字母交换不单独算 1 步**（按普通编辑距离计为 2）。
- 纠错阈值 `threshold` 限定为 0–2，结果数量 `limit` 可配置（1–100，默认 10）。
- 候选排序规则：**编辑距离升序 → 词频降序 → 词条字典序升序**。
- 已正确拼写的词返回 `correct: true`；无候选时返回空数组。
- 不同词典分组（dictionary）相互隔离，不会混查。
- 词典更新（增删改/导入）在下一次查询即生效（按词典缓存 + 变更失效）。
- 每次查询的输入与输出快照持久化在 `queries` 表，重启后仍可查看。

## 输入校验与错误码

| 错误码 | 含义 |
| --- | --- |
| `INVALID_WORD` | 含非字母字符、空串或超长（>64） |
| `INVALID_FREQUENCY` | 词频非 0–1e9 的整数 |
| `INVALID_THRESHOLD` | 阈值非 0–2 的整数 |
| `INVALID_LIMIT` | 数量非 1–100 的整数 |
| `DUPLICATE_WORD` / `DUPLICATE_DICTIONARY` | 重复词条 / 重复词典名（词条大小写归一后判重） |
| `DICT_NOT_FOUND` / `WORD_NOT_FOUND` | 词典 / 词条不存在 |
| `IMPORT_FAILED` | 批量导入失败，**整体回滚**，不留部分结果（报错信息注明出错行号） |

## 快速开始

```powershell
npm install
npm run build        # TypeScript 编译到 dist/
npm test             # 运行全部自动化测试
npm run demo         # 演示：漏字/多字/替换 + 词频调序
npm run gen:words    # 生成可重建的 6000 词批量词表 data/bulk-dict.txt
npm run bench        # 批量导入 + 500 次查询并报告耗时
```

要求 Node.js ≥ 22.5（使用了内置 `node:sqlite` 与 TypeScript 类型剥离；开发环境为 Node 25）。

## CLI

```powershell
npm run cli -- dict-create main
npm run cli -- import main data/demo-dict.txt     # 每行 "单词,词频"，# 为注释
npm run cli -- check main speling --threshold 2 --limit 5
npm run cli -- explain main speling               # 查看各词条的编辑距离
npm run cli -- add main hello 100
npm run cli -- update main hello 200
npm run cli -- remove main hello
npm run cli -- history --limit 10
npm run cli -- export main
npm run cli -- serve --port 8080                  # 不传 --port 时自动选择空闲端口
```

数据库默认位于项目内 `data/spellcheck.db`，可用环境变量 `SPELLCHECK_DB` 覆盖。

## HTTP API

`npm start`（等价于 `cli serve`）启动后：

| 方法与路径 | 说明 |
| --- | --- |
| `POST /dictionaries` `{name}` | 新建词典分组 |
| `GET /dictionaries` | 列出分组 |
| `POST /dictionaries/:dict/import` `{entries:[{word,frequency}]}` | 批量导入（事务，失败整体回滚） |
| `GET /dictionaries/:dict/entries` | 导出词条 |
| `POST /dictionaries/:dict/entries` `{word,frequency}` | 新增词条 |
| `PATCH /dictionaries/:dict/entries/:word` `{frequency}` | 修改词频 |
| `DELETE /dictionaries/:dict/entries/:word` | 删除词条 |
| `GET /dictionaries/:dict/check?word=speling&threshold=2&limit=5` | 拼写检查 |
| `GET /dictionaries/:dict/explain?word=speling&limit=20` | 解释候选距离 |
| `GET /queries?limit=50` | 查询历史 |

### 输入 / 输出样例

```
GET /dictionaries/main/check?word=speling&threshold=2&limit=3
```

```json
{
  "input": "speling",
  "normalized": "speling",
  "correct": false,
  "threshold": 2,
  "limit": 3,
  "candidates": [
    { "word": "spelling", "distance": 1, "frequency": 500 },
    { "word": "selling",  "distance": 2, "frequency": 300 },
    { "word": "spilling", "distance": 2, "frequency": 120 }
  ]
}
```

错误响应统一为：

```json
{ "error": { "code": "INVALID_WORD", "message": "...", "details": null } }
```

## 项目结构

```
src/levenshtein.ts   编辑距离（动态规划，两行滚动数组）
src/errors.ts        参数校验与错误码
src/db.ts            SQLite 存储（dictionaries / entries / queries）
src/checker.ts       候选生成、排序、按词典缓存
src/server.ts        HTTP API（node:http，默认自动选空闲端口）
src/cli.ts           命令行入口
src/demo.ts          演示脚本
src/bench.ts         批量查询基准
scripts/generate-wordlist.ts  确定性生成 6000 词词表
data/demo-dict.txt   演示词表（含易混词与不同词频）
tests/               node:test 自动化测试
```

## 已知限制

- 候选生成是对词条全表扫描 + 长度差剪枝，数千到数万词条规模足够，未做超大规模索引优化。
- 相邻字母交换按普通编辑距离处理（计 2 步），不是 Damerau 变体。
- 仅支持英文 ASCII 字母单词，不支持词组、连字符词与变形还原（词形还原）。
